"use client";

import Link from 'next/link';
import Image from 'next/image';
import { Search, Heart, Tv2, Info } from 'lucide-react';

interface NavbarProps {
  currentPage: string;
}

export default function Navbar({ currentPage }: NavbarProps) {
  const getButtonClasses = (page: string) => {
    const isActive = currentPage === page;
    const baseClasses = "flex items-center gap-2";

    if (isActive) {
      return `${baseClasses} btn-active`;
    }

    return `${baseClasses} btn-secondary`;
  };
  return (
    <div className="flex items-center justify-between px-4 mt-6 mb-0 max-w-6xl mx-auto">
      {/* Logo */}
      <Link href="/" className="flex items-center mr-2 md:mr-8 w-12 md:w-20">
        <Image
          src={currentPage === 'search' ? '/favicon.ico' : '/title.png'}
          alt="palpal"
          width={currentPage === 'search' ? 256 : 2427}
          height={currentPage === 'search' ? 256 : 1371}
          className={`drop-shadow-lg ${
            currentPage === 'search'
              ? 'w-5 h-5 md:w-8 md:h-8 mx-auto'
              : 'h-6 md:h-10 w-auto'
          }`}
          priority
        />
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-1 md:gap-3">
        {/* Desktop Layout */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/"
            className={`${getButtonClasses('search')} nav-pill px-6 py-3 transition-all duration-300 shadow-lg`}
          >
            <Search className="w-4 h-4 mr-2" />
            Search
          </Link>
          <Link
            href="/saved"
            className={`${getButtonClasses('saved')} nav-pill px-6 py-3 transition-all duration-300 shadow-lg`}
          >
            <Heart className="w-4 h-4 mr-2" />
            Saved
          </Link>
          <Link
            href="/watchlist"
            className={`${getButtonClasses('watchlist')} nav-pill px-6 py-3 transition-all duration-300 shadow-lg`}
          >
            <Tv2 className="w-4 h-4 mr-2" />
            Watchlist
          </Link>
          <Link
            href="/about"
            className={`${getButtonClasses('about')} nav-pill px-6 py-3 transition-all duration-300 shadow-lg`}
          >
            <Info className="w-4 h-4 mr-2" />
            About
          </Link>
          <a
            href="https://ko-fi.com/hunterkennedysoftware"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 btn-secondary nav-pill px-6 py-3 transition-all duration-300 shadow-lg"
            aria-label="Support on Ko-fi"
          >
            <Image src="/kofi_symbol.png" alt="Ko-fi" width={321} height={258} className="h-4 w-auto mr-2" />
            Ko-fi
          </a>
        </div>

        {/* Mobile Layout - Icon Only */}
        <div className="md:hidden flex items-center gap-1">
          <Link
            href="/"
            className={`${getButtonClasses('search')} nav-pill px-3 py-2.5 transition-all duration-300 shadow-lg`}
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </Link>
          <Link
            href="/saved"
            className={`${getButtonClasses('saved')} nav-pill px-3 py-2.5 transition-all duration-300 shadow-lg`}
            aria-label="Saved"
          >
            <Heart className="w-4 h-4" />
          </Link>
          <Link
            href="/watchlist"
            className={`${getButtonClasses('watchlist')} nav-pill px-3 py-2.5 transition-all duration-300 shadow-lg`}
            aria-label="Watchlist"
          >
            <Tv2 className="w-4 h-4" />
          </Link>
          <Link
            href="/about"
            className={`${getButtonClasses('about')} nav-pill px-3 py-2.5 transition-all duration-300 shadow-lg`}
            aria-label="About"
          >
            <Info className="w-4 h-4" />
          </Link>
          <a
            href="https://ko-fi.com/hunterkennedysoftware"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 btn-secondary nav-pill px-3 py-2.5 transition-all duration-300 shadow-lg"
            aria-label="Support on Ko-fi"
          >
            <Image src="/kofi_symbol.png" alt="Ko-fi" width={321} height={258} className="h-4 w-auto" />
          </a>
        </div>
      </nav>
    </div>
  );
}