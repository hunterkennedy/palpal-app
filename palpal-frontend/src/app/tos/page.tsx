import type { Metadata } from "next";
import Navbar from '@/components/Navbar';
import TermsPage from '@/components/TermsPage';
import Footer from '@/components/Footer';

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

      <Footer />
    </div>
  );
}