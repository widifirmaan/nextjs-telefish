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
            return NextResponse.json({ error: 'Missing license parameter' }, { status: 400 });
        }
        
        // Decode the license data (same format as BitTV APK)
        const normalizedLicense = licenseParam.replace(/-/g, '+').replace(/_/g, '/');
        const paddedLicense = normalizedLicense.length % 4 === 0 
            ? normalizedLicense 
            : normalizedLicense + '='.repeat(4 - (normalizedLicense.length % 4));
        
        const jsonStr = Buffer.from(paddedLicense, 'base64').toString('utf8');
        const licenseData = JSON.parse(jsonStr);
        
        if (!licenseData.keys || !Array.isArray(licenseData.keys)) {
            return NextResponse.json({ error: 'Invalid license data format' }, { status: 400 });
        }
        
        // Helper to convert base64 to base64url
        const base64ToBase64Url = (base64: string) => {
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        
        // Build EME ClearKey license response
        const clearKeyResponse = {
            keys: licenseData.keys.map((k: { kid: string; k: string }) => ({
                kty: "oct",
                kid: base64ToBase64Url(k.kid),
                k: base64ToBase64Url(k.k)
            })),
            type: "temporary"
        };
        
        console.log('[ClearKey Server] Returning license response:', clearKeyResponse);
        
        return NextResponse.json(clearKeyResponse, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Content-Type': 'application/json'
            }
        });
        
    } catch (e: any) {
        console.error('[ClearKey Server] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
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
