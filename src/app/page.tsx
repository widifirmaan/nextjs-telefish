"use client";

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Play, Tv2, Globe, Filter, Heart, History, X, RefreshCw, Calendar, Flag, Bug, Download } from 'lucide-react';
import Player from '@/components/Player';
import clsx from 'clsx';

interface Channel {
  id: string;
  name: string;
  tagline?: string;
  hls: string;
  namespace?: string;
  is_live?: string; // "t" or "f"
  is_movie?: string;
  image?: string; // This is the logo
  header_iptv?: string;
  url_license?: string;
  header_license?: string;
  jenis?: string;
}

interface PlaylistData {
  indonesia: Channel[];
  event: Channel[];
  version: string;
  lastUpdated: number;
}

interface DebugResult {
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

export default function Home() {
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [search, setSearch] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'indonesia' | 'event'>('indonesia');
  
  // Progress bar state
  const [updateProgress, setUpdateProgress] = useState({ 
    active: false, 
    stage: '', 
    percent: 0 
  });

  // User Preferences
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<Channel[]>([]);

  // Debug State
  const [debugActive, setDebugActive] = useState(false);
  const [debugResults, setDebugResults] = useState<DebugResult[]>([]);
  const [debugIndex, setDebugIndex] = useState(-1);
  const [debugTimeout, setDebugTimeout] = useState<NodeJS.Timeout | null>(null);

  const loadPlaylist = async (force: boolean = false) => {
    if (force) {
      setRefreshing(true);
      setUpdateProgress({ active: true, stage: 'Connecting to server...', percent: 10 });
    }
    try {
      // Simulate progress stages
      if (force) {
        setTimeout(() => setUpdateProgress(p => p.active ? { ...p, stage: 'Fetching version info...', percent: 25 } : p), 300);
        setTimeout(() => setUpdateProgress(p => p.active ? { ...p, stage: 'Downloading Indonesia channels...', percent: 40 } : p), 800);
        setTimeout(() => setUpdateProgress(p => p.active ? { ...p, stage: 'Downloading Event channels...', percent: 60 } : p), 1500);
        setTimeout(() => setUpdateProgress(p => p.active ? { ...p, stage: 'Decrypting playlist...', percent: 80 } : p), 2500);
      }
      
      const res = await fetch(`/api/playlist${force ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error("Network response was not ok");
      
      if (force) {
        setUpdateProgress({ active: true, stage: 'Processing data...', percent: 95 });
      }
      
      const data = await res.json();
      if (data) {
        setPlaylist(data);
        if (force) {
          setUpdateProgress({ active: true, stage: 'Complete!', percent: 100 });
          setTimeout(() => setUpdateProgress({ active: false, stage: '', percent: 0 }), 800);
        }
      }
    } catch (err) {
      console.error(err);
      if (force) {
        setUpdateProgress({ active: true, stage: 'Update failed!', percent: 100 });
        setTimeout(() => setUpdateProgress({ active: false, stage: '', percent: 0 }), 1500);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Init Data & Preferences
  useEffect(() => {
    // Load Preferences
    const savedFavs = localStorage.getItem('bittv_favorites');
    const savedRecents = localStorage.getItem('bittv_recents');
    try {
      if (savedFavs) setFavorites(JSON.parse(savedFavs));
      if (savedRecents) setRecents(JSON.parse(savedRecents));
    } catch (e) {
      console.error("Failed to parse preferences", e);
    }

    loadPlaylist();
  }, []);

  // Save Preferences
  useEffect(() => {
    localStorage.setItem('bittv_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('bittv_recents', JSON.stringify(recents));
  }, [recents]);


  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (favorites.includes(id)) {
      setFavorites(prev => prev.filter(fid => fid !== id));
    } else {
      setFavorites(prev => [...prev, id]);
    }
  };

  const handleChannelClick = (channel: Channel) => {
    setSelectedChannel(channel);
    // Add to recents (unique, max 5, unshift)
    setRecents(prev => {
      const filtered = prev.filter(c => c.id !== channel.id);
      return [channel, ...filtered].slice(0, 5);
    });
  };

  // Debug Methods
  const startDebug = () => {
    if (!playlist) return;
    const all = [...playlist.indonesia, ...playlist.event];
    setDebugResults(all.map(ch => ({
      id: ch.id,
      name: ch.name,
      originalUrl: '',
      proxyUrl: '',
      streamType: '',
      playMethod: '',
      status: 'pending'
    })));
    setDebugActive(true);
    setDebugIndex(0);
  };

  const stopDebug = () => {
    setDebugActive(false);
    setDebugIndex(-1);
    setSelectedChannel(null);
    if (debugTimeout) {
      clearTimeout(debugTimeout);
      setDebugTimeout(null);
    }
  };

  const downloadDebugReport = () => {
    const header = `BITTV CHANNEL DEBUG REPORT\nGenerated: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
    const body = debugResults.map((r, i) => {
      let text = `${i + 1}. [${r.status.toUpperCase()}] ${r.name} (${r.id})\n`;
      text += `   - Playback Method: ${r.playMethod || 'N/A'}\n`;
      text += `   - Stream Type: ${r.streamType || 'N/A'}\n`;
      text += `   - Original URL: ${r.originalUrl || 'N/A'}\n`;
      text += `   - Proxy URL: ${r.proxyUrl || 'N/A'}\n`;
      if (r.drmKeys) text += `   - DRM Keys: ${r.drmKeys}\n`;
      if (r.error) text += `   - ERROR: ${r.error}\n`;
      text += `\n`;
      return text;
    }).join('');

    const blob = new Blob([header + body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bittv-debug-report-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDebugInfo = (info: any) => {
    if (!debugActive || debugIndex < 0) return;
    
    setDebugResults(prev => {
      const next = [...prev];
      if (next[debugIndex]) {
        next[debugIndex] = {
          ...next[debugIndex],
          ...info,
          status: info.error ? 'error' : 'ok'
        };
      }
      return next;
    });
  };

  // Handle Debug Cycling
  useEffect(() => {
    if (debugActive && debugIndex >= 0) {
      const all = playlist ? [...playlist.indonesia, ...playlist.event] : [];
      if (debugIndex < all.length) {
        setSelectedChannel(all[debugIndex]);
        
        const timer = setTimeout(() => {
          setDebugIndex(prev => prev + 1);
        }, 6000); // 6 seconds total (1s buffer for load + 5s play)
        
        setDebugTimeout(timer);
        return () => clearTimeout(timer);
      } else {
        stopDebug();
        // Auto-download when finished automatically
        setTimeout(() => {
          downloadDebugReport();
        }, 500);
      }
    }
  }, [debugActive, debugIndex, playlist]);

  const allChannels = useMemo(() => {
    if (!playlist) return [];
    return activeCategory === 'indonesia' ? playlist.indonesia : playlist.event;
  }, [playlist, activeCategory]);

  const filteredChannels = useMemo(() => {
    return allChannels.filter(ch => {
      const matchesSearch =
        ch.name.toLowerCase().includes(search.toLowerCase()) ||
        ch.tagline?.toLowerCase().includes(search.toLowerCase());
      return matchesSearch;
    });
  }, [allChannels, search]);

  const favoriteChannels = useMemo(() => {
    if (!playlist) return [];
    const all = [...playlist.indonesia, ...playlist.event];
    // Remove duplicates by id
    const unique = all.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
    return unique.filter(ch => favorites.includes(ch.id));
  }, [playlist, favorites]);


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-gray-400 animate-pulse font-medium">Decrypting Secure Playlist... (This may take ~10s)</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto pb-32">
      {/* Header Section */}
      <header className="mb-12 text-center space-y-4">
        <div className="flex flex-col items-center space-y-4">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full glass border border-primary/20"
          >
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold tracking-widest uppercase text-primary">Live Streaming Platform</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-4xl md:text-6xl font-black tracking-tight"
          >
            Telefish <span className="gradient-text">Kere</span>
          </motion.h1>

          <div className="flex items-center space-x-4">
               {playlist?.version && (
                 <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest bg-white/5 px-2 py-1 rounded border border-white/5">
                   Engine {playlist.version}
                 </span>
               )}
               <button
                 onClick={() => loadPlaylist(true)}
                 disabled={refreshing}
                 className={clsx(
                   "p-2 rounded-full glass hover:bg-white/10 transition-all border border-white/5 group",
                   refreshing && "opacity-50 cursor-not-allowed"
                 )}
                 title="Refresh Playlist"
               >
                 <RefreshCw className={clsx("w-4 h-4 text-primary", refreshing && "animate-spin")} />
               </button>
                <button
                  onClick={startDebug}
                  disabled={debugActive || refreshing}
                  className={clsx(
                    "p-2 rounded-full glass hover:bg-white/10 transition-all border border-white/5 group",
                    (debugActive || refreshing) && "opacity-50 cursor-not-allowed"
                  )}
                  title="Debug All Channels"
                >
                  <Bug className={clsx("w-4 h-4 text-primary", debugActive && "animate-pulse")} />
                </button>
          </div>
          
          {/* Progress Bar */}
          <AnimatePresence>
            {updateProgress.active && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="w-full max-w-md mx-auto mt-4"
              >
                <div className="glass rounded-xl p-4 border border-primary/20">
                  {/* Stage Text */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-primary animate-pulse">
                      {updateProgress.stage}
                    </span>
                    <span className="text-xs font-bold text-primary">
                      {updateProgress.percent}%
                    </span>
                  </div>
                  
                  {/* Progress Track */}
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${updateProgress.percent}%` }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className={clsx(
                        "h-full rounded-full transition-colors",
                        updateProgress.stage === 'Complete!' 
                          ? "bg-green-500" 
                          : updateProgress.stage === 'Update failed!' 
                            ? "bg-red-500" 
                            : "bg-gradient-to-r from-primary via-primary/80 to-primary"
                      )}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Search Bar */}
        <div className="max-w-2xl mx-auto mt-8 relative group z-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="Search channels..."
            className="w-full bg-surface/50 border border-white/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all backdrop-blur-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {/* Category Tabs */}
      <div className="flex justify-center mb-8 space-x-4">
         <button
           onClick={() => setActiveCategory('indonesia')}
           className={clsx(
             "px-6 py-2.5 rounded-2xl font-bold flex items-center space-x-2 transition-all",
             activeCategory === 'indonesia' 
              ? "bg-primary text-white shadow-lg shadow-primary/20 scale-105" 
              : "glass text-gray-400 hover:bg-white/5"
           )}
         >
           <Flag className="w-4 h-4" />
           <span>Indonesia</span>
         </button>
         <button
           onClick={() => setActiveCategory('event')}
           className={clsx(
             "px-6 py-2.5 rounded-2xl font-bold flex items-center space-x-2 transition-all",
             activeCategory === 'event' 
              ? "bg-primary text-white shadow-lg shadow-primary/20 scale-105" 
              : "glass text-gray-400 hover:bg-white/5"
           )}
         >
           <Calendar className="w-4 h-4" />
           <span>Event</span>
         </button>
      </div>

      {/* Recents Section */}
      {recents.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center space-x-2 mb-4 px-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Recently Watched</h2>
          </div>
          <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-hide">
            {recents.map(ch => (
              <div
                key={ch.id}
                onClick={() => handleChannelClick(ch)}
                className="glass-card p-3 rounded-xl min-w-[200px] cursor-pointer hover:bg-white/5 flex items-center space-x-3 transition-colors"
              >
                <div className="p-2 bg-primary/20 rounded-lg">
                  <Play className="w-4 h-4 text-primary fill-current" />
                </div>
                <div>
                  <p className="font-bold text-sm truncate">{ch.name}</p>
                  <p className="text-[10px] text-gray-500">Resume Playback</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}


      {/* Favorites Section */}
      {favoriteChannels.length > 0 && !search && (
        <section className="mb-8">
          <div className="flex items-center space-x-2 mb-4 px-2">
            <Heart className="w-4 h-4 text-accent fill-accent" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Your Favorites</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {favoriteChannels.map(ch => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                isFav={true}
                onToggleFav={(e) => toggleFavorite(e, ch.id)}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </div>
        </section>
      )}


      {/* Main Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredChannels.map((channel, idx) => (
            <ChannelCard
              key={channel.id + activeCategory}
              channel={channel}
              isFav={favorites.includes(channel.id)}
              onToggleFav={(e) => toggleFavorite(e, channel.id)}
              onClick={() => handleChannelClick(channel)}
              index={idx}
            />
          ))}
        </AnimatePresence>
      </div>

      {filteredChannels.length === 0 && (
        <div className="text-center py-20 opacity-50">
          <Filter className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <p>No channels found for "{search}"</p>
        </div>
      )}

      {/* Video Player Modal */}
      {selectedChannel && (
        <Player
          url={selectedChannel.hls}
          title={selectedChannel.name}
          headers={selectedChannel.header_iptv ? JSON.parse(selectedChannel.header_iptv) : undefined}
          license={selectedChannel.url_license}
          licenseHeader={selectedChannel.header_license}
          type={selectedChannel.jenis}
          onClose={() => {
            if (debugActive) stopDebug();
            else setSelectedChannel(null);
          }}
          onDebugInfo={handleDebugInfo}
          channels={(() => {
            if (!playlist) return [];
            if (debugActive) return [...playlist.indonesia, ...playlist.event];
            // Find which group the channel belongs to
            const isInIndo = playlist.indonesia.some(ch => ch.id === selectedChannel.id);
            return isInIndo ? playlist.indonesia : playlist.event;
          })()}
          currentIndex={(() => {
            if (!playlist) return -1;
            if (debugActive && debugIndex >= 0) return debugIndex;
            const isInIndo = playlist.indonesia.some(ch => ch.id === selectedChannel.id);
            const list = isInIndo ? playlist.indonesia : playlist.event;
            return list.findIndex(ch => ch.id === selectedChannel.id);
          })()}
          onChannelChange={(channel, index) => {
            setSelectedChannel(channel);
            // Add to recents
            setRecents(prev => {
              const filtered = prev.filter(c => c.id !== channel.id);
              return [channel, ...filtered].slice(0, 5);
            });
          }}
        />
      )}

      {/* Debug Results Modal */}
      <AnimatePresence>
        {debugResults.length > 0 && !debugActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          >
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Bug className="text-primary w-6 h-6" />
                  <h2 className="text-xl font-bold">Channel Debug Report</h2>
                </div>
                <button 
                  onClick={() => setDebugResults([])}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid gap-4">
                  {debugResults.map((result, idx) => (
                    <div 
                      key={`${result.id}-${idx}`}
                      className={clsx(
                        "p-4 rounded-xl border transition-all",
                        result.status === 'ok' ? "bg-green-500/10 border-green-500/30" : 
                        result.status === 'error' ? "bg-red-500/10 border-red-500/30" : 
                        "bg-white/5 border-white/10"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold">{result.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-400 font-mono italic">
                            {result.id}
                          </span>
                        </div>
                        <span className={clsx(
                          "text-xs font-bold uppercase tracking-wider px-2 py-1 rounded",
                          result.status === 'ok' ? "text-green-400 bg-green-400/20" : 
                          result.status === 'error' ? "text-red-400 bg-red-400/20" : 
                          "text-gray-400 bg-gray-400/20"
                        )}>
                          {result.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                        <div className="space-y-1">
                          <p className="text-gray-500 uppercase text-[9px]">Playback Method</p>
                          <p className="text-gray-200">{result.playMethod || 'N/A'}</p>
                          
                          <p className="text-gray-500 uppercase text-[9px] mt-2">Stream Type</p>
                          <p className="text-gray-200">{result.streamType || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-gray-500 uppercase text-[9px]">Original URL</p>
                          <p className="text-gray-200 break-all truncate hover:whitespace-normal cursor-help mb-2" title={result.originalUrl}>
                            {result.originalUrl || 'N/A'}
                          </p>

                          <p className="text-gray-500 uppercase text-[9px]">Proxy URL</p>
                          <p className="text-gray-200 break-all truncate hover:whitespace-normal cursor-help" title={result.proxyUrl}>
                            {result.proxyUrl || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {result.drmKeys && (
                        <div className="mt-3 p-2 bg-black/40 rounded border border-white/5 font-mono text-[10px]">
                          <p className="text-primary/70 mb-1 uppercase text-[8px]">DRM Keys</p>
                          <code className="text-primary break-all">{result.drmKeys}</code>
                        </div>
                      )}

                      {result.error && (
                        <div className="mt-3 p-2 bg-red-500/20 rounded border border-red-500/30 text-red-200 text-[10px]">
                          <p className="uppercase text-[8px] font-bold mb-1">Diagnostic Error</p>
                          {result.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end space-x-4">
                <button 
                  onClick={downloadDebugReport}
                  className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full font-bold transition-all flex items-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .txt</span>
                </button>
                <button 
                  onClick={() => setDebugResults([])}
                  className="px-6 py-2 bg-primary hover:bg-primary/80 text-white rounded-full font-bold transition-all"
                >
                  Close Report
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// Extracted Card Component for Reusability
function ChannelCard({ channel, isFav, onToggleFav, onClick, index = 0 }: {
  channel: Channel;
  isFav: boolean;
  onToggleFav: (e: React.MouseEvent) => void;
  onClick: () => void;
  index?: number;
}) {

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ 
        delay: Math.min(index * 0.01, 0.3),
        layout: { duration: 0.3 }
      }}
      onClick={onClick}
      className="group cursor-pointer h-full"
    >
      <div className="glass-card p-4 rounded-[2rem] h-full flex flex-col shimmer relative transition-transform hover:-translate-y-2">

        {/* Favorite Button */}
        <button
          onClick={onToggleFav}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full glass hover:bg-white/10 transition-colors"
        >
          <Heart className={clsx("w-4 h-4 transition-colors", isFav ? "fill-accent text-accent" : "text-gray-500")} />
        </button>

        <div className="space-y-4">
          {/* Large Logo Container (3x increase) */}
          <div className="w-full h-32 rounded-2xl bg-white/5 p-4 flex items-center justify-center overflow-hidden group-hover:bg-primary/10 transition-colors relative">
            {channel.image ? (
              <img
                src={channel.image}
                alt={channel.name}
                className="w-full h-full object-contain drop-shadow-2xl transition-transform duration-500 group-hover:scale-110"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement?.classList.add('fallback-icon');
                }}
              />
            ) : (
              <Tv2 className="w-12 h-12 text-gray-600 group-hover:text-primary transition-colors" />
            )}
            <Tv2 className="w-12 h-12 text-gray-600 group-hover:text-primary transition-colors hidden fallback-show" />
          </div>

          <div className="px-1">
            <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors line-clamp-1">
              {channel.name}
            </h3>
            <p className="text-gray-500 text-xs mt-1.5 line-clamp-2 min-h-[3rem]">
              {channel.tagline || channel.namespace || "Premium Stream"}
            </p>
          </div>
        </div>

        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="text-[10px] text-gray-600 font-bold uppercase tracking-[0.2em]">
            CH {channel.id}
          </span>
          <div className="flex items-center space-x-2 bg-primary/10 px-3 py-1.5 rounded-full text-primary text-[10px] font-black uppercase tracking-widest group-hover:bg-primary group-hover:text-white transition-all">
            <span>Watch</span>
            <Play className="w-3 h-3 fill-current" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}