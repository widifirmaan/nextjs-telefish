import { NextResponse } from 'next/server';
import { fetchPlaylist } from '@/lib/bittv';

export const dynamic = 'force-dynamic'; // disable static caching

export async function GET() {
    const playlist = await fetchPlaylist();
    if (!playlist) {
        return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 });
    }
    return NextResponse.json(playlist);
}
