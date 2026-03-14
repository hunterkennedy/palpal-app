"use client";

import React from 'react';
import { X } from 'lucide-react';
import { PodcastConfig } from '@/types/podcast';
import Image from 'next/image';
import SocialLink from '@/components/SocialLink';
import { convertToSocialLinkData } from '@/utils/socialUtils';

interface PodcastInfoModalProps {
  podcast: PodcastConfig | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PodcastInfoModal({
  podcast,
  isOpen,
  onClose
}: PodcastInfoModalProps) {
  if (!isOpen || !podcast) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Header */}
        <div className="modal-header relative">
          <button onClick={onClose} className="absolute top-4 right-4 modal-close-btn">
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-lg overflow-hidden border-2 flex items-center justify-center"
                 style={{ borderColor: 'rgba(255, 255, 255, 0.1)', background: 'var(--surface-elevated)' }}>
              {podcast.image ? (
                <Image
                  src={podcast.image}
                  alt={podcast.displayName}
                  width={64}
                  height={64}
                  unoptimized
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-bold" style={{ color: 'var(--text-muted)' }}>
                  {podcast.displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {podcast.displayName}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {podcast.description}
              </p>
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="modal-body">
          {podcast.socialSections?.map((section, sectionIndex) => (
            <div key={sectionIndex} className="space-y-4">
              <h4 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                {section.title}
              </h4>
              <div className="space-y-2">
                {section.links.map((link, linkIndex) => (
                  <SocialLink
                    key={linkIndex}
                    data={convertToSocialLinkData(link)}
                    isMobile={false}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
