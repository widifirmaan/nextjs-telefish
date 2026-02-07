"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

// ============================================
// Configuration Constants (Based on BitTV APK v2.1.5)
// ============================================

const BITTV_CONFIG = {
    // Firefox-based User-Agent matching APK pattern
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
    // Referer format from APK: https://duktek.id/?device={DEVICE}&is_genuine={GENUINE}
    REFERER: 'https://duktek.id/?device=BitTVWeb&is_genuine=true',
    // Origin from APK
    ORIGIN: 'https://duktek.id',
    // Android mode User-Agent
    ANDROID_USER_AGENT: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ1A.231105.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    ANDROID_REFERER: 'https://duktek.id/?device=BitTVAndroid&is_genuine=true',
} as const;

// Stream types supported by APK
type StreamType = 'hls' | 'dash' | 'dash-clearkey' | 'dash-widevine' | 'ts';

// Android/Emtek channels that need special headers
const ANDROID_CHANNELS = ['indosiar', 'sctv', 'moji', 'mentari', 'bri', 'liga 1', 'piala', 'superleague', 'vidio'];

// ============================================
// Type Definitions
// ============================================

interface DebugInfo {
    originalUrl: string;
    proxyUrl: string;
    streamType: string;
    drmKeys?: string;
    playMethod: 'hls' | 'shaka' | 'native';
    error?: string | null;
}

interface PlayerProps {
    url: string;
    title: string;
    onClose: () => void;
    headers?: Record<string, string>;
    license?: string;
    licenseHeader?: string;
    type?: string;
    channels?: ChannelInfo[];
    currentIndex?: number;
    onChannelChange?: (channel: ChannelInfo, index: number) => void;
    onDebugInfo?: (info: DebugInfo) => void;
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

interface PlayerState {
    isLoading: boolean;
    hasError: boolean;
    errorMessage: string | null;
    hasStartedPlaying: boolean;
    isTransitioning: boolean;
}

// ============================================
// Utility Functions
// ============================================

/** Check if URL is HTTP/HTTPS */
const isHttpUrl = (str: string): boolean => 
    str?.startsWith('http://') || str?.startsWith('https://');

/** Check if browser is Safari/WebKit */
const isSafari = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua);
};

/** Check if content requires DRM based on type and license */
const isDrmContent = (type?: string, license?: string): boolean => 
    Boolean(type?.includes('dash') || type?.includes('widevine') || type?.includes('clearkey') || (license && isHttpUrl(license)));

/** Check if URL is HLS stream */
const isHlsStream = (url?: string): boolean => 
    url?.includes('.m3u8') || url?.toLowerCase().includes('m3u8') || false;

/** Check if URL is DASH stream */
const isDashStream = (url?: string): boolean => 
    url?.includes('.mpd') || false;

/** Convert base64 to hex string for ClearKey */
const base64ToHex = (base64: string): string => {
    let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) normalized += '=';
    const binary = atob(normalized);
    let hex = '';
    for (let i = 0; i < binary.length; i++) {
        hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
};

/** Check if channel needs Android mode headers */
const needsAndroidMode = (title: string): boolean => 
    ANDROID_CHANNELS.some(k => title.toLowerCase().includes(k));

/** Get header value case-insensitively */
const getHeaderValue = (headers: Record<string, string> | undefined, key: string): string | undefined => {
    if (!headers) return undefined;
    const foundKey = Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? headers[foundKey] : undefined;
};

// ============================================
// Proxy URL Builder
// ============================================

