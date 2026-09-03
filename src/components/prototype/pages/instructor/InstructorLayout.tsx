'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  BarChart3,
  PlusCircle,
  ArrowLeft,
  GraduationCap,
  ExternalLink,
  ClipboardCheck,
  MessageSquareQuote,
  MessagesSquare,
  Settings,
  Award,
  LogOut,
  Menu,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import type { ViewName } from '@/lib/prototype/types';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

interface NavItem {
  label: string;
  view: ViewName;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', view: 'instructor-dashboard', icon: <LayoutDashboard className="size-5" /> },
  { label: 'Course Management', view: 'course-management', icon: <BookOpen className="size-5" /> },
  { label: 'Q&A', view: 'owner-qa', icon: <MessagesSquare className="size-5" /> },
  { label: 'Grading', view: 'grading', icon: <ClipboardCheck className="size-5" /> },
  { label: 'Certificates', view: 'certificates-admin', icon: <Award className="size-5" /> },
  { label: 'Reviews', view: 'reviews', icon: <MessageSquareQuote className="size-5" /> },
  { label: 'Student Management', view: 'student-management', icon: <Users className="size-5" /> },
  { label: 'Analytics', view: 'analytics', icon: <BarChart3 className="size-5" /> },
  { label: 'Create Course', view: 'create-course', icon: <PlusCircle className="size-5" /> },
];

interface InstructorLayoutProps {
  children: React.ReactNode;
  activeView?: ViewName;
}

interface SidebarContentProps {
  effectiveView: ViewName;
  onClose?: () => void;
}

function SidebarContent({ effectiveView, onClose }: SidebarContentProps) {
  const { navigate, logout, userName } = useNav();
  const ownerName = userName || 'Platform Owner';

  const handleNav = (view: ViewName) => {
    navigate(view);
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full bg-foreground text-background">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <button
          onClick={() => handleNav('home')}
          className="flex items-center gap-2.5 group"
        >
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">DTG</span>
        </button>
      </div>

      {/* Platform owner information */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm shrink-0">
            {ownerName.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{ownerName}</p>
            <p className="text-xs text-background/60">Platform Owner</p>
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = effectiveView === item.view;
          return (
            <button
              key={item.view}
              onClick={() => handleNav(item.view)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all active:bg-white/15',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-background/70 hover:bg-white/10 hover:text-background'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}

        <div className="pt-3 mt-3 border-t border-white/10">
          <button
            onClick={() => handleNav('owner-settings')}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all active:bg-white/15"
          >
            <Settings className="size-5" />
            Account Settings
          </button>
          <button
            onClick={() => handleNav('courses')}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all active:bg-white/15"
          >
            <ArrowLeft className="size-5" />
            Back to Courses
          </button>
        </div>
      </nav>

      {/* Sidebar Footer */}
      <div className="p-3 pb-safe border-t border-white/10">
        <button
          onClick={() => handleNav('home')}
          className="w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all active:bg-white/15"
        >
          <ExternalLink className="size-4" />
          Visit Site
        </button>
        <button
          onClick={() => { logout(); onClose?.(); }}
          className="w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all active:bg-white/15 mt-1"
        >
          <LogOut className="size-4" />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function InstructorLayout({ children, activeView }: InstructorLayoutProps) {
  const { currentView, navigate } = useNav();
  const effectiveView = activeView || currentView;
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar - Dark Theme */}
      <aside className="hidden lg:flex flex-col w-64 fixed inset-y-0 left-0 z-40">
        <SidebarContent effectiveView={effectiveView} />
      </aside>

      {/* Mobile Header — safe-area aware so it clears the status bar in
          standalone (installed PWA) mode. */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-foreground text-background px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <button
          onClick={() => navigate('home')}
          className="flex items-center gap-2 min-h-11"
          aria-label="DTG home"
        >
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap className="size-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold">DTG</span>
        </button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              className="flex items-center gap-2 text-sm font-medium min-h-11 px-3 -mr-2 rounded-md text-background/70 hover:text-background hover:bg-white/10 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
              Menu
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 p-0 pb-safe bg-foreground text-background border-white/10 [&>button]:size-11 [&>button]:text-background/70 [&>button]:hover:text-background [&>button]:hover:opacity-100 [&>button]:flex [&>button]:items-center [&>button]:justify-center"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Owner navigation</SheetTitle>
            </SheetHeader>
            <SidebarContent
              effectiveView={effectiveView}
              onClose={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content — pt-14 clears the fixed mobile header; the safe-area
          spacer covers the extra status-bar inset on notched devices.
          min-w-0 lets the flex item shrink below its content min-width so
          wide children can never push the page past the viewport. */}
      <main className="min-w-0 flex-1 lg:ml-64 pt-14 lg:pt-0">
        <div className="lg:hidden" style={{ height: 'env(safe-area-inset-top, 0px)' }} aria-hidden />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="min-h-screen"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
