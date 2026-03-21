'use client';

import Navbar from '@/components/Navbar';
import SavedPage from '@/components/SavedPage';
import Footer from '@/components/Footer';

export default function Saved() {
  return (
    <div className="page-container">
      <Navbar currentPage="saved" />

      <div className="content-container">
        <SavedPage />
      </div>

      <Footer />
    </div>
  );
}