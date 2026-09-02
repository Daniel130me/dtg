'use client';

import React, { useState } from 'react';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';
import { authClient } from '@/lib/client/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useNav } from '@/lib/prototype/navigation';

export default function RegisterModal() {
  const { navigate } = useNav();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      if (result.error) {
        setError('Unable to create the account. Check the information and try again.');
        return;
      }
      // Better Auth intentionally gives the same response for new and existing
      // addresses so the public form cannot be used to discover student accounts.
      setMessage(
        'Check your email for the next step. New accounts receive a verification link; existing accounts receive sign-in guidance.',
      );
    } catch {
      setError('Unable to reach the registration service. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className='min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12'>
      <Card className='w-full max-w-md p-0 gap-0 overflow-hidden'>
        <div className='bg-gradient-to-br from-[#1d4ed8] to-[#0a1a3e] px-6 py-8 text-center'>
          <div className='mx-auto size-12 rounded-xl bg-white/20 flex items-center justify-center mb-4'>
            <GraduationCap className='size-6 text-white' />
          </div>
          <h1 className='text-xl font-bold text-white'>Create Your Account</h1>
          <p className='text-[#bfdbfe]/80 text-sm mt-1'>Start your learning journey today</p>
        </div>

        <CardContent className='p-6 sm:p-8'>
          <form onSubmit={handleRegister} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='reg-name'>Full Name</Label>
              <Input
                id='reg-name'
                placeholder='John Doe'
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='reg-email'>Email Address</Label>
              <Input
                id='reg-email'
                type='email'
                placeholder='you@example.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='reg-password'>Password</Label>
              <div className='relative'>
                <Input
                  id='reg-password'
                  type={showPassword ? 'text' : 'password'}
                  placeholder='Create a password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={128}
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
              <p className='text-xs text-muted-foreground'>Use 12–128 characters.</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='reg-confirm'>Confirm Password</Label>
              <Input
                id='reg-confirm'
                type='password'
                placeholder='Confirm your password'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </div>

            {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
            {message && <p role='status' className='text-sm text-green-700'>{message}</p>}
            <Button type='submit' className='w-full' size='lg' disabled={pending || Boolean(message)}>
              {pending ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>

          <p className='text-center text-sm text-muted-foreground mt-6'>
            Already have an account?{' '}
            <button onClick={() => navigate('login')} className='text-primary font-medium hover:underline'>
              Login
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
