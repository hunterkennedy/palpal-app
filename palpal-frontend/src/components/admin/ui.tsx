'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="ac-spin" aria-hidden />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      disabled={props.disabled || loading}
      className={`ac-btn ac-btn-${variant} ac-btn-${size} ${className}`}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = {
  processed: 'green',
  running: 'green',
  online: 'green',
  completed: 'green',
  claimed: 'blue',
  downloading: 'yellow',
  pending: 'blue',
  discovered: 'blue',
  transcribing: 'purple',
  finishing: 'purple',
  failed: 'red',
  offline: 'red',
  error: 'red',
  orphaned: 'gray',
  blacklisted: 'orange',
  paused: 'orange',
  cancelled: 'gray',
};

export function Badge({
  children,
  tone,
  className = '',
  title,
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
  title?: string;
}) {
  const key = typeof children === 'string' ? children.toLowerCase() : '';
  const resolved = tone ?? STATUS_TONE[key] ?? 'gray';
  return (
    <span className={`ac-badge ac-badge-${resolved} ${className}`} title={title}>
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className={`ac-toggle ${disabled ? 'is-disabled' : ''}`} title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ac-toggle-track">
        <span className="ac-toggle-thumb" />
      </span>
    </label>
  );
}

export function ProgressBar({
  percent,
  tone = 'accent',
  height = 6,
}: {
  percent?: number | null;
  tone?: 'accent' | 'green' | 'red' | 'blue';
  height?: number;
}) {
  const known = typeof percent === 'number' && Number.isFinite(percent);
  return (
    <div className={`ac-progress ac-progress-${tone}`} style={{ height }}>
      <span
        className={known ? '' : 'ac-progress-indeterminate'}
        style={known ? { width: `${Math.max(0, Math.min(100, percent))}%` } : undefined}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = '',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`ac-stat ${tone ? `ac-stat-${tone}` : ''} ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
    >
      <span className="ac-stat-value">{value}</span>
      <span className="ac-stat-label">{label}</span>
      {hint ? <span className="ac-stat-hint">{hint}</span> : null}
    </Tag>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 620,
}: {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ac-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ac-modal" style={{ maxWidth: width }} role="dialog" aria-modal>
        <header className="ac-modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="ac-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="ac-modal-body">{children}</div>
        {footer ? <footer className="ac-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface ConfirmRequest {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  requireText?: string;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  useEffect(() => {
    setText('');
    setBusy(false);
  }, [request]);

  if (!request) return null;
  const canConfirm = !request.requireText || text.trim() === request.requireText;

  return (
    <Modal
      open
      title={request.title}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={request.tone === 'danger' ? 'danger' : 'primary'}
            disabled={!canConfirm}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request.onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="ac-confirm-body">
        <div className="ac-confirm-icon">
          <AlertTriangle size={18} />
        </div>
        <div>{request.message}</div>
      </div>
      {request.requireText ? (
        <label className="ac-field" style={{ marginTop: 18 }}>
          <span>
            Type <code>{request.requireText}</code> to confirm
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder={request.requireText}
          />
        </label>
      ) : null}
    </Modal>
  );
}

export interface ToastItem {
  id: number;
  message: string;
  tone: 'ok' | 'error' | 'info';
  detail?: string;
  action?: { label: string; onAction: () => void };
}

export function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="ac-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ac-toast ac-toast-${toast.tone}`}>
          <span className="ac-toast-mark">
            {toast.tone === 'ok' ? <Check size={14} /> : toast.tone === 'error' ? <AlertTriangle size={14} /> : null}
          </span>
          <div>
            <div>{toast.message}</div>
            {toast.detail ? <div className="ac-toast-detail">{toast.detail}</div> : null}
          </div>
          {toast.action ? (
            <button
              type="button"
              className="ac-toast-action"
              onClick={() => {
                toast.action?.onAction();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button className="ac-icon-btn" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="ac-empty">
      <div className="ac-empty-title">{title}</div>
      {detail ? <div className="ac-empty-detail">{detail}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function KeyHint({ children }: { children: React.ReactNode }) {
  return <kbd className="ac-kbd">{children}</kbd>;
}

export function CopyText({
  value,
  label,
  display,
  mono = true,
}: {
  value: string;
  label?: string;
  display?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ac-copy"
      title={copied ? 'Copied' : `Copy ${label ?? value}`}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          // Clipboard access can be blocked; no need to surface that.
        }
      }}
    >
      <span className={mono ? 'ac-mono' : ''}>{display ?? value}</span>
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

/** Correct public/source URL for an episode. RSS feeds are private-token URLs
 *  and intentionally do not get an external watch link. */
export function episodeUrl(episode: { site: string; video_id: string; youtube_url?: string }): string | null {
  if (episode.site === 'patreon') return `https://www.patreon.com/posts/${episode.video_id}`;
  if (episode.site === 'youtube') return `https://www.youtube.com/watch?v=${episode.video_id}`;
  return null;
}

export function fmtNumber(n: number | null | undefined): string {  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  if (abs < 10_000) return 'just now';
  if (abs < 60_000) return `${Math.round(abs / 1000)}s ${diff >= 0 ? 'ago' : 'from now'}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${diff >= 0 ? 'ago' : 'from now'}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${diff >= 0 ? 'ago' : 'from now'}`;
  return `${Math.round(abs / 86_400_000)}d ${diff >= 0 ? 'ago' : 'from now'}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  if (seconds < 1) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtEta(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 48) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function jobLabel(job: { kind: string; episode_title?: string | null; source_name?: string | null; episode_podcast?: string | null; source_podcast?: string | null }): {
  primary: string;
  secondary: string;
} {
  if (job.kind === 'process') {
    return {
      primary: job.episode_title || 'Episode removed',
      secondary: job.episode_podcast || '',
    };
  }
  return {
    primary: job.source_name || 'Source removed',
    secondary: job.source_podcast || '',
  };
}
