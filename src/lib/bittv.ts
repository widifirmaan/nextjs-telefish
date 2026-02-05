export interface Channel {
    id: string;
    name: string;
    tagline?: string;
    logo?: string;
    hls?: string;
    group?: string;
    [key: string]: any;
}

const BASE_URL = "https://raw.githubusercontent.com/brodatv1/lite/main";
const GITHUB_API_URL = "https://api.github.com/repos/brodatv1/lite/contents/";

export interface PlaylistData {
    indonesia: Channel[];
    event: Channel[];
    version: string;
    lastUpdated: number;
}

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
let cachedPlaylist: PlaylistData | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 5; // 5 minutes

async function getLatestVersion(): Promise<string> {
    try {
        const res = await fetch(GITHUB_API_URL, { next: { revalidate: 3600 } });
        if (!res.ok) return "v216"; // Fallback to a known version

        const contents = await res.json();
        const versions = contents
            .filter((item: any) => item.type === "dir" && /^v\d+/.test(item.name))
            .map((item: any) => item.name)
            .sort((a: string, b: string) => {
                const numA = parseInt(a.replace(/\D/g, ''));
                const numB = parseInt(b.replace(/\D/g, ''));
                return numB - numA;
            });

        return versions[0] || "v216";
    } catch (e) {
        console.error("Error fetching latest version:", e);
        return "v216";
    }
}

async function fetchAndDecrypt(url: string): Promise<Channel[] | null> {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        const text = await res.text();
        const decrypted = decryptPlaylist(text);
        const parsed = JSON.parse(decrypted);
        return parsed.info || [];
    } catch (e) {
        console.error(`Error fetching/decrypting ${url}:`, e);
        return null;
    }
}

let isUpdating = false;
async function triggerBackgroundUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        await performFetch();
    } finally {
        isUpdating = false;
    }
}

async function performFetch(): Promise<PlaylistData | null> {
    try {
        const version = await getLatestVersion();
        console.log(`Fetching playlist version ${version}`);

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
        console.error("Error performing fetch:", e);
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
        console.log("Returning stale cache, triggering background update...");
        triggerBackgroundUpdate();
        return cachedPlaylist;
    }

    return performFetch();
}