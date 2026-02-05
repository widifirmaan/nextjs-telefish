export interface Channel {
    id: string;
    name: string;
    tagline?: string;
    logo?: string;
    hls?: string;
    group?: string;
    category?: string;
    source?: string;
    [key: string]: any;
}

export interface PlaylistResponse {
    country_name: string;
    country: string;
    info: Channel[];
}

const PLAYLIST_ID_URL = "https://raw.githubusercontent.com/brodatv1/lite/main/ID.json";
const PLAYLIST_EV_URL = "https://raw.githubusercontent.com/brodatv1/lite/main/EV.json";

function reverse(s: string): string {
    return s.split('').reverse().join('');
}

function k0(input: string): string {
    try {
        // Step 1: Reverse then Base64 Decode to binary string (Base64 is ASCII)
        const r1 = reverse(input);
        const b1 = Buffer.from(r1, 'base64');
        const s1 = b1.toString('latin1');

        // Step 2: Reverse then Base64 Decode to binary string
        const r2 = reverse(s1);
        const b2 = Buffer.from(r2, 'base64');
        const s2 = b2.toString('utf8'); // The final result before last reverse should be UTF-8 JSON

        // Step 3: Reverse
        return reverse(s2);
    } catch (e) {
        return "";
    }
}

function decryptPlaylist(encryptedInfo: string): string {
    console.log("Starting decryption scan...");

    // Optimization: Check known common offset (98) first
    const offsetsToCheck = [98, ...Array.from({ length: 1000 }, (_, i) => i).filter(i => i !== 98)];

    for (const i of offsetsToCheck) {
        if (i >= encryptedInfo.length) break;
        try {
            const sub = encryptedInfo.substring(i);
            const decrypted = k0(sub);
            const trimmed = decrypted.trim();

            if (trimmed.startsWith("{")) {
                // To avoid "Unexpected character after JSON", we find the last closing brace
                const lastBrace = trimmed.lastIndexOf("}");
                if (lastBrace !== -1) {
                    const candidate = trimmed.substring(0, lastBrace + 1);
                    try {
                        JSON.parse(candidate);
                        console.log(`Successfully decrypted and parsed at offset ${i}`);
                        return candidate;
                    } catch (e) {
                        // Not a complete JSON yet, continue scanning
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }
    console.error("All offsets failed decryption.");
    return JSON.stringify({ error: "Decryption failed" });
}

// Simple in-memory cache
let cachedPlaylist: PlaylistResponse | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 5; // 5 minutes

async function fetchFromUrl(url: string, useDecryption: boolean = false, source: string = ""): Promise<PlaylistResponse | null> {
    try {
        console.log(`Fetching from ${url}`);
        const res = await fetch(url, { 
            next: { revalidate: 300 },
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

        const text = await res.text();
        let decrypted = text;
        
        if (useDecryption) {
            decrypted = decryptPlaylist(text);
        }

        const data = JSON.parse(decrypted);
        
        // Handle different response formats
        let channels = [];
        if (data.info && Array.isArray(data.info)) {
            channels = data.info;
        } else if (Array.isArray(data)) {
            channels = data;
        } else if (data.channels && Array.isArray(data.channels)) {
            channels = data.channels;
        } else if (data.data && Array.isArray(data.data)) {
            channels = data.data;
        }
        
        // Normalize channel fields - handle different field names
        const processedChannels = channels.map((ch: any) => ({
            ...ch,
            id: ch.id || ch.tvg_id || `ch_${Date.now()}_${Math.random()}`,
            name: ch.name || ch.tvg_name || ch.title || 'Unknown',
            hls: ch.hls || ch.url || ch.stream_url || ch.link || '',
            logo: ch.logo || ch.tvg_logo || ch.image || ch.thumb || '',
            source: source || data.country || "Unknown"
        }));
        
        return {
            country_name: data.country_name || data.country || source || "Unknown",
            country: data.country || source || "Unknown",
            info: processedChannels,
        };
    } catch (e) {
        console.error(`Error fetching from ${url}:`, e);
        return null;
    }
}

export async function fetchPlaylist(): Promise<PlaylistResponse | null> {
    const now = Date.now();
    if (cachedPlaylist && lastFetchTime > 0 && (now - lastFetchTime < CACHE_DURATION)) {
        console.log("Returning playlist from cache");
        return cachedPlaylist;
    }

    try {
        const fetchTime = Date.now();
        console.log("Fetching ID.json and EV.json with categories");
        
        // Fetch both in parallel
        const [idPlaylist, evPlaylist] = await Promise.all([
            fetchFromUrl(PLAYLIST_ID_URL, true, "Indonesia"),
            fetchFromUrl(PLAYLIST_EV_URL, false, "Event"),
        ]);

        if (!idPlaylist && !evPlaylist) {
            return null;
        }

        // Combine all channels with category
        const allChannels: Channel[] = [];

        // Add ID.json channels with "indonesia" category
        if (idPlaylist && Array.isArray(idPlaylist.info)) {
            idPlaylist.info.forEach(ch => {
                allChannels.push({
                    ...ch,
                    category: "indonesia",
                    source: "Indonesia"
                });
            });
        }

        // Add EV.json channels with "event" category
        if (evPlaylist && Array.isArray(evPlaylist.info)) {
            evPlaylist.info.forEach(ch => {
                allChannels.push({
                    ...ch,
                    category: "event",
                    source: "Event"
                });
            });
        }

        cachedPlaylist = {
            country_name: 'Indonesia & Event',
            country: 'ID+EV',
            info: allChannels,
        };
        lastFetchTime = fetchTime;

        console.log(`Playlist loaded: ${allChannels.length} channels (${idPlaylist?.info?.length || 0} Indonesia + ${evPlaylist?.info?.length || 0} Event)`);
        return cachedPlaylist;
    } catch (e) {
        console.error("Error fetching playlist:", e);
        return null;
    }
}