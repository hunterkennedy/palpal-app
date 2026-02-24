import type { Metadata } from "next";
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import PrivacyPage from '@/components/PrivacyPage';

export const metadata: Metadata = {
  title: "Privacy Policy - palpal",
  description: "Privacy Policy for palpal podcast search engine",
};

export default function PrivacyPolicy() {
  return (
    <div className="page-container">
      <Navbar currentPage="privacy" />

      <div className="content-container">
        <PrivacyPage />
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