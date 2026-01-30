export interface Channel {
    id: string;
    name: string;
    tagline?: string;
    logo?: string;
    hls?: string;
    group?: string;
    [key: string]: any;
}

export interface PlaylistResponse {
    country_name: string;
    country: string;
    info: Channel[];
}

const PLAYLIST_URL = "https://raw.githubusercontent.com/brodatv1/lite/main/v214/ID.json";

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

export async function fetchPlaylist(): Promise<PlaylistResponse | null> {
    const now = Date.now();
    if (cachedPlaylist && (now - lastFetchTime < CACHE_DURATION)) {
        return cachedPlaylist;
    }

    try {
        console.log(`Fetching playlist from ${PLAYLIST_URL}`);
        const res = await fetch(PLAYLIST_URL, { next: { revalidate: 300 } });
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

        const text = await res.text();
        const decrypted = decryptPlaylist(text);

        cachedPlaylist = JSON.parse(decrypted);
        lastFetchTime = now;

        return cachedPlaylist;
    } catch (e) {
        console.error("Error fetching playlist:", e);
        return null;
    }
}
