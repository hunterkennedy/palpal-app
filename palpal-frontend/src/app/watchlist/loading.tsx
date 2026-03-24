import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className ?? ''}`}
      style={{ backgroundColor: 'var(--surface-secondary)', ...style }}
    />
  );
}

export default function WatchlistLoading() {
  return (
    <div className="page-container">
      <Navbar currentPage="watchlist" />

      <div className="content-container">
        {/* Page header */}
        <div className="mb-12">
          <Skeleton className="h-10 w-40 mb-3" />
          <Skeleton className="h-6 w-64" />
        </div>

        <div className="section-container">
          {/* Podcast tabs */}
          <section className="mb-6">
            <div className="flex gap-2 flex-wrap">
              {[120, 100, 140, 110].map((w, i) => (
                <Skeleton key={i} className="h-10 rounded-2xl" style={{ width: w }} />
              ))}
            </div>
          </section>

          {/* Progress bar */}
          <section className="card-primary mb-6">
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </section>

          {/* Filter tabs */}
          <section className="flex gap-2 mb-4">
            {[80, 110, 90].map((w, i) => (
              <Skeleton key={i} className="h-9 rounded-2xl" style={{ width: w }} />
            ))}
          </section>

          {/* Table */}
          <section>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-primary)' }}
            >
              {/* Header */}
              <div
                className="grid px-4 py-3 gap-4"
                style={{
                  gridTemplateColumns: '2rem 1fr 9rem 6rem 5rem',
                  backgroundColor: 'var(--surface-secondary)',
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                {['w-4', 'w-10', 'w-8', 'w-14', 'w-10'].map((w, i) => (
                  <Skeleton key={i} className={`h-3 ${w}`} />
                ))}
              </div>

              {/* Rows */}
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="grid px-4 py-3.5 gap-4 items-center"
                  style={{
                    gridTemplateColumns: '2rem 1fr 9rem 6rem 5rem',
                    borderTop: i === 0 ? undefined : '1px solid var(--border-secondary)',
                  }}
                >
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4" style={{ width: `${55 + (i * 17) % 35}%` }} />
                  <Skeleton className="h-4 w-20 hidden sm:block" />
                  <Skeleton className="h-4 w-10 hidden md:block" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <Footer />
    </div>
  );
}
