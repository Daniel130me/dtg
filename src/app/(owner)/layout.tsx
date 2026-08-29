import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/authorization';

export default async function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    await requireOwner(await headers());
  } catch {
    redirect('/login');
  }
  return children;
}
