import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET() {
  (await cookies()).delete('palpal_admin_session');
  redirect('/admin/login');
}
