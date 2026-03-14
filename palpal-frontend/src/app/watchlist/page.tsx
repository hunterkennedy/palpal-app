'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import WatchlistPage from '@/components/WatchlistPage';

export default function Watchlist() {
  return (
    <div className="page-container">
      <Navbar currentPage="watchlist" />

      <div className="content-container">
        <WatchlistPage />
      </div>

      <footer className="footer-container">
        <div className="footer-content">
          <div className="flex space-x-6 text-sm justify-center">
            <Link href="/tos" className="nav-link">Terms of Service</Link>
            <Link href="/pp" className="nav-link">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
