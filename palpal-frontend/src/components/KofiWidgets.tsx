'use client';

import { useEffect } from 'react';

type KofiWindow = Window & {
  kofiwidget2: { init: (label: string, color: string, id: string) => void; draw: () => void };
  kofiWidgetOverlay: { draw: (name: string, opts: Record<string, string>) => void };
};

export default function KofiWidgets() {
  useEffect(() => {
    const win = window as unknown as KofiWindow;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const script = document.createElement('script');

    if (isMobile) {
      script.src = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js';
      script.onload = () => {
        win.kofiwidget2.init('', '#72a4f2', 'T6T41LCW9R');
        win.kofiwidget2.draw();
      };
    } else {
      script.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';
      script.onload = () => {
        win.kofiWidgetOverlay.draw('hunterkennedysoftware', {
          'type': 'floating-chat',
          'floating-chat.donateButton.text': 'Support Me',
          'floating-chat.donateButton.background-color': '#f45d22',
          'floating-chat.donateButton.text-color': '#fff',
        });
      };
    }

    document.body.appendChild(script);
  }, []);

  return null;
}
