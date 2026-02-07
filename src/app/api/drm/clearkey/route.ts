import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * ClearKey License Server
 * 
 * This endpoint acts as a ClearKey license server for dash.js.
 * It receives a license request from EME and returns the key data.
 * 
 * Query params:
 * - license: Base64 encoded license data containing keys
 * 
 * OR POST body contains the EME license request (key IDs needed)
 */
export async function POST(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const licenseParam = searchParams.get('license');
        
        if (!licenseParam) {
            console.error('[ClearKey] No license parameter provided');
            return NextResponse.json({ error: 'Missing license parameter' }, { status: 400 });
        }
        
        // 1. Get requested kids from body
        let requestedKids: string[] = [];
        try {
            const body = await request.json();
            console.log('[ClearKey] Request Body:', body);
            if (body && body.kids) {
                requestedKids = body.kids;
            }
        } catch (e) {
            console.log('[ClearKey] No valid JSON body or empty body');
        }

        // 2. Decode the license key set from the query param
        let licenseData;
        try {
            const normalizedLicense = licenseParam.replace(/-/g, '+').replace(/_/g, '/');
            const paddedLicense = normalizedLicense.padEnd(normalizedLicense.length + (4 - normalizedLicense.length % 4) % 4, '=');
            const jsonStr = Buffer.from(paddedLicense, 'base64').toString('utf8');
            licenseData = JSON.parse(jsonStr);
        } catch (e: any) {
            console.error('[ClearKey] License decode failed:', e.message);
            return NextResponse.json({ error: 'License decoding failed' }, { status: 400 });
        }
        
        if (!licenseData.keys || !Array.isArray(licenseData.keys)) {
            return NextResponse.json({ error: 'Invalid keys format' }, { status: 400 });
        }
        
        const base64ToBase64Url = (base64: string) => {
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        
        // 3. Filter keys if kids are requested, otherwise return all
        // Shaka usually sends base64url encoded kids in the request
        const responseKeys = licenseData.keys
            .map((k: { kid: string; k: string }) => ({
                kty: "oct",
                kid: base64ToBase64Url(k.kid),
                k: base64ToBase64Url(k.k)
            }));
            
        // Log what we found
        console.log(`[ClearKey] Found ${responseKeys.length} keys. Requested kids:`, requestedKids);

        const clearKeyResponse = {
            keys: responseKeys
        };
        
        return new NextResponse(JSON.stringify(clearKeyResponse), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
        
    } catch (e: any) {
        console.error('[ClearKey Server] Global Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    // Redirect GET to POST logic for easy debugging
    return POST(request);
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}