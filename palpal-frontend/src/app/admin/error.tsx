'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin console error:', error);
  }, [error]);

  return (
    <div
      className="ac-root"
      style={{ alignItems: 'center', justifyContent: 'center', padding: '24px' }}
    >
      <div className="ac-card" style={{ width: '100%', maxWidth: 560, padding: 30, textAlign: 'center' }}>
        <div className="ac-brand" style={{ justifyContent: 'center', marginBottom: 20 }}>
          <div className="ac-brand-mark">p</div>
          <div className="ac-brand-text" style={{ textAlign: 'left' }}>
            <strong>palpal</strong>
            <span>admin console</span>
          </div>
        </div>
        <h1 style={{ margin: '0 0 8px', color: 'var(--ac-text)', fontSize: 21 }}>
          The console hit an error
        </h1>
        <p className="ac-muted" style={{ margin: '0 0 22px', lineHeight: 1.6 }}>
          The pipeline itself is unaffected. Reload the console and try again.
        </p>
        <div className="ac-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="ac-btn ac-btn-primary ac-btn-md" onClick={reset}>
            Try again
          </button>
          <Link className="ac-btn ac-btn-secondary ac-btn-md" href="/admin">
            Back to console
          </Link>
        </div>
        {process.env.NODE_ENV === 'development' && error?.message ? (
          <pre className="ac-code-block" style={{ marginTop: 18, textAlign: 'left' }}>
            {error.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
