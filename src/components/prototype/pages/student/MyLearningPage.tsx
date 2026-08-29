'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, BookOpen, CheckCircle2, CircleDot, Clock, Loader2 } from 'lucide-react';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { fetchMyEnrolments, type EnrolmentListQueryInput } from '@/features/learning/api';
import { ApiClientError } from '@/lib/client/api-client';
import { formatDuration, formatLevel } from '@/lib/client/format';
import {
  ENROLMENT_PAGE_LIMIT_DEFAULT,
  type EnrolmentDto,
  type EnrolmentStatusFilter,
  type EnrolmentStatusValue,
} from '@/contracts/enrolments';

// --- Tab model -------------------------------------------------------------
// Tabs are server-filtered: "All" sends no status param, the other tabs map to
// the contract's status filters.

const TAB_ALL = 'all';
const TAB_ACTIVE = 'active';
const TAB_COMPLETED = 'completed';

const TAB_VALUES = [TAB_ALL, TAB_ACTIVE, TAB_COMPLETED] as const;
type TabValue = (typeof TAB_VALUES)[number];

function statusForTab(tab: TabValue): EnrolmentStatusFilter | undefined {
  if (tab === TAB_ACTIVE) return 'ACTIVE';
  if (tab === TAB_COMPLETED) return 'COMPLETED';
  return undefined;
}

function isTabValue(value: string): value is TabValue {
  return (TAB_VALUES as readonly string[]).includes(value);
}

const tabEmptyState: Record<TabValue, { title: string; description: string }> = {
  [TAB_ALL]: {
    title: 'No courses yet',
    description: "You haven't enrolled in any courses yet. Find something great to learn!",
  },
  [TAB_ACTIVE]: {
    title: 'No courses in progress',
    description: 'Enroll in a course and start learning today.',
  },
  [TAB_COMPLETED]: {
    title: 'No completed courses yet',
    description: "Keep going! You'll complete your first course soon.",
  },
};

// --- Display maps (same palette as CourseCard) ------------------------------

/** Gradient placeholders keyed by category slug; unknown slugs use the default. */
const categoryGradients: Record<string, string> = {
  'web-development': 'from-[#1d4ed8] to-[#0a1a3e]',
  'data-science': 'from-[#2563eb] to-[#0f2847]',
  'mobile-development': 'from-[#3b82f6] to-[#1e3a8a]',
  'devops-and-cloud': 'from-[#0f2847] to-[#0a1a3e]',
  'design-and-ui-ux': 'from-[#4338ca] to-[#0a1a3e]',
};

const DEFAULT_GRADIENT = 'from-[#1d4ed8] to-[#0a1a3e]';

const statusBadgeMap: Record<
  EnrolmentStatusValue,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  ACTIVE: { label: 'In progress', variant: 'default' },
  COMPLETED: { label: 'Completed', variant: 'secondary' },
  REVOKED: { label: 'Revoked', variant: 'destructive' },
};

const ENROLLED_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "2026-08-29T10:00:00.000Z" -> "29 Aug 2026" (enrolledAt arrives as ISO datetime). */
function formatEnrolledDate(iso: string): string {
  return ENROLLED_DATE_FORMAT.format(new Date(iso));
}

