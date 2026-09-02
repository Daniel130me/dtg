'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  Banknote,
  BookOpen,
  ClipboardCheck,
  RefreshCw,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import InstructorLayout from './InstructorLayout';
import { useNav } from '@/lib/prototype/navigation';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { formatCount } from '@/lib/client/format';
import { ApiClientError } from '@/lib/client/api-client';
import { formatAxisMoney, formatMoney, getOwnerAnalytics } from '@/features/owner/analytics-api';
import type {
  AnalyticsActivityKind,
  AnalyticsCourseRowDto,
  OwnerAnalyticsDto,
} from '@/contracts/analytics';

// Owner dashboard, driven entirely by GET /api/v1/owner/analytics (the
// cached read model defined by docs/ANALYTICS_METRICS.md). Every number on
// the page comes from that payload — the mock's fabricated "+12.5%" delta
// chips are gone because no historical-delta metric exists; cards carry
// honest subtext instead. Loading/error follow the house request-key
// pattern (see ReviewsModerationPage / GradingQueuePage).

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
};

/** Course status -> Badge presentation (teal/emerald + muted brand palette). */
const COURSE_STATUS_BADGES: Record<AnalyticsCourseRowDto['status'], { label: string; className: string }> = {
  PUBLISHED: { label: 'Published', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground border-border' },
  ARCHIVED: { label: 'Archived', className: 'bg-muted text-muted-foreground border-border' },
};

/** Activity kind -> icon chip, mirroring the mock's muted circular chips. */
const ACTIVITY_ICONS: Record<AnalyticsActivityKind, React.ReactNode> = {
  ENROLMENT: <UserPlus className="size-4 text-primary" />,
  REVIEW: <Star className="size-4 text-amber-500" />,
  SUBMISSION: <ClipboardCheck className="size-4 text-emerald-600 dark:text-emerald-400" />,
  CERTIFICATE: <Award className="size-4 text-amber-500" />,
};

/** "just now" / "5m ago" / "2h ago" / "3d ago", then a short date fallback. */
function timeAgo(iso: string): string {
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

/** Server freshnessSeconds -> "0s ago" / "45s ago" / "2m ago". */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

interface StatCardProps {
  label: string;
  value: string;
  subtext: string;
  icon: React.ReactNode;
  iconClass: string;
}

function StatCard({ label, value, subtext, icon, iconClass }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold mt-1 truncate">{value}</p>
            <p className="text-xs text-muted-foreground mt-2">{subtext}</p>
          </div>
          <div className={`p-2.5 rounded-lg shrink-0 ${iconClass}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-5 space-y-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardContent className="p-6">
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function InstructorDashboard() {
  const { userName } = useNav();

  // Dashboard payload with the house request-key pattern (loading is
  // DERIVED; every setState lives in async callbacks or event handlers).
  const [analytics, setAnalytics] = useState<OwnerAnalyticsDto | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const loading = loadedKey !== reloadToken;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOwnerAnalytics()
      .then((payload) => {
        if (cancelled) return;
        setAnalytics(payload);
        setLoadError(null);
        setLoadedKey(reloadToken);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the dashboard.',
        );
        setLoadedKey(reloadToken);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleRefresh = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const trendData =
    analytics?.trend.map((point) => ({
      label: point.label,
      enrolments: point.enrolments,
      revenueMinor: point.revenueMinor,
    })) ?? [];

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Keying the container to its branch replays the stagger when the
            data sections mount late (post-fetch) — variant orchestration does
            not reach children that subscribe after the initial wave. */}
        <motion.div
          key={loading ? 'skeleton' : loadError || !analytics ? 'error' : 'content'}
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-7xl mx-auto space-y-6"
        >
          {/* Welcome + freshness line */}
          <motion.div variants={item} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">
                Welcome back{userName ? `, ${userName.split(' ')[0]}` : ''}!
              </h1>
              <p className="text-muted-foreground mt-1">
                Here&apos;s what&apos;s happening with your courses today.
              </p>
            </div>
            {analytics && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  Data as of{' '}
                  <span className="font-medium text-foreground/80">
                    {new Date(analytics.generatedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>{' '}
                  · updated {formatAge(analytics.freshnessSeconds)}
                </p>
                {analytics.cached && <Badge variant="secondary" className="text-xs">cached</Badge>}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleRefresh}
                  disabled={loading}
                  aria-label="Refresh analytics data"
                >
                  <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                  Refresh
                </Button>
              </div>
            )}
          </motion.div>

          {loading ? (
            <motion.div variants={item}>
              <DashboardSkeleton />
            </motion.div>
          ) : loadError || !analytics ? (
            <motion.div variants={item}>
              <FetchErrorState
                title="Could not load the dashboard"
                message={loadError ?? undefined}
                onRetry={handleRefresh}
              />
            </motion.div>
          ) : (
            <>
              {/* Stats Cards — honest subtext, no fabricated deltas */}
              <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Total Students"
                  value={formatCount(analytics.totals.learners)}
                  subtext={`across ${formatCount(analytics.totals.totalEnrolments)} enrolments`}
                  icon={<Users className="size-5" />}
                  iconClass="bg-primary/10 text-primary"
                />
                <StatCard
                  label="Active Courses"
                  value={formatCount(analytics.totals.activeCourses)}
                  subtext="courses currently published"
                  icon={<BookOpen className="size-5" />}
                  iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                />
                <StatCard
                  label="Net Revenue"
                  value={formatMoney(analytics.totals.netRevenueMinor, analytics.totals.currency)}
                  subtext={`primary currency ${analytics.totals.currency}`}
                  icon={<Banknote className="size-5" />}
                  iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                />
                <StatCard
                  label="Avg Rating"
                  value={analytics.totals.avgRating === null ? '—' : analytics.totals.avgRating.toFixed(2)}
                  subtext={`${formatCount(analytics.totals.ratingCount)} visible ${analytics.totals.ratingCount === 1 ? 'review' : 'reviews'}`}
                  icon={<Star className="size-5" />}
                  iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                />
              </motion.div>

              {/* Trend: enrolments (area, primary) + revenue (line, amber, right axis) */}
              <motion.div variants={item}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base font-semibold">Enrollment Trends</CardTitle>
                      <Badge variant="secondary" className="text-xs">Last 6 Months</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-[280px] sm:h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trendData} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
                          <defs>
                            <linearGradient id="enrolmentGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            yAxisId="enrolments"
                            allowDecimals={false}
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={40}
                          />
                          <YAxis
                            yAxisId="revenue"
                            orientation="right"
                            tickFormatter={(value) => formatAxisMoney(Number(value), analytics.totals.currency)}
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={56}
                          />
                          <Tooltip
                            contentStyle={CHART_TOOLTIP_STYLE}
                            formatter={(value, name) => {
                              if (name === 'Revenue') {
                                return [formatMoney(Number(value), analytics.totals.currency), String(name)];
                              }
                              return [formatCount(Number(value)), String(name)];
                            }}
                          />
                          <Area
                            yAxisId="enrolments"
                            type="monotone"
                            dataKey="enrolments"
                            name="Enrolments"
                            stroke="var(--primary)"
                            strokeWidth={2.5}
                            fill="url(#enrolmentGradient)"
                            dot={{ fill: 'var(--primary)', strokeWidth: 2, r: 3 }}
                            activeDot={{ r: 5, strokeWidth: 0 }}
                          />
                          <Line
                            yAxisId="revenue"
                            type="monotone"
                            dataKey="revenueMinor"
                            name="Revenue"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Bottom Row: Table + Activity */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Course Performance Table */}
                <motion.div variants={item} className="xl:col-span-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold">Course Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {analytics.courses.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                          No enrolments yet — course performance appears once learners enrol.
                        </p>
                      ) : (
                        <>
                          {/* Desktop table */}
                          <div className="hidden md:block overflow-x-auto max-h-[380px] overflow-y-auto custom-scrollbar">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Course Name</TableHead>
                                <TableHead className="text-xs text-right">Enrollments</TableHead>
                                <TableHead className="text-xs text-right">Completion Rate</TableHead>
                                <TableHead className="text-xs text-right">Rating</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analytics.courses.map((course) => (
                                <TableRow key={course.courseId}>
                                  <TableCell>
                                    <div className="min-w-0">
                                      <p className="font-medium text-sm truncate max-w-[220px]">{course.title}</p>
                                      <Badge
                                        variant="outline"
                                        className={`mt-1 text-[11px] font-normal ${COURSE_STATUS_BADGES[course.status].className}`}
                                      >
                                        {COURSE_STATUS_BADGES[course.status].label}
                                      </Badge>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right text-sm">{formatCount(course.enrolments)}</TableCell>
                                  <TableCell className="text-right text-sm">
                                    {course.completionRate === null ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : (
                                      <Badge variant="secondary" className="font-mono text-xs">
                                        {course.completionRate}%
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                                      <span className="text-sm font-medium">
                                        {course.ratingAverage === null ? '—' : course.ratingAverage.toFixed(2)}
                                      </span>
                                      <span className="text-xs text-muted-foreground">({course.ratingCount})</span>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          </div>

                          {/* Mobile cards — course title + key numbers */}
                          <div className="md:hidden space-y-3">
                            {analytics.courses.map((course) => (
                              <div key={course.courseId} className="rounded-xl border p-4 space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium leading-snug min-w-0">{course.title}</p>
                                  <Badge
                                    variant="outline"
                                    className={`shrink-0 text-[11px] font-normal ${COURSE_STATUS_BADGES[course.status].className}`}
                                  >
                                    {COURSE_STATUS_BADGES[course.status].label}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Enrolled</p>
                                    <p className="text-sm font-medium">{formatCount(course.enrolments)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Completion</p>
                                    <p className="text-sm font-medium">
                                      {course.completionRate === null ? '—' : `${course.completionRate}%`}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rating</p>
                                    <p className="text-sm font-medium flex items-center justify-end gap-1">
                                      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                                      {course.ratingAverage === null ? '—' : course.ratingAverage.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Recent Activity */}
                <motion.div variants={item}>
                  <Card className="h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {analytics.recentActivity.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
                      ) : (
                        <div className="space-y-4">
                          {analytics.recentActivity.map((activity) => (
                            <div key={activity.id} className="flex items-start gap-3">
                              <div className="mt-0.5 p-1.5 rounded-full bg-muted shrink-0">
                                {ACTIVITY_ICONS[activity.kind]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">
                                  <span className="font-medium">{activity.actorName}</span>{' '}
                                  <span className="text-muted-foreground">{activity.summary}</span>
                                </p>
                                {activity.courseTitle && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{activity.courseTitle}</p>
                                )}
                                <p className="text-xs text-muted-foreground/70 mt-0.5">{timeAgo(activity.occurredAt)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            </>
          )}

          <div className="h-8" />
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
