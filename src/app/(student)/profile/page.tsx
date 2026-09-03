import type { UserRole } from '@prisma/client';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUserCached } from '@/server/auth/authorization';
import { ProfilePage } from '@/features/learning';

export default async function ProfileRoute() {
  // redirect() throws internally, so it must never run inside the try below.
  let role: UserRole;

  try {
    const { user } = await requireAuthenticatedUserCached(await headers());
    role = user.role;
  } catch {
    redirect('/login');
  }

  // /profile is the student surface; owners have a dedicated settings page.
  if (role === 'OWNER') redirect('/owner/settings');
  return <ProfilePage />;
}
