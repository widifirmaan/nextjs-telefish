import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const targetUrl = searchParams.get('url');
    const referer = searchParams.get('referer') || 'https://duktek.id/';
    const origin = searchParams.get('origin') || 'https://duktek.id';
    const userAgent = searchParams.get('user_agent') || 'BitTV/2.1.4';

    if (!targetUrl) {
        return new NextResponse("Missing url parameter", { status: 400 });
    }

    // Handle relative segments appended to the proxy URL
    // Safari might try requesting /api/playlist/proxy?url=BASE_URL&referer=.../segment.ts
    // or it might just append /segment.ts to the end of the query string.
    let finalUrl = targetUrl;
    const pathExtra = searchParams.get('path');
    if (pathExtra) {
        finalUrl = new URL(pathExtra, targetUrl).toString();
    }

    try {
        const headers: Record<string, string> = {
            'User-Agent': userAgent,
            'Referer': referer,
            'Origin': origin,
        };

        const incomingRange = request.headers.get('range');
        if (incomingRange) headers['Range'] = incomingRange;

        const incomingAccept = request.headers.get('accept');
        if (incomingAccept) headers['Accept'] = incomingAccept;

        const response = await fetch(finalUrl, {
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

        if (isM3u8 || isMpd) {
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
                        
                        let segmentUrl = trimmed;
                        try { segmentUrl = new URL(trimmed, baseUrl).toString(); } catch (e) { return trimmed; }
                        
                        // Proxy the segment URL
                        const proxiedLink = new URL('/api/playlist/proxy', request.url);
                        proxiedLink.searchParams.set('url', segmentUrl);
                        proxiedLink.searchParams.set('referer', referer);
                        proxiedLink.searchParams.set('origin', origin);
                        proxiedLink.searchParams.set('user_agent', userAgent);
                        if (drm) proxiedLink.searchParams.set('drm', drm);
                        
                        return proxiedLink.toString();
                    }).join('\n');
                } else if (isMpd) {
                    // For MPD, we need to rewrite BaseURL to go through our proxy
                    // This ensures all segment requests are CORS-enabled
                    const proxyBaseUrl = `/api/playlist/proxy?url=${encodeURIComponent(baseUrl)}`;
                    
                    if (!text.includes('<BaseURL>')) {
                        const mpdMatch = text.match(/<MPD[^>]*>/i);
                        if (mpdMatch) {
                            const mpdTag = mpdMatch[0];
                            const idx = text.indexOf(mpdTag);
                            
                            // For MPD BaseURL, we point it to the proxy
                            const proxiedBase = new URL('/api/playlist/proxy', request.url);
                            proxiedBase.searchParams.set('url', baseUrl);
                            proxiedBase.searchParams.set('referer', referer);
                            proxiedBase.searchParams.set('origin', origin);
                            proxiedBase.searchParams.set('user_agent', userAgent);
                            if (drm) proxiedBase.searchParams.set('drm', drm);
                            
                            text = text.slice(0, idx + mpdTag.length) + `\n  <BaseURL>${proxiedBase.toString()}&amp;path=</BaseURL>` + text.slice(idx + mpdTag.length);
                        }
                    } else {
                        // If BaseURL exists, we leave it for now or could wrap it. 
                        // Most Duktek MPDs don't have it, so injecting it is usually enough.
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
        return new NextResponse(`Proxy Error: ${e.message}`, { status: 500 });
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Range, User-Agent, X-Requested-With',
        },
    });
}