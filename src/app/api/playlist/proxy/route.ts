import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const targetUrl = searchParams.get('url');
    const referer = searchParams.get('referer') || 'https://duktek.id/';
    const origin = searchParams.get('origin') || 'https://duktek.id';
    const userAgent = searchParams.get('user_agent') || 'BitTV/2.1.4';

    if (!targetUrl) {
        // Fallback: Check if the request path itself contains the target info? 
        // Or if dash.js appended the segment to the proxy base path?
        // e.g. /api/playlist/proxy/segment.mp4 ?? Next.js app router doesn't route like that automatically for this file structure.
        // The error shows /api/playlist/index_video... which means it fell out of the proxy route entirely!
        // Wait, the error is: GET http://localhost:3000/api/playlist/index_video_7_0_init.mp4?m=1744885984 404 (Not Found)
        // This is NOT hitting /api/playlist/proxy. It's hitting /api/playlist/...
        // This means dash.js is resolving relative to the PAGE path or some other base, NOT the proxy.
        // Ah! If we load manifest via /api/playlist/proxy?url=..., dash.js likely sets the BaseURL to /api/playlist/ IF the mpd doesn't contain a BaseURL.
        // So we MUST inject the BaseURL.
        return new NextResponse("Missing url parameter", { status: 400 });
    }

    try {
        const headers: Record<string, string> = {
            'User-Agent': userAgent,
            'Referer': referer,
            'Origin': origin,
        };

        // Forward critical headers from the incoming request
        const incomingRange = request.headers.get('range');
        if (incomingRange) headers['Range'] = incomingRange;

        const incomingAccept = request.headers.get('accept');
        if (incomingAccept) headers['Accept'] = incomingAccept;

        const response = await fetch(targetUrl, {
            headers: headers,
            // For streams, we usually want to stream the response back
            // but Next.js/Node fetch might buffer. 
            // In App Router, returning response directly might work for streaming if using native Response?
            // Let's try standard fetch streaming.
        });

        // Copy headers from the upstream response
        const newHeaders = new Headers(response.headers);

        // Remove compression headers to avoid ERR_CONTENT_DECODING_FAILED
        // because fetch() automatically decompresses, but if we forward content-encoding,
        // the browser expects compressed data while getting raw.
        newHeaders.delete('content-encoding');
        newHeaders.delete('content-length');

        // CORS headers
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Range, User-Agent, X-Requested-With');

        const contentType = newHeaders.get('content-type') || '';
        const isM3u8 = contentType.includes('application/vnd.apple.mpegurl') ||
            contentType.includes('application/x-mpegurl') ||
            targetUrl.includes('.m3u8');

        const isMpd = contentType.includes('application/dash+xml') ||
            targetUrl.includes('.mpd');

        if (isM3u8 || isMpd) {
            let text = await response.text();

            // Read DRM type
            const drm = searchParams.get('drm');

            // Rewrite relative URLs to absolute upstream URLs
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            if (isM3u8) {
                text = text.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) return line;

                    // If line is a URL (relative or absolute)
                    if (trimmed.startsWith('http')) return trimmed; // Already absolute

                    // Resolve relative URL
                    try {
                        return new URL(trimmed, baseUrl).toString();
                    } catch (e) {
                        return trimmed;
                    }
                }).join('\n');
            } else if (isMpd) {
                // Better approach for dash.js: If we insert an absolute <BaseURL> at the top level, 
                // dash.js will resolve relative segments against it.

                if (!text.includes('<BaseURL>')) {
                    // Inject BaseURL after <MPD ...> tag
                    const mpdMatch = text.match(/<MPD[^>]*>/i);
                    if (mpdMatch) {
                        const mpdTag = mpdMatch[0];
                        const insertPoint = text.indexOf(mpdTag) + mpdTag.length;
                        const insert = `\n  <BaseURL>${baseUrl}</BaseURL>`;
                        text = text.slice(0, insertPoint) + insert + text.slice(insertPoint);
                        console.log(`Injected BaseURL: ${baseUrl}`);
                    }
                } else {
                    text = text.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, content) => {
                        if (content.trim().startsWith('http')) return match;
                        return `<BaseURL>${baseUrl}${content}</BaseURL>`;
                    });
                }

                // DRM Injection for ClearKey if requested
                // dash.js needs to know ClearKey is supported if it's not in the manifest.
                if (drm === 'clearkey') {
                    // 1. Remove Widevine and PlayReady ContentProtection tags
                    // Widevine: edef8ba9-79d6-4ace-a3c8-27dcd51d21ed
                    // PlayReady: 9a04f079-9840-4286-ab92-e65be0885f95
                    
                    // Remove blocks with Widevine/PlayReady UUIDs
                    text = text.replace(/<ContentProtection[^>]*schemeIdUri="urn:uuid:(edef8ba9-79d6-4ace-a3c8-27dcd51d21ed|9a04f079-9840-4286-ab92-e65be0885f95)"[^>]*>([\s\S]*?)<\/ContentProtection>/gi, '');
                    text = text.replace(/<ContentProtection[^>]*schemeIdUri="urn:uuid:(edef8ba9-79d6-4ace-a3c8-27dcd51d21ed|9a04f079-9840-4286-ab92-e65be0885f95)"[^>]*\/>/gi, '');

                    // 2. Inject standard ClearKey <ContentProtection> into AdaptationSets
                    // We also add it to any AdaptationSet that doesn't have it yet.
                    const clearKeyProtection = '        <ContentProtection schemeIdUri="urn:uuid:1077efe1-c512-469a-ab1c-def2a6981145" value="ClearKey"/>';
                    text = text.replace(/<AdaptationSet([^>]*)>/g, (match) => {
                        return `${match}\n${clearKeyProtection}`;
                    });
                }
                
                // Final verify log
                console.log(`[Proxy] Final MPD text length: ${text.length}. DRM: ${drm || 'none'}`);
            }
            return new NextResponse(text, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders,
            });
        }

        // We can pass the body stream directly for non-m3u8 (segments)
        return new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });

    } catch (e: any) {
        console.error("Proxy error:", e);
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
