import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background:
          'radial-gradient(900px 450px at 82% -10%, rgba(254,133,0,0.1), transparent 60%), var(--bg-page)',
      }}
    >
      <div className="card-primary w-full max-w-xl text-center" style={{ padding: '2.5rem' }}>
        <p
          className="text-sm font-semibold tracking-[0.18em] uppercase mb-3"
          style={{ color: 'var(--accent-primary)' }}
        >
          404
        </p>
        <h1 className="heading-primary">Page not found</h1>
        <p className="text-body mb-8">
          That page doesn’t exist, or it moved. Try searching the archive instead.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary">
            Back to search
          </Link>
          <Link href="/whats-new" className="btn-secondary">
            What’s new
          </Link>
        </div>
      </div>
    </main>
  );
}
