import type { Metadata } from "next";
import Navbar from '@/components/Navbar';
import AboutPage from '@/components/AboutPage';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: "About - palpal",
  description: "Learn about palpal, the podcast search engine",
};

export default function About() {
  return (
    <div className="page-container">
      <Navbar currentPage="about" />

      <div className="content-container">
        <AboutPage />
      </div>

      <Footer />
    </div>
  );
}