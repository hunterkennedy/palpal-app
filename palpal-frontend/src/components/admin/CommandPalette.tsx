'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { KeyHint } from './ui';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        (item.hint ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => Math.min(filtered.length - 1, prev + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => Math.max(0, prev - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = filtered[active];
        if (item) {
          item.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="ac-command-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ac-command" role="dialog" aria-modal>
        <div className="ac-command-input">
          <Search size={15} className="ac-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page or run an action…"
          />
          <KeyHint>esc</KeyHint>
        </div>
        <div className="ac-command-list">
          {filtered.length === 0 ? (
            <div className="ac-empty" style={{ padding: 24 }}>
              Nothing matches.
            </div>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {showGroup ? <div className="ac-command-group">{item.group}</div> : null}
                  <button
                    className={`ac-command-item ${index === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.hint ? <span className="ac-command-hint">{item.hint}</span> : null}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
