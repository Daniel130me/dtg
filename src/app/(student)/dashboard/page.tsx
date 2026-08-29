import type { UserRole } from '@prisma/client';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUserCached } from '@/server/auth/authorization';
import { StudentDashboardPage } from '@/features/learning';

export default async function DashboardRoute() {
  // redirect() throws internally, so it must never run inside the try below.
  let role: UserRole;

  try {
    const { user } = await requireAuthenticatedUserCached(await headers());
    role = user.role;
  } catch {
    redirect('/login');
  }

  // /dashboard is the student learning home; owners have a dedicated console.
  if (role === 'OWNER') redirect('/owner');
  return <StudentDashboardPage />;
}
