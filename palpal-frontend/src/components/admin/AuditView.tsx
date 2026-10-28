'use client';

import React, { useMemo, useState } from 'react';
import { History, RotateCcw, Search } from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { AuditEntry } from './types';
import {
  Badge,
  Button,
  EmptyState,
  Spinner,
  fmtDateTime,
  fmtNumber,
  titleCase,
} from './ui';

export default function AuditView({
  entries,
  loading,
}: {
  entries: AuditEntry[] | null;
  loading: boolean;
}) {
  const admin = useAdmin();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const haystack = `${entry.action} ${entry.target_type ?? ''} ${entry.target_id ?? ''} ${JSON.stringify(entry.detail)}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query]);

  return (
    <div className="ac-stack">
      <div className="ac-card" style={{ paddingBottom: 12 }}>
        <div className="ac-row-between" style={{ marginBottom: 12 }}>
          <div className="ac-row">
            <History size={15} className="ac-subtle" />
            <span className="ac-small ac-muted">
              {fmtNumber(filtered.length)} admin action{filtered.length === 1 ? '' : 's'} recorded
            </span>
            {loading ? <Spinner /> : null}
          </div>
          <div className="ac-search" style={{ maxWidth: 300 }}>
            <Search size={14} />
            <input
              className="ac-input"
              placeholder="Filter audit log…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={query ? 'No matching actions' : 'No admin actions yet'}
            detail="Pause/resume, retries, blacklists, settings changes, and other mutations appear here."
          />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>when</th>
                  <th>action</th>
                  <th>target</th>
                  <th>details</th>
                  <th>state</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="ac-cell-muted ac-nowrap">{fmtDateTime(entry.created_at)}</td>
                    <td>
                      <Badge tone={entry.action.startsWith('audit.') ? 'gray' : 'blue'}>
                        {entry.action}
                      </Badge>
                    </td>
                    <td>
                      <div className="ac-small">{entry.target_type ?? '—'}</div>
                      {entry.target_id ? (
                        <div className="ac-tiny ac-subtle ac-mono ac-truncate" style={{ maxWidth: 220 }}>
                          {entry.target_id}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="ac-tiny ac-subtle ac-truncate" style={{ maxWidth: 340 }}>
                        {summarize(entry.detail)}
                      </div>
                    </td>
                    <td>
                      {entry.undone_at ? (
                        <Badge tone="gray">undone</Badge>
                      ) : entry.undoable ? (
                        <Badge tone="green">undoable</Badge>
                      ) : (
                        <span className="ac-tiny ac-subtle">—</span>
                      )}
                    </td>
                    <td className="is-actions">
                      {entry.undoable ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RotateCcw size={12} />}
                          onClick={() =>
                            admin.confirm({
                              title: 'Undo this action?',
                              message: (
                                <>
                                  Undo <strong>{entry.action}</strong> from{' '}
                                  {fmtDateTime(entry.created_at)}? This restores the previous state
                                  where possible.
                                </>
                              ),
                              confirmLabel: 'Undo action',
                              onConfirm: async () => {
                                await admin.run(`audit-undo:${entry.id}`, async () => {
                                  await api(`/admin/audit/${entry.id}/undo`, { method: 'POST' });
                                  admin.toast('Action undone');
                                  admin.refreshAll();
                                });
                              },
                            })
                          }
                        >
                          Undo
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function summarize(detail: Record<string, unknown>): string {
  try {
    return Object.entries(detail)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${titleCase(key)}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join(' · ');
  } catch {
    return '—';
  }
}
