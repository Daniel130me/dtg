'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Ban,
  Download,
  Eye,
  Loader2,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import InstructorLayout from './InstructorLayout';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import { formatCount } from '@/lib/client/format';
import {
  createOwnerExport,
  downloadOwnerExportCsv,
  getOwnerStudent,
  listOwnerStudents,
  setOwnerUserStatus,
} from '@/features/owner/analytics-api';
import type {
  ManageableUserStatus,
  OwnerStudentDetailDto,
  OwnerStudentRowDto,
} from '@/contracts/owner-ops';
import { OWNER_STUDENT_SEARCH_MAX } from '@/contracts/owner-ops';

// Student management console, driven by the Phase 11 owner-ops API:
// searchable + status-filtered learner directory (cursor pagination),
// a detail dialog with per-enrolment progress, ACTIVE⇄SUSPENDED status
// operations (suspension revokes sessions server-side), and a one-click
// STUDENTS CSV export. Loading follows the house request-key pattern;
// no row shows a number the API did not send.

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

const STATUS_FILTER_VALUES = ['ALL', 'ACTIVE', 'SUSPENDED'] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

/** Row status -> Badge presentation per the house status mapping. */
const ACCOUNT_STATUS_BADGES: Record<OwnerStudentRowDto['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ACTIVE: { label: 'Active', variant: 'default' },
  SUSPENDED: { label: 'Suspended', variant: 'destructive' },
  DELETED: { label: 'Deleted', variant: 'outline' },
};

/** Enrolment status -> Badge presentation inside the detail dialog. */
const ENROLMENT_STATUS_BADGES: Record<OwnerStudentDetailDto['enrolments'][number]['status'], { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  COMPLETED: { label: 'Completed', className: 'bg-primary/10 text-primary border-primary/30' },
  REVOKED: { label: 'Revoked', className: 'bg-muted text-muted-foreground border-border' },
};

