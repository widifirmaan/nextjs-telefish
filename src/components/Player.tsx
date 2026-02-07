"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

// ============================================
// Type Definitions
// ============================================

interface PlayerProps {
    url: string;
    title: string;
    onClose: () => void;
    headers?: Record<string, string>;
    license?: string;
    licenseHeader?: string;
    type?: string;
    // Channel navigation props
    channels?: ChannelInfo[];
    currentIndex?: number;
    onChannelChange?: (channel: ChannelInfo, index: number) => void;
}

interface ChannelInfo {
    id: string;
    name: string;
    hls: string;
    header_iptv?: string;
    url_license?: string;
    header_license?: string;
    jenis?: string;
    image?: string;
    tagline?: string;
}

interface ErrorState {
    show: boolean;
    message: string | null;
}

interface StreamDetectionResult {
    type: 'm3u8' | 'mpd';
    url: string;
}

// ============================================
// Helper Functions (Extracted to avoid duplication)
// ============================================

/**
 * Setup WebKit/Safari autoplay with muted video
 * Extracted to avoid code duplication (was repeated 3x)
 */
const setupWebKitAutoplay = (video: HTMLMediaElement): void => {
    try {
        video.muted = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
    } catch (e) {
        console.warn('[Player] Failed to setup WebKit autoplay:', e);
    }
};

/**
 * Convert base64 to hex string
 * Used for clearkey DRM key conversion
 */
const base64ToHex = (base64: string): string => {
    let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) {
        normalized += '=';
    }
    const binary = atob(normalized);
    let hex = '';
    for (let i = 0; i < binary.length; i++) {
        hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
};

/**
 * Check if URL is HTTP/HTTPS stream
 */
const isHttpUrl = (str: string): boolean => {
    return str.startsWith('http://') || str.startsWith('https://');
};

/**
 * Check if URL contains HLS stream
 */
const hasHlsExtension = (url?: string): boolean => {
    if (!url) return false;
    return url.includes('.m3u8') || url.toLowerCase().includes('m3u8');
};

// ============================================
// Component
// ============================================

