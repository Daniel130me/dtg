'use client';

import React, { useState } from 'react';
import { GraduationCap, Menu, LogOut, User, LayoutDashboard, BookOpen, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import NotificationsBell from '@/components/prototype/layout/NotificationsBell';
import BottomNav from '@/components/prototype/layout/BottomNav';
import { useNav } from '@/lib/prototype/navigation';
import type { ViewName } from '@/lib/prototype/types';

const navLinks = [
  { label: 'Home', view: 'home' as const },
  { label: 'Courses', view: 'courses' as const },
  { label: 'About Instructor', view: 'about' as const },
  { label: 'Contact', view: 'contact' as const },
];

export default function Header() {
  const { currentView, navigate, isAuthenticated, userRole, userName, logout } = useNav();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = userName
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

  const handleNav = (view: ViewName) => {
    navigate(view);
    setMobileOpen(false);
  };

  return (
    <>
      <header className='sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-safe'>
        <div className='max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8'>
          {/* Logo */}
          <button
            onClick={() => navigate('home')}
            className='flex items-center gap-2 hover:opacity-80 transition-opacity'
          >
            <div className='size-9 rounded-lg bg-primary flex items-center justify-center'>
              <GraduationCap className='size-5 text-primary-foreground' />
            </div>
            <span className='text-xl font-bold tracking-tight text-foreground'>DTG</span>
          </button>

          {/* Desktop Nav */}
          <nav className='hidden md:flex items-center gap-1' aria-label='Primary'>
            {navLinks.map((link) => (
              <button
                key={link.view}
                onClick={() => handleNav(link.view)}
                aria-current={currentView === link.view ? 'page' : undefined}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
                  currentView === link.view
                    ? 'text-primary bg-primary/5'
                    : 'text-muted-foreground'
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>

          {/* Right Side */}
          <div className='flex items-center gap-2'>
            {isAuthenticated ? (
              <>
                {/* Notification bell — live inbox (Phase 10), auth-gated inside. */}
                <NotificationsBell />

                {/* User Avatar Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' className='gap-2 pl-2 pr-3 min-h-11' aria-label='Open account menu'>
                      <Avatar className='size-8'>
                        <AvatarFallback className='bg-primary/10 text-primary text-xs font-bold'>{initials}</AvatarFallback>
                      </Avatar>
                      <ChevronDown className='size-3.5 text-muted-foreground' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-56'>
                    <DropdownMenuLabel>
                      <div className='flex flex-col gap-0.5'>
                        <span className='font-medium text-sm'>{userName}</span>
                        <span className='text-xs text-muted-foreground font-normal capitalize'>{userRole}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {userRole === 'student' && (
                      <DropdownMenuItem onClick={() => navigate('my-learning')} className='cursor-pointer'>
                        <BookOpen className='size-4 mr-2' /> My Learning
                      </DropdownMenuItem>
                    )}
                    {userRole === 'owner' && (
                      <DropdownMenuItem onClick={() => navigate('instructor-dashboard')} className='cursor-pointer'>
                        <LayoutDashboard className='size-4 mr-2' /> Dashboard
                      </DropdownMenuItem>
                    )}
                    {/* Owners get their own console settings page; students
                        get the learner profile. */}
                    <DropdownMenuItem
                      onClick={() => navigate(userRole === 'owner' ? 'owner-settings' : 'profile')}
                      className='cursor-pointer'
                    >
                      <User className='size-4 mr-2' /> Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className='cursor-pointer text-red-600 focus:text-red-600'>
                      <LogOut className='size-4 mr-2' /> Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {/* Mobile: a compact sign-in affordance so authentication is
                    one tap away without opening the sheet. */}
                <Button
                  variant='ghost'
                  className='md:hidden min-h-11 px-3'
                  onClick={() => navigate('login')}
                  aria-label='Sign in'
                >
                  Sign in
                </Button>
                <div className='hidden md:flex items-center gap-2'>
                  <Button variant='ghost' onClick={() => navigate('login')}>
                    Login
                  </Button>
                  <Button onClick={() => navigate('register')}>
                    Register
                  </Button>
                </div>
              </>
            )}

            {/* Mobile Menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild className='md:hidden'>
                <Button variant='ghost' size='icon' className='size-11' aria-label='Open navigation menu'>
                  <Menu className='size-5' />
                </Button>
              </SheetTrigger>
              <SheetContent side='right' className='w-80 pt-8 pb-safe flex flex-col'>
                <SheetHeader>
                  <SheetTitle className='flex items-center gap-2'>
                    <div className='size-8 rounded-lg bg-primary flex items-center justify-center'>
                      <GraduationCap className='size-4 text-primary-foreground' />
                    </div>
                    DTG
                  </SheetTitle>
                </SheetHeader>
                <nav className='flex flex-col gap-1 mt-4 px-4' aria-label='Mobile'>
                  {navLinks.map((link) => (
                    <button
                      key={link.view}
                      onClick={() => handleNav(link.view)}
                      aria-current={currentView === link.view ? 'page' : undefined}
                      className={`px-3 py-3 rounded-lg text-sm font-medium text-left transition-colors hover:bg-accent ${
                        currentView === link.view
                          ? 'text-primary bg-primary/5'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {link.label}
                    </button>
                  ))}
                  <div className='border-t my-2' />
                  {isAuthenticated ? (
                    <>
                      {userRole === 'student' && (
                        <button onClick={() => handleNav('my-learning')} className='px-3 py-3 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-accent transition-colors'>
                          My Learning
                        </button>
                      )}
                      {userRole === 'owner' && (
                        <button onClick={() => handleNav('instructor-dashboard')} className='px-3 py-3 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-accent transition-colors'>
                          Dashboard
                        </button>
                      )}
                      <button
                        onClick={() => handleNav(userRole === 'owner' ? 'owner-settings' : 'profile')}
                        className='px-3 py-3 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-accent transition-colors'
                      >
                        Profile
                      </button>
                      <button onClick={() => { logout(); setMobileOpen(false); }} className='px-3 py-3 rounded-lg text-sm font-medium text-left text-red-600 hover:bg-red-50 transition-colors'>
                        Logout
                      </button>
                    </>
                  ) : (
                    <>
                      <Button variant='outline' className='justify-start min-h-11' onClick={() => handleNav('login')}>
                        Login
                      </Button>
                      <Button className='w-full min-h-11' onClick={() => handleNav('register')}>
                        Register
                      </Button>
                    </>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* App-like mobile bottom navigation (public surfaces). */}
      <BottomNav variant='public' />
    </>
  );
}
