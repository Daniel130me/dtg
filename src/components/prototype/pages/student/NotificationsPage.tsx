'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Bell, CheckCheck, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { NotificationRow } from '@/components/prototype/shared/NotificationItem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/engagement/api';
import { ApiClientError } from '@/lib/client/api-client';
import { NOTIFICATION_PAGE_LIMIT_DEFAULT, type NotificationDto } from '@/contracts/notifications';
import type { ViewName } from '@/lib/prototype/types';

// Full-page notification inbox for the student area. Same row rendering as
// the header bell (shared NotificationRow), plus an unread-only filter,
// cursor Load more, and a mark-all-read header action.

const SKELETON_ROW_COUNT = 6;

type InboxTab = 'all' | 'unread';

interface ListError {
  message: string;
  /** 401 gets its own "Session expired" panel (CertificatesPage pattern). */
  sessionExpired: boolean;
}

function InboxSkeletonRows() {
  return (
    <Card>
      <CardContent className='p-0'>
        <div className='px-4 py-4 space-y-5'>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
            <div key={index} className='flex gap-3'>
              <Skeleton className='mt-1.5 size-2 rounded-full shrink-0' />
              <div className='flex-1 space-y-1.5'>
                <Skeleton className='h-3.5 w-2/3' />
                <Skeleton className='h-3 w-full' />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NotificationsPage() {
  const router = useRouter();

  const [tab, setTab] = useState<InboxTab>('all');
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<ListError | null>(null);

  // Request-key pattern (house): loading is DERIVED, state writes live in
  // async callbacks only.
  const requestKey = `${tab}#${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    listNotifications({
      limit: NOTIFICATION_PAGE_LIMIT_DEFAULT,
      unreadOnly: tab === 'unread' ? 'true' : undefined,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total);
        setUnreadCount(page.unreadCount);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          message: err instanceof Error ? err.message : 'Failed to load your notifications.',
          sessionExpired: err instanceof ApiClientError && err.status === 401,
        });
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listNotifications({
        limit: NOTIFICATION_PAGE_LIMIT_DEFAULT,
        cursor: nextCursor,
        unreadOnly: tab === 'unread' ? 'true' : undefined,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't load more notifications.");
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Row open: mark read (idempotent) and follow the linkPath via the Next
   * router — linkPaths are arbitrary relative paths, so useNav.navigate is
   * deliberately not used. On the Unread tab a newly-read row leaves the
   * filter's result set, so it is removed instead of restyled.
   */
  const handleOpenNotification = (notification: NotificationDto) => {
    if (notification.readAt === null) {
      if (tab === 'unread') {
        setItems((current) => current.filter((item) => item.id !== notification.id));
        setTotal((count) => Math.max(0, count - 1));
      } else {
        const readNow = new Date().toISOString();
        setItems((current) =>
          current.map((item) =>
            item.id === notification.id && item.readAt === null ? { ...item, readAt: readNow } : item,
          ),
        );
      }
      setUnreadCount((count) => Math.max(0, count - 1));
      markNotificationRead(notification.id).catch(() => {
        /* The badge/list resync on the next visit; rows stay honest locally. */
      });
    }
    if (notification.linkPath) {
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
      setUnreadCount(0);
      if (tab === 'unread') {
        // Every row just became read — the unread filter is now empty.
        setReloadToken((token) => token + 1);
      } else {
        const readNow = new Date().toISOString();
        setItems((current) =>
          current.map((item) => (item.readAt === null ? { ...item, readAt: readNow } : item)),
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't mark everything as read.");
    } finally {
      setMarkAllPending(false);
    }
  };

  const activeView: ViewName = 'notifications';

  return (
    <StudentLayout activeView={activeView}>
      <div className='max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Page header */}
        <div className='flex items-start justify-between gap-3'>
          <div>
            <Button
              variant='ghost'
              size='sm'
              className='gap-1.5 -ml-2 text-muted-foreground hover:text-foreground'
              onClick={() => router.back()}
            >
              <ArrowLeft className='size-4' aria-hidden /> Back
            </Button>
            <h1 className='text-2xl font-bold mt-1'>Notifications</h1>
            <p className='text-muted-foreground mt-1 text-sm'>
              {loading
                ? 'Your announcements and activity updates'
                : `${total} ${total === 1 ? 'notification' : 'notifications'} · ${unreadCount} unread`}
            </p>
          </div>
          {unreadCount > 0 && !loading && !error && (
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5 shrink-0'
              onClick={() => void handleMarkAllRead()}
              disabled={markAllPending}
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

        {/* Unread-only filter */}
        <Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)}>
          <TabsList aria-label='Filter notifications'>
            <TabsTrigger value='all'>All</TabsTrigger>
            <TabsTrigger value='unread'>Unread</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <InboxSkeletonRows />
        ) : error ? (
          error.sessionExpired ? (
            /* 401 — the route guard redirects on hard navigation; this panel
               covers an expired session while the page is already open. */
            <div className='text-center py-16'>
              <div className='size-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4'>
                <LogIn className='size-7 text-amber-600' aria-hidden />
              </div>
              <h2 className='font-semibold text-lg mb-1'>Session expired</h2>
              <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>
                Your session has expired. Sign in again to see your notifications.
              </p>
              <Button asChild>
                <Link href='/login'>Sign in</Link>
              </Button>
            </div>
          ) : (
            <FetchErrorState
              title="Couldn't load your notifications"
              message={error.message}
              onRetry={() => setReloadToken((token) => token + 1)}
            />
          )
        ) : items.length === 0 ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-16 text-center'>
              <div className='size-16 rounded-2xl bg-muted flex items-center justify-center'>
                <Bell className='size-8 text-muted-foreground/50' aria-hidden />
              </div>
              <h2 className='text-lg font-semibold mt-4'>
                {tab === 'unread' ? "You're all caught up." : 'No notifications yet'}
              </h2>
              <p className='text-sm text-muted-foreground mt-1.5 max-w-sm'>
                {tab === 'unread'
                  ? 'Everything has been read. New activity will show up here.'
                  : 'Enrolments, grades, replies and certificates will show up here as they happen.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Card>
              <CardContent className='p-0'>
                <ul className='divide-y'>
                  {items.map((notification) => (
                    <li key={notification.id}>
                      <NotificationRow notification={notification} onOpen={handleOpenNotification} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            {nextCursor && (
              <div className='flex justify-center pt-4'>
                <Button variant='outline' onClick={() => void handleLoadMore()} disabled={loadingMore}>
                  {loadingMore && <Loader2 className='size-4 mr-2 animate-spin' aria-hidden />}
                  Load more
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </StudentLayout>
  );
}
