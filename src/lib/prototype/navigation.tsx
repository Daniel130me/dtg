'use client';

import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/client/auth-client';
import type { ViewName } from './types';

interface NavigationState {
  currentView: ViewName;
  previousView: ViewName | null;
  viewParams: Record<string, string>;
  isAuthenticated: boolean;
  userRole: 'student' | 'owner';
  userName: string | null;
}

interface NavigationContextType extends NavigationState {
  navigate: (view: ViewName, params?: Record<string, string>) => void;
  goBack: () => void;
  logout: () => Promise<void>;
}

const VIEW_ROUTES: Record<ViewName, string> = {
  home: '/',
  courses: '/courses',
  'course-detail': '/courses/course-1',
  about: '/about',
  contact: '/contact',
  login: '/login',
  register: '/register',
  'student-dashboard': '/dashboard',
  'my-learning': '/learning',
  'learning-player': '/learning/course-1/les-1',
  certificates: '/certificates',
  profile: '/profile',
  'instructor-dashboard': '/owner',
  'course-management': '/owner/courses',
  'student-management': '/owner/students',
  analytics: '/owner/analytics',
  grading: '/owner/grading',
  'create-course': '/owner/courses/new',
};

function resolveView(pathname: string): ViewName {
  if (pathname === '/') return 'home';
  if (pathname === '/courses') return 'courses';
  if (pathname.startsWith('/courses/')) return 'course-detail';
  if (pathname === '/about') return 'about';
  if (pathname === '/contact') return 'contact';
  if (pathname === '/login') return 'login';
  if (pathname === '/register') return 'register';
  if (pathname === '/dashboard') return 'student-dashboard';
  if (pathname === '/learning') return 'my-learning';
  if (pathname.startsWith('/learning/')) return 'learning-player';
  if (pathname === '/certificates') return 'certificates';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/owner') return 'instructor-dashboard';
  if (pathname === '/owner/courses/new') return 'create-course';
  if (pathname === '/owner/courses' || pathname.startsWith('/owner/courses/')) return 'course-management';
  if (pathname === '/owner/students') return 'student-management';
  if (pathname === '/owner/analytics') return 'analytics';
  if (pathname === '/owner/grading') return 'grading';
  return 'home';
}

function routeFor(view: ViewName, params: Record<string, string>): string {
  if (view === 'course-detail') return `/courses/${encodeURIComponent(params.courseId || 'course-1')}`;
  if (view === 'learning-player') {
    const courseId = encodeURIComponent(params.courseId || 'course-1');
    const lessonId = encodeURIComponent(params.lessonId || 'les-1');
    return `/learning/${courseId}/${lessonId}`;
  }
  return VIEW_ROUTES[view];
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams<Record<string, string | string[]>>();
  const currentView = resolveView(pathname);
  const { data: session } = authClient.useSession();
  const [previousView, setPreviousView] = useState<ViewName | null>(null);
  const userRole = (session?.user as { role?: string } | undefined)?.role === 'OWNER' ? 'owner' : 'student';

  const viewParams = useMemo(
    () => Object.fromEntries(
      Object.entries(routeParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
    [routeParams],
  );

  const navigate = useCallback((view: ViewName, params: Record<string, string> = {}) => {
    setPreviousView(currentView);
    router.push(routeFor(view, params));
  }, [currentView, router]);

  const goBack = useCallback(() => router.back(), [router]);

  const logout = useCallback(async () => {
    await authClient.signOut();
    router.refresh();
    router.replace('/');
  }, [router]);

  return (
    <NavigationContext.Provider
      value={{ currentView, previousView, viewParams, isAuthenticated: Boolean(session), userRole, userName: session?.user.name ?? null, navigate, goBack, logout }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNav() {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNav must be used within NavigationProvider');
  return context;
}