/** "29 Aug 2026" compact date (mirrors the moderation queue's format). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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
  return formatDate(iso);
}

function initialsOf(name: string): string {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || '?';
}

function ListSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 pb-4 border-b last:border-b-0 last:pb-0">
            <Skeleton className="size-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function StudentManagement() {
  // ---- Directory state -------------------------------------------------
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [items, setItems] = useState<OwnerStudentRowDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Request-key pattern (see ReviewsModerationPage): loading is DERIVED,
  // every setState lives in async callbacks or event handlers.
  const requestKey = `${search}|${statusFilter}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search is debounced (300ms) so typing does not fire a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  // Page 1 for the current filter set.
  useEffect(() => {
    let cancelled = false;
    listOwnerStudents({
      q: search || undefined,
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
            : 'Something went wrong while loading the students.',
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
      const page = await listOwnerStudents({
        q: search || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more students.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  // ---- Export state ----------------------------------------------------
  const [exportRunning, setExportRunning] = useState(false);

  const handleExportCsv = async () => {
    if (exportRunning) return;
    setExportRunning(true);
    try {
      const job = await createOwnerExport('STUDENTS');
      if (job.status === 'COMPLETED') {
        toast.success(`Export ready — ${formatCount(job.rowCount)} ${job.rowCount === 1 ? 'row' : 'rows'}`);
        await downloadOwnerExportCsv(job);
      } else if (job.status === 'FAILED') {
        toast.error('The export failed to process.', { description: job.error ?? undefined });
      } else {
        toast.info('The export is still processing — it will appear in the analytics exports panel when it finishes.');
      }
    } catch (error) {
      showActionErrorToast(error, 'Could not create the export.');
    } finally {
      setExportRunning(false);
    }
  };

  // ---- Detail dialog state ----------------------------------------------
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OwnerStudentDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Bumped to silently re-reconcile the detail after a status change.
  const [detailToken, setDetailToken] = useState(0);
  const [statusPending, setStatusPending] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  useEffect(() => {
    if (!viewingId) return;
    let cancelled = false;
    getOwnerStudent(viewingId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setDetailError(null);
        setDetailLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetailError(
          error instanceof ApiClientError ? error.message : 'Could not load the student.',
        );
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingId, detailToken]);

  const openDetail = (student: OwnerStudentRowDto) => {
    setViewingId(student.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
  };

  const closeDetail = () => {
    setViewingId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setConfirmSuspend(false);
  };

  const retryDetail = () => {
    setDetailError(null);
    setDetailLoading(true);
    setDetailToken((token) => token + 1);
  };

  /**
   * Applies a status change: the returned { status, sessionsRevoked } is
   * merged optimistically into the open detail and the list row, then a
   * silent detail refetch reconciles with the server as source of truth.
   */
  const handleStatus = async (next: ManageableUserStatus, onSuccess?: () => void) => {
    if (!detail || statusPending) return;
    const studentName = detail.name;
    setStatusPending(true);
    try {
      const result = await setOwnerUserStatus(detail.id, next);
      setDetail((current) => (current ? { ...current, status: result.status } : current));
      setItems((current) =>
        current.map((row) => (row.id === result.id ? { ...row, status: result.status } : row)),
      );
      toast.success(
        next === 'SUSPENDED' ? `${studentName} suspended` : `${studentName} reactivated`,
        result.sessionsRevoked > 0
          ? {
              description: `${formatCount(result.sessionsRevoked)} active ${result.sessionsRevoked === 1 ? 'session' : 'sessions'} revoked.`,
            }
          : undefined,
      );
      setDetailToken((token) => token + 1);
      onSuccess?.();
    } catch (error) {
      showActionErrorToast(error, 'Could not update the student status.');
    } finally {
      setStatusPending(false);
    }
  };

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Branch key: replay the stagger when post-fetch sections mount late
            (variant orchestration does not reach late subscribers). */}
        <motion.div
          key={loading ? 'skeleton' : loadError ? 'error' : 'content'}
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-7xl mx-auto space-y-6"
        >
          {/* Header */}
          <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Student Management</h1>
              <p className="text-muted-foreground mt-1">
                {loading ? 'Learners across your courses' : `${formatCount(total)} ${total === 1 ? 'student' : 'students'} in view`}
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => void handleExportCsv()}
              disabled={exportRunning}
              aria-label="Export students as CSV"
            >
              {exportRunning ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Export CSV
            </Button>
          </motion.div>

          {/* Search + status filter */}
          <motion.div variants={item} className="flex flex-col sm:flex-row gap-3">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                className="pl-9"
                maxLength={OWNER_STUDENT_SEARCH_MAX}
                aria-label="Search students by name or email"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === 'ALL' ? 'All statuses' : ACCOUNT_STATUS_BADGES[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          {/* Student Table */}
          <motion.div variants={item}>
            {loading ? (
              <ListSkeleton />
            ) : loadError ? (
              <FetchErrorState
                title="Could not load the students"
                message={loadError}
                onRetry={handleRetry}
              />
            ) : items.length === 0 ? (
              <Card>
                <CardContent className="py-14 text-center">
                  <div className="size-14 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
                    <Users className="size-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold mb-1">No students found</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {search || statusFilter !== 'ALL'
                      ? 'No learners match the current search and filter. Try clearing them.'
                      : 'Learners appear here as soon as they enrol in a course.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Student Name</TableHead>
                          <TableHead className="text-xs hidden md:table-cell">Email</TableHead>
                          <TableHead className="text-xs text-right">Enrolments</TableHead>
                          <TableHead className="text-xs hidden sm:table-cell">Last Active</TableHead>
                          <TableHead className="text-xs hidden lg:table-cell">Joined</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((student) => (
                          <TableRow key={student.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                                  {initialsOf(student.name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{student.name}</p>
                                  <p className="text-xs text-muted-foreground md:hidden truncate max-w-[180px]">{student.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <span className="text-sm text-muted-foreground">{student.email}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{formatCount(student.enrolmentCount)}</TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <span className="text-sm text-muted-foreground whitespace-nowrap">
                                {student.lastActivityAt ? timeAgo(student.lastActivityAt) : 'never'}
                              </span>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <span className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(student.createdAt)}</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={ACCOUNT_STATUS_BADGES[student.status].variant}>
                                {ACCOUNT_STATUS_BADGES[student.status].label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => openDetail(student)}
                                aria-label={`View ${student.name}`}
                              >
                                <Eye className="size-4" aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            {nextCursor && !loading && !loadError && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="size-4 mr-2 animate-spin" aria-hidden />}
                  Load more
                </Button>
              </div>
            )}
          </motion.div>

          <div className="h-8" />
        </motion.div>
      </div>

      {/* Detail dialog */}
      <Dialog open={viewingId !== null} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto custom-scrollbar sm:max-w-lg">
          {detailLoading && !detail ? (
            <>
              {/* Every dialog branch carries an accessible title/description
                  even when the visual chrome only shows the spinner. */}
              <DialogHeader className="sr-only">
                <DialogTitle>Student details</DialogTitle>
                <DialogDescription>Loading student…</DialogDescription>
              </DialogHeader>
              <div className="py-16 flex flex-col items-center gap-3">
                <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">Loading student…</p>
              </div>
            </>
          ) : detailError ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-left">Student details</DialogTitle>
                <DialogDescription className="text-left">
                  The student could not be loaded.
                </DialogDescription>
              </DialogHeader>
              <div className="py-10 text-center">
                <p className="text-sm text-destructive mb-4">{detailError}</p>
                <Button variant="outline" size="sm" onClick={retryDetail} className="gap-1.5">
                  <RotateCcw className="size-3.5" aria-hidden />
                  Try again
                </Button>
              </div>
            </>
          ) : detail ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                    {initialsOf(detail.name)}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="truncate text-left">{detail.name}</DialogTitle>
                    <DialogDescription className="truncate text-left">{detail.email}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* Account meta */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={ACCOUNT_STATUS_BADGES[detail.status].variant}>
                  {ACCOUNT_STATUS_BADGES[detail.status].label}
                </Badge>
                <Badge variant="outline">{detail.role === 'OWNER' ? 'Owner' : 'Student'}</Badge>
                <Badge variant="outline" className={detail.emailVerified ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}>
                  {detail.emailVerified ? 'Email verified' : 'Email unverified'}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <p>Joined {formatDate(detail.createdAt)}</p>
                <p>
                  Last activity:{' '}
                  <span className="font-medium text-foreground/80">
                    {detail.lastActivityAt ? timeAgo(detail.lastActivityAt) : 'never'}
                  </span>
                </p>
                <p>
                  Certificates: <span className="font-medium text-foreground/80">{formatCount(detail.certificates)}</span>
                </p>
              </div>

              {/* Status action */}
              <div className="flex justify-end border-t pt-3">
                {detail.status === 'ACTIVE' ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setConfirmSuspend(true)}
                    disabled={statusPending}
                  >
                    <Ban className="size-3.5" aria-hidden />
                    Suspend
                  </Button>
                ) : detail.status === 'SUSPENDED' ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleStatus('ACTIVE')}
                    disabled={statusPending}
                  >
                    {statusPending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw className="size-3.5" aria-hidden />
                    )}
                    Reactivate
                  </Button>
                ) : null}
              </div>

              {/* Enrolments */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Enrolments ({formatCount(detail.enrolments.length)})
                </p>
                {detail.enrolments.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No enrolments yet.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                    {detail.enrolments.map((enrolment) => (
                      <div key={enrolment.enrolmentId} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate">{enrolment.courseTitle}</p>
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-normal shrink-0 ${ENROLMENT_STATUS_BADGES[enrolment.status].className}`}
                          >
                            {ENROLMENT_STATUS_BADGES[enrolment.status].label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {enrolment.source}
                          </Badge>
                          <span className="text-xs text-muted-foreground">Enrolled {formatDate(enrolment.enrolledAt)}</span>
                          {enrolment.completedAt && (
                            <span className="text-xs text-muted-foreground">Completed {formatDate(enrolment.completedAt)}</span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{enrolment.progressPercent}%</span>
                            <span className="text-xs text-muted-foreground">
                              {enrolment.completedLessons}/{enrolment.totalLessons} lessons
                            </span>
                          </div>
                          <Progress value={enrolment.progressPercent} className="h-2" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Suspend confirmation (nested inside the detail dialog) */}
              <AlertDialog
                open={confirmSuspend}
                onOpenChange={(open) => { if (!open) setConfirmSuspend(false); }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Suspend {detail.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Suspending this account revokes all their sessions immediately — the student is
                      signed out on every device. You can reactivate the account at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={statusPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      disabled={statusPending}
                      onClick={(event) => {
                        event.preventDefault();
                        void handleStatus('SUSPENDED', () => setConfirmSuspend(false));
                      }}
                    >
                      {statusPending && <Loader2 className="size-4 mr-2 animate-spin" aria-hidden />}
                      Suspend
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </InstructorLayout>
  );
}
