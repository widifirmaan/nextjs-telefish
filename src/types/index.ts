
export interface Channel {
    id: string;
    name: string;
    tagline?: string;
    hls: string;
    namespace?: string;
    is_live?: string; // "t" or "f"
    is_movie?: string;
    image?: string; // Logo
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

export interface DebugResult {
    id: string;
    name: string;
    originalUrl: string;
    proxyUrl: string;
    streamType: string;
    drmKeys?: string;
    playMethod: string;
    error?: string | null;
    status: 'pending' | 'ok' | 'error';
}
