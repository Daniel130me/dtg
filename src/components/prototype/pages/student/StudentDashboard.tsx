'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Award, BookOpen, Clock, LogIn, PlayCircle, Trophy } from 'lucide-react';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { authClient } from '@/lib/client/auth-client';
import { ApiClientError } from '@/lib/client/api-client';
import { formatDuration } from '@/lib/client/format';
import { fetchLearnerDashboard } from '@/features/learning/api';
import { fetchMyCertificates } from '@/features/learning/certificates-api';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import {
  CONTINUE_LEARNING_LIMIT,
  type ContinueLearningCardDto,
  type LearnerDashboardDto,
} from '@/contracts/learning';
import type { MyCertificatesDto } from '@/contracts/certificates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

// --- Motion presets (carried over from the prototype dashboard) -------------

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

// --- Display maps (same palette as CourseCard / MyLearningPage) --------------

/**
 * Gradient placeholders for the thumbnail fallback. The continue-learning DTO
 * carries the category display NAME (not the slug), so this map is keyed by
 * name; the values mirror the categoryGradients map on MyLearningPage and
 * unknown categories fall back to the default.
 */
const categoryGradients: Record<string, string> = {
  'Web Development': 'from-[#1d4ed8] to-[#0a1a3e]',
  'Data Science': 'from-[#2563eb] to-[#0f2847]',
  'Mobile Development': 'from-[#3b82f6] to-[#1e3a8a]',
  'DevOps & Cloud': 'from-[#0f2847] to-[#0a1a3e]',
  'Design & UI/UX': 'from-[#4338ca] to-[#0a1a3e]',
};

const DEFAULT_GRADIENT = 'from-[#1d4ed8] to-[#0a1a3e]';

/** The stats row always shows these four cards; the skeleton mirrors them. */
const STAT_CARD_COUNT = 4;

