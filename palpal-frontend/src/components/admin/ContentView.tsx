'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import sanitizeHtml from 'sanitize-html';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { WhatsNewEntry } from './types';
import { Button, EmptyState, Spinner, fmtDateTime } from './ui';

export default function ContentView({
  entries,
  placeholders,
  loading,
}: {
  entries: WhatsNewEntry[] | null;
  placeholders: string[] | null;
  loading: boolean;
}) {
  const admin = useAdmin();
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [phItems, setPhItems] = useState<string[]>([]);
  const [phDirty, setPhDirty] = useState(false);

  useEffect(() => {
    if (!phDirty) setPhItems(placeholders ?? []);
  }, [placeholders, phDirty]);

  async function postUpdate() {
    const value = content.trim();
    if (!value) {
      admin.toast('Write something first', 'error');
      return;
    }
    await admin.run('whats-new-post', async () => {
      await api('/admin/whats-new', {
        method: 'POST',
        body: JSON.stringify({ content: value }),
      });
      setContent('');
      setPreview(false);
      admin.toast("What's New posted");
      admin.refreshAll();
    });
  }

  async function removeEntry(entry: WhatsNewEntry) {
    await admin.confirm({
      title: "Delete this What's New entry?",
      message: (
        <>
          Remove the entry posted {fmtDateTime(entry.posted_at)}. This is shown publicly and cannot be
          restored.
        </>
      ),
      confirmLabel: 'Delete entry',
      tone: 'danger',
      onConfirm: async () => {
        await admin.run(`whats-new-delete:${entry.id}`, async () => {
          await api(`/admin/whats-new/${entry.id}`, { method: 'DELETE' });
          admin.toast('Entry deleted');
          admin.refreshAll();
        });
      },
    });
  }

  async function savePlaceholders() {
    await admin.run('placeholders-save', async () => {
      const cleaned = phItems.map((s) => s.trim()).filter(Boolean);
      await api('/admin/search-placeholders', {
        method: 'PUT',
        body: JSON.stringify(cleaned),
      });
      setPhDirty(false);
      admin.toast('Search placeholders saved');
      admin.refreshAll();
    });
  }

  function movePlaceholder(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= phItems.length) return;
    const next = [...phItems];
    [next[index], next[target]] = [next[target], next[index]];
    setPhItems(next);
    setPhDirty(true);
  }

  return (
    <div className="ac-grid ac-grid-2" style={{ alignItems: 'start' }}>
      <section className="ac-card">
        <div className="ac-card-header">
          <h2>What&apos;s New</h2>
          <div className="ac-card-actions ac-tiny ac-subtle">{entries?.length ?? 0} entries</div>
        </div>

        {loading && !entries ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <Spinner size={16} />
          </div>
        ) : entries?.length ? (
          <div className="ac-list" style={{ marginBottom: 16 }}>
            {entries.map((entry) => (
              <div className="ac-list-item" key={entry.id} style={{ alignItems: 'flex-start' }}>
                <div className="ac-list-item-main">
                  {preview ? (
                    <div
                      className="ac-small"
                      style={{ color: 'var(--ac-text-2)' }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.content) }}
                    />
                  ) : (
                    <div
                      className="ac-list-item-title"
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 400 }}
                    >
                      {entry.content}
                    </div>
                  )}
                  <div className="ac-list-item-sub">{fmtDateTime(entry.posted_at)}</div>
                </div>
                <button className="ac-icon-btn is-danger" title="Delete entry" onClick={() => removeEntry(entry)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No entries yet" detail="Post release notes to show them on the public What's New page." />
        )}

        <div className="ac-callout" style={{ marginBottom: 10 }}>
          HTML is allowed in entries (the public page sanitizes it before rendering).
        </div>
        <textarea
          className="ac-textarea"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What changed…"
        />
        <div className="ac-row" style={{ marginTop: 8 }}>
          <Button
            variant="primary"
            size="sm"
            loading={admin.isPending('whats-new-post')}
            disabled={!content.trim()}
            onClick={postUpdate}
          >
            Post
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Plain text' : 'Preview HTML'}
          </Button>
          {preview && content.trim() ? (
            <div
              className="ac-small ac-row-end"
              style={{ color: 'var(--ac-text-2)', maxWidth: '55%', textAlign: 'right' }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
            />
          ) : null}
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-card-header">
          <h2>Search placeholders</h2>
          <div className="ac-card-actions">
            {phDirty ? <span className="ac-tiny ac-warning-text">unsaved</span> : null}
            <Button
              size="sm"
              variant="primary"
              icon={<Save size={12} />}
              loading={admin.isPending('placeholders-save')}
              disabled={!phDirty}
              onClick={savePlaceholders}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="ac-callout" style={{ marginBottom: 10 }}>
          Rotating placeholder text shown in the public search bar. Empty rows are dropped on save.
        </div>

        <div className="ac-list">
          {phItems.length === 0 ? (
            <div className="ac-subtle ac-small" style={{ padding: '8px 0' }}>
              No placeholders. Add one below.
            </div>
          ) : (
            phItems.map((item, index) => (
              <div className="ac-row" key={index} style={{ padding: '3px 0' }}>
                <input
                  className="ac-input"
                  style={{ flex: 1 }}
                  value={item}
                  onChange={(e) => {
                    const next = [...phItems];
                    next[index] = e.target.value;
                    setPhItems(next);
                    setPhDirty(true);
                  }}
                />
                <button
                  className="ac-icon-btn"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => movePlaceholder(index, -1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  className="ac-icon-btn"
                  title="Move down"
                  disabled={index === phItems.length - 1}
                  onClick={() => movePlaceholder(index, 1)}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  className="ac-icon-btn is-danger"
                  title="Remove"
                  onClick={() => {
                    setPhItems(phItems.filter((_, i) => i !== index));
                    setPhDirty(true);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={12} />}
          style={{ marginTop: 10 }}
          onClick={() => {
            setPhItems([...phItems, '']);
            setPhDirty(true);
          }}
        >
          Add placeholder
        </Button>
      </section>
    </div>
  );
}
