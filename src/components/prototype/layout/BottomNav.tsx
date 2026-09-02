'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Home,
  Compass,
  LayoutDashboard,
  BookOpen,
  Award,
  Bell,
  User,
  Info,
  Phone,
  CircleUser,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import type { ViewName } from '@/lib/prototype/types';
import { cn } from '@/lib/utils';
import { fetchUnreadNotificationCount } from '@/features/engagement/api';

// Mobile bottom navigation bar — the core of the app-like chrome.
// Two variants:
//  - "public": marketing/catalog surfaces (inside the public Header).
//  - "student": authenticated student surfaces (inside StudentLayout).
// Hidden from a route-by-route blocklist (e.g. the immersive learning player,
// which carries its own sticky chrome) via SHOULD_RENDER checks.

interface BottomNavItem {
  label: string;
  view: ViewName;
  icon: React.ReactNode;
  /** Filled-style emphasis is handled with a scale + color treatment. */
  badge?: 'unread-notifications';
}

const PUBLIC_ITEMS: BottomNavItem[] = [
  { label: 'Home', view: 'home', icon: <Home className="size-5" /> },
  { label: 'Courses', view: 'courses', icon: <Compass className="size-5" /> },
  { label: 'About', view: 'about', icon: <Info className="size-5" /> },
  { label: 'Contact', view: 'contact', icon: <Phone className="size-5" /> },
  { label: 'Account', view: 'login', icon: <CircleUser className="size-5" /> },
];

const STUDENT_ITEMS: BottomNavItem[] = [
  { label: 'Dashboard', view: 'student-dashboard', icon: <LayoutDashboard className="size-5" /> },
  { label: 'Learning', view: 'my-learning', icon: <BookOpen className="size-5" /> },
  { label: 'Certificates', view: 'certificates', icon: <Award className="size-5" /> },
  { label: 'Alerts', view: 'notifications', icon: <Bell className="size-5" />, badge: 'unread-notifications' },
  { label: 'Profile', view: 'profile', icon: <User className="size-5" /> },
];

/** Routes where the bottom nav must never render (immersive/full-bleed UIs). */
function isSuppressedByPath(pathname: string): boolean {
  // The learning player renders its own sticky top + bottom bars.
  if (/^\/learning\/[^/]+\/[^/]+/.test(pathname)) return true;
  // Course detail pages show a sticky mobile enroll bar instead (native
  // product-page pattern). NOTE: /courses (the list) must NOT be suppressed.
  if (/^\/courses\/.+$/.test(pathname)) return true;
  return false;
}

export default function BottomNav({
  variant,
  activeView,
}: {
  variant: 'public' | 'student';
  activeView?: ViewName;
}) {
  const pathname = usePathname();
  const { navigate, currentView, isAuthenticated, userRole } = useNav();
  const [unreadCount, setUnreadCount] = useState(0);

  // Best-effort unread probe for the Alerts badge (student variant only).
  // Re-probed on every route change so navigation keeps it fresh.
  useEffect(() => {
    if (variant !== 'student' || !isAuthenticated) return;
    let cancelled = false;
    fetchUnreadNotificationCount()
      .then((payload) => {
        if (!cancelled) setUnreadCount(payload.unreadCount);
      })
      .catch(() => {
        /* Badge keeps its last known value; retried on the next navigation. */
      });
    return () => {
      cancelled = true;
    };
  }, [variant, isAuthenticated, pathname]);

  if (isSuppressedByPath(pathname)) return null;

  const items =
    variant === 'student'
      ? STUDENT_ITEMS
      : // Signed-in public visitors land on their home surface from "Account";
        // signed-out ones go to the sign-in view.
        PUBLIC_ITEMS.map((item) =>
          item.view === 'login' && isAuthenticated
            ? { ...item, view: (userRole === 'owner' ? 'instructor-dashboard' : 'profile') as ViewName }
            : item,
        );

  const active = activeView ?? currentView;

  const renderBadge = (item: BottomNavItem) => {
    if (item.badge !== 'unread-notifications' || unreadCount <= 0) return null;
    return (
      <span
        aria-hidden
        className="absolute top-1 right-[calc(50%-1.4rem)] min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-background"
      >
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    );
  };

  return (
    <nav
      aria-label={`${variant === 'student' ? 'Student' : 'Primary'} mobile navigation`}
      className={cn(
        'fixed bottom-0 inset-x-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        variant === 'student' ? 'lg:hidden' : 'md:hidden',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="grid grid-flow-col auto-cols-fr h-16 items-stretch">
        {items.map((item) => {
          const isActive = active === item.view;
          return (
            <li key={item.label} className="flex">
              <button
                type="button"
                onClick={() => navigate(item.view)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 min-h-[3rem] transition-colors active:bg-accent/60',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {renderBadge(item)}
                <span
                  className={cn(
                    'relative transition-transform',
                    // A gentle "lift" on the active icon reads as app-native.
                    isActive && '-translate-y-0.5 scale-110',
                  )}
                  aria-hidden
                >
                  {item.icon}
                  {isActive && (
                    <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </span>
                <span className={cn('text-[11px] leading-none', isActive ? 'font-semibold' : 'font-medium')}>
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