/** Same initials rule as CourseCard/MyLearningPage: first letters of the first two meaningful words. */
function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => !['for', 'and', 'with', 'the', 'to', 'in', 'of', 'a', 'an'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// --- Error shape -------------------------------------------------------------

interface DashboardError {
  message: string;
  /** 401 gets its own "Session expired" panel with a sign-in link. */
  sessionExpired: boolean;
}

// --- Skeletons ---------------------------------------------------------------

/** Mirrors a stats card so the row keeps its height while loading. */
function StatCardSkeleton() {
  return (
    <Card className='p-4'>
      <div className='flex items-start justify-between'>
        <div className='space-y-2'>
          <Skeleton className='h-3.5 w-20' />
          <Skeleton className='h-7 w-12' />
        </div>
        <Skeleton className='size-10 rounded-xl' />
      </div>
    </Card>
  );
}

/** Mirrors a continue-learning card so the rail keeps its height while loading. */
function ContinueCardSkeleton() {
  return (
    <Card className='overflow-hidden p-0 gap-0'>
      <Skeleton className='h-28 w-full rounded-b-none' />
      <div className='p-4 flex flex-col gap-3'>
        <Skeleton className='h-3 w-24' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-1.5 w-full' />
        <Skeleton className='h-3 w-3/4' />
      </div>
    </Card>
  );
}

// --- Continue-learning card --------------------------------------------------

interface ContinueLearningCardProps {
  card: ContinueLearningCardDto;
  index: number;
}

/**
 * One "continue learning" card. With a next lesson the whole card deep-links
 * into the classroom at that course; a finished course links back to its
 * public page for a re-watch/review.
 */
function ContinueLearningCard({ card, index }: ContinueLearningCardProps) {
  const gradient = categoryGradients[card.categoryName] ?? DEFAULT_GRADIENT;
  const href = card.nextLesson ? `/learning/${card.courseSlug}` : `/courses/${card.courseSlug}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), duration: 0.3 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      <Link
        href={href}
        className='block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      >
        <Card className='group h-full cursor-pointer overflow-hidden p-0 gap-0 transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5'>
          {/* Thumbnail / gradient fallback */}
          <div className={`relative h-28 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            {card.thumbnailUrl ? (
              <img
                src={card.thumbnailUrl}
                alt={card.courseTitle}
                className='absolute inset-0 size-full object-cover'
              />
            ) : (
              <>
                <div className='absolute inset-0 bg-black/10' />
                <span className='relative z-10 text-white/60 text-xs font-semibold tracking-wider uppercase'>
                  {getInitials(card.courseTitle)}
                </span>
              </>
            )}
          </div>

          {/* Content */}
          <CardContent className='p-4 flex flex-col gap-3'>
            <p className='text-xs font-medium text-primary uppercase tracking-wide'>{card.categoryName}</p>
            <h3 className='font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors'>
              {card.courseTitle}
            </h3>

            <div className='flex flex-col gap-1.5'>
              <div className='flex items-center gap-2'>
                <Progress value={card.progressPercent} className='h-1.5 flex-1' />
                <span className='text-xs font-medium text-muted-foreground shrink-0'>
                  {card.completedLessons}/{card.totalLessons} lessons
                </span>
              </div>
              <p className='text-xs text-muted-foreground truncate'>
                {card.nextLesson ? (
                  <>
                    Up next: <span className='font-medium text-foreground'>{card.nextLesson.title}</span>
                  </>
                ) : (
                  <span className='font-medium text-primary'>Course complete 🎉</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

// --- Page --------------------------------------------------------------------

export default function StudentDashboard() {
  // Session is only used for the greeting; auth itself is guaranteed by the
  // /dashboard route guard (unauthenticated -> /login, owner -> /owner).
  const { data: session } = authClient.useSession();
  const firstName = session?.user.name ? session.user.name.trim().split(/\s+/)[0] : null;

  const [dashboard, setDashboard] = useState<LearnerDashboardDto | null>(null);
  const [error, setError] = useState<DashboardError | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Loading is DERIVED from the request key (see CoursesPage/MyLearningPage)
  // so effects never call setState synchronously; all state writes happen in
  // async callbacks.
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const requestKey = retrySeed;
  const loading = loadedKey !== requestKey;
  // Secondary certificates read (issued + claimable) for the dashboard card.
  const [certificates, setCertificates] = useState<MyCertificatesDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLearnerDashboard()
      .then((data) => {
        if (cancelled) return;
        setDashboard(data);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDashboard(null);
        setError({
          message: err instanceof Error ? err.message : 'Failed to load your dashboard.',
          sessionExpired: err instanceof ApiClientError && err.status === 401,
        });
        setLoadedKey(requestKey);
      });
    // Certificates summary is a secondary read: its failure must never break
    // the dashboard, so it resolves silently and the card simply stays hidden.
    fetchMyCertificates()
      .then((data) => {
        if (!cancelled) setCertificates(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  // Stats row values (derived; absent while loading/error).
  const stats = dashboard
    ? [
        {
          label: 'Enrolled Courses',
          value: String(dashboard.stats.enrolledCourses),
          icon: <BookOpen className='size-5' />,
          color: 'bg-primary/10 text-primary',
        },
        {
          label: 'Completed',
          value: String(dashboard.stats.completedCourses),
          icon: <Trophy className='size-5' />,
          color: 'bg-amber-500/10 text-amber-600',
        },
        {
          label: 'Lessons Completed',
          value: String(dashboard.stats.lessonsCompleted),
          icon: <PlayCircle className='size-5' />,
          color: 'bg-rose-500/10 text-rose-500',
        },
        {
          label: 'Time Completed',
          value: formatDuration(dashboard.stats.minutesCompleted),
          icon: <Clock className='size-5' />,
          color: 'bg-emerald-500/10 text-emerald-600',
        },
      ]
    : [];

  const cards = dashboard?.continueLearning ?? [];
  const hasEnrolments = (dashboard?.stats.enrolledCourses ?? 0) > 0;

  return (
    <StudentLayout>
      <div className='max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Welcome Banner */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#0a1a3e] p-6 sm:p-8 text-white'
        >
          <div className='absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2' />
          <div className='absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2' />
          <div className='relative z-10'>
            {firstName && <p className='text-sm font-medium text-white/80'>Welcome back,</p>}
            <h1 className='text-2xl sm:text-3xl font-bold mt-1'>
              {firstName ? `${firstName} 👋` : 'Welcome back'}
            </h1>
            <p className='text-white/80 mt-2 max-w-lg text-sm sm:text-base'>
              You&apos;re making great progress! Continue where you left off or explore new courses.
            </p>
            <div className='mt-4 flex flex-wrap gap-3'>
              <Button
                variant='secondary'
                className='bg-white/20 hover:bg-white/30 text-white border-0'
                asChild
              >
                <Link href='/learning'>
                  Continue Learning
                  <ArrowRight className='size-4 ml-1.5' />
                </Link>
              </Button>
              <Button
                variant='outline'
                className='border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white'
                asChild
              >
                <Link href='/courses'>Browse Courses</Link>
              </Button>
            </div>
          </div>
        </motion.div>

        {loading ? (
          /* Skeleton layout mirrors the final stats row + continue-learning rail */
          <>
            <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
              {Array.from({ length: STAT_CARD_COUNT }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
            <Card>
              <CardHeader className='pb-3'>
                <Skeleton className='h-5 w-44' />
              </CardHeader>
              <CardContent>
                <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6'>
                  {Array.from({ length: CONTINUE_LEARNING_LIMIT }).map((_, i) => (
                    <ContinueCardSkeleton key={i} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : error ? (
          error.sessionExpired ? (
            /* 401 — the route guard redirects on hard navigation; this panel
               covers an expired session while the dashboard is already open. */
            <div className='text-center py-16'>
              <div className='size-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4'>
                <LogIn className='size-7 text-amber-600' />
              </div>
              <h3 className='font-semibold text-lg mb-1'>Session expired</h3>
              <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>
                Your session has expired. Sign in again to pick up where you left off.
              </p>
              <Button asChild>
                <Link href='/login'>Sign in</Link>
              </Button>
            </div>
          ) : (
            <FetchErrorState
              title="Couldn't load your dashboard"
              message={error.message}
              onRetry={() => setRetrySeed((s) => s + 1)}
            />
          )
        ) : dashboard ? (
          <>
            {/* Stats Cards */}
            <motion.div
              variants={container}
              initial='hidden'
              animate='show'
              className='grid grid-cols-2 lg:grid-cols-4 gap-4'
            >
              {stats.map((stat) => (
                <motion.div key={stat.label} variants={item}>
                  <Card className='p-4 hover:shadow-md transition-shadow'>
                    <div className='flex items-start justify-between'>
                      <div>
                        <p className='text-sm text-muted-foreground'>{stat.label}</p>
                        <p className='text-2xl font-bold mt-1'>{stat.value}</p>
                      </div>
                      <div className={`size-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                        {stat.icon}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </motion.div>

            {/* Certificates summary card (hidden until there is something to show) */}
            {certificates &&
              (certificates.certificates.length > 0 || certificates.eligibleCourses.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.35 }}
                >
                  <Card className='border-amber-200 bg-gradient-to-r from-amber-50 to-transparent dark:border-amber-900 dark:from-amber-950/40 py-0'>
                    <CardContent className='flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5'>
                      <div className='size-11 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0'>
                        <Award className='size-5' />
                      </div>
                      <div className='flex-1 min-w-0'>
                        <p className='font-semibold text-sm'>
                          {certificates.eligibleCourses.length > 0
                            ? `You can claim ${certificates.eligibleCourses.length} certificate${
                                certificates.eligibleCourses.length > 1 ? 's' : ''
                              }`
                            : 'Your certificates'}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {certificates.certificates.length > 0 &&
                            `${certificates.certificates.length} earned`}
                          {certificates.certificates.length > 0 &&
                            certificates.eligibleCourses.length > 0 &&
                            ' · '}
                          {certificates.eligibleCourses.length > 0 &&
                            `${certificates.eligibleCourses.length} ready to claim`}
                        </p>
                      </div>
                      <Button size='sm' className='shrink-0' asChild>
                        <Link href='/certificates'>
                          <Award className='size-4 mr-1.5' />
                          View certificates
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

            {/* Continue Learning rail */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
            >
              <Card>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <CardTitle className='text-lg font-semibold flex items-center gap-2'>
                      <PlayCircle className='size-5 text-primary' />
                      Continue Learning
                    </CardTitle>
                    {hasEnrolments && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-xs text-muted-foreground'
                        asChild
                      >
                        <Link href='/learning'>
                          View All
                          <ArrowRight className='size-3.5 ml-1' />
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {cards.length > 0 ? (
                    <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6'>
                      {cards.map((card, index) => (
                        <ContinueLearningCard key={card.courseId} card={card} index={index} />
                      ))}
                    </div>
                  ) : hasEnrolments ? (
                    /* Enrolled somewhere, but nothing mid-progress to continue */
                    <div className='text-center py-8'>
                      <BookOpen className='size-10 text-muted-foreground/50 mx-auto' />
                      <p className='text-sm text-muted-foreground mt-2'>
                        Pick a course from My Learning to continue
                      </p>
                      <Button variant='outline' size='sm' className='mt-3' asChild>
                        <Link href='/learning'>Go to My Learning</Link>
                      </Button>
                    </div>
                  ) : (
                    /* Nothing enrolled yet */
                    <div className='text-center py-8'>
                      <BookOpen className='size-10 text-muted-foreground/50 mx-auto' />
                      <p className='text-sm text-muted-foreground mt-2'>
                        No courses yet. Find something great to learn!
                      </p>
                      <Button size='sm' className='mt-3' asChild>
                        <Link href='/courses'>Browse Courses</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </>
        ) : null}
      </div>
    </StudentLayout>
  );
}