export default function Player({
    url,
    title,
    onClose,
    headers,
    license,
    licenseHeader,
    type,
    channels,
    currentIndex = 0,
    onChannelChange
}: PlayerProps) {
    const artRef = useRef<HTMLDivElement>(null);
    const ttmlRef = useRef<HTMLDivElement>(null);

    // Refs untuk cleanup
    const hlsRef = useRef<Hls | null>(null);
    const dashRef = useRef<any>(null);
    const artInstanceRef = useRef<any>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Memoized headers untuk menghindari re-render tidak perlu
    const memoizedHeaders = useMemo(() => headers, [headers]);

    // Unified error state
    const [errorState, setErrorState] = useState<ErrorState>({
        show: false,
        message: null
    });

    // Loading state for DRM patching overlay
    const [isLoading, setIsLoading] = useState(true);

    // ============================================
    // Helper Methods
    // ============================================

    /**
     * Detect actual stream URL and license from props
     * Handles Events channels where fields may be swapped
     */
    const getStreamInfo = useCallback(() => {
        const actualStreamUrl = license && isHttpUrl(license) ? license : url;
        const actualLicense = license && isHttpUrl(license) ? null : license;
        return { actualStreamUrl, actualLicense };
    }, [url, license]);

    /**
     * Construct proxy URL with headers
     */
    const getProxyUrl = useCallback((targetUrl: string, drm?: string, useAndroidHeaders?: boolean): string => {
        const params = new URLSearchParams({ url: targetUrl });
        if (drm) params.append('drm', drm);
        if (useAndroidHeaders) params.append('android', '1');

        // Default headers mimicking Android App
        if (!params.has('user_agent')) {
            params.append('user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0');
        }

        if (!params.has('referer') && (!memoizedHeaders || !memoizedHeaders['referer'])) {
            params.append('referer', 'https://duktek.id/?device=BitTVWeb&is_genuine=true');
        }

        if (!params.has('origin') && (!memoizedHeaders || !memoizedHeaders['origin'])) {
            params.append('origin', 'https://duktek.id');
        }

        // Case-insensitive header lookup
        if (memoizedHeaders) {
            const getHeader = (key: string) => 
                Object.keys(memoizedHeaders).find(k => k.toLowerCase() === key.toLowerCase());

            const refererKey = getHeader('referer');
            if (refererKey) params.set('referer', memoizedHeaders[refererKey]);

            const originKey = getHeader('origin');
            if (originKey) params.set('origin', memoizedHeaders[originKey]);

            const uaKey = getHeader('user-agent');
            if (uaKey) params.set('user_agent', memoizedHeaders[uaKey]);
        }

        return `/api/playlist/proxy?${params.toString()}`;
    }, [memoizedHeaders]);

    /**
     * Probe a proxied URL to check availability
     * Returns true when the proxied endpoint responds successfully
     */
    const probeProxied = useCallback(async (proxyUrl: string): Promise<boolean> => {
        try {
            // Create new abort controller for this probe
            const controller = new AbortController();
            
            // Set timeout to abort after 5 seconds
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            // Try HEAD first to minimize bandwidth
            let res = await fetch(proxyUrl, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            if (res && res.status >= 200 && res.status < 400) return true;

            // Some servers disallow HEAD; try lightweight GET with Range
            controller.abort(); // Abort previous, create new
            const controller2 = new AbortController();
            res = await fetch(proxyUrl, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: controller2.signal });
            if (res && res.status >= 200 && res.status < 400) return true;

            return false;
        } catch (e: any) {
            // Ignore expected abort errors
            if (e.name === 'AbortError' || e.message?.includes('aborted')) {
                return false;
            }
            console.warn('[Player] Probe failed:', e.name);
            return false;
        }
    }, []);

    /**
     * Detect stream type from URL and props
     */
    const detectStreamType = useCallback((streamUrl: string, licenseUrl: string): StreamDetectionResult => {
        const isWebKit = typeof navigator !== 'undefined' && 
            /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

        // Find HLS candidate for WebKit
        const hlsCandidate = hasHlsExtension(streamUrl) ? streamUrl : 
            (hasHlsExtension(url) ? url : (hasHlsExtension(licenseUrl) ? licenseUrl : null));

        if (isWebKit && hlsCandidate) {
            console.log('[Player] WebKit detected - preferring HLS candidate');
            return { type: 'm3u8', url: hlsCandidate };
        }

        // Check explicit type prop
        if (type && (type.includes('dash') || type === 'mpd')) {
            console.log('[Player] Using explicit type prop (DASH):', type);
            return { type: 'mpd', url: streamUrl };
        }

        // Detect from URL extension
        if (streamUrl.includes('.mpd')) {
            console.log('[Player] Detected from URL: .mpd extension');
            return { type: 'mpd', url: streamUrl };
        }

        if (hasHlsExtension(streamUrl)) {
            console.log('[Player] Detected from URL: .m3u8 extension');
            return { type: 'm3u8', url: streamUrl };
        }

        // Default to HLS
        console.log('[Player] Defaulting to HLS');
        return { type: 'm3u8', url: streamUrl };
    }, [type, url]);

    /**
     * Unified error handler
     */
    const showError = useCallback((message?: string) => {
        setErrorState(prev => ({ show: true, message: message || null }));
    }, []);

    const hideError = useCallback(() => {
        setErrorState(prev => ({ show: false, message: null }));
    }, []);

    // ============================================
    // Channel Navigation Handlers
    // ============================================

    const handlePrevChannel = useCallback(() => {
        if (!channels || channels.length === 0 || currentIndex <= 0) return;
        const newIndex = currentIndex - 1;
        const newChannel = channels[newIndex];
        console.log('[Player] Previous channel:', newChannel.name, 'Index:', newIndex);
        onChannelChange?.(newChannel, newIndex);
    }, [channels, currentIndex, onChannelChange]);

    const handleNextChannel = useCallback(() => {
        if (!channels || channels.length === 0 || currentIndex >= channels.length - 1) return;
        const newIndex = currentIndex + 1;
        const newChannel = channels[newIndex];
        console.log('[Player] Next channel:', newChannel.name, 'Index:', newIndex);
        onChannelChange?.(newChannel, newIndex);
    }, [channels, currentIndex, onChannelChange]);

    const hasPrevChannel = channels && channels.length > 0 && currentIndex > 0;
    const hasNextChannel = channels && channels.length > 0 && currentIndex < channels.length - 1;

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') {
                handlePrevChannel();
            } else if (e.key === 'ArrowRight') {
                handleNextChannel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePrevChannel, handleNextChannel]);

    /**
     * Cleanup HLS instance
     */
    const cleanupHls = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }, []);

    /**
     * Cleanup DASH instance
     */
    const cleanupDash = useCallback(async () => {
        if (dashRef.current) {
            const prevPlayer = dashRef.current;
            dashRef.current = null;
            try {
                await prevPlayer.destroy();
            } catch (e) {
                console.warn('[Player] Failed to destroy DASH player:', e);
            }
        }
    }, []);

    /**
     * Cleanup artplayer instance
     */
    const cleanupArt = useCallback(() => {
        if (artInstanceRef.current) {
            try {
                artInstanceRef.current.destroy(true);
            } catch (e) {
                console.warn('[Player] Failed to destroy Artplayer:', e);
            }
            artInstanceRef.current = null;
        }
    }, []);

    // ============================================
    // Cleanup helper
    // ============================================

    const cleanupAll = useCallback(() => {
        // Clear error timeout
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = null;
        }

        // Cleanup video element
        if (artInstanceRef.current?.video) {
            try {
                const video = artInstanceRef.current.video;
                video.pause();
                video.src = '';
                video.load();
            } catch (e) {
                console.warn('[Player] Failed to cleanup video element:', e);
            }
        }

        // Cleanup media players
        cleanupHls();
        cleanupDash();
        cleanupArt();
    }, [cleanupHls, cleanupDash, cleanupArt]);

    // ============================================
    // Main useEffect
    // ============================================

    useEffect(() => {
        if (!artRef.current) return;

        let isActive = true;
        const { actualStreamUrl, actualLicense } = getStreamInfo();
        const { type: streamType, url: selectedUrl } = detectStreamType(actualStreamUrl, license || '');

        console.log('[Player] Stream Detection:', {
            selectedUrl,
            detectedType: streamType,
            typeFromProps: type,
            isMPD: selectedUrl.includes('.mpd'),
            urlLicenseUsedAsStream: license && isHttpUrl(license)
        });

        let useAndroidHeadersForPlayer = false;
        let art: any = null;

        const initPlayer = async () => {
            // Preflight probes
            const normalProxy = getProxyUrl(selectedUrl);
            const androidProxy = getProxyUrl(selectedUrl, undefined, true);
            let finalProxy = normalProxy;

            try {
                const ok = await probeProxied(normalProxy);
                if (!ok) {
                    const okAndroid = await probeProxied(androidProxy);
                    if (okAndroid) {
                        finalProxy = androidProxy;
                        useAndroidHeadersForPlayer = true;
                        console.log('[Player] Using Android-emulated proxy headers');
                    } else {
                        console.log('[Player] Preflight probes failed, using default');
                    }
                }
            } catch (e) {
                console.warn('[Player] Preflight probe threw:', e);
            }

            // Guard: only proceed if component is still active
            if (!isActive || !artRef.current) {
                console.log('[Player] Component unmounted, skipping Artplayer creation');
                return;
            }

            // Destroy any previous instance
            if (art) {
                try {
                    art.destroy(true);
                } catch (e) {
                    console.warn('[Player] Could not destroy previous instance:', e);
                }
            }

            art = new Artplayer({
                container: artRef.current,
                url: actualStreamUrl,
                title: title,
                volume: 1,
                isLive: true,
                muted: false,
                autoplay: true,
                autoSize: true,
                autoMini: true,
                setting: true,
                flip: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,
                fullscreenWeb: false,
                subtitleOffset: true,
                miniProgressBar: true,
                mutex: true,
                backdrop: true,
                playsInline: true,
                autoPlayback: false,
                airplay: true,
                theme: '#6366f1',
                loading: false,
                click: false,
                type: streamType,
                customType: {
                    m3u8: function (video: HTMLMediaElement, url: string) {
                        console.log('[Player] Processing M3U8 stream:', { 
                            url: actualStreamUrl, 
                            proxyUrl: getProxyUrl(actualStreamUrl) 
                        });

                        const proxyUrl = finalProxy || getProxyUrl(actualStreamUrl, undefined, useAndroidHeadersForPlayer);

                        // Setup CORS and playsinline for WebKit
                        try {
                            video.crossOrigin = 'anonymous';
                            video.setAttribute('webkit-playsinline', '');
                        } catch (e) {}

                        if (Hls.isSupported()) {
                            // Clean previous HLS instance
                            if (hlsRef.current) {
                                hlsRef.current.destroy();
                            }

                            const hls = new Hls({
                                xhrSetup: function (xhr, url) {
                                    // Route segment/chunk requests through proxy
                                    if (!url.includes('api/playlist/proxy')) {
                                        xhr.open('GET', getProxyUrl(url, undefined, useAndroidHeadersForPlayer), true);
                                    }
                                    try { xhr.withCredentials = false; } catch (e) {}
                                }
                            });

                            hls.loadSource(proxyUrl);
                            hls.attachMedia(video);
                            hlsRef.current = hls;

                            // WebKit autoplay - using extracted helper
                            if (typeof navigator !== 'undefined' && 
                                /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
                                setupWebKitAutoplay(video);
                                const p = video.play();
                                if (p && typeof p.catch === 'function') {
                                    p.catch(() => {});
                                }
                            }

                            hls.on(Hls.Events.ERROR, (event, data) => {
                                if (data?.fatal) {
                                    art.emit('error', data);
                                }
                            });
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            // Native HLS for Safari
                            try {
                                video.crossOrigin = 'anonymous';
                                video.setAttribute('webkit-playsinline', '');
                            } catch (e) {}

                            // WebKit autoplay - using extracted helper
                            if (typeof navigator !== 'undefined' && 
                                /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
                                setupWebKitAutoplay(video);
                                const p = video.play();
                                if (p && typeof p.catch === 'function') {
                                    p.catch(() => {});
                                }
                            }

                            video.src = proxyUrl;
                        }
                    },

                    mpd: async function (video: HTMLMediaElement, url: string) {
                        console.log('[Player] Initializing DASH stream:', { 
                            url: actualStreamUrl, 
                            hasShaka: typeof window !== 'undefined' && !!(window as any).shaka 
                        });

                        const shaka = await import('shaka-player') as any;
                        shaka.polyfill.installAll();

                        if (!shaka.Player.isBrowserSupported()) {
                            console.warn('[Player] Shaka not supported');
                            return;
                        }
                        if (!isActive) return;

                        // Cleanup previous DASH instance
                        if (dashRef.current) {
                            const prevPlayer = dashRef.current;
                            dashRef.current = null;
                            await prevPlayer.destroy();
                        }
                        if (!isActive) return;

                        const player = new shaka.Player();
                        await player.attach(video);
                        if (!isActive) {
                            await player.destroy();
                            return;
                        }

                        dashRef.current = player;
                        (window as any).__shakaPlayer = player;

                        // DRM configuration
                        const drmType = type?.includes('clearkey') ? 'clearkey' : undefined;
                        const proxiedManifestUrl = getProxyUrl(actualStreamUrl, drmType, useAndroidHeadersForPlayer) || 
                            (finalProxy || getProxyUrl(actualStreamUrl, drmType));

                        // Register request filter for proxy
                        player.getNetworkingEngine()?.registerRequestFilter((type: any, request: any) => {
                            if (request.uris?.length > 0) {
                                const uri = request.uris[0];
                                if (uri.startsWith('http') && 
                                    !uri.includes(window.location.host) && 
                                    !uri.includes('/api/playlist/proxy')) {
                                    request.uris[0] = getProxyUrl(uri, undefined, useAndroidHeadersForPlayer);
                                }
                            }
                        });

                        // Clearkey DRM setup
                        if (actualLicense && type === 'dash-clearkey') {
                            try {
                                const normalizedLicense = actualLicense.replace(/-/g, '+').replace(/_/g, '/');
                                const paddedLicense = normalizedLicense.length % 4 === 0 
                                    ? normalizedLicense 
                                    : normalizedLicense + '='.repeat(4 - (normalizedLicense.length % 4));
                                const licenseData = JSON.parse(atob(paddedLicense));

                                if (licenseData.keys) {
                                    const clearKeys: { [keyId: string]: string } = {};
                                    licenseData.keys.forEach((k: any) => {
                                        clearKeys[base64ToHex(k.kid)] = base64ToHex(k.k);
                                    });
                                    player.configure({ drm: { clearKeys: clearKeys } });
                                }
                            } catch (e) {
                                console.warn('[Player] Failed to setup clearkey:', e);
                            }
                        }

                        // Widevine DRM
                        if (license && type !== 'dash-clearkey' && license.startsWith('http')) {
                            player.configure({ drm: { servers: { 'com.widevine.alpha': license } } });
                        }

                        // Load manifest
                        try {
                            if (!isActive) return;
                            console.log('[Player] Loading DASH manifest:', proxiedManifestUrl);
                            await player.load(proxiedManifestUrl);
                            console.log('[Player] DASH manifest loaded successfully');

                            // WebKit autoplay after manifest load
                            if (isActive && 
                                typeof navigator !== 'undefined' && 
                                /AppleWebKit/.test(navigator.userAgent) && 
                                !/Chrome/.test(navigator.userAgent)) {
                                setupWebKitAutoplay(video);
                                const p = video.play();
                                if (p && typeof p.catch === 'function') {
                                    p.catch(() => {});
                                }
                            }
                        } catch (e: any) {
                            console.error('[Player] DASH Error:', {
                                message: e?.message,
                                code: e?.code,
                                stack: e?.stack,
                                url: proxiedManifestUrl
                            });
                            const errorMsg = e?.message || 'Failed to load DASH stream';
                            if (isActive) {
                                showError(errorMsg);
                                art.emit('error', e);
                            }
                        }
                    },
                },
            } as any);

            artInstanceRef.current = art;

            // Disable default loading indicator
            try { 
                if (art?.loading) {
                    art.loading.show = false;
                }
                // Hide all default loading elements
                if (art?.player?.classList) {
                    art.player.classList.remove('artplayer-loading');
                }
            } catch (e) {}

            // Always show custom DRM loading overlay
            setIsLoading(true);

            // Event handlers
            art.on('play', () => {
                setIsLoading(false);
                hideError();
            });

            art.on('video:waiting', () => {
                // Always show custom loading during buffering
                setIsLoading(true);
            });

            art.on('video:playing', () => {
                // Hide loading overlay when video actually plays
                setIsLoading(false);
                hideError();
            });

            art.on('canplay', () => {
                setIsLoading(false);
            });

            art.on('error', (err: any) => {
                console.error('[Player Error]', err);

                // Hide loading overlay
                setIsLoading(false);

                // Cleanup media players
                cleanupHls();
                cleanupDash();

                // Show error and schedule close
                showError();
                if (errorTimeoutRef.current) {
                    clearTimeout(errorTimeoutRef.current);
                }
                errorTimeoutRef.current = setTimeout(() => {
                    try { onClose(); } catch (e) {}
                }, 1200);
            });

            // Video element error listener
            try {
                art.video.addEventListener('error', () => {
                    showError();
                });
            } catch (e) {}
        };

        // Initialize player
        initPlayer();

        // Cleanup on unmount
        return () => {
            isActive = false;
            cleanupAll();
        };
    }, [
        url, title, license, licenseHeader, type,
        memoizedHeaders,
        getStreamInfo, detectStreamType, getProxyUrl, probeProxied,
        showError, hideError, cleanupHls, cleanupDash, cleanupAll, onClose
    ]);

    // ============================================
    // Render
    // ============================================

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className={`relative w-[80vw] h-[80vh] glass-card overflow-hidden rounded-2xl group transition-all duration-300 ${isLoading ? 'border-primary/30 shadow-lg shadow-primary/10' : ''}`}>
                {/* Glass card loading effect */}
                {isLoading && (
                    <div className="absolute inset-0 z-20 pointer-events-none">
                        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20 overflow-hidden">
                            <div className="h-full bg-primary/60 animate-pulse w-1/3"></div>
                        </div>
                    </div>
                )}
                <div ref={artRef} className="w-full h-full" />
                <div ref={ttmlRef} className="absolute inset-0 pointer-events-none z-10" />
                
                {/* DRM Patching Loading Overlay */}
                {isLoading && !errorState.show && (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90">
                        <div className="flex flex-col items-center space-y-4">
                            {/* Animated Shield Icon */}
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                <div className="absolute inset-2 w-12 h-12 border-4 border-primary/20 border-t-primary/60 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute inset-0 m-auto text-primary w-8 h-8">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                            </div>
                            
                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-bold text-white tracking-wider">PATCHING DRM PROTECTION</h3>
                                <p className="text-sm text-gray-400 animate-pulse">Please wait...</p>
                            </div>
                            
                            {/* Progress bar */}
                            <div className="w-48 h-1 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-primary/50 animate-pulse" style={{ width: '60%' }}></div>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Custom Error Overlay */}
                <div 
                    className={`absolute inset-0 z-40 flex-col items-center justify-center bg-black/80 backdrop-blur-sm transition-all duration-300 ${errorState.show ? 'flex' : 'hidden'}`}
                >
                    <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300 max-w-md">
                        <div className="p-4 bg-red-500/20 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-widest uppercase drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                            Channel Modar
                        </h2>
                        <p className="text-white/60 text-sm md:text-base font-medium text-center">
                            Source error or restriction detected!
                        </p>
                        
                        {/* Error details */}
                        {errorState.message && (
                            <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <p className="text-xs text-red-200 text-center">{errorState.message}</p>
                            </div>
                        )}
                        
                        <button 
                            onClick={hideError}
                            className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/10"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-red-500 text-white rounded-full transition-all hover:scale-110 active:scale-90"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                {/* Channel Navigation Buttons */}
                {channels && channels.length > 0 && (
                    <>
                        {/* Previous Channel Button */}
                        <button
                            onClick={handlePrevChannel}
                            disabled={!hasPrevChannel}
                            className={`absolute left-4 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full transition-all hover:scale-110 active:scale-90 ${
                                hasPrevChannel 
                                    ? 'bg-black/50 hover:bg-primary text-white cursor-pointer' 
                                    : 'bg-black/20 text-gray-500 cursor-not-allowed opacity-30'
                            }`}
                            title="Previous Channel (←)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>

                        {/* Next Channel Button */}
                        <button
                            onClick={handleNextChannel}
                            disabled={!hasNextChannel}
                            className={`absolute right-4 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full transition-all hover:scale-110 active:scale-90 ${
                                hasNextChannel 
                                    ? 'bg-black/50 hover:bg-primary text-white cursor-pointer' 
                                    : 'bg-black/20 text-gray-500 cursor-not-allowed opacity-30'
                            }`}
                            title="Next Channel (→)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>

                        {/* Channel Info Indicator */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-black/60 backdrop-blur-sm rounded-full">
                            <span className="text-white text-sm font-medium">
                                {currentIndex + 1} / {channels.length}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

