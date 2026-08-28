'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  BarChart3,
  PlusCircle,
  ArrowLeft,
  GraduationCap,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import type { ViewName } from '@/lib/prototype/types';
import { cn } from '@/lib/utils';
import { instructor } from '@/lib/prototype/mock-data';

interface NavItem {
  label: string;
  view: ViewName;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', view: 'instructor-dashboard', icon: <LayoutDashboard className="size-5" /> },
  { label: 'Course Management', view: 'course-management', icon: <BookOpen className="size-5" /> },
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
  const { navigate, logout } = useNav();

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
            {instructor.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{instructor.name}</p>
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
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
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
            onClick={() => handleNav('courses')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all"
          >
            <ArrowLeft className="size-5" />
            Back to Courses
          </button>
        </div>
      </nav>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => handleNav('home')}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all"
        >
          <ExternalLink className="size-4" />
          Visit Site
        </button>
        <button
          onClick={() => { logout(); onClose?.(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-background/70 hover:bg-white/10 hover:text-background transition-all mt-1"
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

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-foreground text-background px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate('home')}
          className="flex items-center gap-2"
        >
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap className="size-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold">DTG</span>
        </button>
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 text-sm font-medium text-background/70 hover:text-background"
        >
          <LayoutDashboard className="size-5" />
          Menu
        </button>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute left-0 top-0 bottom-0 w-72 shadow-2xl"
            >
              <SidebarContent
                effectiveView={effectiveView}
                onClose={() => setMobileOpen(false)}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
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
