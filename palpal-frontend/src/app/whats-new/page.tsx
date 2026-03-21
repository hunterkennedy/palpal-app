export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import WhatsNewPage from '@/components/WhatsNewPage';
import { getWhatsNew } from '@/lib/conductor';
import Footer from '@/components/Footer';

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

      <Footer />
    </div>
  );
}
