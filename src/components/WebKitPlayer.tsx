"use client";

import { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { Channel } from '@/types';

interface WebKitPlayerProps {
    url: string;
    title: string;
    onClose: () => void;
    headers?: any;
    onDebugInfo?: (info: any) => void;
}

const PROXY_BASE = '/api/playlist/stream';

const getProxyUrl = (targetUrl: string, customHeaders?: any): string => {
    if (targetUrl.startsWith('/') || targetUrl.includes(PROXY_BASE)) return targetUrl;
    if (!targetUrl.startsWith('http')) return targetUrl;
    
    let url = `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
    
    if (customHeaders && Object.keys(customHeaders).length > 0) {
        try {
            const headerStr = JSON.stringify(customHeaders);
            const base64 = typeof window !== 'undefined' 
                ? btoa(headerStr) 
                : Buffer.from(headerStr).toString('base64');
            url += `&p_headers=${encodeURIComponent(base64)}`;
        } catch (e) {
            console.error("Failed to encode custom headers", e);
        }
    }
    return url;
};

/**
 * WebKitPlayer - A lightweight player optimized for Safari and iOS.
 * Uses native HLS support instead of Hls.js or Shaka Player.
 */
export default function WebKitPlayer({ 
    url, 
    title, 
    onClose, 
    headers, 
    onDebugInfo 
}: WebKitPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    const initPlayer = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        setError(null);
        const proxyUrl = getProxyUrl(url, headers);
        console.log(`[WebKitPlayer] Init effort #${retryCount + 1}`, proxyUrl);
        
        video.src = proxyUrl;
        video.load();

        const handlePlay = () => {
            setRetryCount(0); // Reset on success
            if (onDebugInfo) {
                onDebugInfo({
                    status: 'ok',
                    playMethod: 'Native WebKit',
                    streamType: 'HLS (Native)',
                    originalUrl: url,
                    proxyUrl: proxyUrl
                });
            }
        };

        const handleError = () => {
            const err = video.error;
            let msg = `Error ${err?.code}: `;
            
            switch(err?.code) {
                case 1: msg += "Playback Aborted"; break;
                case 2: msg += "Network Error"; break;
                case 3: msg += "Decoding Failed"; break;
                case 4: msg += "Stream not supported"; break;
                default: msg += "Unknown error";
            }

            console.error('[WebKitPlayer]', msg);
            setError(msg);

            if (onDebugInfo) {
                onDebugInfo({
                    status: 'error',
                    error: msg,
                    originalUrl: url
                });
            }

            // Auto-Retry logic for network/abort errors
            if (retryCount < 3 && (err?.code === 1 || err?.code === 2)) {
                console.log("[WebKitPlayer] Retrying in 2s...");
                setTimeout(() => setRetryCount(prev => prev + 1), 2000);
            }
        };

        video.addEventListener('play', handlePlay);
        video.addEventListener('error', handleError);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('error', handleError);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [url, headers, onDebugInfo, retryCount]);

    useEffect(() => {
        const cleanup = initPlayer();
        return () => {
            if (cleanup) cleanup();
        };
    }, [initPlayer]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl">
            <div className="relative w-full h-full md:w-[90vw] md:h-[85vh] bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10">
                
                {/* Native Video Tag */}
                <video 
                    ref={videoRef}
                    className="w-full h-full"
                    controls
                    playsInline
                />

                {/* Error Overlay */}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20">
                        <p className="text-white font-medium mb-4">{error}</p>
                        <button 
                            onClick={() => { setRetryCount(0); initPlayer(); }}
                            className="px-6 py-2 bg-primary text-white rounded-full hover:scale-105 transition-transform"
                        >
                            Retry Now
                        </button>
                    </div>
                )}
                
                {/* Header */}
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
