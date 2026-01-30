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
            autoplay: true,
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
                    const dashjs = await import('dashjs');
                    if (dashRef.current) dashRef.current.reset();

                    const player = dashjs.MediaPlayer().create();

                    // Use the PROXIED URL for the manifest.
                    // Pass drm=clearkey if it's a clearkey playback
                    const drmType = type?.includes('clearkey') ? 'clearkey' : undefined;
                    const proxiedManifestUrl = getProxyUrl(url, drmType);

                    // Global XHR Hook - The "Nuclear Option" to solve CORS for all dash.js internal loaders
                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method: string, requestUrl: string | URL) {
                        let finalUrl = typeof requestUrl === 'string' ? requestUrl : requestUrl.toString();
                        
                        // If it is an external URL, re-route it through our proxy
                        if (finalUrl && finalUrl.startsWith('http') && !finalUrl.includes(window.location.host)) {
                            console.log("[DRM Global Hook] Proxying:", finalUrl);
                            finalUrl = getProxyUrl(finalUrl);
                        }
                        
                        return originalOpen.apply(this, [method, finalUrl, ...Array.from(arguments).slice(2)] as any);
                    };

                    // DRM Protection Data
                    const protectionData: any = {};

                    // ClearKey
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

                            // Helper to convert base64 to base64url (some browsers prefer this for clearkeys)
                            const base64ToBase64Url = (base64: string) => {
                                return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                            };

                            const normalizedLicense = license.replace(/-/g, '+').replace(/_/g, '/');
                            const paddedLicense = normalizedLicense.length % 4 === 0 ? normalizedLicense : normalizedLicense + '='.repeat(4 - (normalizedLicense.length % 4));
                            const jsonStr = atob(paddedLicense);
                            const licenseData = JSON.parse(jsonStr);

                            if (licenseData.keys) {
                                const clearkeys: Record<string, string> = {};
                                licenseData.keys.forEach((k: any) => {
                                    const kidHex = base64ToHex(k.kid);
                                    const keyHex = base64ToHex(k.k);
                                    
                                    // dash.js compatibility: provide multiple HEX variants
                                    clearkeys[kidHex.toLowerCase()] = keyHex.toLowerCase();
                                    clearkeys[kidHex.toUpperCase()] = keyHex.toLowerCase();
                                    
                                    // Provide dashed version if it's 32 chars (UUID)
                                    if (kidHex.length === 32) {
                                        const dashed = `${kidHex.substring(0,8)}-${kidHex.substring(8,12)}-${kidHex.substring(12,16)}-${kidHex.substring(16,20)}-${kidHex.substring(20)}`;
                                        clearkeys[dashed.toLowerCase()] = keyHex.toLowerCase();
                                        clearkeys[dashed.toUpperCase()] = keyHex.toLowerCase();
                                    }
                                    
                                    // Provide Base64URL
                                    const kidB64Url = base64ToBase64Url(k.kid);
                                    const keyB64Url = base64ToBase64Url(k.k);
                                    clearkeys[kidB64Url] = keyB64Url;
                                });
                                
                                protectionData["org.w3.clearkey"] = { 
                                    "clearkeys": clearkeys,
                                    "priority": 1 // High priority for dash.js 5+
                                };
                                console.log("[DRM] ClearKey configured with exhaustive formats for", licenseData.keys.length, "keys");
                            }
                        } catch (e) {
                            console.error("Failed to parse ClearKey license", e);
                        }
                    }

                    // Widevine / License Headers
                    if (licenseHeader) {
                        try {
                            const parsedHeader = JSON.parse(licenseHeader);
                            if (parsedHeader.widevine) {
                                protectionData["com.widevine.alpha"] = {
                                    serverURL: parsedHeader.widevine,
                                    priority: 5 // Lower priority than ClearKey
                                };

                                // Add extra headers if specified (e.g. from header_license in playlist)
                                if (headers) {
                                    protectionData["com.widevine.alpha"].httpRequestHeaders = headers;
                                }
                            }
                        } catch (e) {
                            // licenseHeader might not be JSON sometimes? 
                            // In some cases it might be a direct URL, but based on encrypted_playlist.json it's JSON.
                        }
                    }

                    if (Object.keys(protectionData).length > 0) {
                        player.setProtectionData(protectionData);
                    }

                    player.initialize(video, proxiedManifestUrl, true);
                    dashRef.current = player;
                    
                    // Store original open on the player object for cleanup
                    (player as any)._originalXhrOpen = originalOpen;
                }
            },
        } as any);

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (dashRef.current) {
                // Restore XHR if it was patched
                if ((dashRef.current as any)._originalXhrOpen) {
                    XMLHttpRequest.prototype.open = (dashRef.current as any)._originalXhrOpen;
                }
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
