'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationRow } from '@/components/prototype/shared/NotificationItem';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNav } from '@/lib/prototype/navigation';
import {
  fetchUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/engagement/api';
import { ApiClientError } from '@/lib/client/api-client';
import { NOTIFICATION_PAGE_LIMIT_DEFAULT, type NotificationDto } from '@/contracts/notifications';

// Header notification bell (authenticated users only): an unread badge probed
// on mount, plus an inbox that refetches on every open — a bottom vaul Drawer
// on mobile (swipe-to-dismiss + scroll lock, safe-area padding) and the
// desktop Popover above 768px. Clicking a row marks it read (idempotent
// server-side) and follows its linkPath via the Next router — linkPaths are
// arbitrary relative paths, so useNav.navigate is deliberately NOT used here.

/** The badge caps at "9+" so a two-digit count never breaks the icon shape. */
const UNREAD_BADGE_CAP = 9;
const SKELETON_ROW_COUNT = 4;

function BellSkeletonRows() {
  return (
    <div className='px-4 py-3 space-y-4'>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <div key={index} className='flex gap-3'>
          <Skeleton className='mt-1.5 size-2 rounded-full shrink-0' />
          <div className='flex-1 space-y-1.5'>
            <Skeleton className='h-3.5 w-3/4' />
            <Skeleton className='h-3 w-full' />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Shared inbox content (rendered inside the Popover OR the Drawer) --------

interface InboxContentProps {
  unreadCount: number;
  markAllPending: boolean;
  listLoading: boolean;
  listError: string | null;
  items: NotificationDto[];
  nextCursor: string | null;
  loadingMore: boolean;
  onMarkAllRead: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenNotification: (notification: NotificationDto) => void;
  /** Closes the host container (popover/drawer) when "View all" is clicked. */
  onViewAll: () => void;
}

function InboxContent({
  unreadCount,
  markAllPending,
  listLoading,
  listError,
  items,
  nextCursor,
  loadingMore,
  onMarkAllRead,
  onRetry,
  onLoadMore,
  onOpenNotification,
  onViewAll,
}: InboxContentProps) {
  return (
    <div className='flex min-h-0 flex-col'>
      <div className='flex items-center justify-between gap-2 px-4 py-3 border-b'>
        <p className='text-sm font-semibold'>Notifications</p>
        {unreadCount > 0 && (
          <Button
            variant='ghost'
            size='sm'
            className='h-9 gap-1.5 text-xs'
            onClick={onMarkAllRead}
            disabled={markAllPending}
            aria-label='Mark all notifications as read'
          >
            {markAllPending ? (
              <Loader2 className='size-3.5 animate-spin' aria-hidden />
            ) : (
              <CheckCheck className='size-3.5' aria-hidden />
            )}
            Mark all read
          </Button>
        )}
      </div>

      <div className='max-h-96 overflow-y-auto custom-scrollbar'>
        {listLoading ? (
          <BellSkeletonRows />
        ) : listError ? (
          <div className='px-4 py-8 text-center'>
            <p className='text-sm text-destructive mb-3'>{listError}</p>
            <Button variant='outline' size='sm' onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className='px-4 py-10 text-center'>
            <Bell className='size-8 mx-auto text-muted-foreground/40 mb-2' aria-hidden />
            <p className='text-sm text-muted-foreground'>You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className='divide-y'>
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationRow notification={notification} onOpen={onOpenNotification} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {nextCursor && !listLoading && !listError && (
        <div className='border-t p-2'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full text-muted-foreground'
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className='size-3.5 animate-spin' aria-hidden />}
            Load more
          </Button>
        </div>
      )}

      <Link
        href='/notifications'
        onClick={onViewAll}
        className='block border-t px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:bg-accent/60'
      >
        View all notifications
      </Link>
    </div>
  );
}

export default function NotificationsBell() {
  const { isAuthenticated } = useNav();
  const router = useRouter();
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  // Bumped on every open so the list reloads (badge count follows suit).
  const [openGeneration, setOpenGeneration] = useState(0);
  // Bumped to resync the badge after optimistic writes fail server-side.
  const [badgeSeed, setBadgeSeed] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  // --- Unread badge (best-effort probe; never blocks the header) -----------
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetchUnreadNotificationCount()
      .then((payload) => {
        if (cancelled) return;
        setUnreadCount(payload.unreadCount);
      })
      .catch(() => {
        /* Badge stays at its last known value; retried on the next trigger. */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, badgeSeed, openGeneration]);

  // --- Inbox page 1 (fetched only while the panel is open) ------------------
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Request-key pattern (house): loading is DERIVED from the key, state
  // writes only ever happen inside async callbacks.
  const requestKey = openGeneration > 0 ? `open#${openGeneration}#${reloadToken}` : 'closed';
  const [loadedKey, setLoadedKey] = useState<string | null>('closed');
  const listLoading = loadedKey !== requestKey;

  useEffect(() => {
    if (openGeneration === 0) return;
    let cancelled = false;
    listNotifications({ limit: NOTIFICATION_PAGE_LIMIT_DEFAULT })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        // The page carries the live unread count; keep the badge in sync.
        setUnreadCount(page.unreadCount);
        setListError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListError(
          err instanceof ApiClientError ? err.message : "Couldn't load your notifications.",
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [openGeneration, requestKey]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setOpenGeneration((generation) => generation + 1);
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listNotifications({
        limit: NOTIFICATION_PAGE_LIMIT_DEFAULT,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't load more notifications.");
    } finally {
      setLoadingMore(false);
    }
  };

  /** Optimistically marks the row read; server errors resync via a badge refetch. */
  const handleOpenNotification = (notification: NotificationDto) => {
    if (notification.readAt === null) {
      const readNow = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.id === notification.id && item.readAt === null ? { ...item, readAt: readNow } : item,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      markNotificationRead(notification.id).catch(() => {
        // The write didn't stick (expired session, etc.) — resync honestly.
        setBadgeSeed((seed) => seed + 1);
      });
    }
    if (notification.linkPath) {
      setOpen(false);
      // linkPath is an arbitrary relative path from the server.
      router.push(notification.linkPath);
    }
  };

  const handleMarkAllRead = async () => {
    if (markAllPending) return;
    setMarkAllPending(true);
    try {
      const updatedCount = await markAllNotificationsRead();
      if (updatedCount > 0) {
        toast.success(`Marked ${updatedCount} notification${updatedCount === 1 ? '' : 's'} as read`);
      }
      // Reconcile the open page locally (no refetch needed for a read flag).
      const readNow = new Date().toISOString();
      setItems((current) =>
        current.map((item) => (item.readAt === null ? { ...item, readAt: readNow } : item)),
      );
      setUnreadCount(0);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't mark everything as read.");
    } finally {
      setMarkAllPending(false);
    }
  };

  if (!isAuthenticated) return null;

  // The bell + badge trigger is identical for both containers.
  const bellTrigger = (
    <Button variant='ghost' size='icon' className='relative' aria-label='Notifications'>
      <Bell className='size-5' />
      {unreadCount > 0 && (
        <span
          aria-hidden
          className='absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center'
        >
          {unreadCount > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : unreadCount}
        </span>
      )}
    </Button>
  );

  const inbox = (
    <InboxContent
      unreadCount={unreadCount}
      markAllPending={markAllPending}
      listLoading={listLoading}
      listError={listError}
      items={items}
      nextCursor={nextCursor}
      loadingMore={loadingMore}
      onMarkAllRead={() => void handleMarkAllRead()}
      onRetry={() => setReloadToken((token) => token + 1)}
      onLoadMore={() => void handleLoadMore()}
      onOpenNotification={handleOpenNotification}
      onViewAll={() => setOpen(false)}
    />
  );

  // Mobile: bottom drawer with grab handle, swipe-to-dismiss and safe-area
  // padding so "View all" clears the home indicator in PWA standalone.
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger asChild>{bellTrigger}</DrawerTrigger>
        <DrawerContent className='max-h-[85vh] overflow-hidden pb-safe'>
          <DrawerTitle className='sr-only'>Notifications</DrawerTitle>
          <DrawerDescription className='sr-only'>Your notification inbox</DrawerDescription>
          {inbox}
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: the original anchored popover.
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{bellTrigger}</PopoverTrigger>
      {/* Width is clamped to the viewport minus page gutters so it never
          overflows small phones (390px). */}
      <PopoverContent align='end' className='w-[min(24rem,calc(100vw-2rem))] p-0'>
        {inbox}
      </PopoverContent>
    </Popover>
  );
}
