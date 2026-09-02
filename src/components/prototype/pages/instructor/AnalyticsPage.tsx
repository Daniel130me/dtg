'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  DollarSign,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trophy,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import InstructorLayout from './InstructorLayout';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import { formatCount } from '@/lib/client/format';
import {
  createOwnerExport,
  downloadOwnerExportCsv,
  formatAxisMoney,
  formatMoney,
  getOwnerAnalytics,
  listOwnerExports,
} from '@/features/owner/analytics-api';
import type { OwnerAnalyticsDto } from '@/contracts/analytics';
import { EXPORT_TTL_HOURS, EXPORT_EXPIRED } from '@/contracts/owner-ops';
import type { ExportJobDto, ExportTypeValue } from '@/contracts/owner-ops';

// Owner analytics page, driven entirely by GET /api/v1/owner/analytics plus
// the Phase 11 export jobs API. Every number comes from the API; rates that
// are null (no in-scope enrolments) render as "—" with an explicit empty
// hint instead of a fabricated chart. The exports panel lists the owner's
// job history with per-job download/retry actions.

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
};

const EXPORT_TYPE_LABELS: Record<ExportTypeValue, string> = {
  ENROLMENTS: 'Enrolments',
  STUDENTS: 'Students',
};

/** Export status -> Badge presentation (COMPLETED is the success-ish green). */
const EXPORT_STATUS_BADGES: Record<ExportJobDto['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  COMPLETED: { label: 'Completed', variant: 'outline', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  EXPIRED: { label: 'Expired', variant: 'secondary' },
  PENDING: { label: 'Pending', variant: 'outline', className: 'text-muted-foreground' },
  PROCESSING: { label: 'Processing', variant: 'outline', className: 'text-muted-foreground' },
};

