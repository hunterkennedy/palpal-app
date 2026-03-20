import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import WhatsNewPage from '@/components/WhatsNewPage';
import { getWhatsNew } from '@/lib/conductor';

export const metadata: Metadata = {
  title: "What's New - palpal",
  description: "Recent updates and changes to palpal",
};

export default async function WhatsNew() {
  const entries = await getWhatsNew();
  return (
    <div className="page-container">
      <Navbar currentPage="whats-new" />

      <div className="content-container">
        <WhatsNewPage entries={entries} />
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
