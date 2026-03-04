import AdminPanel from './AdminPanel';
import Navbar from '@/components/Navbar';

export const metadata = { title: 'Admin — palpal' };

export default function AdminPage() {
  return (
    <div className="page-container">
      <Navbar currentPage="admin" />
      <div className="content-container max-w-5xl mx-auto">
        <AdminPanel />
      </div>
    </div>
  );
}