/** Server freshnessSeconds -> "0s ago" / "45s ago" / "2m ago". */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/** "29 Aug 2026, 2:15 PM" for export job timestamps. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardContent className="p-6">
            <Skeleton className="h-[280px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-[220px] w-full" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function ExportsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  // ---- Analytics payload (request-key pattern, see ReviewsModerationPage)
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
            : 'Something went wrong while loading the analytics.',
        );
        setLoadedKey(reloadToken);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // ---- Export jobs history ----------------------------------------------
  const [jobs, setJobs] = useState<ExportJobDto[]>([]);
  const [jobsReloadToken, setJobsReloadToken] = useState(0);
  const [jobsLoadedKey, setJobsLoadedKey] = useState<number | null>(null);
  const jobsLoading = jobsLoadedKey !== jobsReloadToken;
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<ExportTypeValue>('ENROLMENTS');
  const [requesting, setRequesting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Refresh covers both surfaces (the export list runs the piggyback
  // expiry sweep on the server, so its freshness matters too).
  const handleRefresh = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
    setJobsReloadToken((token) => token + 1);
  };

  useEffect(() => {
    let cancelled = false;
    listOwnerExports()
      .then((page) => {
        if (cancelled) return;
        setJobs(page.items);
        setJobsError(null);
        setJobsLoadedKey(jobsReloadToken);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setJobsError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the exports.',
        );
        setJobsLoadedKey(jobsReloadToken);
      });
    return () => {
      cancelled = true;
    };
  }, [jobsReloadToken]);

  /** Creates a job (processed inline) and prepends the returned record. */
  const handleRequestExport = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const job = await createOwnerExport(requestType);
      setJobs((current) => [job, ...current]);
      if (job.status === 'COMPLETED') {
        toast.success(`Export ready — ${formatCount(job.rowCount)} ${job.rowCount === 1 ? 'row' : 'rows'}`);
      } else if (job.status === 'FAILED') {
        toast.error('The export failed to process.', { description: job.error ?? undefined });
      } else {
        toast.info('The export is still processing — it will appear in the list when it finishes.');
      }
    } catch (error) {
      showActionErrorToast(error, 'Could not create the export.');
    } finally {
      setRequesting(false);
    }
  };

  const handleDownload = async (job: ExportJobDto) => {
    if (downloadingId) return;
    setDownloadingId(job.id);
    try {
      await downloadOwnerExportCsv(job);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === EXPORT_EXPIRED) {
        toast.error('This export has expired and is no longer downloadable.');
        setJobsReloadToken((token) => token + 1); // list refresh flips + purges it
      } else {
        showActionErrorToast(error, 'Could not download the export.');
      }
    } finally {
      setDownloadingId(null);
    }
  };

  /** Re-requests the same export type after a FAILED job. */
  const handleRetryExport = async (job: ExportJobDto) => {
    if (retryingId) return;
    setRetryingId(job.id);
    try {
      const next = await createOwnerExport(job.type);
      setJobs((current) => [next, ...current]);
      if (next.status === 'COMPLETED') {
        toast.success(`Export ready — ${formatCount(next.rowCount)} ${next.rowCount === 1 ? 'row' : 'rows'}`);
      } else if (next.status === 'FAILED') {
        toast.error('The export failed to process.', { description: next.error ?? undefined });
      }
    } catch (error) {
      showActionErrorToast(error, 'Could not retry the export.');
    } finally {
      setRetryingId(null);
    }
  };

  const totals = analytics?.totals;
  const trendData =
    analytics?.trend.map((point) => ({
      label: point.label,
      enrolments: point.enrolments,
    })) ?? [];
  const revenueData =
    analytics?.courses.map((course) => ({
      name: course.title,
      revenueMinor: course.revenueMinor,
    })) ?? [];
  const completionRate = totals?.completionRate ?? null;
  const completionData =
    completionRate === null
      ? []
      : [
          { name: 'Completed', value: completionRate },
          { name: 'In progress', value: 100 - completionRate },
        ];

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Branch key: replay the stagger when post-fetch sections mount late
            (variant orchestration does not reach late subscribers). */}
        <motion.div
          key={loading ? 'skeleton' : loadError || !analytics ? 'error' : 'content'}
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-7xl mx-auto space-y-6"
        >
          {/* Header + freshness footer */}
          <motion.div variants={item} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Analytics</h1>
              <p className="text-muted-foreground mt-1">
                Track your courses&apos; performance and student engagement.
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
                title="Could not load the analytics"
                message={loadError ?? undefined}
                onRetry={handleRefresh}
              />
            </motion.div>
          ) : (
            <>
              {/* Overview Stats */}
              <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground font-medium">Total Students</p>
                        <p className="text-2xl font-bold mt-1">{formatCount(analytics.totals.learners)}</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
                        <Users className="size-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground font-medium">Total Enrolments</p>
                        <p className="text-2xl font-bold mt-1">{formatCount(analytics.totals.totalEnrolments)}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatCount(analytics.totals.completedEnrolments)} completed
                        </p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
                        <BookOpen className="size-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground font-medium">Completion Rate</p>
                        <p className="text-2xl font-bold mt-1">{analytics.totals.completionRate === null ? '—' : `${analytics.totals.completionRate}%`}</p>
                        <p className="text-xs text-muted-foreground mt-2">of in-scope enrolments</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Trophy className="size-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground font-medium">Net Revenue</p>
                        <p className="text-2xl font-bold mt-1">{formatMoney(analytics.totals.netRevenueMinor, analytics.totals.currency)}</p>
                        <p className="text-xs text-muted-foreground mt-2">primary currency {analytics.totals.currency}</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                        <DollarSign className="size-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Enrolment Growth */}
                <motion.div variants={item} className="min-w-0 w-full xl:col-span-2">
                  <Card className="min-w-0 w-full overflow-hidden">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold">Enrolment Growth</CardTitle>
                        <Badge variant="secondary" className="text-xs">Last 6 Months</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 min-w-0 w-full">
                      <div className="h-[280px] sm:h-[300px] w-full min-w-0 overflow-hidden">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                            <defs>
                              <linearGradient id="analyticsEnrolmentGradient" x1="0" y1="0" x2="0" y2="1">
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
                              allowDecimals={false}
                              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              width={40}
                            />
                            <Tooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              formatter={(value) => [formatCount(Number(value)), 'Enrolments']}
                            />
                            <Area
                              type="monotone"
                              dataKey="enrolments"
                              name="Enrolments"
                              stroke="var(--primary)"
                              strokeWidth={2.5}
                              fill="url(#analyticsEnrolmentGradient)"
                              dot={{ fill: 'var(--primary)', strokeWidth: 2, r: 3 }}
                              activeDot={{ r: 5, strokeWidth: 0 }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Completion Donut (honest null state when there is no denominator) */}
                <motion.div variants={item} className="min-w-0 w-full">
                  <Card className="h-full min-w-0 w-full overflow-hidden">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">Completion Rate</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 min-w-0 w-full flex flex-col items-center justify-center">
                      {completionRate === null ? (
                        <div className="py-16 text-center">
                          <p className="text-4xl font-bold">—</p>
                          <p className="text-sm text-muted-foreground mt-2">No enrolments yet</p>
                        </div>
                      ) : (
                        <>
                          <div className="h-[200px] w-full min-w-0 overflow-hidden">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={completionData}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={58}
                                  outerRadius={82}
                                  paddingAngle={4}
                                  dataKey="value"
                                  startAngle={90}
                                  endAngle={-270}
                                >
                                  {completionData.map((entry, index) => (
                                    <Cell
                                      key={`cell-${index}`}
                                      fill={index === 0 ? 'var(--primary)' : 'var(--muted)'}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={CHART_TOOLTIP_STYLE}
                                  formatter={(value, name) => [`${value}%`, String(name)]}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="text-center -mt-4">
                            <p className="text-3xl font-bold">{completionRate}%</p>
                            <p className="text-sm text-muted-foreground">Average Completion</p>
                          </div>
                          <div className="flex items-center gap-4 mt-4 text-sm">
                            <div className="flex items-center gap-1.5">
                              <div className="size-3 rounded-full bg-primary" />
                              <span className="text-muted-foreground">Completed</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="size-3 rounded-full bg-muted" />
                              <span className="text-muted-foreground">In Progress</span>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </div>

              {/* Revenue by Course */}
              <motion.div variants={item} className="min-w-0 w-full">
                <Card className="min-w-0 w-full overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base font-semibold">Course Revenue</CardTitle>
                      <Badge variant="secondary" className="text-xs">Top {analytics.courses.length || 0} Courses</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 min-w-0 w-full">
                    {revenueData.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">
                        No enrolments yet — revenue appears once learners enrol.
                      </p>
                    ) : (
                      <div className="h-[280px] w-full min-w-0 overflow-hidden">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={revenueData} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                            <XAxis
                              type="number"
                              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                              tickFormatter={(value) => formatAxisMoney(Number(value), analytics.totals.currency)}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={140}
                              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                              tickFormatter={(value) =>
                                String(value).length > 18 ? `${String(value).slice(0, 18)}…` : String(value)
                              }
                            />
                            <Tooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              formatter={(value) => [formatMoney(Number(value), analytics.totals.currency), 'Revenue']}
                            />
                            <Bar dataKey="revenueMinor" fill="var(--primary)" radius={[0, 6, 6, 0]} barSize={28} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {/* Data Exports */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Data Exports</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      CSV snapshots of platform data. Files stay downloadable for {EXPORT_TTL_HOURS} hours.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Select value={requestType} onValueChange={(value) => setRequestType(value as ExportTypeValue)}>
                      <SelectTrigger className="w-full sm:w-44" aria-label="Export type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ENROLMENTS">Enrolments</SelectItem>
                        <SelectItem value="STUDENTS">Students</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={() => void handleRequestExport()} disabled={requesting} className="gap-1.5" aria-label="Request export">
                      {requesting ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Download className="size-4" aria-hidden />
                      )}
                      Request export
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {jobsLoading ? (
                  <ExportsSkeleton />
                ) : jobsError ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-destructive mb-4">{jobsError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setJobsReloadToken((token) => token + 1)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      Try again
                    </Button>
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="py-10 text-center">
                    <div className="size-12 mx-auto rounded-full bg-muted flex items-center justify-center mb-3">
                      <Download className="size-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">No exports yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Request an export above to download a CSV snapshot.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {jobs.map((job) => (
                      <li key={job.id} className="rounded-lg border p-3 sm:p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <Badge variant="outline" className="text-xs font-normal">
                              {EXPORT_TYPE_LABELS[job.type]}
                            </Badge>
                            <Badge
                              variant={EXPORT_STATUS_BADGES[job.status].variant}
                              className={EXPORT_STATUS_BADGES[job.status].className}
                            >
                              {EXPORT_STATUS_BADGES[job.status].label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {job.status === 'COMPLETED' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => void handleDownload(job)}
                                disabled={downloadingId !== null}
                                aria-label={`Download ${EXPORT_TYPE_LABELS[job.type]} export`}
                              >
                                {downloadingId === job.id ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                ) : (
                                  <Download className="size-4" aria-hidden />
                                )}
                              </Button>
                            )}
                            {job.status === 'FAILED' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => void handleRetryExport(job)}
                                disabled={retryingId !== null}
                                aria-label={`Retry ${EXPORT_TYPE_LABELS[job.type]} export`}
                              >
                                {retryingId === job.id ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                ) : (
                                  <RotateCcw className="size-4" aria-hidden />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatCount(job.rowCount)} {job.rowCount === 1 ? 'row' : 'rows'} · requested{' '}
                          {formatDateTime(job.createdAt)}
                          {job.completedAt ? ` · completed ${formatDateTime(job.completedAt)}` : ''} ·{' '}
                          {job.expiresAt ? `expires ${formatDateTime(job.expiresAt)}` : 'expired'} ·{' '}
                          {formatCount(job.downloadCount)} {job.downloadCount === 1 ? 'download' : 'downloads'}
                        </p>
                        {job.error && <p className="text-xs text-destructive">{job.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <div className="h-8" />
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
