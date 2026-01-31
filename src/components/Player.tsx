"use client";

import { useEffect, useRef } from 'react';
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

    useEffect(() => {
        if (!artRef.current) return;

        const art = new Artplayer({
            container: artRef.current,
            url: url,
            title: title,
            volume: 0.7,
            isLive: true,
            muted: false,
            autoplay: false,
            autoSize: true,
            autoMini: true,
            setting: true,
            loop: true,
            flip: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            subtitleOffset: true,
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: true,
            autoPlayback: true,
            airplay: true,
            theme: '#6366f1',
            loading: false, // Don't show spinner initially
            type: url.includes('.mpd') ? 'mpd' : 'm3u8',
            customType: {
                m3u8: function (video: HTMLMediaElement, url: string) {
                    const proxyUrl = getProxyUrl(url);
                    if (Hls.isSupported()) {
                        if (hlsRef.current) hlsRef.current.destroy(); // Clean previous
                        const hls = new Hls({
                            xhrSetup: function (xhr, url) {
                                if (!url.includes('api/playlist/proxy')) {
                                    xhr.open('GET', getProxyUrl(url), true);
                                }
                            }
                        });
                        hls.loadSource(proxyUrl);
                        hls.attachMedia(video);
                        hlsRef.current = hls;
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = proxyUrl;
                    }
                },
                mpd: async function (video: HTMLMediaElement, url: string) {
                    // Use Shaka Player for MPD - better ClearKey DRM support
                    const shaka = await import('shaka-player') as any;
                    
                    // Install polyfills
                    shaka.polyfill.installAll();
                    
                    if (!shaka.Player.isBrowserSupported()) {
                        console.error('[Shaka] Browser not supported');
                        return;
                    }
                    
                    // Reset any existing Shaka player
                    if ((window as any).__shakaPlayer) {
                        await (window as any).__shakaPlayer.destroy();
                    }
                    
                    const player = new shaka.Player();
                    await player.attach(video);
                    (window as any).__shakaPlayer = player;
                    
                    // Use the PROXIED URL for the manifest
                    const drmType = type?.includes('clearkey') ? 'clearkey' : undefined;
                    const proxiedManifestUrl = getProxyUrl(url, drmType);
                    
                    // Configure network request interception to proxy all external requests
                    player.getNetworkingEngine()?.registerRequestFilter((type: any, request: any) => {
                        if (request.uris && request.uris.length > 0) {
                            const uri = request.uris[0];
                            if (uri.startsWith('http') && 
                                !uri.includes(window.location.host) && 
                                !uri.includes('/api/playlist/proxy')) {
                                console.log('[Shaka] Proxying request:', uri);
                                request.uris[0] = getProxyUrl(uri);
                            }
                        }
                    });
                    
                    // ClearKey DRM Configuration
                    if (license && type === 'dash-clearkey') {
                        try {
                            // Helper to convert base64 to hex
                            const base64ToHex = (base64: string) => {
                                let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
                                while (normalized.length % 4 !== 0) normalized += '=';
                                const binary = atob(normalized);
                                let hex = '';
                                for (let i = 0; i < binary.length; i++) {
                                    hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
                                }
                                return hex;
                            };
                            
                            const normalizedLicense = license.replace(/-/g, '+').replace(/_/g, '/');
                            const paddedLicense = normalizedLicense.length % 4 === 0 ? normalizedLicense : normalizedLicense + '='.repeat(4 - (normalizedLicense.length % 4));
                            const jsonStr = atob(paddedLicense);
                            const licenseData = JSON.parse(jsonStr);
                            
                            if (licenseData.keys) {
                                // Build Shaka ClearKey configuration
                                // Shaka expects keys in hex format: { keyId: key }
                                const clearKeys: { [keyId: string]: string } = {};
                                licenseData.keys.forEach((k: any) => {
                                    const kidHex = base64ToHex(k.kid);
                                    const keyHex = base64ToHex(k.k);
                                    clearKeys[kidHex] = keyHex;
                                    console.log(`[Shaka ClearKey] Registered: KID=${kidHex}, Key=${keyHex}`);
                                });
                                
                                player.configure({
                                    drm: {
                                        clearKeys: clearKeys
                                    }
                                });
                                
                                console.log('[Shaka] ClearKey configured:', clearKeys);
                            }
                        } catch (e) {
                            console.error('[Shaka] Failed to configure ClearKey:', e);
                        }
                    }
                    
                    // Widevine DRM Configuration
                    if (license && type !== 'dash-clearkey' && license.startsWith('http')) {
                        const drmConfig: any = {
                            drm: {
                                servers: {
                                    'com.widevine.alpha': license
                                }
                            }
                        };
                        
                        // Add license request headers if available
                        if (licenseHeader) {
                            try {
                                const parsedHeaders = JSON.parse(licenseHeader);
                                player.getNetworkingEngine()?.registerRequestFilter((reqType: any, request: any) => {
                                    if (reqType === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                                        Object.assign(request.headers, parsedHeaders);
                                    }
                                });
                            } catch (e) {
                                console.warn('[Shaka] Failed to parse licenseHeader');
                            }
                        }
                        
                        player.configure(drmConfig);
                        console.log('[Shaka] Widevine configured:', license);
                    }
                    
                    // Error handling
                    player.addEventListener('error', (event: any) => {
                        console.error('[Shaka Error]:', event.detail);
                    });
                    
                    // Load the manifest
                    try {
                        console.log('[Shaka] Loading manifest:', proxiedManifestUrl);
                        await player.load(proxiedManifestUrl);
                        console.log('[Shaka] Manifest loaded successfully');
                    } catch (e: any) {
                        console.error('[Shaka] Failed to load manifest:', e);
                    }
                },
            },
        } as any);
        
        // Only show loading spinner once the user has started playback
        art.on('play', () => {
            art.loading.show = true;
        });

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (dashRef.current) {
                dashRef.current.reset();
                dashRef.current = null;
            }
            if (art && art.destroy) {
                art.destroy(true); // Destroy DOM and events
            }
        };
    }, [url, title, headers, license, licenseHeader, type]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-10">
            <div className="relative w-full max-w-5xl aspect-video glass-card overflow-hidden rounded-2xl">
                <div ref={artRef} className="w-full h-full" />
                <div ref={ttmlRef} className="absolute inset-0 pointer-events-none z-10" />
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-accent text-white rounded-full transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        </div>
    );
}