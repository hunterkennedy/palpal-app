import type { Metadata } from "next";
import Navbar from '@/components/Navbar';
import PrivacyPage from '@/components/PrivacyPage';
import Footer from '@/components/Footer';

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

      <Footer />
    </div>
  );
}