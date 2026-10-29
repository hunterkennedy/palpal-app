'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background:
          'radial-gradient(900px 450px at 82% -10%, rgba(254,133,0,0.1), transparent 60%), var(--bg-page)',
      }}
    >
      <div className="card-primary w-full max-w-xl text-center" style={{ padding: '2.5rem' }}>
        <div className="text-5xl mb-4" aria-hidden>
          ⚠
        </div>
        <p
          className="text-sm font-semibold tracking-[0.18em] uppercase mb-3"
          style={{ color: 'var(--accent-primary)' }}
        >
          palpal
        </p>
        <h1 className="heading-primary">Something went wrong</h1>
        <p className="text-body mb-8">
          The page hit an unexpected error. Your library is safe — reload or go back and try again.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to search
          </Link>
        </div>
        {process.env.NODE_ENV === 'development' && error?.message ? (
          <pre
            className="mt-6 text-left text-xs p-3 rounded-lg overflow-auto"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--error)',
              border: '1px solid var(--border-primary)',
            }}
          >
            {error.message}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
