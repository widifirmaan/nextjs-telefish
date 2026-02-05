import { NextResponse } from 'next/server';
import { fetchPlaylist } from '@/lib/bittv';

export const dynamic = 'force-dynamic'; // disable static caching

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';
        
        console.log(`[Playlist API] Force refresh: ${forceRefresh}`);
        const playlist = await fetchPlaylist(forceRefresh);

        if (!playlist) {
            return NextResponse.json(
                { error: 'Failed to fetch playlist' },
                { status: 500 }
            );
        }

        return NextResponse.json(playlist);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Playlist API error:', errorMsg, error);
        return NextResponse.json(
            { error: 'Internal server error', details: errorMsg },
            { status: 500 }
        );
    }
}