"use client";

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Play, Tv2, Globe, Filter, Heart, History, X, RefreshCw, Calendar, Flag } from 'lucide-react';
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

export default function Home() {
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [search, setSearch] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'indonesia' | 'event'>('indonesia');

  // User Preferences
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<Channel[]>([]);

  const loadPlaylist = async (force: boolean = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/playlist${force ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error("Network response was not ok");
      const data = await res.json();
      if (data) {
        setPlaylist(data);
      }
    } catch (err) {
      console.error(err);
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
          </div>
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
          onClose={() => setSelectedChannel(null)}
        />
      )}
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