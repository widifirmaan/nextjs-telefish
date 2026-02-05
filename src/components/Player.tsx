"use client";

import { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

interface PlayerProps {
    url: string;
    title: string;
    onClose: () => void;
    headers?: Record<string, string>;
    license?: string;
    licenseHeader?: string;
    type?: string;
}

export default function Player({ url, title, onClose, headers, license, licenseHeader, type }: PlayerProps) {
    const artRef = useRef<HTMLDivElement>(null);
    const ttmlRef = useRef<HTMLDivElement>(null);

    // Construct Proxy URL with headers
    const getProxyUrl = (targetUrl: string, drm?: string) => {
        const params = new URLSearchParams({ url: targetUrl });
        if (drm) params.append('drm', drm);

        // Default Headers mimicking Android App (BitTVActivity.smali)
        // Construction: Mozilla/5.0 ... Firefox/119.0
        // Referer: https://duktek.id/?device=...&is_genuine=...

        if (!params.has('user_agent')) {
            // Use a standard Firefox UA to match the app's spoofing
            params.append('user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0');
        }

        if (!params.has('referer') && (!headers || !headers['referer'])) {
            // App appends device and genuine flag. We'll mock them.
            params.append('referer', 'https://duktek.id/?device=BitTVWeb&is_genuine=true');
        }

        if (!params.has('origin') && (!headers || !headers['origin'])) {
            params.append('origin', 'https://duktek.id');
        }

        if (headers) {
            // Case-insensitive header lookup
            const getHeader = (key: string) => Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase());

            const refererKey = getHeader('referer');
            if (refererKey) params.set('referer', headers[refererKey]);

            const originKey = getHeader('origin');
            if (originKey) params.set('origin', headers[originKey]);

            const uaKey = getHeader('user-agent');
            if (uaKey) params.set('user_agent', headers[uaKey]);
        }

        return `/api/playlist/proxy?${params.toString()}`;
    };

    const hlsRef = useRef<any>(null);
    const dashRef = useRef<any>(null);
    const [showErrorOverlay, setShowErrorOverlay] = useState(false);
    
    const showError = () => {
        setShowErrorOverlay(true);
    };

    const hideError = () => {
        setShowErrorOverlay(false);
    };

    useEffect(() => {
        if (!artRef.current) return;
        let isActive = true;
        const isWebKit = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

        // Determine stream type: prioritize explicit 'type' prop, then URL pattern, then 'jenis' property
        let streamType = 'mpd';
        if (type && (type.includes('dash') || type === 'mpd')) {
            streamType = 'mpd';
            console.log('[Player] Using explicit type prop (DASH):', type);
        } else if (url.includes('.mpd')) {
            streamType = 'mpd';
            console.log('[Player] Detected from URL: .mpd extension');
        } else {
            streamType = 'm3u8';
            console.log('[Player] Default to HLS: .m3u8');
        }
        console.log('[Player] Stream Type Detection:', { 
            url: url, 
            detectedType: streamType,
            typeFromProps: type,
            isMPD: url.includes('.mpd')
        });
        
        const art = new Artplayer({
            container: artRef.current,
            url: url,
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
                    console.log('[Player] Processing M3U8 stream:', { url, proxyUrl: getProxyUrl(url) });
                    const proxyUrl = getProxyUrl(url);

                    // WebKit / Safari native HLS needs CORS-friendly URIs in playlist and crossOrigin on the video
                    try { video.crossOrigin = 'anonymous'; video.setAttribute('webkit-playsinline', ''); } catch (e) {}

                    if (Hls.isSupported()) {
                        if (hlsRef.current) hlsRef.current.destroy(); // Clean previous
                        const hls = new Hls({
                            xhrSetup: function (xhr, url) {
                                // Route segment/chunk requests through our proxy so CORS headers are applied
                                if (!url.includes('api/playlist/proxy')) {
                                    xhr.open('GET', getProxyUrl(url), true);
                                }
                                // Avoid sending credentials to upstream
                                try { xhr.withCredentials = false; } catch (e) {}
                            }
                        });
                        hls.loadSource(proxyUrl);
                        hls.attachMedia(video);
                        hlsRef.current = hls;

                        // Try muted autoplay on WebKit (Safari/iOS): set playsinline attrs and attempt play
                        if (isWebKit) {
                            try {
                                video.muted = true;
                                video.setAttribute('playsinline', '');
                                video.setAttribute('webkit-playsinline', '');
                                // Best-effort, may reject if autoplay blocked
                                const p = video.play();
                                if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
                            } catch (e) { /* ignore */ }
                        }

                        hls.on(Hls.Events.ERROR, (event, data) => {
                            if (data && data.fatal) {
                                art.emit('error', data);
                            }
                        });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        // Native HLS (Safari) — ensure playlist uses proxied URIs (proxy rewrites playlist) and set crossOrigin
                        try { video.crossOrigin = 'anonymous'; video.setAttribute('webkit-playsinline', ''); } catch (e) {}
                        // For Safari, attempt muted autoplay for native HLS
                        if (isWebKit) {
                            try { video.muted = true; video.setAttribute('playsinline', ''); } catch (e) {}
                            const p = video.play(); if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
                        }
                        video.src = proxyUrl;
                    }
                },

                mpd: async function (video: HTMLMediaElement, url: string) {
                    console.log('[Player] Initializing DASH (MPD) stream:', { url, hasShaka: typeof window !== 'undefined' && !!(window as any).shaka });
                    const shaka = await import('shaka-player') as any;
                    shaka.polyfill.installAll();
                    if (!shaka.Player.isBrowserSupported()) return;
                    if (!isActive) return;

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
                    const drmType = type?.includes('clearkey') ? 'clearkey' : undefined;
                    const proxiedManifestUrl = getProxyUrl(url, drmType);
                    player.getNetworkingEngine()?.registerRequestFilter((type: any, request: any) => {
                        if (request.uris && request.uris.length > 0) {
                            const uri = request.uris[0];
                            if (uri.startsWith('http') && !uri.includes(window.location.host) && !uri.includes('/api/playlist/proxy')) {
                                request.uris[0] = getProxyUrl(uri);
                            }
                        }
                    });
                    if (license && type === 'dash-clearkey') {
                        try {
                            const base64ToHex = (base64: string) => {
                                let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
                                while (normalized.length % 4 !== 0) normalized += '=';
                                const binary = atob(normalized);
                                let hex = '';
                                for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
                                return hex;
                            };
                            const normalizedLicense = license.replace(/-/g, '+').replace(/_/g, '/');
                            const paddedLicense = normalizedLicense.length % 4 === 0 ? normalizedLicense : normalizedLicense + '='.repeat(4 - (normalizedLicense.length % 4));
                            const licenseData = JSON.parse(atob(paddedLicense));
                            if (licenseData.keys) {
                                const clearKeys: { [keyId: string]: string } = {};
                                licenseData.keys.forEach((k: any) => {
                                    clearKeys[base64ToHex(k.kid)] = base64ToHex(k.k);
                                });
                                player.configure({ drm: { clearKeys: clearKeys } });
                            }
                        } catch (e) {}
                    }
                    if (license && type !== 'dash-clearkey' && license.startsWith('http')) {
                        player.configure({ drm: { servers: { 'com.widevine.alpha': license } } });
                    }
                    try { 
                        if (!isActive) return;
                        console.log('[Player] Loading DASH manifest from:', proxiedManifestUrl);
                        await player.load(proxiedManifestUrl);
                        console.log('[Player] DASH manifest loaded successfully');
                        // Attempt muted autoplay on WebKit after manifest load
                        if (isActive && isWebKit) {
                            try {
                                video.muted = true;
                                video.setAttribute('playsinline', '');
                                video.setAttribute('webkit-playsinline', '');
                                const p = video.play(); if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
                            } catch (e) { /* ignore */ }
                        }
                    } catch (e: any) {
                        console.error('[Player] DASH Error Details:', {
                            message: e?.message,
                            code: e?.code,
                            stack: e?.stack,
                            url: proxiedManifestUrl
                        });
                        if (isActive) art.emit('error', e);
                    }
                },
            },
        } as any);

        const internalShowError = () => {
            art.loading.show = false;
            showError();
        };

        const internalHideError = () => {
            hideError();
        };

        let hasStartedPlaying = false;
        art.loading.show = false; // Force hide initially

        art.on('play', () => {
            hasStartedPlaying = false;
            internalHideError();
        });

        art.on('video:waiting', () => {
            if (!hasStartedPlaying) art.loading.show = false;
        });

        art.on('video:playing', () => {
            art.loading.show = false;
            internalHideError();
        });

        art.on('error', (err: any) => {
            console.error('[Player Error]', err);
            internalShowError();
        });

        // Listen for video element errors specifically
        art.video.addEventListener('error', internalShowError);

        return () => {
            isActive = false;
            art.video.removeEventListener('error', internalShowError);
            
            // Immediate stop
            try {
                art.video.pause();
                art.video.src = "";
                art.video.load();
            } catch (e) {}

            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (dashRef.current) {
                dashRef.current.destroy();
                dashRef.current = null;
            }
            if (art && art.destroy) {
                art.destroy(true); // Destroy DOM and events
            }
        };
    }, [url, title, headers, license, licenseHeader, type]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className="relative w-[80vw] h-[80vh] glass-card overflow-hidden rounded-2xl group">
                <div ref={artRef} className="w-full h-full" />
                <div ref={ttmlRef} className="absolute inset-0 pointer-events-none z-10" />
                
                {/* Custom Error Overlay */}
                <div 
                    className={`absolute inset-0 z-40 flex-col items-center justify-center bg-black/80 backdrop-blur-sm transition-all duration-300 ${showErrorOverlay ? 'flex' : 'hidden'}`}
                >
                    <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300">
                        <div className="p-4 bg-red-500/20 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        </div>
                        <h2 className="text-3xl md:text-5xl font-bold text-white tracking-widest uppercase drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                            Channel Modar
                        </h2>
                        <p className="text-white/60 text-sm md:text-base font-medium">Source error or restriction detected!</p>
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        </div>
    );
}