import type { Metadata } from "next";
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import AboutPage from '@/components/AboutPage';

export const metadata: Metadata = {
  title: "About - palpal",
  description: "Learn about palpal, the intelligent podcast search engine",
};

export default function About() {
  return (
    <div className="page-container">
      <Navbar currentPage="about" />

      <div className="content-container">
        <AboutPage />
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