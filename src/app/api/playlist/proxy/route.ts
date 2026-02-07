import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// BitTV APK v2.1.5 Header Defaults
const BITTV_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0';
const BITTV_REFERER = 'https://duktek.id/?device=BitTVWeb&is_genuine=true';
const BITTV_ORIGIN = 'https://duktek.id';
const ANDROID_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ1A.231105.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';
const ANDROID_REFERER = 'https://duktek.id/?device=BitTVAndroid&is_genuine=true';

async function handleRequest(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const targetUrl = searchParams.get('url');
    const referer = searchParams.get('referer') || BITTV_REFERER;
    const origin = searchParams.get('origin') || BITTV_ORIGIN;
    const userAgent = searchParams.get('user_agent') || BITTV_USER_AGENT;
    const useAndroid = (searchParams.get('android') || '').toLowerCase() === '1' || (searchParams.get('android') || '').toLowerCase() === 'true';


    if (!targetUrl) {
        return new NextResponse("Missing url parameter", { status: 400 });
    }

    try {
        const headers: Record<string, string> = {
            'User-Agent': useAndroid ? ANDROID_USER_AGENT : userAgent,
        };

        if (useAndroid) {
            const androidRef = searchParams.get('referer');
            headers['Referer'] = (androidRef && androidRef !== 'none') ? androidRef : ANDROID_REFERER;
        } else if (referer && referer !== 'none') {
            headers['Referer'] = referer;
        }
        if (origin && origin !== 'none') headers['Origin'] = origin;

        const incomingRange = request.headers.get('range');
        if (incomingRange) headers['Range'] = incomingRange;

        const incomingAccept = request.headers.get('accept');
        if (incomingAccept) headers['Accept'] = incomingAccept;

        // Passthrough original method (important for HEAD requests)
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
        });

        const newHeaders = new Headers(response.headers);
        newHeaders.delete('content-encoding');
        
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Range, User-Agent, X-Requested-With');
        newHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        const contentType = newHeaders.get('content-type') || '';
        const isM3u8 = contentType.includes('application/vnd.apple.mpegurl') ||
            contentType.includes('application/x-mpegurl') ||
            targetUrl.includes('.m3u8');

        const isMpd = contentType.includes('application/dash+xml') ||
            targetUrl.includes('.mpd');

        // Only process manifest text for GET requests
        if ((isM3u8 || isMpd) && request.method === 'GET') {
            try {
                // Since we are modifying the manifest text, the original Content-Length is invalid
                newHeaders.delete('content-length');
                
                let text = await response.text();
                const drm = searchParams.get('drm');
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

                if (isM3u8) {
                    text = text.split('\n').map(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return line;
                        if (trimmed.startsWith('http')) return trimmed;
                        try { return new URL(trimmed, baseUrl).toString(); } catch (e) { return trimmed; }
                    }).join('\n');
                } else if (isMpd) {
                    if (!text.includes('<BaseURL>')) {
                        const mpdMatch = text.match(/<MPD[^>]*>/i);
                        if (mpdMatch) {
                            const mpdTag = mpdMatch[0];
                            const idx = text.indexOf(mpdTag);
                            text = text.slice(0, idx + mpdTag.length) + `\n  <BaseURL>${baseUrl}</BaseURL>` + text.slice(idx + mpdTag.length);
                        }
                    } else {
                        text = text.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (m, c) => c.trim().startsWith('http') ? m : `<BaseURL>${baseUrl}${c.trim()}</BaseURL>`);
                    }

                    if (drm === 'clearkey') {
                        console.log("[Proxy] Processing ClearKey for MPD:", targetUrl);
                        const cpRegex = /<ContentProtection[\s\S]*?<\/ContentProtection>|<ContentProtection[\s\S]*?\/>/gi;
                        const kidMatch = text.match(/(?:cenc:)?default_KID="([^"]+)"/i);
                        const kidStr = kidMatch ? ` cenc:default_KID="${kidMatch[1]}" xmlns:cenc="urn:mpeg:cenc:2013"` : "";
                        if (kidMatch) console.log("[Proxy] Found default_KID:", kidMatch[1]);

                        const originalCount = (text.match(cpRegex) || []).length;
                        text = text.replace(cpRegex, '');
                        console.log(`[Proxy] Stripped ${originalCount} ContentProtection blocks`);

                        const clearKeyProtection = `      <ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-0070aaff49d2" value="ClearKey"${kidStr}/>`;
                        if (text.includes('<AdaptationSet')) {
                            text = text.replace(/<AdaptationSet([^>]*)>/g, (match) => `${match}\n${clearKeyProtection}`);
                            console.log("[Proxy] Injected ClearKey into AdaptationSets");
                        } else {
                            console.warn("[Proxy] No AdaptationSet found to inject ClearKey!");
                        }
                    }
                }

                return new NextResponse(text, { status: response.status, headers: newHeaders });
            } catch (err: any) {
                console.error("[Proxy] Manifest processing error:", err);
                return new NextResponse(`Proxy Processing Failed: ${err.message}`, { status: 500 });
            }
        }

        return new NextResponse(response.body, {
            status: response.status,
            headers: newHeaders,
        });

    } catch (e: any) {
        console.error("Proxy main error:", e);
        const errorMessage = e.message || 'Unknown error';
        const isNetworkError = errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('connect');
        
        if (isNetworkError) {
            return new NextResponse(JSON.stringify({
                error: 'Network/CDN Error',
                message: 'Unable to reach streaming source. This may be due to: geo-blocking, CDN issues, expired token, or connectivity problems.',
                details: errorMessage,
                suggestion: 'Try a different channel or wait a moment and refresh.'
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
        
        return new NextResponse(JSON.stringify({
            error: 'Proxy Error',
            message: errorMessage
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function HEAD(request: NextRequest) {
    return handleRequest(request);
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Range, User-Agent, X-Requested-With',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        },
    });
}