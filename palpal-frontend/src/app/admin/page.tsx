import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminToken } from '@/lib/auth';
import AdminConsole from '@/components/admin/AdminConsole';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !(await verifyAdminToken(session.value))) {
    redirect('/admin/login');
  }

  return <AdminConsole />;
}
