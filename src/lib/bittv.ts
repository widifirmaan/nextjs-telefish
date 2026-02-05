export interface Channel {
    id: string;
    name: string;
    tagline?: string;
    hls: string;
    namespace?: string;
    is_live?: string;
    is_movie?: string;
    image?: string;
    header_iptv?: string;
    url_license?: string;
    header_license?: string;
    jenis?: string;
    [key: string]: any;
}

export interface PlaylistData {
    indonesia: Channel[];
    event: Channel[];
    version: string;
    lastUpdated: number;
}

const BASE_URL = "https://raw.githubusercontent.com/brodatv1/lite/main";
const GITHUB_API_URL = "https://api.github.com/repos/brodatv1/lite/contents/";

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
    // First, try to parse as plain JSON (might not be encrypted)
    try {
        const parsed = JSON.parse(encryptedInfo);
        // Check if it looks like playlist data
        if (parsed.data || parsed.info || Array.isArray(parsed)) {
            console.log("[Playlist] Data is plain JSON, not encrypted");
            return encryptedInfo;
        }
    } catch (e) {
        // Not plain JSON, proceed with decryption
    }

    console.log("[Playlist] Starting decryption scan...");

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
                        console.log(`[Playlist] Successfully decrypted and parsed at offset ${i}`);
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

    console.error("[Playlist] All offsets failed decryption.");
    return encryptedInfo; // Return original as fallback, maybe it's partially valid
}

async function getLatestVersion(): Promise<string> {
    try {
        const res = await fetch(GITHUB_API_URL, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
        
        const data = await res.json() as Array<{ name: string }>;
        // Find directories (versions) and sort them - they should be numeric folder names
        const versions = data
            .filter(item => item.name && /^\d+$/.test(item.name))
            .map(item => parseInt(item.name, 10))
            .sort((a, b) => b - a);
        
        if (versions.length === 0) {
            console.warn('[Playlist] No versions found, using default');
            return 'default';
        }
        
        const latest = versions[0].toString();
        console.log(`[Playlist] Latest version: ${latest}`);
        return latest;
    } catch (e) {
        console.error('[Playlist] Error getting latest version:', e);
        return 'default';
    }
}

// Simple in-memory cache
let cachedPlaylist: PlaylistData | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 5; // 5 minutes

async function fetchAndDecrypt(url: string): Promise<Channel[] | null> {
    try {
        console.log(`[Playlist] Fetching from ${url}`);
        const res = await fetch(url, { 
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (!res.ok) {
            console.error(`[Playlist] Fetch failed with status ${res.status}`);
            return null;
        }

        let text = await res.text();
        console.log(`[Playlist] Raw response length: ${text.length}, first 150 chars: ${text.substring(0, 150)}`);
        
        // Check if data looks like it's already JSON (not encrypted)
        let data;
        try {
            // Try parsing first before decryption
            data = JSON.parse(text);
            console.log(`[Playlist] Data is plain JSON, parsed successfully`);
        } catch (e) {
            // Not plain JSON, try decryption
            console.log(`[Playlist] Not plain JSON, attempting decryption...`);
            const decrypted = decryptPlaylist(text);
            try {
                data = JSON.parse(decrypted);
                console.log(`[Playlist] Decryption successful`);
            } catch (parseErr) {
                console.error(`[Playlist] JSON parse error after decryption for ${url}:`, parseErr);
                return null;
            }
        }
        
        // Extract channels from various possible structures
        let channels: Channel[] = [];
        if (data.info && Array.isArray(data.info)) {
            channels = data.info;
            console.log(`[Playlist] Found ${channels.length} channels in data.info`);
        } else if (data.data && Array.isArray(data.data)) {
            channels = data.data;
            console.log(`[Playlist] Found ${channels.length} channels in data.data`);
        } else if (Array.isArray(data)) {
            channels = data;
            console.log(`[Playlist] Found ${channels.length} channels in root array`);
        } else {
            console.warn(`[Playlist] No channel array found in response, keys:`, Object.keys(data).slice(0, 10));
            return null;
        }
        
        console.log(`[Playlist] Extracted ${channels.length} channels from ${url}`);
        return channels.length > 0 ? channels : null;
    } catch (e) {
        console.error(`[Playlist] Error fetching/decrypting ${url}:`, e);
        return null;
    }
}

let isUpdating = false;
async function triggerBackgroundUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const result = await performFetch();
        if (result) {
            console.log('[Playlist] Background update completed');
        }
    } finally {
        isUpdating = false;
    }
}

async function performFetch(): Promise<PlaylistData | null> {
    try {
        const version = await getLatestVersion();
        console.log(`[Playlist] Fetching version ${version}`);

        const idUrl = `${BASE_URL}/${version}/ID.json`;
        const evUrl = `${BASE_URL}/${version}/EV.json`;

        const [idChannels, evChannels] = await Promise.all([
            fetchAndDecrypt(idUrl),
            fetchAndDecrypt(evUrl)
        ]);

        const data: PlaylistData = {
            indonesia: idChannels || [],
            event: evChannels || [],
            version: version,
            lastUpdated: Date.now()
        };

        cachedPlaylist = data;
        lastFetchTime = Date.now();
        return data;
    } catch (e) {
        console.error("[Playlist] Error performing fetch:", e);
        return null;
    }
}

export async function fetchPlaylist(force: boolean = false): Promise<PlaylistData | null> {
    const now = Date.now();
    
    // Return cache if fresh enough and not forced
    if (!force && cachedPlaylist && (now - lastFetchTime < CACHE_DURATION)) {
        return cachedPlaylist;
    }

    // If we have stale cache, trigger background update and return stale data
    if (!force && cachedPlaylist) {
        console.log("[Playlist] Returning stale cache, triggering background update...");
        triggerBackgroundUpdate();
        return cachedPlaylist;
    }

    return performFetch();
}