import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/server/auth/authorization';

export default async function AuthenticatedStudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    await requireAuthenticatedUser(await headers());
  } catch {
    redirect('/login');
  }
  return children;
}
