"use client";

import React from 'react';
import { Layers } from 'lucide-react';

interface OnePerEpisodeToggleProps {
  onePerEpisode: boolean;
  onOnePerEpisodeChange: (enabled: boolean) => void;
  className?: string;
}

export default function OnePerEpisodeToggle({
  onePerEpisode,
  onOnePerEpisodeChange,
  className = ''
}: OnePerEpisodeToggleProps) {
  return (
    <button
      onClick={() => onOnePerEpisodeChange(!onePerEpisode)}
      className={`flex items-center gap-2 px-3 py-2 border border-white/20 rounded-lg text-white transition-all duration-200 w-52 ${
        onePerEpisode
          ? 'bg-orange-600 hover:bg-orange-700'
          : 'bg-white/10 hover:bg-white/15'
      } ${className}`}
    >
      <Layers className="w-4 h-4" />
      <span className="text-sm font-medium">Deduplicate episodes</span>
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
        onePerEpisode ? 'border-white bg-white' : 'border-gray-400'
      }`}>
        {onePerEpisode && (
          <div className="w-2 h-2 bg-orange-600 rounded-sm" />
        )}
      </div>
    </button>
  );
}