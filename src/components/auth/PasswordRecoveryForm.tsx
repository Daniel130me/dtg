'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/client/auth-client';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setPending(false);
    if (result.error) {
      setError('We could not send the email right now. Please try again in a moment.');
      return;
    }
    setComplete(true);
  }

  return (
    <AuthCard title='Reset your password'>
      <form className='space-y-4' onSubmit={submit}>
        <p className='text-sm text-muted-foreground'>Enter your email and we will send reset instructions if an account is eligible.</p>
        <div className='space-y-2'>
          <Label htmlFor='recovery-email'>Email address</Label>
          <Input id='recovery-email' type='email' value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
        {complete && <p role='status' className='text-sm text-green-700'>If the account exists, reset instructions have been sent.</p>}
        <Button className='w-full' disabled={pending || complete}>{pending ? 'Sending…' : 'Send instructions'}</Button>
        <Link className='block text-center text-sm text-primary hover:underline' href='/login'>Back to login</Link>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || password !== confirmPassword) {
      setError(token ? 'Passwords do not match.' : 'This reset link is invalid or has expired.');
      return;
    }
    setPending(true);
    const result = await authClient.resetPassword({ token, newPassword: password });
    setPending(false);
    if (result.error) {
      setError('This reset link is invalid or has expired. Request a new one.');
      return;
    }
    router.replace('/login?passwordReset=success');
  }

  return (
    <AuthCard title='Choose a new password'>
      <form className='space-y-4' onSubmit={submit}>
        <div className='space-y-2'>
          <Label htmlFor='new-password'>New password</Label>
          <Input id='new-password' type='password' minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='confirm-new-password'>Confirm password</Label>
          <Input id='confirm-new-password' type='password' minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
        </div>
        {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
        <Button className='w-full' disabled={pending}>{pending ? 'Updating…' : 'Update password'}</Button>
      </form>
    </AuthCard>
  );
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className='flex min-h-[70vh] items-center justify-center px-4 py-12'>
      <Card className='w-full max-w-md'>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
