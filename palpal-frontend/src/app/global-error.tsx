'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#1c1b1a',
          color: '#eaeaea',
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: '560px',
            padding: '2.5rem',
            textAlign: 'center',
            borderRadius: '16px',
            border: '1px solid rgba(255,248,240,0.12)',
            background: '#2d2b28',
            boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }} aria-hidden>
            ⚠
          </div>
          <p
            style={{
              margin: '0 0 0.6rem',
              color: '#fe8500',
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            palpal
          </p>
          <h1 style={{ margin: '0 0 0.8rem', fontSize: '1.75rem', color: '#faf8f5' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.5rem', color: '#d0cdc7', lineHeight: 1.6 }}>
            The application hit an unexpected error. Your library is safe — reload and try again.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid #fe8500',
                borderRadius: '12px',
                background: '#fe8500',
                color: '#1c1b1a',
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.replace('/');
              }}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid rgba(255,248,240,0.12)',
                borderRadius: '12px',
                background: '#36342f',
                color: '#eaeaea',
                textDecoration: 'none',
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Back to search
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && error?.message ? (
            <pre
              style={{
                marginTop: '1.5rem',
                padding: '0.75rem',
                textAlign: 'left',
                fontSize: '0.75rem',
                overflow: 'auto',
                borderRadius: '8px',
                background: '#151413',
                color: '#ff6b6b',
              }}
            >
              {error.message}
            </pre>
          ) : null}
        </main>
      </body>
    </html>
  );
}
