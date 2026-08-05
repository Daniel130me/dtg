'use client';

import React, { useState } from 'react';
import { GraduationCap, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useNav } from '@/lib/prototype/navigation';

export default function LoginModal() {
  const { navigate, login } = useNav();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login('student');
  };

  const handleInstructorLogin = () => {
    login('instructor');
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
                <button type='button' className='text-xs text-primary hover:underline'>Forgot password?</button>
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

            <Button type='submit' className='w-full' size='lg'>
              Sign In
            </Button>
          </form>

          <div className='relative my-6'>
            <Separator />
            <span className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground'>or</span>
          </div>

          <Button variant='outline' className='w-full' onClick={handleInstructorLogin}>
            Login as Instructor
          </Button>

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
