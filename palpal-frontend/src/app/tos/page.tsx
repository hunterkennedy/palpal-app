import type { Metadata } from "next";
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import TermsPage from '@/components/TermsPage';

export const metadata: Metadata = {
  title: "Terms of Service - palpal",
  description: "Terms of Service for palpal podcast search engine",
};

export default function TermsOfService() {
  return (
    <div className="page-container">
      <Navbar currentPage="terms" />

      <div className="content-container">
        <TermsPage />
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