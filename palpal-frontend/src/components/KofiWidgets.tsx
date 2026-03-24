'use client';

import { useEffect } from 'react';

export default function KofiWidgets() {
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const script = document.createElement('script');

    if (isMobile) {
      script.src = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js';
      script.onload = () => {
        (window as any).kofiwidget2.init('', '#72a4f2', 'T6T41LCW9R');
        (window as any).kofiwidget2.draw();
      };
    } else {
      script.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';
      script.onload = () => {
        (window as any).kofiWidgetOverlay.draw('hunterkennedysoftware', {
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
