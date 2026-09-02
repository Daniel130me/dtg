'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import InstructorLayout from './InstructorLayout';
import GradingDetailDialog from './grading-detail-dialog';
import { SUBMISSION_STATUS_BADGES, SUBMISSION_STATUS_LABELS } from './grading-status';
import { fetchGradingQueue } from '@/features/owner/assessments-api';
import { listOwnerCourses } from '@/features/owner/api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import type { GradingQueueItemDto } from '@/contracts/assessments';
import { SUBMISSION_STATUSES, type SubmissionStatusValue } from '@/contracts/assessments';
import type { OwnerCourseListItemDto } from '@/contracts/owner-courses';

// Owner grading queue: assignment submissions awaiting (or holding) a grade,
// filterable by course and status, with a detail + grading dialog per row.

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const STATUS_FILTER_VALUES = ['ALL', ...SUBMISSION_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const ALL_COURSES = 'ALL';

/** One bounded page of courses is enough for the filter dropdown in practice. */
const COURSE_FILTER_PAGE_LIMIT = 100;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function QueueSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function GradingQueuePage() {
  // Course filter options (single bounded load).
  const [courses, setCourses] = useState<OwnerCourseListItemDto[]>([]);

  // Queue state.
  const [items, setItems] = useState<GradingQueueItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [courseFilter, setCourseFilter] = useState<string>(ALL_COURSES);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Request-key pattern: loading is DERIVED, every setState lives in async
  // callbacks or event handlers (react-hooks/set-state-in-effect).
  const requestKey = `${courseFilter}|${statusFilter}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detailSubmissionId, setDetailSubmissionId] = useState<string | null>(null);

  // Course options for the filter Select.
  useEffect(() => {
    let cancelled = false;
    listOwnerCourses({ limit: COURSE_FILTER_PAGE_LIMIT })
      .then((page) => {
        if (cancelled) return;
        setCourses(page.items);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Non-fatal: the queue still works with the "All courses" default.
        showActionErrorToast(error, 'Could not load the course filter options.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Queue page 1 for the current filters.
  useEffect(() => {
    let cancelled = false;
    fetchGradingQueue({
      courseId: courseFilter === ALL_COURSES ? undefined : courseFilter,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total);
        setLoadError(null);
        setLoadedKey(requestKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the grading queue.',
        );
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
      const page = await fetchGradingQueue(buildQueueQuery(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more submissions.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  // After a grade is recorded the whole queue refetches (page 1 of the current
  // filters). That is the simplest way to keep the touched row's status/score
  // honest; cursor state resets with it, which is acceptable at this scale.
  const handleGraded = () => {
    setReloadToken((token) => token + 1);
  };

  const buildQueueQuery = (cursor?: string) => ({
    courseId: courseFilter === ALL_COURSES ? undefined : courseFilter,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    cursor,
  });

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-6xl mx-auto space-y-6"
        >
          {/* Header */}
          <motion.div variants={item} className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <ClipboardCheck className="size-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Grading</h1>
              <p className="text-muted-foreground mt-1">
                {loading
                  ? 'Assignment submissions from your students'
                  : `${total} ${total === 1 ? 'submission' : 'submissions'} in view`}
              </p>
            </div>
          </motion.div>

          {/* Filters */}
          <motion.div variants={item} className="flex flex-col sm:flex-row gap-3">
            <Select value={courseFilter} onValueChange={setCourseFilter}>
              <SelectTrigger className="w-full sm:w-64" aria-label="Filter by course">
                <SelectValue placeholder="All courses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COURSES}>All courses</SelectItem>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === 'ALL'
                      ? 'All statuses'
                      : SUBMISSION_STATUS_LABELS[status as SubmissionStatusValue]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          {/* Queue */}
          <motion.div variants={item}>
            {loading ? (
              <QueueSkeleton />
            ) : loadError ? (
              <div className="text-center py-16">
                <div className="size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                  <ClipboardCheck className="size-7 text-destructive" />
                </div>
                <h3 className="font-semibold text-lg mb-1">Could not load the grading queue</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{loadError}</p>
                <Button variant="outline" onClick={handleRetry} className="gap-1.5">
                  <RefreshCw className="size-4" /> Try Again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className="py-14 text-center">
                  <div className="size-14 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
                    <ClipboardCheck className="size-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold mb-1">Nothing waiting for grading</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Assignment submissions appear here the moment students hand them in. Adjust the
                    filters above if you expected something specific.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Submissions</CardTitle>
                  <CardDescription>
                    Open a row to read the submission and record a grade.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto custom-scrollbar">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Lesson</TableHead>
                          <TableHead className="hidden md:table-cell">Course</TableHead>
                          <TableHead className="hidden sm:table-cell text-right">Attempt</TableHead>
                          <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                          <TableHead className="text-right">Score</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-8" aria-label="Open" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((entry) => (
                          <TableRow
                            key={entry.id}
                            className="cursor-pointer"
                            tabIndex={0}
                            aria-label={`Open submission from ${entry.student.name} on ${entry.lessonTitle}`}
                            onClick={() => setDetailSubmissionId(entry.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setDetailSubmissionId(entry.id);
                              }
                            }}
                          >
                            <TableCell>
                              <p className="text-sm font-medium">{entry.student.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.student.email}</p>
                            </TableCell>
                            <TableCell className="text-sm max-w-40">
                              <p className="truncate">{entry.lessonTitle}</p>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-40">
                              <p className="truncate">{entry.courseTitle}</p>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground text-right">
                              #{entry.attemptNumber}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {formatDate(entry.submittedAt)}
                            </TableCell>
                            <TableCell className="text-sm text-right tabular-nums">
                              {entry.latestScore === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                `${entry.latestScore}/${entry.maxPoints}`
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={SUBMISSION_STATUS_BADGES[entry.status].className}>
                                {SUBMISSION_STATUS_BADGES[entry.status].label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile card list — each card opens the grading sheet */}
                  <div className="md:hidden space-y-3">
                    {items.map((entry) => (
                      <div
                        key={entry.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open submission from ${entry.student.name} on ${entry.lessonTitle}`}
                        onClick={() => setDetailSubmissionId(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setDetailSubmissionId(entry.id);
                          }
                        }}
                        className="w-full text-left rounded-xl border bg-card p-4 space-y-3 cursor-pointer transition-colors hover:bg-muted/30 active:bg-muted/50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{entry.student.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{entry.student.email}</p>
                          </div>
                          <Badge className={SUBMISSION_STATUS_BADGES[entry.status].className}>
                            {SUBMISSION_STATUS_BADGES[entry.status].label}
                          </Badge>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{entry.lessonTitle}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.courseTitle}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            Attempt #{entry.attemptNumber} · {formatDate(entry.submittedAt)}
                          </span>
                          <span className="text-sm font-medium tabular-nums text-foreground">
                            {entry.latestScore === null ? '—' : `${entry.latestScore}/${entry.maxPoints}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {nextCursor && (
                    <div className="flex justify-center pt-4">
                      <Button variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
                        {loadingMore && <Loader2 className="size-4 mr-2 animate-spin" />}
                        Load more
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </motion.div>

          <div className="h-8" />
        </motion.div>
      </div>

      {/* Detail + grading dialog. Mounted only while open so its form state
          starts fresh per submission. */}
      {detailSubmissionId && (
        <GradingDetailDialog
          submissionId={detailSubmissionId}
          onClose={() => setDetailSubmissionId(null)}
          onGraded={handleGraded}
        />
      )}
    </InstructorLayout>
  );
}
