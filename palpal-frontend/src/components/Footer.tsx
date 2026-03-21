import Link from 'next/link';

export default function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  return (
    <footer className="footer-container">
      <div className="footer-content">
        <div className="flex items-center justify-center gap-6 text-sm">
          <Link href="/tos" className="nav-link hover:text-orange-300 transition-colors duration-200">
            Terms of Service
          </Link>
          <Link href="/pp" className="nav-link hover:text-orange-300 transition-colors duration-200">
            Privacy Policy
          </Link>
          {version && (
            <Link href="/whats-new" className="nav-link opacity-50 hover:opacity-100 transition-opacity duration-200">v{version}</Link>
          )}
        </div>
      </div>
    </footer>
  );
}