const buildProxyUrl = (
    targetUrl: string,
    options: {
        headers?: Record<string, string>;
        drm?: string;
        androidMode?: boolean;
    } = {}
): string => {
    const { headers, drm, androidMode = false } = options;
    const params = new URLSearchParams({ url: targetUrl });

    if (drm) params.append('drm', drm);
    if (androidMode) params.append('android', '1');

    // Set headers based on mode
    if (androidMode) {
        params.set('user_agent', BITTV_CONFIG.ANDROID_USER_AGENT);
        params.set('referer', BITTV_CONFIG.ANDROID_REFERER);
        params.set('origin', BITTV_CONFIG.ORIGIN);
    } else {
        // Use playlist headers if valid, otherwise use defaults
        const referer = getHeaderValue(headers, 'referer');
        const origin = getHeaderValue(headers, 'origin');
        const userAgent = getHeaderValue(headers, 'user-agent');

        params.set('user_agent', userAgent || BITTV_CONFIG.USER_AGENT);
        params.set('referer', (referer && referer !== 'none') ? referer : BITTV_CONFIG.REFERER);
        params.set('origin', (origin && origin !== 'none') ? origin : BITTV_CONFIG.ORIGIN);
    }

    return `/api/playlist/proxy?${params.toString()}`;
};

// ============================================
// Stream Type Detector
// ============================================

const detectStreamType = (url: string, type?: string, license?: string): { streamType: StreamType; streamUrl: string } => {
    // Explicit type from props
    if (type === 'dash-clearkey') return { streamType: 'dash-clearkey', streamUrl: url };
    if (type === 'dash-widevine') return { streamType: 'dash-widevine', streamUrl: url };
    if (type?.includes('dash') || type === 'mpd') return { streamType: 'dash', streamUrl: url };
    
    // Widevine detection via license URL
    if (license && isHttpUrl(license) && !type?.includes('clearkey')) {
        return { streamType: 'dash-widevine', streamUrl: url };
    }

    // URL-based detection
    if (isDashStream(url)) return { streamType: 'dash', streamUrl: url };
    if (isHlsStream(url)) return { streamType: 'hls', streamUrl: url };

    // Default to HLS
    return { streamType: 'hls', streamUrl: url };
};

// ============================================
// DRM Configuration Builder
// ============================================

const buildDrmConfig = (type?: string, license?: string): { clearKeys?: Record<string, string>; widevineUrl?: string } => {
    const config: { clearKeys?: Record<string, string>; widevineUrl?: string } = {};

    // ClearKey DRM
    if (type === 'dash-clearkey' && license && !isHttpUrl(license)) {
        try {
            let normalized = license.replace(/-/g, '+').replace(/_/g, '/');
            while (normalized.length % 4 !== 0) normalized += '=';
            const licenseData = JSON.parse(atob(normalized));

            if (licenseData.keys) {
                const clearKeys: Record<string, string> = {};
                licenseData.keys.forEach((k: { kid: string; k: string }) => {
                    clearKeys[base64ToHex(k.kid)] = base64ToHex(k.k);
                });
                config.clearKeys = clearKeys;
            }
        } catch (e) {
            console.warn('[Player] ClearKey parse error:', e);
        }
    }

    // Widevine DRM
    if (license && isHttpUrl(license) && type !== 'dash-clearkey') {
        config.widevineUrl = license;
    }

    return config;
};

