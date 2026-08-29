import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/authorization';
import { Toaster } from '@/components/ui/sonner';

export default async function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    await requireOwner(await headers());
  } catch {
    redirect('/login');
  }
  return (
    <>
      {children}
      {/* Owner surfaces use sonner for success/error feedback. */}
      <Toaster position="bottom-right" richColors />
    </>
  );
}
