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

    const initPlayer = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        const proxyUrl = getProxyUrl(url, headers);
        console.log("[WebKitPlayer] Initializing with URL:", proxyUrl);
        
        video.src = proxyUrl;
        video.load();

        // Handle Play Promise to avoid AbortError
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn("[WebKitPlayer] Autoplay prevented or aborted:", error);
            });
        }

        // Basic event listeners for debugging
        const handlePlay = () => {
            console.log("[WebKitPlayer] Playback started");
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
            const error = video.error;
            console.error('Native Player Error:', error?.code, error?.message);
            if (onDebugInfo) {
                onDebugInfo({
                    status: 'error',
                    error: `Code ${error?.code}: ${error?.message || 'Native WebKit error'}`,
                    originalUrl: url
                });
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
    }, [url, headers, onDebugInfo]);

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
                    autoPlay
                    muted
                    playsInline
                />
                
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
