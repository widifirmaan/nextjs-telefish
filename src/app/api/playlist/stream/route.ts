
/**
 * PROXY ROUTE - BitTV Web
 * Last Touched: 2026-02-08 (Fixing stale build cache)
 * 
 * This file handles proxying and manifest rewriting for the player.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Configuration for impersonating an Android device (BitTV App)
const EXOPLAYER_UA = 'Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/TQ1A.231105.002) ExoPlayerLib/2.18.2';
const ANDROID_REFERER = 'https://duktek.id/';
const ANDROID_ORIGIN = 'https://duktek.id';
const ANDROID_X_REQUESTED_WITH = 'id.duktek.bittv';

async function handleRequest(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const targetUrl = searchParams.get('url');
    const customHeadersBase64 = searchParams.get('p_headers');

    if (!targetUrl) {
        return new NextResponse("Missing 'url' parameter", { status: 400 });
    }

    console.log("Proxy Target URL:", targetUrl);

    try {
        new URL(targetUrl);
    } catch (e) {
        console.error('URL parse fail:', e, targetUrl);
        return new NextResponse("Invalid URL", { status: 400 });
    }

    try {
        // Headers - Mimic BitTV Android App (ExoPlayer based)
        const headers = new Headers();
        headers.set('User-Agent', EXOPLAYER_UA);
        headers.set('Referer', ANDROID_REFERER);
        headers.set('Origin', ANDROID_ORIGIN);
        headers.set('X-Requested-With', ANDROID_X_REQUESTED_WITH);
        
        // Forward Client IP (Crucial for bypassing region locks on Vercel)
        const clientIpRaw = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
        if (clientIpRaw) {
            const clientIp = clientIpRaw.split(',')[0].trim();
            headers.set('X-Forwarded-For', clientIp);
            headers.set('X-Real-IP', clientIp);
            headers.set('Client-IP', clientIp);
            headers.set('True-Client-IP', clientIp);
            headers.set('X-Originating-IP', clientIp);
        }

        // Apply Trans Media (TransTV, Trans7, CNN, CNBC) Specific Hack if URL matches
        if (/transtv|trans7|cnnindonesia|cnbcindonesia|detik/.test(targetUrl)) {
             headers.set('Referer', 'https://www.transtv.co.id/');
             headers.set('Origin', 'https://www.transtv.co.id');
        }

        // Apply Custom Headers from URL parameter (if provided)
        if (customHeadersBase64) {
            try {
                const decodedJson = Buffer.from(customHeadersBase64, 'base64').toString('utf8');
                const pHeaders = JSON.parse(decodedJson);
                Object.entries(pHeaders).forEach(([key, value]) => {
                    headers.set(key, String(value));
                });
            } catch (e) {
                console.error("[Proxy] Failed to parse p_headers", e);
            }
        }
        
        // Forward Content-Type for POST/PUT requests
        const reqContentType = request.headers.get('content-type');
        if (reqContentType) {
            headers.set('Content-Type', reqContentType);
        }
        
        const incomingRange = request.headers.get('range');
        const isManifest = targetUrl.includes('.m3u8') || targetUrl.includes('.mpd');
        const isFlv = targetUrl.includes('.flv');
        
        if (incomingRange) {
            headers.set('Range', incomingRange);
        } else if (!isManifest && !isFlv) {
             // Force Range for media segments (but NOT manifests or live FLV)
             headers.set('Range', 'bytes=0-');
        }
        
        const incomingAccept = request.headers.get('accept');
        headers.set('Accept', incomingAccept || '*/*');

        headers.set('Connection', 'Keep-Alive');
        headers.set('Accept-Encoding', 'gzip');
        
        // Debug headers
        console.log(`[Proxy] ${request.method} to ${targetUrl}`);

        // Handle body for POST/PUT/PATCH
        let body: any = undefined;
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
            body = await request.arrayBuffer();
        }

        // Fetch
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: body,
            redirect: 'follow',
            signal: request.signal // Stop proxying if the client disconnects
        });

        // Response Headers
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        responseHeaders.set('Access-Control-Expose-Headers', '*');
        responseHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');

        const finalContentType = responseHeaders.get('content-type') || '';
        const isM3u8 = finalContentType.includes('mpegurl') || targetUrl.includes('.m3u8');
        const isMpd = finalContentType.includes('dash+xml') || targetUrl.includes('.mpd');

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Proxy Upstream Error ${response.status}:`, errorText.substring(0, 200));
            return new NextResponse(errorText, {
                status: response.status,
                headers: responseHeaders,
            });
        }

        // Rewrite Manifests ...
        if (request.method === 'GET' && (isM3u8 || isMpd)) {
            const originalText = await response.text();
            let newText = originalText;
            const finalUrl = response.url || targetUrl;
            const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);

            if (isM3u8) {
                newText = originalText.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;
                    if (trimmed.startsWith('#')) {
                        // Rewrite URI inside tags
                         if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
                            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
                                if (uri.startsWith('http')) return `URI="${uri}"`;
                                try { return `URI="${new URL(uri, baseUrl).toString()}"`; } catch (e) { return `URI="${uri}"`; }
                            });
                        }
                        return line;
                    }
                    // Rewrite segment URL
                    if (trimmed.startsWith('http')) return trimmed;
                    try { return new URL(trimmed, baseUrl).toString(); } catch (e) { return trimmed; }
                }).join('\n');

            } else if (isMpd) {
                 // Rewrite DASH: Inject BaseURL if not present, or ensure it's absolute
                 if (!newText.includes('<BaseURL>')) {
                     const mpdMatch = newText.match(/<MPD[^>]*>/i);
                     if (mpdMatch) {
                        const mpdTag = mpdMatch[0];
                        const idx = newText.indexOf(mpdTag) + mpdTag.length;
                        newText = newText.slice(0, idx) + `\n  <BaseURL>${baseUrl}</BaseURL>` + newText.slice(idx);
                     }
                 } else {
                     newText = newText.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, content) => {
                         const trimmed = content.trim();
                         if (trimmed.startsWith('http')) return match;
                         try {
                              return `<BaseURL>${new URL(trimmed, baseUrl).toString()}</BaseURL>`;
                         } catch (e) { return match; }
                     });
                 }
            }

            return new NextResponse(newText, {
                status: 200,
                headers: responseHeaders,
            });
        }

        return new NextResponse(response.body, {
            status: response.status,
            headers: responseHeaders,
        });

    } catch (e: any) {
        if (e.name === 'AbortError') {
            console.log(`[Proxy] Aborted by client: ${targetUrl}`);
            return new NextResponse(null, { status: 499 }); // Client Closed Request
        }
        console.error(`[Proxy Error] URL: ${targetUrl}`, e);
        return new NextResponse(JSON.stringify({ 
            error: e.message,
            stack: e.stack,
            url: targetUrl
        }), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

export async function HEAD(request: NextRequest) {
    return handleRequest(request);
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
        },
    });
}
