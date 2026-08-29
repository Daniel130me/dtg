'use client';

import React, { useState } from 'react';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useNav } from '@/lib/prototype/navigation';
import { authClient } from '@/lib/client/auth-client';
import { safeRedirectPath } from '@/lib/client/safe-redirect';

export default function LoginModal() {
  const { navigate } = useNav();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError('Email or password is incorrect, or the email is not verified.');
      return;
    }
    router.replace(safeRedirectPath(searchParams.get('returnTo')));
    router.refresh();
  };

  return (
    <div className='min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12'>
      <Card className='w-full max-w-md p-0 gap-0 overflow-hidden'>
        <div className='bg-gradient-to-br from-[#1d4ed8] to-[#0a1a3e] px-6 py-8 text-center'>
          <div className='mx-auto size-12 rounded-xl bg-white/20 flex items-center justify-center mb-4'>
            <GraduationCap className='size-6 text-white' />
          </div>
          <h1 className='text-xl font-bold text-white'>Welcome Back</h1>
          <p className='text-[#bfdbfe]/80 text-sm mt-1'>Sign in to continue learning</p>
        </div>

        <CardContent className='p-6 sm:p-8'>
          <form onSubmit={handleLogin} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='login-email'>Email Address</Label>
              <Input
                id='login-email'
                type='email'
                placeholder='you@example.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='login-password'>Password</Label>
                <Link href='/forgot-password' className='text-xs text-primary hover:underline'>Forgot password?</Link>
              </div>
              <div className='relative'>
                <Input
                  id='login-password'
                  type={showPassword ? 'text' : 'password'}
                  placeholder='Enter your password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type='button'
                  onClick={() => setShowPassword(!showPassword)}
                  className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                >
                  {showPassword ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
                </button>
              </div>
            </div>

            {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
            <Button type='submit' className='w-full' size='lg' disabled={pending}>
              {pending ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <p className='text-center text-sm text-muted-foreground mt-6'>
            Don&apos;t have an account?{' '}
            <button onClick={() => navigate('register')} className='text-primary font-medium hover:underline'>
              Register
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
