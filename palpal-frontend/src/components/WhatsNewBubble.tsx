'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { dismissWhatsNew, isWhatsNewDismissed } from '@/lib/cookies';
import type { ConductorWhatsNew } from '@/lib/conductor';

interface WhatsNewBubbleProps {
  initialData: ConductorWhatsNew | null;
}

export default function WhatsNewBubble({ initialData }: WhatsNewBubbleProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!initialData?.content || !initialData?.date) return;
    if (!isWhatsNewDismissed(initialData.date)) {
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    if (initialData?.date) {
      dismissWhatsNew(initialData.date);
    }
    setVisible(false);
  };

  if (!visible || !initialData?.content) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-[9999] max-w-xs animate-scaleIn">
      <div className="relative overflow-hidden rounded-xl border backdrop-blur-xl"
           style={{
             background: 'linear-gradient(135deg, rgba(51, 51, 51, 0.95) 0%, rgba(42, 42, 42, 0.9) 100%)',
             borderColor: 'rgba(255, 140, 66, 0.3)',
             boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 140, 66, 0.15)'
           }}>

        {/* Subtle glow effect */}
        <div className="absolute inset-0 rounded-xl opacity-50"
             style={{
               background: 'radial-gradient(circle at top right, rgba(255, 140, 66, 0.1) 0%, transparent 70%)'
             }} />

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 z-[10000] p-1.5 rounded-lg transition-colors duration-200 hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
          aria-label="Dismiss what's new"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Content */}
        <div className="relative z-10 p-4 pr-10">
          <div
            className="text-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(initialData.content) }}
          />
        </div>
      </div>
    </div>
  );
}
