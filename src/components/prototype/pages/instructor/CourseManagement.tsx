'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Archive,
  BookOpen,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  archiveCourse,
  deleteCourse,
  listOwnerCourses,
  publishCourse,
  unpublishCourse,
} from '@/features/owner/api';
import {
  COURSE_STATUS_BADGE_CLASS,
  COURSE_STATUS_LABELS,
} from '@/features/owner/course-status';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import type { OwnerCourseLifecycleResult } from '@/contracts/owner-courses';
import type { OwnerCourseListItemDto } from '@/contracts/owner-courses';
import type { CourseStatusValue } from '@/contracts/owner-courses';
import { ApiClientError } from '@/lib/client/api-client';
import { formatCount, formatDuration, formatLevel, formatPrice } from '@/lib/client/format';

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

const STATUS_FILTERS = ['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: 'All',
  DRAFT: 'Drafts',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const SEARCH_DEBOUNCE_MS = 300;
// Matches the API's default page size; "Load more" appends further pages.
const PAGE_SIZE = 20;

type ConfirmAction = 'publish' | 'unpublish' | 'archive' | 'delete';

const CONFIRM_COPY: Record<
  ConfirmAction,
  { title: string; description: (title: string) => string; confirmLabel: string; destructive?: boolean }
> = {
  publish: {
    title: 'Publish this course?',
    description: (title) =>
      `"${title}" and all of its lessons will become visible in the public catalog.`,
    confirmLabel: 'Publish course',
  },
  unpublish: {
    title: 'Unpublish this course?',
    description: (title) =>
      `"${title}" will return to draft and disappear from the public catalog.`,
    confirmLabel: 'Unpublish course',
  },
  archive: {
    title: 'Archive this course?',
    description: (title) =>
      `"${title}" will be removed from the public catalog. Enrolled students keep their access.`,
    confirmLabel: 'Archive course',
  },
  delete: {
    title: 'Delete this course?',
    description: (title) =>
      `"${title}" and its entire curriculum will be permanently deleted. This cannot be undone.`,
    confirmLabel: 'Delete course',
    destructive: true,
  },
};

export default function CourseManagement() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [courses, setCourses] = useState<OwnerCourseListItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Row-level in-flight flag so one row cannot double-fire an action.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ action: ConfirmAction; course: OwnerCourseListItemDto } | null>(
    null,
  );

  // Debounce the search box before it hits the API. The loading flip happens
  // here (a timer callback, not the effect body) only when the term changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) {
        setListState('loading');
        setSearch(next);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const buildQuery = useCallback(
    (cursor?: string) => ({
      status: statusFilter === 'ALL' ? undefined : (statusFilter as CourseStatusValue),
      search: search === '' ? undefined : search,
      cursor,
      limit: PAGE_SIZE,
    }),
    [statusFilter, search],
  );

  // Page fetch: state updates only from the async callbacks, never
  // synchronously inside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    listOwnerCourses(buildQuery())
      .then((page) => {
        if (cancelled) return;
        setCourses(page.items);
        setNextCursor(page.nextCursor);
        setListState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading courses.',
        );
        setListState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [buildQuery, reloadToken]);

  const handleFilterChange = (filter: StatusFilter) => {
    if (filter === statusFilter) return;
    setListState('loading');
    setStatusFilter(filter);
  };

  const handleRetry = () => {
    setListState('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listOwnerCourses(buildQuery(nextCursor));
      setCourses((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more courses.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Optimistic-ish local update: the API returns the new status/version, and
  // the loaded list is patched in place so stats stay honest without a refetch.
  const applyLifecycleResult = (courseId: string, result: OwnerCourseLifecycleResult) => {
    setCourses((current) =>
      current.map((course) =>
        course.id === courseId
          ? { ...course, status: result.status, version: result.version, publishedAt: result.publishedAt }
          : course,
      ),
    );
  };

  const runConfirmAction = async () => {
    if (!confirm) return;
    const { action, course } = confirm;
    setPendingId(course.id);
    try {
      if (action === 'publish') {
        applyLifecycleResult(course.id, await publishCourse(course.id));
        toast.success(`"${course.title}" is now live.`);
      } else if (action === 'unpublish') {
        applyLifecycleResult(course.id, await unpublishCourse(course.id));
        toast.success(`"${course.title}" is back to draft.`);
      } else if (action === 'archive') {
        applyLifecycleResult(course.id, await archiveCourse(course.id));
        toast.success(`"${course.title}" has been archived.`);
      } else {
        await deleteCourse(course.id);
        setCourses((current) => current.filter((entry) => entry.id !== course.id));
        toast.success(`"${course.title}" was deleted.`);
      }
    } catch (error) {
      showActionErrorToast(error, 'The action could not be completed.');
    } finally {
      setPendingId(null);
      setConfirm(null);
    }
  };

  // Stats reflect the loaded subset only — the API is cursor paginated, so
  // fabricating platform-wide totals here would be dishonest.
  const stats = useMemo(
    () => ({
      total: courses.length,
      drafts: courses.filter((course) => course.status === 'DRAFT').length,
      published: courses.filter((course) => course.status === 'PUBLISHED').length,
      archived: courses.filter((course) => course.status === 'ARCHIVED').length,
    }),
    [courses],
  );

  // Shared row actions menu (used by the desktop table row and the mobile
  // card footer so both layouts offer identical actions).
  const renderCourseActions = (course: OwnerCourseListItemDto, triggerClassName: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          disabled={pendingId === course.id}
        >
          {pendingId === course.id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onSelect={() => router.push(`/owner/courses/${course.id}`)}
        >
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        {course.status === 'PUBLISHED' && (
          <DropdownMenuItem className="gap-2 cursor-pointer" asChild>
            <a href={`/courses/${course.slug}`} target="_blank" rel="noreferrer">
              <Eye className="size-4" /> View public page
            </a>
          </DropdownMenuItem>
        )}
        {course.status === 'DRAFT' && (
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => setConfirm({ action: 'publish', course })}
          >
            <Rocket className="size-4" /> Publish
          </DropdownMenuItem>
        )}
        {course.status === 'PUBLISHED' && (
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => setConfirm({ action: 'unpublish', course })}
          >
            <Undo2 className="size-4" /> Unpublish
          </DropdownMenuItem>
        )}
        {course.status === 'PUBLISHED' && (
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => setConfirm({ action: 'archive', course })}
          >
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
        )}
        {course.status === 'DRAFT' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
              onSelect={() => setConfirm({ action: 'delete', course })}
            >
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Course Management</h1>
              <p className="text-muted-foreground mt-1">
                Manage your catalog{listState === 'ready' ? ` — ${formatCount(stats.total)} loaded` : ''}
              </p>
            </div>
            <Button
              onClick={() => router.push('/owner/courses/new')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="size-4 mr-2" />
              Create New Course
            </Button>
          </motion.div>

          {/* Stats cards (loaded subset) */}
          <motion.div variants={item} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Loaded courses</CardDescription>
                <CardTitle className="text-2xl">{formatCount(stats.total)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">in the current view</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Drafts (loaded)</CardDescription>
                <CardTitle className="text-2xl">{formatCount(stats.drafts)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">not yet published</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Published (loaded)</CardDescription>
                <CardTitle className="text-2xl">{formatCount(stats.published)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">live in the catalog</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Archived (loaded)</CardDescription>
                <CardTitle className="text-2xl">{formatCount(stats.archived)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">removed from catalog</CardContent>
            </Card>
          </motion.div>

          {/* Filters */}
          <motion.div variants={item} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search courses by title..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {STATUS_FILTERS.map((filter) => (
                <Button
                  key={filter}
                  variant={statusFilter === filter ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleFilterChange(filter)}
                  className={
                    statusFilter === filter
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : ''
                  }
                >
                  {STATUS_FILTER_LABELS[filter]}
                </Button>
              ))}
            </div>
          </motion.div>

          {/* Course Table */}
          <motion.div variants={item}>
            <Card>
              <CardContent className="p-0">
                {listState === 'loading' ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div key={index} className="flex items-center gap-4">
                        <Skeleton className="size-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                        <Skeleton className="h-4 w-16 hidden sm:block" />
                        <Skeleton className="h-4 w-16 hidden md:block" />
                        <Skeleton className="h-6 w-20" />
                      </div>
                    ))}
                  </div>
                ) : listState === 'error' ? (
                  <div className="py-16 text-center space-y-3">
                    <p className="text-sm font-medium">Courses could not be loaded</p>
                    <p className="text-sm text-muted-foreground">{loadError}</p>
                    <Button variant="outline" onClick={handleRetry}>
                      <RefreshCw className="size-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                ) : courses.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <BookOpen className="size-10 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium mt-2">
                      {search || statusFilter !== 'ALL'
                        ? 'No courses match the current filters.'
                        : 'No courses yet.'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {search || statusFilter !== 'ALL'
                        ? 'Try a different search term or status filter.'
                        : 'Create your first course to get started.'}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-2"
                      onClick={() => router.push('/owner/courses/new')}
                    >
                      <Plus className="size-4 mr-2" />
                      Create New Course
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block overflow-x-auto custom-scrollbar">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Title</TableHead>
                            <TableHead className="text-xs hidden md:table-cell">Category</TableHead>
                            <TableHead className="text-xs text-right hidden sm:table-cell">Price</TableHead>
                            <TableHead className="text-xs text-right hidden sm:table-cell">Students</TableHead>
                            <TableHead className="text-xs text-center">Status</TableHead>
                            <TableHead className="text-xs text-right hidden lg:table-cell">Updated</TableHead>
                            <TableHead className="text-xs text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {courses.map((course) => (
                            <TableRow key={course.id} className="group">
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <div className="size-10 rounded-lg bg-gradient-to-br from-primary/20 to-[#0a1a3e]/20 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-primary">
                                      {course.totalLessons}
                                    </span>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate max-w-[240px]">
                                      {course.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatLevel(course.level)} · {formatDuration(course.totalMinutes)} ·{' '}
                                      {course.totalSections} sections
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {course.category ? (
                                  <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                    {course.category.name}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium hidden sm:table-cell">
                                {formatPrice(course.priceMinor, course.currency)}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium hidden sm:table-cell">
                                {formatCount(course.enrollmentCount)}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge className={COURSE_STATUS_BADGE_CLASS[course.status]}>
                                  {COURSE_STATUS_LABELS[course.status]}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">
                                {new Date(course.updatedAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-right">
                                {renderCourseActions(course, 'size-8')}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile card list (compact, same actions as the table rows) */}
                    <div className="md:hidden space-y-3">
                      {courses.map((course) => (
                        <div key={course.id} className="rounded-xl border bg-card p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-sm leading-snug">{course.title}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatLevel(course.level)} · {formatDuration(course.totalMinutes)} ·{' '}
                                {course.totalSections} sections
                              </p>
                            </div>
                            {renderCourseActions(course, 'size-9 shrink-0 -mr-1.5 -mt-1.5')}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={COURSE_STATUS_BADGE_CLASS[course.status]}>
                              {COURSE_STATUS_LABELS[course.status]}
                            </Badge>
                            {course.category && (
                              <Badge variant="secondary" className="text-xs">
                                {course.category.name}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="text-sm font-medium text-foreground">
                              {formatPrice(course.priceMinor, course.currency)}
                            </span>
                            <span>{formatCount(course.enrollmentCount)} students</span>
                            <span>Updated {new Date(course.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {nextCursor && (
                      <div className="p-4 border-t text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleLoadMore()}
                          disabled={loadingMore}
                        >
                          {loadingMore && <Loader2 className="size-4 mr-2 animate-spin" />}
                          Load more
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>

      {/* Row action confirmation (publish / unpublish / archive / delete) */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? CONFIRM_COPY[confirm.action].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? CONFIRM_COPY[confirm.action].description(confirm.course.title) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirm && CONFIRM_COPY[confirm.action].destructive
                  ? 'bg-destructive text-white hover:bg-destructive/90'
                  : ''
              }
              onClick={(event) => {
                event.preventDefault();
                void runConfirmAction();
              }}
              disabled={pendingId !== null}
            >
              {pendingId !== null && <Loader2 className="size-4 mr-2 animate-spin" />}
              {confirm ? CONFIRM_COPY[confirm.action].confirmLabel : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InstructorLayout>
  );
}