/** Same initials rule as CourseCard: first letters of the first two meaningful words. */
function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => !['for', 'and', 'with', 'the', 'to', 'in', 'of', 'a', 'an'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// --- Skeletons --------------------------------------------------------------

/** Mirrors the EnrolmentCard layout so the grid keeps its height while loading. */
function EnrolmentCardSkeleton() {
  return (
    <Card className='overflow-hidden p-0 gap-0'>
      <Skeleton className='h-32 w-full rounded-b-none' />
      <div className='p-4 flex flex-col gap-3'>
        <Skeleton className='h-3 w-24' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-2/3' />
        <div className='flex gap-3'>
          <Skeleton className='h-3 w-16' />
          <Skeleton className='h-3 w-20' />
        </div>
        <div className='pt-1 border-t flex items-center justify-between'>
          <Skeleton className='h-3 w-28' />
          <Skeleton className='h-3.5 w-16' />
        </div>
      </div>
    </Card>
  );
}

// --- Card -------------------------------------------------------------------

interface EnrolmentCardProps {
  enrolment: EnrolmentDto;
  index: number;
}

/** The player arrives in Phase 8 — for now the course page is the honest destination. */
function EnrolmentCard({ enrolment, index }: EnrolmentCardProps) {
  const course = enrolment.course;
  const gradient = categoryGradients[course.categorySlug] ?? DEFAULT_GRADIENT;
  const statusBadge = statusBadgeMap[enrolment.status];
  const progress = enrolment.progress; // nullable — see enrolmentProgressSchema
  // Fully-watched courses switch the card's primary action from resuming to
  // reviewing (the link target stays the course page either way).
  const courseCompleted = progress?.progressPercent === 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), duration: 0.3 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      <Link
        href={`/courses/${course.slug}`}
        className='block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      >
        <Card className='group h-full cursor-pointer overflow-hidden p-0 gap-0 transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5'>
          {/* Banner */}
          <div className={`relative h-32 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            {course.thumbnailUrl ? (
              <img
                src={course.thumbnailUrl}
                alt={course.title}
                className='absolute inset-0 size-full object-cover'
              />
            ) : (
              <>
                <div className='absolute inset-0 bg-black/10' />
                <span className='relative z-10 text-white/60 text-xs font-semibold tracking-wider uppercase'>
                  {getInitials(course.title)}
                </span>
              </>
            )}
            <div className='absolute top-2 right-2 z-10'>
              <Badge variant={statusBadge.variant} className='text-[10px]'>
                {statusBadge.label}
              </Badge>
            </div>
            <div className='absolute bottom-2 left-2 z-10'>
              <Badge variant='secondary' className='bg-white/90 text-foreground text-[10px] backdrop-blur-sm'>
                {formatLevel(course.level)}
              </Badge>
            </div>
          </div>

          {/* Content */}
          <CardContent className='p-4 flex flex-col gap-3'>
            <p className='text-xs font-medium text-primary uppercase tracking-wide'>{course.categoryName}</p>
            <h3 className='font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors'>
              {course.title}
            </h3>

            <div className='flex items-center gap-3 text-xs text-muted-foreground'>
              <span className='flex items-center gap-1'>
                <Clock className='size-3.5' /> {formatDuration(course.totalMinutes)}
              </span>
              <span className='flex items-center gap-1'>
                <BookOpen className='size-3.5' /> {course.totalLessons} lessons
              </span>
            </div>

            {/* Per-course progress — null on freshly granted enrolments, in
                which case only the plain meta row above renders. The
                indicator's standard color is bg-primary, which covers both
                cases: 100% completed bars render in primary, and in-progress
                bars keep the same standard color. */}
            {progress && (
              <div className='flex flex-col gap-1.5'>
                <Progress
                  value={progress.progressPercent}
                  className='h-1.5'
                  aria-label={`${progress.progressPercent}% of this course completed`}
                />
                <div className='flex items-center justify-between text-xs'>
                  <span className='text-muted-foreground'>
                    {progress.completedLessons}/{progress.totalLessons} lessons
                  </span>
                  <span className='font-medium text-foreground'>{progress.progressPercent}%</span>
                </div>
              </div>
            )}

            <div className='pt-1 border-t flex items-center justify-between'>
              <span className='text-xs text-muted-foreground'>
                Enrolled {formatEnrolledDate(enrolment.enrolledAt)}
              </span>
              <span className='inline-flex items-center gap-1 text-xs font-medium text-primary'>
                {courseCompleted ? 'Review course' : 'Continue'} <ArrowRight className='size-3.5' />
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

// --- Page -------------------------------------------------------------------

export default function MyLearningPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(TAB_ALL);

  const [items, setItems] = useState<EnrolmentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Loading is DERIVED from the request key (see CoursesPage) so effects never
  // call setState synchronously; all state writes happen in async callbacks.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${activeTab}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  const status = statusForTab(activeTab);
  const query = useMemo<EnrolmentListQueryInput>(
    () => ({ status, limit: ENROLMENT_PAGE_LIMIT_DEFAULT }),
    [status],
  );

  // Re-fetch page 1 whenever the tab (or a retry) changes. The skeleton grid
  // renders first, so stale items never leak through.
  useEffect(() => {
    let cancelled = false;
    fetchMyEnrolments(query)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setError(null);
        setLoadMoreError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiClientError && err.status === 401
            ? 'Your session has expired. Please sign in again.'
            : err instanceof Error
              ? err.message
              : 'Failed to load your courses.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchMyEnrolments({ ...query, cursor: nextCursor });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more courses.');
    } finally {
      setLoadingMore(false);
    }
  }, [query, nextCursor, loadingMore]);

  const emptyState = tabEmptyState[activeTab];

  return (
    <StudentLayout>
      <div className='max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Page Header */}
        <div>
          <h1 className='text-2xl font-bold'>My Learning</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            Track your enrolled courses and progress
          </p>
        </div>

        {/* Tabs (server-filtered: All / ACTIVE / COMPLETED) */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (isTabValue(value)) setActiveTab(value);
          }}
          className='w-full'
        >
          <TabsList>
            <TabsTrigger value={TAB_ALL} className='gap-1.5'>
              <BookOpen className='size-3.5' />
              All
            </TabsTrigger>
            <TabsTrigger value={TAB_ACTIVE} className='gap-1.5'>
              <CircleDot className='size-3.5' />
              In Progress
            </TabsTrigger>
            <TabsTrigger value={TAB_COMPLETED} className='gap-1.5'>
              <CheckCircle2 className='size-3.5' />
              Completed
            </TabsTrigger>
          </TabsList>

          {/* Shared list area — content follows the selected tab's server-filtered fetch. */}
          <AnimatePresence mode='wait'>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className='mt-4'
            >
              {/* Summary */}
              {loading ? (
                <Skeleton className='h-4 w-44 mb-6' />
              ) : !error && items.length > 0 ? (
                <p className='text-sm text-muted-foreground mb-6'>
                  Showing <span className='font-medium text-foreground'>{items.length}</span> of{' '}
                  <span className='font-medium text-foreground'>{total}</span>{' '}
                  {total === 1 ? 'course' : 'courses'}
                </p>
              ) : null}

              {loading ? (
                /* Skeleton grid mirrors the enrolment card layout */
                <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6'>
                  {Array.from({ length: ENROLMENT_PAGE_LIMIT_DEFAULT }).map((_, i) => (
                    <EnrolmentCardSkeleton key={i} />
                  ))}
                </div>
              ) : error ? (
                <FetchErrorState
                  title="Couldn't load your courses"
                  message={error}
                  onRetry={() => setRetrySeed((s) => s + 1)}
                />
              ) : items.length > 0 ? (
                <>
                  <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6'>
                    {items.map((enrolment, idx) => (
                      <EnrolmentCard key={enrolment.id} enrolment={enrolment} index={idx} />
                    ))}
                  </div>

                  {/* Load More (cursor pagination) */}
                  {nextCursor && (
                    <div className='text-center mt-10'>
                      {loadMoreError && (
                        <p className='text-sm text-destructive mb-3'>{loadMoreError}</p>
                      )}
                      <Button variant='outline' size='lg' onClick={loadMore} disabled={loadingMore}>
                        {loadingMore && <Loader2 className='size-4 animate-spin' />}
                        {loadingMore ? 'Loading…' : 'Load More Courses'}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                /* Empty state */
                <Card>
                  <CardContent className='flex flex-col items-center justify-center py-16 text-center'>
                    <div className='size-16 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground/50'>
                      <BookOpen className='size-8' />
                    </div>
                    <h3 className='text-lg font-semibold mt-4'>{emptyState.title}</h3>
                    <p className='text-sm text-muted-foreground mt-1.5 max-w-sm'>
                      {emptyState.description}
                    </p>
                    <Button className='mt-4' asChild>
                      <Link href='/courses'>Browse Courses</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </div>
    </StudentLayout>
  );
}