// ============================================
// Player Component
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
    onChannelChange,
    onDebugInfo
}: PlayerProps) {
    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<Artplayer | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const shakaRef = useRef<any>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const mountedRef = useRef(true);
    const initializingRef = useRef(false);
    const effectVersionRef = useRef(0); // Version tracker to prevent async race conditions
    const initLockRef = useRef<string | null>(null); // To prevent concurrent initializations per URL
    // Memoized headers
    const memoizedHeaders = useMemo(() => headers, [headers]);

    // State
    const [state, setState] = useState<PlayerState>({
        isLoading: true,
        hasError: false,
        errorMessage: null,
        hasStartedPlaying: false,
        isTransitioning: false,
    });

    // Use refs for state values that need to be accessed in event handlers
    const stateRef = useRef(state);
    stateRef.current = state;

    // Check if Android mode is needed
    const androidMode = useMemo(() => needsAndroidMode(title), [title]);

    // ============================================
    // Cleanup Functions
    // ============================================

    const cleanupHls = useCallback(() => {
        if (hlsRef.current) {
            try {
                hlsRef.current.destroy();
            } catch (e) { /* ignore */ }
            hlsRef.current = null;
        }
    }, []);

    const cleanupShaka = useCallback(async () => {
        if (shakaRef.current) {
            try {
                await shakaRef.current.destroy();
            } catch (e) { /* ignore */ }
            shakaRef.current = null;
        }
    }, []);

    const cleanupArt = useCallback(() => {
        if (artRef.current) {
            try {
                // Pause and clear video source first
                const video = artRef.current.video;
                if (video) {
                    video.pause();
                    video.src = '';
                    video.load();
                }
                artRef.current.destroy(true);
            } catch (e) { /* ignore */ }
            artRef.current = null;
        }
    }, []);

    const cleanupAll = useCallback(async () => {
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = null;
        }
        cleanupArt(); // Synchronously destroy Artplayer first to release DOM
        cleanupHls();
        await cleanupShaka();
    }, [cleanupHls, cleanupShaka, cleanupArt]);

    // ============================================
    // Error Handling
    // ============================================

    const showError = useCallback((message?: string) => {
        setState(prev => ({ ...prev, hasError: true, errorMessage: message || null, isLoading: false }));
    }, []);

    const hideError = useCallback(() => {
        setState(prev => ({ ...prev, hasError: false, errorMessage: null }));
    }, []);

    // ============================================
    // Channel Navigation
    // ============================================

    const handlePrevChannel = useCallback(() => {
        if (!channels || channels.length === 0 || currentIndex <= 0) return;
        setState(prev => ({ ...prev, hasStartedPlaying: false, isTransitioning: false }));
        onChannelChange?.(channels[currentIndex - 1], currentIndex - 1);
    }, [channels, currentIndex, onChannelChange]);

    const handleNextChannel = useCallback(() => {
        if (!channels || channels.length === 0 || currentIndex >= channels.length - 1) return;
        setState(prev => ({ ...prev, hasStartedPlaying: false, isTransitioning: false }));
        onChannelChange?.(channels[currentIndex + 1], currentIndex + 1);
    }, [channels, currentIndex, onChannelChange]);

    const hasPrevChannel = Boolean(channels && channels.length > 0 && currentIndex > 0);
    const hasNextChannel = Boolean(channels && channels.length > 0 && currentIndex < channels.length - 1);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') handlePrevChannel();
            else if (e.key === 'ArrowRight') handleNextChannel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePrevChannel, handleNextChannel]);

    // ============================================
    // HLS Engine
    // ============================================

    const setupHls = useCallback((video: HTMLMediaElement, proxyUrl: string) => {
        cleanupHls();

        if (Hls.isSupported()) {
            const hls = new Hls({
                xhrSetup: (xhr, requestUrl) => {
                    if (!requestUrl.includes('api/playlist/proxy')) {
                        xhr.open('GET', buildProxyUrl(requestUrl, { headers: memoizedHeaders, androidMode }), true);
                    }
                    try { xhr.withCredentials = false; } catch (e) { /* ignore */ }
                }
            });

            hls.loadSource(proxyUrl);
            hls.attachMedia(video);
            hlsRef.current = hls;

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data?.fatal && mountedRef.current) {
                    artRef.current?.emit('error', data);
                }
            });

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS for Safari
            video.src = proxyUrl;
        }
    }, [cleanupHls, memoizedHeaders, androidMode]);

    // ============================================
    // DASH/Shaka Engine
    // ============================================

    const setupShaka = useCallback(async (video: HTMLMediaElement, proxyUrl: string, drmConfig: ReturnType<typeof buildDrmConfig>) => {
        await cleanupShaka();
        if (!mountedRef.current) return;

        const shaka = await import('shaka-player') as any;
        shaka.polyfill.installAll();

        if (!shaka.Player.isBrowserSupported()) {
            showError('Browser does not support DASH playback');
            return;
        }

        const player = new shaka.Player();
        await player.attach(video);
        
        if (!mountedRef.current) {
            await player.destroy();
            return;
        }

        shakaRef.current = player;

        // Configure request filter for proxy
        player.getNetworkingEngine()?.registerRequestFilter((reqType: any, request: any) => {
            if (request.uris?.length > 0) {
                const uri = request.uris[0];
                if (uri.startsWith('http') && !uri.includes(window.location.host) && !uri.includes('/api/playlist/proxy')) {
                    request.uris[0] = buildProxyUrl(uri, { headers: memoizedHeaders, androidMode });
                }
            }
        });

        // Configure DRM
        const config: any = {};
        
        if (drmConfig.clearKeys) {
            config.drm = { clearKeys: drmConfig.clearKeys };
        } else if (drmConfig.widevineUrl) {
            config.drm = { servers: { 'com.widevine.alpha': drmConfig.widevineUrl } };
        }

        if (Object.keys(config).length > 0) {
            player.configure(config);
        }

        // Load manifest
        try {
            await player.load(proxyUrl);
        } catch (e: any) {
            if (mountedRef.current) {
                showError(e?.message || 'Failed to load DASH stream');
                artRef.current?.emit('error', e);
            }
        }
    }, [cleanupShaka, showError, memoizedHeaders, androidMode]);

    // ============================================
    // Main Player Initialization
    // ============================================

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        
        mountedRef.current = true;
        const currentUrl = url;
        const currentVersion = ++effectVersionRef.current;

        const initPlayer = async () => {
            // Guard: don't re-init if already initializing the same URL with active player
            if (initLockRef.current === currentUrl && artRef.current) return;
            initLockRef.current = currentUrl;

            // Cleanup any existing instances first
            await cleanupAll();
            
            // Check if this effect is still the latest one
            if (!mountedRef.current || url !== currentUrl || !container || currentVersion !== effectVersionRef.current) {
                if (initLockRef.current === currentUrl) initLockRef.current = null;
                return;
            }
            
            // Ensure container is empty before Artplayer mount
            container.innerHTML = '';
            
            // Detect stream type
            const { streamType, streamUrl } = detectStreamType(url, type, license);
            const drmConfig = buildDrmConfig(type, license);
            const drmQuery = streamType === 'dash-clearkey' ? 'clearkey' : undefined;
            
            // Build proxy URL
            const proxyUrl = buildProxyUrl(streamUrl, {
                headers: memoizedHeaders,
                drm: drmQuery,
                androidMode,
            });

            // Report technical info for debugger
            if (onDebugInfo) {
                onDebugInfo({
                    originalUrl: streamUrl,
                    proxyUrl: proxyUrl,
                    streamType: streamType,
                    drmKeys: drmConfig.clearKeys ? JSON.stringify(drmConfig.clearKeys) : undefined,
                    playMethod: streamType.startsWith('dash') ? 'shaka' : 'hls',
                    error: null
                });
            }

            // Determine Artplayer type
            const artType = streamType.startsWith('dash') ? 'mpd' : 'm3u8';

            // Create Artplayer instance
            const art = new Artplayer({
                container: container,
                url: streamUrl,                title: title,
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
                type: artType,
                customType: {
                    m3u8: (video: HTMLMediaElement) => {
                        setupHls(video, proxyUrl);
                    },
                    mpd: async (video: HTMLMediaElement) => {
                        await setupShaka(video, proxyUrl, drmConfig);
                    },
                },
            } as any);

            artRef.current = art;

            // Event handlers
            art.on('play', () => {
                if (mountedRef.current) {
                    setState(prev => ({ ...prev, isLoading: false, hasError: false, hasStartedPlaying: true }));
                }
            });

            art.on('video:waiting', () => {
                if (mountedRef.current) {
                    setState(prev => ({ ...prev, isLoading: true }));
                }
            });

            art.on('video:playing', () => {
                if (mountedRef.current) {
                    setState(prev => ({ ...prev, isLoading: false, hasError: false, hasStartedPlaying: true }));
                }
            });

            art.on('canplay', () => {
                if (mountedRef.current) {
                    setState(prev => ({ ...prev, isLoading: false, hasStartedPlaying: true }));
                }
            });

            art.on('error', (err: any) => {
                if (!mountedRef.current || stateRef.current.isTransitioning) return;

                const errorMsg = err?.message || 'Playback error';
                
                if (onDebugInfo) {
                    onDebugInfo({
                        originalUrl: streamUrl,
                        proxyUrl: proxyUrl,
                        streamType: streamType,
                        drmKeys: drmConfig.clearKeys ? JSON.stringify(drmConfig.clearKeys) : undefined,
                        playMethod: streamType.startsWith('dash') ? 'shaka' : 'hls',
                        error: errorMsg
                    });
                }

                setState(prev => ({ ...prev, isLoading: false }));

                if (stateRef.current.hasStartedPlaying) {
                    // Auto-move to next channel on mid-playback error
                    setState(prev => ({ ...prev, isTransitioning: true, hasError: true, errorMessage: 'Error, moving to next channel...' }));
                    
                    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                    errorTimeoutRef.current = setTimeout(() => {
                        setState(prev => ({ ...prev, isTransitioning: false }));
                        handleNextChannel();
                    }, 1500);
                } else {
                    // Error at start - show overlay
                    cleanupHls();
                    cleanupShaka();
                    showError();
                }
            });

            // Video element error
            try {
                art.video.addEventListener('error', () => {
                    if (mountedRef.current) showError();
                });
            } catch (e) { /* ignore */ }
        };

        initPlayer();

        // Cleanup on unmount
        return () => {
            mountedRef.current = false;
            initializingRef.current = false;
            initLockRef.current = null;
            cleanupAll();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, title, license, type, androidMode]);

    // ============================================
    // Render
    // ============================================

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className={`relative w-[80vw] h-[80vh] glass-card overflow-hidden rounded-2xl group transition-all duration-300 ${state.isLoading ? 'border-primary/30 shadow-lg shadow-primary/10' : ''}`}>
                
                {/* Loading Effect - Top Border */}
                {state.isLoading && (
                    <div className="absolute inset-0 z-20 pointer-events-none">
                        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
                        <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20 overflow-hidden">
                            <div className="h-full bg-primary/60 animate-pulse w-1/3" />
                        </div>
                    </div>
                )}

                {/* Video Container */}
                <div ref={containerRef} className="w-full h-full" />

                {/* Loading Overlay */}
                {state.isLoading && !state.hasError && (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90">
                        <div className="flex flex-col items-center space-y-4">
                            {/* Spinning Shield Icon */}
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                                <div className="absolute inset-2 w-12 h-12 border-4 border-primary/20 border-t-primary/60 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute inset-0 m-auto text-primary w-8 h-8">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                            </div>
                            
                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-bold text-white tracking-wider">PATCHING DRM PROTECTION</h3>
                                <p className="text-sm text-gray-400 animate-pulse">Please wait...</p>
                            </div>
                            
                            {/* Progress bar */}
                            <div className="w-48 h-1 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-primary/50 animate-pulse" style={{ width: '60%' }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Overlay */}
                <div className={`absolute inset-0 z-40 flex-col items-center justify-center bg-black/80 backdrop-blur-sm transition-all duration-300 ${state.hasError ? 'flex' : 'hidden'}`}>
                    <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300 max-w-md">
                        <div className="p-4 bg-red-500/20 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-widest uppercase drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                            {state.errorMessage?.includes('moving to next channel') ? 'Stream Error' : 'Channel Error'}
                        </h2>
                        
                        {state.errorMessage ? (
                            <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <p className="text-sm text-red-200 text-center animate-pulse">{state.errorMessage}</p>
                            </div>
                        ) : (
                            <p className="text-white/60 text-sm md:text-base font-medium text-center">
                                Source error or restriction detected!
                            </p>
                        )}
                        
                        {!state.errorMessage?.includes('moving to next channel') && (
                            <button 
                                onClick={hideError}
                                className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/10"
                            >
                                Dismiss
                            </button>
                        )}
                    </div>
                </div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-red-500 text-white rounded-full transition-all hover:scale-110 active:scale-90"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>

                {/* Channel Navigation */}
                {channels && channels.length > 0 && (
                    <>
                        {/* Previous Channel */}
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
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>

                        {/* Next Channel */}
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
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </button>

                        {/* Channel Indicator */}
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
