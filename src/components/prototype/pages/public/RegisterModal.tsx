'use client';

import React, { useState } from 'react';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useNav } from '@/lib/prototype/navigation';

const countries = [
  'Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Egypt', 'Tanzania', 'Uganda',
  'Rwanda', 'Ethiopia', 'Senegal', 'United States', 'United Kingdom', 'Canada',
  'Germany', 'France', 'India', 'Philippines', 'Brazil', 'Other',
];

export default function RegisterModal() {
  const { navigate, login } = useNav();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    login('student');
  };

  return (
    <div className='min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12'>
      <Card className='w-full max-w-md p-0 gap-0 overflow-hidden'>
        <div className='bg-gradient-to-br from-blue-600 to-blue-800 px-6 py-8 text-center'>
          <div className='mx-auto size-12 rounded-xl bg-white/20 flex items-center justify-center mb-4'>
            <GraduationCap className='size-6 text-white' />
          </div>
          <h1 className='text-xl font-bold text-white'>Create Your Account</h1>
          <p className='text-blue-100/80 text-sm mt-1'>Start your learning journey today</p>
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
              <p className='text-xs text-muted-foreground'>Must be at least 8 characters</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='reg-confirm'>Confirm Password</Label>
              <Input
                id='reg-confirm'
                type='password'
                placeholder='Confirm your password'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label>Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Select your country' />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type='submit' className='w-full' size='lg'>
              Create Account
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