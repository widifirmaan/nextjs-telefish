
"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { X } from 'lucide-react';

import { Channel } from '@/types';

interface PlayerProps {
    url: string;
    title: string;
    onClose: () => void;
    // Optional props for playlist navigation if needed later
    channels?: Channel[];
    currentIndex?: number;
    onChannelChange?: (channel: Channel, index: number) => void;
    // Special props often used for DRM or headers
    license?: string;
    licenseHeader?: string;
    headers?: any;
    type?: string; 
    onDebugInfo?: (info: any) => void;
}

const PROXY_BASE = '/api/playlist/stream';

/**
 * Encodes a target URL into a proxy URL
 */
const getProxyUrl = (targetUrl: string): string => {
    // Prevent double proxying or proxying local internal routes
    if (targetUrl.startsWith('/') || targetUrl.includes(PROXY_BASE)) return targetUrl;
    // Only proxy external URLs
    if (!targetUrl.startsWith('http')) return targetUrl;
    return `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
};

/**
 * Checks if a URL is an HLS stream
 */
const isHls = (url: string, type?: string) => {
    return (type === 'm3u8' || url.includes('.m3u8') || type === 'hls');
};

const isFlv = (url: string, type?: string) => {
    return (type === 'flv' || url.includes('.flv'));
};


const isDash = (url: string, type?: string) => {
    return (type === 'mpd' || url.includes('.mpd') || type === 'dash');
};

export default function Player({ 
    url, 
    title, 
    onClose, 
    license, 
    licenseHeader, 
    headers, 
    type, 
    onDebugInfo, 
    channels, 
    currentIndex, 
    onChannelChange 
}: PlayerProps) {
    const artRef = useRef<Artplayer | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<any>(null);
    const isMounted = useRef(false);

    // =========================================================================
    // HLS (m3u8) Setup - Replicates ExoPlayer behavior via HLS.js Interception
    // =========================================================================
    const playHls = useCallback((video: HTMLMediaElement, sourceUrl: string, art: Artplayer) => {
        if (Hls.isSupported()) {
            const hls = new Hls({
                // Crucial: Intercept every network request to route through our Android-mimicking proxy
                xhrSetup: (xhr, url) => {
                    // Url here is what HLS.js thinks it is fetching (e.g. resolved relative segment)
                    // We route it through the proxy
                    xhr.open('GET', getProxyUrl(url), true);
                    xhr.withCredentials = false;
                }
            });

            // Load the ORIGINAL source URL. 
            // This ensures HLS.js resolves relative paths correctly against the original domain.
            hls.loadSource(sourceUrl);
            hls.attachMedia(video);
            engineRef.current = hls;

            art.on('destroy', () => {
                hls.destroy();
                if (engineRef.current === hls) engineRef.current = null;
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari Native HLS: We can't intercept requests easily.
            // We must use the direct proxy URL. 
            // Note: This might fail for relative segments if the proxy doesn't rewrite them.
            // But since we removed rewriting, Safari might struggle with relative segments unless they are absolute.
            // However, most modern HLS streams use absolute or we rely on the generic proxy behavior.
            // If Safari fails, we might need a specific Safari-rewrite mode in proxy, but let's try direct first.
            // Actually, simply pointing to proxyUrl works IF the m3u8 uses absolute URLs.
            video.src = getProxyUrl(sourceUrl);
        }
    }, []);

    // =========================================================================
    // FLV Setup
    // =========================================================================
    const playFlv = useCallback(async (video: HTMLMediaElement, sourceUrl: string, art: Artplayer) => {
        const flvjs = await import('flv.js') as any;
        if (!isMounted.current) return;
        
        if (flvjs.default.isSupported()) {
            const flv = flvjs.default.createPlayer({
                type: 'flv',
                url: getProxyUrl(sourceUrl),
                cors: true,
                isLive: true
            }, {
                enableWorker: false, // Disable worker to debug/avoid worker CORS
                enableStashBuffer: false,
                isLive: true,
                lazyLoad: false
            });
            flv.attachMediaElement(video);
            flv.load();
            engineRef.current = flv;

            art.on('destroy', () => {
                flv.destroy();
                if (engineRef.current === flv) engineRef.current = null;
            });
        } else {
            art.notice.show = 'flv.js is not supported';
        }
    }, []);

    // =========================================================================
    // DASH (mpd) Setup - Replicates ExoPlayer behavior via Shaka Interception
    // =========================================================================
    const playDash = useCallback(async (video: HTMLMediaElement, sourceUrl: string, art: Artplayer) => {
        // Dynamic import to avoid SSR issues
        const shakaModule = await import('shaka-player') as any;
        if (!isMounted.current) return;
        
        const shaka = shakaModule.default || shakaModule;
        // Install polyfills
        shaka.polyfill.installAll();

        if (shaka.Player.isBrowserSupported()) {
            const player = new shaka.Player(video);
            
            // Networking Engine Interceptor
            // This is where we force all traffic (Manifest, Segments, License) through our Android proxy
            player.getNetworkingEngine().registerRequestFilter((type: any, request: any) => {
                request.uris = request.uris.map((uri: string) => getProxyUrl(uri));
            });

            // DRM Configuration
            const drmConfig: any = { 
                servers: {},
                advanced: {},
                clearKeys: {}
            };
            
            // Parse license headers if provided
            let licenseHeaders = {};
            if (licenseHeader) {
                try {
                    licenseHeaders = JSON.parse(licenseHeader);
                } catch (e) {
                    console.error("Failed to parse license headers", e);
                }
            }
            
            // Handle ClearKey
            if (type?.includes('clearkey') && license) {
                if (license.startsWith('http')) {
                    drmConfig.servers['org.w3.clearkey'] = license;
                    drmConfig.advanced['org.w3.clearkey'] = {
                        headers: licenseHeaders
                    };
                } else {
                    // Use Shaka's direct clearKeys map - much more reliable than local license server
                    try {
                        const decoded = Buffer.from(license, 'base64').toString('utf8');
                        const parsed = JSON.parse(decoded);
                        if (parsed.keys) {
                            parsed.keys.forEach((k: any) => {
                                // Shaka clearKeys expects: { 'kid_hex': 'k_hex' }
                                const kidHex = Buffer.from(k.kid.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
                                const kHex = Buffer.from(k.k.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
                                drmConfig.clearKeys[kidHex] = kHex;
                            });
                            console.log(`[DRM] Configured ${Object.keys(drmConfig.clearKeys).length} ClearKeys directly`);
                        }
                    } catch (e) {
                        console.error("[DRM] ClearKey local parse failed", e);
                    }
                }
            } 
            // Handle Widevine
            else if (license && license.startsWith('http')) {
                drmConfig.servers['com.widevine.alpha'] = license;
                drmConfig.advanced['com.widevine.alpha'] = {
                    headers: licenseHeaders
                };
            }

            if (Object.keys(drmConfig.servers).length > 0 || Object.keys(drmConfig.clearKeys).length > 0) {
                player.configure({ drm: drmConfig });
            }

            try {
                // Load the ORIGINAL URL. Shaka resolves relative paths against this.
                // The network filter then proxies the actual request.
                engineRef.current = player;
                if (!isMounted.current) {
                    player.destroy();
                    return;
                }
                await player.load(sourceUrl);
            } catch (e: any) {
                if (e.name === 'AbortError' || e.code === 7000) return; // Ignore expected aborts
                console.error("Shaka Error", e);
                art.notice.show = "Error loading stream: " + e.message;
            }

            art.on('destroy', () => {
                player.destroy();
                if (engineRef.current === player) engineRef.current = null;
            });
        } else {
            art.notice.show = "Browser does not support DASH";
        }
    }, [license, type]);

    useEffect(() => {
        isMounted.current = true;
        if (!containerRef.current) return;

        let customType: any = {};
        let opts: any = {};

        if (isDash(url, type)) {
            customType = {
                mpd: (video: HTMLMediaElement, url: string, art: Artplayer) => playDash(video, url, art)
            };
            opts.type = 'mpd';
        } else if (isFlv(url, type)) {
             customType = {
                flv: (video: HTMLMediaElement, url: string, art: Artplayer) => playFlv(video, url, art)
            };
            opts.type = 'flv';
        } else {
            // Default to HLS
            customType = {
                m3u8: (video: HTMLMediaElement, url: string, art: Artplayer) => playHls(video, url, art)
            };
            opts.type = 'm3u8';
        }


        const art = new Artplayer({
            container: containerRef.current,
            url: url, // Pass original URL
            title: title || 'Live Stream',
            volume: 0.8,
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
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: true,
            autoPlayback: true,
            airplay: true,
            theme: '#ff0055', // Match the vibrant aesthetic
            customType: customType,
            ...opts
        });

        artRef.current = art;

        // Success and Debugging
        art.on('video:play', () => {
             if (onDebugInfo) {
                onDebugInfo({
                    status: 'ok',
                    playMethod: isDash(url, type) ? 'Shaka' : isFlv(url, type) ? 'mpegts.js' : 'HLS.js',
                    streamType: type || 'auto',
                    originalUrl: url,
                    proxyUrl: getProxyUrl(url)
                });
            }
        });

        // Error handling
        art.on('error', (error: any) => {
            console.error('Artplayer Error:', error);
            art.notice.show = 'Stream Error. Retrying...';
            
            if (onDebugInfo) {
                onDebugInfo({
                    status: 'error',
                    error: error?.message || 'Artplayer generic error',
                    originalUrl: url
                });
            }
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!channels || currentIndex === undefined || !onChannelChange) return;
            
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % channels.length;
                onChannelChange(channels[nextIndex], nextIndex);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prevIndex = (currentIndex - 1 + channels.length) % channels.length;
                onChannelChange(channels[prevIndex], prevIndex);
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            isMounted.current = false;
            window.removeEventListener('keydown', handleKeyDown);
            
            // 1. Destroy Engine (HLS, Shaka, etc)
            if (engineRef.current) {
                const engine = engineRef.current;
                console.log("[Player] Explicitly destroying engine in cleanup", engine.constructor?.name || 'Engine');
                try {
                    if (typeof engine.destroy === 'function') {
                        engine.destroy();
                    } else if (typeof engine.unload === 'function') {
                        engine.unload().then(() => engine.destroy());
                    }
                } catch (e) {
                    console.error("[Player] Engine destroy failed", e);
                }
                engineRef.current = null;
            }

            // 2. Destroy Artplayer
            if (artRef.current) {
                // Pause before destroy to prevent AbortError in some browsers
                const video = artRef.current.video;
                if (video) {
                    try {
                        video.pause();
                        video.removeAttribute('src'); // Explicitly remove src
                        video.load();
                    } catch (e) {}
                }
                artRef.current.destroy(false);
                artRef.current = null;
            }
        };
    }, [url, title, type, playHls, playDash, playFlv, onDebugInfo, channels, currentIndex, onChannelChange]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl">
            {/* Main Player Container */}
            <div className="relative w-full h-full md:w-[90vw] md:h-[85vh] bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10">
                <div ref={containerRef} className="w-full h-full" />
                
                {/* Custom Overlay / Header (Optional) */}
                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none z-10">
                    <h2 className="text-white text-lg font-bold drop-shadow-md">{title}</h2>
                </div>

                {/* Close Button */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 z-20 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all hover:rotate-90"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>
        </div>
    );
}
