import './admin.css';

export const metadata = {
  title: 'palpal control room',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
