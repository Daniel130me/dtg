'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Copy, Loader2, RefreshCw, Search, ShieldBan } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import InstructorLayout from './InstructorLayout';
import { fetchOwnerCertificates, revokeOwnerCertificate } from '@/features/owner/certificates-api';
import { listOwnerCourses } from '@/features/owner/api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import { formatCount } from '@/lib/client/format';
import type { OwnerCertificateListItemDto } from '@/contracts/certificates';
import {
  CERTIFICATE_REVOKED_REASON_MAX,
  CERTIFICATE_STATUSES,
  type CertificateStatusValue,
} from '@/contracts/certificates';
import type { OwnerCourseListItemDto } from '@/contracts/owner-courses';

// Owner certificate console: every issued certificate with learner + course
// context, searchable by learner/code, filterable by course and status, with
// an audited revoke flow per row. Revocation is public — the verification page
// shows a revoked badge — hence the required reason.

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// Status -> Badge mapping, mirroring grading-status.ts (emerald tint active,
// destructive tint revoked — no blue/indigo).
const CERTIFICATE_STATUS_BADGES: Record<
  CertificateStatusValue,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0',
  },
  REVOKED: {
    label: 'Revoked',
    className: 'bg-destructive/10 text-destructive border-0',
  },
};

const STATUS_FILTER_VALUES = ['ALL', ...CERTIFICATE_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const ALL_COURSES = 'ALL';

/** One bounded page of courses is enough for the filter dropdown in practice. */
const COURSE_FILTER_PAGE_LIMIT = 100;

const SEARCH_DEBOUNCE_MS = 400;

const ISSUE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "2026-08-29T10:00:00.000Z" -> "29 Aug 2026" (date-only, house convention). */
function formatIssueDate(iso: string): string {
  return ISSUE_DATE_FORMAT.format(new Date(iso));
}

function ListSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
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

export default function CertificatesAdminPage() {
  // Course filter options (single bounded load).
  const [courses, setCourses] = useState<OwnerCourseListItemDto[]>([]);

  // Search box: the draft updates per keystroke, `search` is the debounced
  // value that actually hits the API (CourseManagement's pattern).
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // List state.
  const [items, setItems] = useState<OwnerCertificateListItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [courseFilter, setCourseFilter] = useState<string>(ALL_COURSES);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Request-key pattern: loading is DERIVED, every setState lives in async
  // callbacks or event handlers (react-hooks/set-state-in-effect).
  const requestKey = `${courseFilter}|${statusFilter}|${search}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Revoke flow: the row being revoked (opens the AlertDialog) + reason state.
  const [revokeTarget, setRevokeTarget] = useState<OwnerCertificateListItemDto | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const filtersActive = courseFilter !== ALL_COURSES || statusFilter !== 'ALL' || search !== '';

  // Debounce the search box before it hits the API. The flip happens here (a
  // timer callback, not the effect body) only when the term changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) setSearch(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

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
        // Non-fatal: the console still works with the "All courses" default.
        showActionErrorToast(error, 'Could not load the course filter options.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Page 1 for the current filters.
  useEffect(() => {
    let cancelled = false;
    fetchOwnerCertificates({
      courseId: courseFilter === ALL_COURSES ? undefined : courseFilter,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      search: search === '' ? undefined : search,
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
            : 'Something went wrong while loading the certificates.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const buildQuery = (cursor?: string) => ({
    courseId: courseFilter === ALL_COURSES ? undefined : courseFilter,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    search: search === '' ? undefined : search,
    cursor,
  });

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchOwnerCertificates(buildQuery(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more certificates.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  // Same clipboard pattern as the student CertificatesPage's code copy.
  const handleCopyCode = async (certificate: OwnerCertificateListItemDto) => {
    try {
      await navigator.clipboard.writeText(certificate.code);
      toast.success('Code copied');
    } catch {
      toast.error("Couldn't copy the code. Copy it manually instead.");
    }
  };

  const closeRevokeDialog = () => {
    if (revoking) return;
    setRevokeTarget(null);
    setRevokeReason('');
  };

  // Revoke -> toast -> refetch page 1 of the current filters. The reason is
  // required (mirrors certificateRevokeSchema) and becomes public on the
  // verification page, hence the confirmation copy.
  const handleRevoke = async () => {
    if (!revokeTarget || revoking) return;
    const reason = revokeReason.trim();
    if (reason.length === 0) return;
    setRevoking(true);
    try {
      await revokeOwnerCertificate(revokeTarget.id, { reason });
      toast.success(`Certificate ${revokeTarget.code} revoked.`);
      setRevokeTarget(null);
      setRevokeReason('');
      setRevoking(false);
      setReloadToken((token) => token + 1);
    } catch (error) {
      setRevoking(false);
      showActionErrorToast(error, 'The certificate could not be revoked.');
    }
  };

  // Stats: with no filters active the page-1 response IS the unfiltered one,
  // so `total` is the platform-wide count; the status split only claims the
  // loaded rows ("in view") because the list is cursor paginated.
  const activeInView = items.filter((entry) => entry.status === 'ACTIVE').length;
  const revokedInView = items.length - activeInView;

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
              <Award className="size-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Certificates</h1>
              <p className="text-muted-foreground mt-1">
                Issue records for completed learners. Revoke with care — revocation is public.
              </p>
            </div>
          </motion.div>

          {/* Stats strip */}
          <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Total certificates</CardDescription>
                <CardTitle className="text-2xl">{formatCount(total)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {filtersActive ? 'matching the current filters' : 'issued across the platform'}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Active (in view)</CardDescription>
                <CardTitle className="text-2xl">{formatCount(activeInView)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">valid and verifiable</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Revoked (in view)</CardDescription>
                <CardTitle className="text-2xl">{formatCount(revokedInView)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">publicly marked invalid</CardContent>
            </Card>
          </motion.div>

          {/* Filters */}
          <motion.div variants={item} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by learner name, email, or code..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="pl-9"
                aria-label="Search certificates"
              />
            </div>
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
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === 'ALL' ? 'All statuses' : CERTIFICATE_STATUS_BADGES[status as CertificateStatusValue].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          {/* List */}
          <motion.div variants={item}>
            {loading ? (
              <ListSkeleton />
            ) : loadError ? (
              <div className="text-center py-16">
                <div className="size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                  <Award className="size-7 text-destructive" />
                </div>
                <h3 className="font-semibold text-lg mb-1">Could not load the certificates</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{loadError}</p>
                <Button variant="outline" onClick={handleRetry} className="gap-1.5">
                  <RefreshCw className="size-4" /> Try Again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className="py-14 text-center">
                  <div className="size-14 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                    <Award className="size-6 text-amber-500/70" />
                  </div>
                  <h3 className="font-semibold mb-1">No certificates yet</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {filtersActive
                      ? 'No certificates match the current filters. Try a different search term or filter.'
                      : 'Certificates appear here when learners claim them after completing a course.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Issued certificates</CardTitle>
                  <CardDescription>
                    Copy a code to verify it, or revoke a record with a reason.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Learner</TableHead>
                          <TableHead className="hidden md:table-cell">Course</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead className="hidden lg:table-cell">Issued</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <p className="text-sm font-medium">{entry.learner.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.learner.email}</p>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm max-w-48">
                              <p className="truncate">{entry.course.title}</p>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                  {entry.code}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 shrink-0"
                                  aria-label={`Copy certificate code ${entry.code}`}
                                  onClick={() => void handleCopyCode(entry)}
                                >
                                  <Copy className="size-3.5" aria-hidden />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {formatIssueDate(entry.issuedAt)}
                            </TableCell>
                            <TableCell>
                              <Badge className={CERTIFICATE_STATUS_BADGES[entry.status].className}>
                                {CERTIFICATE_STATUS_BADGES[entry.status].label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {entry.status === 'ACTIVE' ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setRevokeReason('');
                                    setRevokeTarget(entry);
                                  }}
                                >
                                  <ShieldBan className="size-3.5 mr-1.5" aria-hidden />
                                  Revoke
                                </Button>
                              ) : (
                                <span
                                  className="text-xs text-muted-foreground max-w-40 truncate inline-block align-middle"
                                  title={entry.revokedReason ?? undefined}
                                >
                                  {entry.revokedReason ? entry.revokedReason : '—'}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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

      {/* Revoke confirmation. The reason is required and becomes part of the
          public verification record, so the copy says so explicitly. */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRevokeDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this certificate?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget
                ? `"${revokeTarget.code}" issued to ${revokeTarget.learner.name} for "${revokeTarget.course.title}" will be publicly marked as revoked. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="revoke-reason">Reason (required, shown publicly)</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {revokeReason.length}/{CERTIFICATE_REVOKED_REASON_MAX}
              </span>
            </div>
            <Textarea
              id="revoke-reason"
              value={revokeReason}
              maxLength={CERTIFICATE_REVOKED_REASON_MAX}
              rows={3}
              placeholder="Why is this certificate being revoked?"
              onChange={(event) => setRevokeReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeRevokeDialog}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={revoking || revokeReason.trim().length === 0}
              onClick={(event) => {
                event.preventDefault();
                void handleRevoke();
              }}
            >
              {revoking && <Loader2 className="size-4 mr-2 animate-spin" />}
              Revoke certificate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InstructorLayout>
  );
}
