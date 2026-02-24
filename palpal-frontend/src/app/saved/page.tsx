'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import SavedPage from '@/components/SavedPage';

export default function Saved() {
  return (
    <div className="page-container">
      <Navbar currentPage="saved" />

      <div className="content-container">
        <SavedPage />
      </div>

      <footer className="footer-container">
        <div className="footer-content">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="text-center md:text-left">
              <p className="text-meta">
                Created by{' '}
                <Link
                  href="/about"
                  className="nav-link-accent"
                >
                  Hunter Kennedy
                </Link>
              </p>
            </div>

            <div className="flex space-x-6 text-sm">
              <Link
                href="/tos"
                className="nav-link"
              >
                Terms of Service
              </Link>
              <Link
                href="/pp"
                className="nav-link"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}