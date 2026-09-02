'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  Award,
  Bell,
  UserCircle,
  ArrowLeft,
  GraduationCap,
  LogOut,
  Menu,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import type { ViewName } from '@/lib/prototype/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import BottomNav from '@/components/prototype/layout/BottomNav';
import NotificationsBell from '@/components/prototype/layout/NotificationsBell';

interface NavItem {
  label: string;
  view: ViewName;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', view: 'student-dashboard', icon: <LayoutDashboard className="size-5" /> },
  { label: 'My Learning', view: 'my-learning', icon: <BookOpen className="size-5" /> },
  { label: 'Certificates', view: 'certificates', icon: <Award className="size-5" /> },
  { label: 'Notifications', view: 'notifications', icon: <Bell className="size-5" /> },
  { label: 'Profile', view: 'profile', icon: <UserCircle className="size-5" /> },
];

interface StudentLayoutProps {
  children: React.ReactNode;
  activeView?: ViewName;
}

export default function StudentLayout({ children, activeView }: StudentLayoutProps) {
  const { navigate, currentView, user, userName, userEmail, logout } = useNav();
  const effectiveView = activeView || currentView;
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const displayName = user?.name || userName || 'Student';
  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'S';
  const email = user?.email || userEmail || '';

  const handleNav = (view: ViewName) => {
    navigate(view);
    setMobileOpen(false);
  };

  const accountBlock = (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/40">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">{displayName}</p>
        {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
      </div>
      <button
        onClick={logout}
        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Log out"
      >
        <LogOut className="size-4" />
        <span className="sr-only">Log out</span>
      </button>
    </div>
  );

  const helpBlock = (
    <div className="bg-primary/5 rounded-lg p-3">
      <p className="text-xs font-medium text-primary">Need Help?</p>
      <p className="text-xs text-muted-foreground mt-1">
        Visit our contact page for support
      </p>
      <button
        onClick={() => handleNav('contact')}
        className="text-xs font-medium text-primary hover:underline mt-2 block"
      >
        Contact Us
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r bg-card fixed inset-y-0 left-0 z-40">
        {/* Logo */}
        <div className="p-6 border-b">
          <button
            onClick={() => navigate('home')}
            className="flex items-center gap-2.5 group"
          >
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
              <GraduationCap className="size-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight group-hover:text-primary transition-colors">
              DTG
            </span>
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Student">
          {navItems.map((item) => {
            const isActive = effectiveView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => navigate(item.view)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t">
            <button
              onClick={() => navigate('courses')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
            >
              <ArrowLeft className="size-5" />
              Back to Courses
            </button>
          </div>
        </nav>

        {/* User Account & Footer */}
        <div className="p-4 border-t space-y-3">
          {accountBlock}
          {helpBlock}
        </div>
      </aside>

      {/* Mobile Header — safe-area aware so it clears the status bar in
          standalone (installed PWA) mode. */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <button
          onClick={() => navigate('home')}
          className="flex items-center gap-2"
          aria-label="DTG home"
        >
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap className="size-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold">DTG</span>
        </button>
        {/* Unread-count bell (auth-gated internally; bottom Drawer on mobile). */}
        <NotificationsBell />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant='ghost' size='sm' className='gap-2 min-h-11 text-muted-foreground'>
              <Menu className="size-5" />
              Menu
            </Button>
          </SheetTrigger>
          <SheetContent side='left' className='w-80 p-0 pb-safe flex flex-col'>
            <SheetHeader className='p-6 pb-4 border-b'>
              <SheetTitle>
                <button
                  onClick={() => handleNav('home')}
                  className="flex items-center gap-2.5"
                >
                  <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
                    <GraduationCap className="size-5 text-primary-foreground" />
                  </div>
                  <span className="text-lg font-bold">DTG</span>
                </button>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Student mobile">
              {navItems.map((item) => {
                const isActive = effectiveView === item.view;
                return (
                  <button
                    key={item.view}
                    onClick={() => handleNav(item.view)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
              <div className="pt-4 mt-4 border-t">
                <button
                  onClick={() => handleNav('courses')}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                >
                  <ArrowLeft className="size-5" />
                  Back to Courses
                </button>
              </div>
            </nav>
            <div className="p-4 border-t space-y-3">
              {accountBlock}
              {helpBlock}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content — top padding clears the fixed mobile header (plus
          safe inset); the trailing spacer clears the mobile bottom nav. */}
      <main
        className="flex-1 lg:ml-64"
        style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="min-h-screen"
        >
          {children}
          {/* Spacer matching the bottom nav + safe inset (mobile only). */}
          <div className="lg:hidden" style={{ height: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }} aria-hidden />
        </motion.div>
      </main>

      {/* App-like mobile bottom navigation. */}
      <BottomNav variant='student' activeView={effectiveView} />
    </div>
  );
}
