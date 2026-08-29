import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUserCached } from '@/server/auth/authorization';

export default async function AuthenticatedStudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    // Memoized per request so the dashboard page's role check reuses this lookup.
    await requireAuthenticatedUserCached(await headers());
  } catch {
    redirect('/login');
  }
  return children;
}
