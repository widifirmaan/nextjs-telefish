
"use client";

import { motion } from 'framer-motion';
import { Play, Tv2, Heart } from 'lucide-react';
import { Channel } from '@/types';
import clsx from 'clsx';
import React from 'react';

interface ChannelCardProps {
  channel: Channel;
  isFav: boolean;
  onToggleFav: (e: React.MouseEvent) => void;
  onClick: () => void;
  index?: number;
}

const ChannelCard = React.memo(({ channel, isFav, onToggleFav, onClick, index = 0 }: ChannelCardProps) => {
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
          {/* Large Logo Container */}
          <div className="w-full h-32 rounded-2xl bg-white/5 p-4 flex items-center justify-center overflow-hidden group-hover:bg-primary/10 transition-colors relative">
            {channel.image ? (
              <img
                src={channel.image}
                alt={channel.name}
                className="w-full h-full object-contain drop-shadow-2xl transition-transform duration-500 group-hover:scale-110"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'block';
                }}
              />
            ) : (
              <Tv2 className="w-12 h-12 text-gray-600 group-hover:text-primary transition-colors" />
            )}
            <Tv2 className="w-12 h-12 text-gray-600 group-hover:text-primary transition-colors hidden" />
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
});

ChannelCard.displayName = 'ChannelCard';

export default ChannelCard;
