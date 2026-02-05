import { NextResponse } from 'next/server';
import { fetchPlaylist } from '@/lib/bittv';

export const dynamic = 'force-dynamic'; // disable static caching

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('refresh') === 'true';
    
    const playlist = await fetchPlaylist(force);
    if (!playlist) {
        return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 });
    }
    return NextResponse.json(playlist);
}