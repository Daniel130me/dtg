'use client';

import React from 'react';
import type { NotificationDto } from '@/contracts/notifications';
import { cn } from '@/lib/utils';

// Shared notification row used by both the header bell dropdown and the
// student inbox page, so the two surfaces always render identically.

/** "just now" / "5m ago" / "2h ago" / "3d ago", then a short date fallback. */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

interface NotificationRowProps {
  notification: NotificationDto;
  /** Click handler: mark read (+ navigate when the row carries a linkPath). */
  onOpen: (notification: NotificationDto) => void;
  className?: string;
}

/**
 * One inbox row. Rendered as a <button> so it is natively keyboard-focusable;
 * inner elements are spans with block display (a button's content model is
 * phrasing content). Unread rows get the accent tint + leading dot.
 */
export function NotificationRow({ notification, onOpen, className }: NotificationRowProps) {
  const unread = notification.readAt === null;

  return (
    <button
      type='button'
      onClick={() => onOpen(notification)}
      aria-label={unread ? `Unread notification: ${notification.title}` : `Notification: ${notification.title}`}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 transition-colors',
        'hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none',
        unread && 'bg-accent/50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-2 rounded-full shrink-0',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
      />
      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline justify-between gap-2'>
          <span
            className={cn(
              'text-sm line-clamp-2',
              unread ? 'font-medium text-foreground' : 'text-foreground/90',
            )}
          >
            {notification.title}
          </span>
          <span className='text-[11px] text-muted-foreground shrink-0'>
            {formatRelativeTime(notification.createdAt)}
          </span>
        </span>
        {notification.body && (
          <span className='block text-sm text-muted-foreground line-clamp-2 mt-0.5'>
            {notification.body}
          </span>
        )}
      </span>
    </button>
  );
}
