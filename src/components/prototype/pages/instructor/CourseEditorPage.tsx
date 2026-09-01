'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Archive,
  ArrowLeft,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  FileCheck,
  FileText,
  HelpCircle,
  Layers,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  MoveRight,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
  Undo2,
  Upload,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import InstructorLayout from './InstructorLayout';
import QuizBuilder from './quiz-builder';
import AssignmentEditor from './assignment-editor';
import {
  archiveCourse,
  createLesson,
  createSection,
  deleteLesson,
  deleteSection,
  getOwnerCourse,
  listOwnerCatalogOptions,
  moveLesson,
  publishCourse,
  renameSection,
  reorderSection,
  unpublishCourse,
  updateCourse,
  updateLesson,
  uploadCourseThumbnail,
  uploadLessonVideo,
} from '@/features/owner/api';
import {
  COURSE_STATUS_BADGE_CLASS,
  COURSE_STATUS_LABELS,
} from '@/features/owner/course-status';
import {
  showActionErrorToast,
  showValidationIssuesToast,
} from '@/features/owner/toast-helpers';
import {
  LESSON_DURATION_MAX_SECONDS,
  lessonCreateSchema,
  lessonTypeSchema,
  lessonUpdateSchema,
  sectionCreateSchema,
  updateCourseSchema,
} from '@/contracts/owner-courses';
import type {
  CourseLevelValue,
  LessonCreateBody,
  LessonTypeValue,
  LessonUpdateBody,
  OwnerCourseDetailDto,
  OwnerLessonDto,
  OwnerSectionDto,
} from '@/contracts/owner-courses';
import type { CategoryDto } from '@/contracts/catalog';
import {
  COURSE_THUMBNAIL_CONTENT_TYPES,
  MAX_COURSE_THUMBNAIL_BYTES,
} from '@/contracts/course-media';
import {
  LESSON_VIDEO_CONTENT_TYPES,
  MAX_LESSON_VIDEO_BYTES,
} from '@/contracts/lesson-video';
import { ApiClientError } from '@/lib/client/api-client';
import { formatLessonDuration, formatLevel, formatPrice } from '@/lib/client/format';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const LESSON_TYPE_OPTIONS = lessonTypeSchema.options;

const LESSON_TYPE_ICONS: Record<LessonTypeValue, React.ReactNode> = {
  VIDEO: <Video className="size-4" />,
  TEXT: <FileText className="size-4" />,
  QUIZ: <HelpCircle className="size-4" />,
  ASSIGNMENT: <ClipboardList className="size-4" />,
};

const LESSON_TYPE_LABELS: Record<LessonTypeValue, string> = {
  VIDEO: 'Video',
  TEXT: 'Text',
  QUIZ: 'Quiz',
  ASSIGNMENT: 'Assignment',
};

type LifecycleAction = 'publish' | 'archive' | 'unpublish';

type SectionDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; section: OwnerSectionDto }
  | null;

type LessonDialogState =
  | { mode: 'create'; section: OwnerSectionDto }
  | { mode: 'edit'; lesson: OwnerLessonDto }
  | null;

/** "49.9" (major units) -> 4990 minor units; invalid input -> null. */
function parsePriceToMinor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** totalMinutes counter rendered with the shared seconds formatter. */
function formatCourseContentLength(totalMinutes: number): string {
  return totalMinutes > 0 ? formatLessonDuration(totalMinutes * 60) : '0m';
}

// ---------------------------------------------------------------------------
// Page shell: data loading, header, tabs
// ---------------------------------------------------------------------------

export default function CourseEditorPage() {
  const params = useParams<{ courseId: string }>();
  const searchParams = useSearchParams();
  const courseId = params.courseId;

  const [course, setCourse] = useState<OwnerCourseDetailDto | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [lifecycleBusy, setLifecycleBusy] = useState<LifecycleAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  const [activeTab, setActiveTab] = useState<'metadata' | 'media' | 'curriculum'>(() =>
    searchParams.get('tab') === 'curriculum' ? 'curriculum' : 'metadata',
  );

  // Initial load: state is set from the async callbacks only, never
  // synchronously inside the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    Promise.all([getOwnerCourse(courseId), listOwnerCatalogOptions()])
      .then(([courseDetail, catalog]) => {
        if (cancelled) return;
        setCourse(courseDetail);
        setCategories(catalog.categories);
        setLevels(catalog.levels);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the course.',
        );
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadToken]);

  const retryLoad = () => {
    setLoadState('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const refetch = useCallback(async () => {
    try {
      const fresh = await getOwnerCourse(courseId);
      setCourse(fresh);
    } catch (error) {
      showActionErrorToast(error, 'Could not refresh the course.');
    }
  }, [courseId]);

  const runLifecycle = useCallback(
    async (action: LifecycleAction) => {
      if (!course) return;
      setLifecycleBusy(action);
      try {
        if (action === 'publish') {
          await publishCourse(course.id);
          toast.success(`"${course.title}" is now live.`);
        } else if (action === 'archive') {
          await archiveCourse(course.id);
          toast.success(`"${course.title}" has been archived.`);
        } else {
          await unpublishCourse(course.id);
          toast.success(`"${course.title}" is back to draft.`);
        }
        await refetch();
      } catch (error) {
        showActionErrorToast(error, 'The course status could not be updated.');
      } finally {
        setLifecycleBusy(null);
        setConfirmAction(null);
      }
    },
    [course, refetch],
  );

  if (loadState !== 'ready' || !course) {
    return (
      <InstructorLayout>
        {loadState === 'loading' ? (
          <EditorSkeleton />
        ) : (
          <div className="p-4 sm:p-6 lg:p-8">
            <Card className="max-w-xl mx-auto mt-10">
              <CardHeader>
                <CardTitle className="text-base">Could not load this course</CardTitle>
                <CardDescription>{loadError}</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-3">
                <Button variant="outline" onClick={retryLoad}>
                  <RefreshCw className="size-4 mr-2" />
                  Retry
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/owner/courses">Back to course management</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </InstructorLayout>
    );
  }

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-5xl mx-auto space-y-6"
        >
          {/* Header */}
          <motion.div variants={item} className="space-y-4">
            <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
              <Link href="/owner/courses">
                <ArrowLeft className="size-4 mr-1.5" />
                Back to course management
              </Link>
            </Button>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-bold truncate">{course.title}</h1>
                  <Badge className={COURSE_STATUS_BADGE_CLASS[course.status]}>
                    {COURSE_STATUS_LABELS[course.status]}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">v{course.version}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  /courses/{course.slug} · {formatLevel(course.level)} · last updated{' '}
                  {formatDate(course.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {course.status === 'PUBLISHED' && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/courses/${course.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4 mr-2" />
                      View public page
                    </a>
                  </Button>
                )}
                {course.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() => setConfirmAction('publish')}
                    disabled={lifecycleBusy !== null}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {lifecycleBusy === 'publish' ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="size-4 mr-2" />
                    )}
                    Publish
                  </Button>
                )}
                {course.status === 'PUBLISHED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction('archive')}
                    disabled={lifecycleBusy !== null}
                  >
                    {lifecycleBusy === 'archive' ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Archive className="size-4 mr-2" />
                    )}
                    Archive
                  </Button>
                )}
                {course.status === 'ARCHIVED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction('unpublish')}
                    disabled={lifecycleBusy !== null}
                  >
                    {lifecycleBusy === 'unpublish' ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Undo2 className="size-4 mr-2" />
                    )}
                    Unpublish
                  </Button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <motion.div variants={item}>
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                setActiveTab(value as 'metadata' | 'media' | 'curriculum')
              }
            >
              <TabsList>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
                <TabsTrigger value="media">Media</TabsTrigger>
                <TabsTrigger value="curriculum">
                  Curriculum
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {course.totalSections} · {course.totalLessons}
                  </Badge>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="metadata" className="mt-4">
                <MetadataTab
                  key={`${course.id}:${course.version}:${course.updatedAt}`}
                  course={course}
                  categories={categories}
                  levels={levels}
                  onSaved={setCourse}
                />
              </TabsContent>
              <TabsContent value="media" className="mt-4">
                <MediaTab course={course} onSaved={setCourse} />
              </TabsContent>
              <TabsContent value="curriculum" className="mt-4">
                <CurriculumTab course={course} onRefetch={refetch} />
              </TabsContent>
            </Tabs>
          </motion.div>

          <div className="h-8" />
        </motion.div>
      </div>

      {/* Lifecycle confirmation dialog */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'publish' && 'Publish this course?'}
              {confirmAction === 'archive' && 'Archive this course?'}
              {confirmAction === 'unpublish' && 'Unpublish this course?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'publish' &&
                'Every lesson will be published and the course will become visible in the public catalog.'}
              {confirmAction === 'archive' &&
                'The course will be removed from the public catalog. Students already enrolled keep their access.'}
              {confirmAction === 'unpublish' &&
                'The course will return to draft so you can edit and republish it later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirmAction) void runLifecycle(confirmAction);
              }}
              disabled={lifecycleBusy !== null}
            >
              {lifecycleBusy !== null && <Loader2 className="size-4 mr-2 animate-spin" />}
              {confirmAction === 'publish' && 'Publish course'}
              {confirmAction === 'archive' && 'Archive course'}
              {confirmAction === 'unpublish' && 'Unpublish course'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InstructorLayout>
  );
}

// ---------------------------------------------------------------------------
// Media tab
// ---------------------------------------------------------------------------

interface MediaTabProps {
  course: OwnerCourseDetailDto;
  onSaved: (course: OwnerCourseDetailDto) => void;
}

function MediaTab({ course, onSaved }: MediaTabProps) {
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [promoVideoUrl, setPromoVideoUrl] = useState(course.promoVideoUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [savingPromo, setSavingPromo] = useState(false);

  const handleThumbnailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    if (!(COURSE_THUMBNAIL_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      toast.error('Choose a PNG, JPG, or WebP thumbnail.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_COURSE_THUMBNAIL_BYTES) {
      toast.error('The thumbnail must be 5 MB or smaller.');
      event.target.value = '';
      return;
    }
    setThumbnailFile(file);
  };

  const handleThumbnailUpload = async () => {
    if (!thumbnailFile) return;
    setUploading(true);
    try {
      await uploadCourseThumbnail(course.id, thumbnailFile);
      const updated = await getOwnerCourse(course.id);
      onSaved(updated);
      setThumbnailFile(null);
      toast.success('Course thumbnail uploaded.');
    } catch (error) {
      showActionErrorToast(error, 'The course thumbnail could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const handlePromoSave = async () => {
    const parsed = updateCourseSchema.safeParse({
      promoVideoUrl: promoVideoUrl.trim() || null,
      expectedVersion: course.version,
    });
    if (!parsed.success) {
      showValidationIssuesToast(parsed.error, 'Enter a valid promo-video URL.');
      return;
    }

    setSavingPromo(true);
    try {
      const updated = await updateCourse(course.id, parsed.data);
      onSaved(updated);
      toast.success('Promo video saved.');
    } catch (error) {
      showActionErrorToast(error, 'The promo video could not be saved.');
    } finally {
      setSavingPromo(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Course media</CardTitle>
        <CardDescription>
          Manage the catalog thumbnail and the optional public promo-video link.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="editor-thumbnail">Course thumbnail</Label>
          <label
            htmlFor="editor-thumbnail"
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/30 p-8 text-center transition-colors hover:border-primary/50"
          >
            {course.thumbnailUrl ? (
              <ImageIcon className="mb-3 size-6 text-primary" />
            ) : (
              <Upload className="mb-3 size-6 text-muted-foreground" />
            )}
            <span className="max-w-full truncate text-sm font-medium">
              {thumbnailFile?.name ??
                (course.thumbnailUrl ? 'Choose a replacement thumbnail' : 'Choose a thumbnail')}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              PNG, JPG or WebP · max 5 MB · recommended 1280×720
            </span>
          </label>
          <Input
            id="editor-thumbnail"
            type="file"
            accept={COURSE_THUMBNAIL_CONTENT_TYPES.join(',')}
            onChange={handleThumbnailChange}
            className="sr-only"
          />
          <Button
            type="button"
            onClick={() => void handleThumbnailUpload()}
            disabled={!thumbnailFile || uploading}
          >
            {uploading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Upload thumbnail
          </Button>
        </div>

        <div className="space-y-3 border-t pt-5">
          <Label htmlFor="editor-promo-video">Promo video URL</Label>
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="editor-promo-video"
              type="url"
              className="pl-9"
              placeholder="https://youtube.com/watch?v=..."
              value={promoVideoUrl}
              onChange={(event) => setPromoVideoUrl(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePromoSave()}
            disabled={savingPromo}
          >
            {savingPromo && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save promo video
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EditorSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-10 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata tab
// ---------------------------------------------------------------------------

interface MetadataTabProps {
  course: OwnerCourseDetailDto;
  categories: CategoryDto[];
  levels: { id: string; name: string }[];
  onSaved: (course: OwnerCourseDetailDto) => void;
}

function MetadataTab({ course, categories, levels, onSaved }: MetadataTabProps) {
  const [title, setTitle] = useState(course.title);
  const [shortDescription, setShortDescription] = useState(course.shortDescription);
  const [description, setDescription] = useState(course.description);
  const [categoryId, setCategoryId] = useState(course.category?.id ?? '');
  const [level, setLevel] = useState<CourseLevelValue>(course.level);
  const [language, setLanguage] = useState(course.language);
  const [priceInput, setPriceInput] = useState((course.priceMinor / 100).toString());
  const [saving, setSaving] = useState(false);

  const priceMinor = parsePriceToMinor(priceInput);
  const isFree = priceMinor === 0;

  const handleSave = async () => {
    if (priceMinor === null) {
      toast.error('Please enter a valid price (a non-negative number).');
      return;
    }

    const body = {
      title,
      shortDescription,
      description,
      categoryId,
      level,
      language,
      priceMinor,
      expectedVersion: course.version,
    };

    const parsed = updateCourseSchema.safeParse(body);
    if (!parsed.success) {
      showValidationIssuesToast(parsed.error, 'Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateCourse(course.id, parsed.data);
      onSaved(updated);
      toast.success('Course details saved.');
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === 'VERSION_CONFLICT'
      ) {
        toast.error('This course was updated by another request.', {
          description: 'Reload the latest version, then re-apply your changes.',
          action: {
            label: 'Reload',
            onClick: () => {
              void getOwnerCourse(course.id).then(onSaved);
            },
          },
          duration: 15000,
        });
        return;
      }
      showActionErrorToast(error, 'The course details could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Course metadata</CardTitle>
        <CardDescription>
          Describes the course everywhere it is shown. The slug /courses/{course.slug} stays
          permanent so existing links keep working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="editor-title">Course title</Label>
          <Input
            id="editor-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g., Complete Next.js Masterclass"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editor-short-description">Short description</Label>
          <Input
            id="editor-short-description"
            value={shortDescription}
            onChange={(event) => setShortDescription(event.target.value)}
            placeholder="One or two sentences shown on cards and listings"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editor-description">Full description</Label>
          <Textarea
            id="editor-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            placeholder="What students will learn, who the course is for..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={categories.length === 0 ? 'No categories available' : 'Select category'}
                />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Level</Label>
            <Select value={level} onValueChange={(value) => setLevel(value as CourseLevelValue)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                {levels.map((option) => (
                  <SelectItem key={option.id} value={option.name}>
                    {formatLevel(option.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editor-language">Language</Label>
            <Input
              id="editor-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="e.g., English"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="editor-price">Price ({course.currency})</Label>
            <div className="relative">
              <Input
                id="editor-price"
                type="number"
                min="0"
                step="0.01"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                className="pl-7"
                placeholder="49.99"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Currently {formatPrice(course.priceMinor, course.currency)}.
              {isFree && ' This course will be free for students.'}
            </p>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Curriculum tab
// ---------------------------------------------------------------------------

interface CurriculumTabProps {
  course: OwnerCourseDetailDto;
  onRefetch: () => Promise<void>;
}

function CurriculumTab({ course, onRefetch }: CurriculumTabProps) {
  const [busy, setBusy] = useState(false);
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState>(null);
  const [sectionDeleteTarget, setSectionDeleteTarget] = useState<OwnerSectionDto | null>(null);
  const [lessonDialog, setLessonDialog] = useState<LessonDialogState>(null);
  const [lessonDeleteTarget, setLessonDeleteTarget] = useState<OwnerLessonDto | null>(null);
  const [lessonMoveTarget, setLessonMoveTarget] = useState<OwnerLessonDto | null>(null);
  // Quiz/assignment authoring target: mounted only while its dialog is open.
  const [assessmentLesson, setAssessmentLesson] = useState<OwnerLessonDto | null>(null);

  const sections = useMemo(
    () => [...course.sections].sort((a, b) => a.position - b.position),
    [course.sections],
  );
  const latestSection = sections.at(-1);

  // Every mutation bumps the course version server-side, so the tab simply
  // refetches the course afterwards to stay authoritative. Actions may return
  // any payload; only their success/failure matters here.
  const withBusy = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        await onRefetch();
      } catch (error) {
        showActionErrorToast(error, 'The curriculum could not be updated.');
      } finally {
        setBusy(false);
      }
    },
    [onRefetch],
  );

  const handleSectionSubmit = (title: string): Promise<void> => {
    if (!sectionDialog) return Promise.resolve();
    const dialog = sectionDialog;
    return withBusy(async () => {
      if (dialog.mode === 'create') {
        await createSection(course.id, { title });
        toast.success('Section added.');
      } else {
        await renameSection(dialog.section.id, { title });
        toast.success('Section renamed.');
      }
    });
  };

  const handleSectionDelete = (): Promise<void> => {
    if (!sectionDeleteTarget) return Promise.resolve();
    const target = sectionDeleteTarget;
    setSectionDeleteTarget(null);
    return withBusy(async () => {
      await deleteSection(target.id);
      toast.success('Section deleted.');
    });
  };

  const handleLessonCreate = async (
    sectionId: string,
    body: LessonCreateBody,
    videoFile: File | null,
    onProgress: (percent: number) => void,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await createLesson(sectionId, body);
      if (videoFile) await uploadLessonVideo(result.lesson.id, videoFile, onProgress);
      await onRefetch();
      toast.success(videoFile ? 'Lesson and lecture video added.' : 'Lesson added.');
      return true;
    } catch (error) {
      showActionErrorToast(error, 'The lesson or its lecture video could not be saved.');
      await onRefetch().catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleLessonUpdate = async (
    lessonId: string,
    body: LessonUpdateBody,
    videoFile: File | null,
    onProgress: (percent: number) => void,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await updateLesson(lessonId, body);
      if (videoFile) await uploadLessonVideo(lessonId, videoFile, onProgress);
      await onRefetch();
      toast.success(videoFile ? 'Lesson and lecture video updated.' : 'Lesson updated.');
      return true;
    } catch (error) {
      showActionErrorToast(error, 'The lesson or its lecture video could not be saved.');
      await onRefetch().catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleLessonDelete = (): Promise<void> => {
    if (!lessonDeleteTarget) return Promise.resolve();
    const target = lessonDeleteTarget;
    setLessonDeleteTarget(null);
    return withBusy(async () => {
      await deleteLesson(target.id);
      toast.success('Lesson deleted.');
    });
  };

  const handleLessonMove = (sectionId: string, position: number): Promise<void> => {
    if (!lessonMoveTarget) return Promise.resolve();
    const target = lessonMoveTarget;
    setLessonMoveTarget(null);
    return withBusy(async () => {
      await moveLesson(target.id, { sectionId, position });
      toast.success('Lesson moved.');
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Curriculum</CardTitle>
              <CardDescription>
                {course.totalSections} {course.totalSections === 1 ? 'section' : 'sections'} ·{' '}
                {course.totalLessons} {course.totalLessons === 1 ? 'lesson' : 'lessons'} ·{' '}
                {formatCourseContentLength(course.totalMinutes)} of content
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {latestSection && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLessonDialog({ mode: 'create', section: latestSection })}
                  disabled={busy}
                >
                  <Upload className="mr-2 size-4" />
                  Add lecture video
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setSectionDialog({ mode: 'create' })}
                disabled={busy}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Plus className="size-4 mr-2" />
                Add section
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sections.length === 0 && (
            <div className="border border-dashed rounded-lg p-10 text-center">
              <Layers className="size-8 mx-auto text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No sections yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a section first. You can then upload a recording with the Add lecture video
                action.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 border-dashed"
                onClick={() => setSectionDialog({ mode: 'create' })}
                disabled={busy}
              >
                <Plus className="size-4 mr-2" />
                Add your first section
              </Button>
            </div>
          )}

          {sections.map((section, index) => (
            <div key={section.id} className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 p-3 bg-muted/50">
                <Badge variant="secondary" className="text-xs shrink-0">
                  #{section.position}
                </Badge>
                <span className="font-medium text-sm flex-1 truncate">{section.title}</span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {section.lessons.length} {section.lessons.length === 1 ? 'lesson' : 'lessons'}
                </Badge>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy || index === 0}
                    onClick={() =>
                      void withBusy(() => reorderSection(section.id, section.position - 1))
                    }
                    aria-label="Move section up"
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy || index === sections.length - 1}
                    onClick={() =>
                      void withBusy(() => reorderSection(section.id, section.position + 1))
                    }
                    aria-label="Move section down"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy}
                    onClick={() => setSectionDialog({ mode: 'rename', section })}
                    aria-label="Rename section"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setSectionDeleteTarget(section)}
                    aria-label="Delete section"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {section.lessons.length > 0 && (
                <div className="divide-y">
                  {section.lessons.map((lesson, lessonIndex) => (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-2 px-3 py-2.5 pl-5 group hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-muted-foreground shrink-0">
                        {LESSON_TYPE_ICONS[lesson.type]}
                      </span>
                      <span className="text-sm flex-1 truncate">{lesson.title}</span>
                      {lesson.isPreview && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Preview
                        </Badge>
                      )}
                      {lesson.type === 'VIDEO' && lesson.videoFileName && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          Video uploaded
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                        {formatLessonDuration(lesson.durationSeconds)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={busy || lessonIndex === 0}
                          onClick={() =>
                            void withBusy(() =>
                              moveLesson(lesson.id, {
                                sectionId: section.id,
                                position: lesson.position - 1,
                              }),
                            )
                          }
                          aria-label="Move lesson up"
                        >
                          <ChevronUp className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={busy || lessonIndex === section.lessons.length - 1}
                          onClick={() =>
                            void withBusy(() =>
                              moveLesson(lesson.id, {
                                sectionId: section.id,
                                position: lesson.position + 1,
                              }),
                            )
                          }
                          aria-label="Move lesson down"
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={busy || sections.length < 2}
                          onClick={() => setLessonMoveTarget(lesson)}
                          aria-label="Move lesson to another section"
                        >
                          <MoveRight className="size-3.5" />
                        </Button>
                        {/* Assessment config only applies to QUIZ/ASSIGNMENT lessons. */}
                        {(lesson.type === 'QUIZ' || lesson.type === 'ASSIGNMENT') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            disabled={busy}
                            onClick={() => setAssessmentLesson(lesson)}
                            aria-label={
                              lesson.type === 'QUIZ' ? 'Configure quiz' : 'Configure assignment'
                            }
                          >
                            {lesson.type === 'QUIZ' ? (
                              <BookOpenCheck className="size-3.5" />
                            ) : (
                              <FileCheck className="size-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={busy}
                          onClick={() => setLessonDialog({ mode: 'edit', lesson })}
                          aria-label="Edit lesson"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => setLessonDeleteTarget(lesson)}
                          aria-label="Delete lesson"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  disabled={busy}
                  onClick={() => setLessonDialog({ mode: 'create', section })}
                >
                  <Plus className="size-4 mr-2" />
                  Add lesson or upload video
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Section create / rename — mounted only while open so its form state
          resets between opens without sync effects. */}
      {sectionDialog && (
        <SectionDialog
          key={sectionDialog.mode === 'rename' ? sectionDialog.section.id : 'create'}
          state={sectionDialog}
          busy={busy}
          onClose={() => setSectionDialog(null)}
          onSubmit={handleSectionSubmit}
        />
      )}

      {/* Section delete confirmation */}
      <AlertDialog
        open={sectionDeleteTarget !== null}
        onOpenChange={(open) => !open && setSectionDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              {sectionDeleteTarget &&
                `"${sectionDeleteTarget.title}" and its ${sectionDeleteTarget.lessons.length} ${
                  sectionDeleteTarget.lessons.length === 1 ? 'lesson' : 'lessons'
                } will be permanently removed. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleSectionDelete();
              }}
            >
              Delete section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lesson create / edit */}
      {lessonDialog && (
        <LessonDialog
          key={
            lessonDialog.mode === 'edit' ? lessonDialog.lesson.id : `create:${lessonDialog.section.id}`
          }
          state={lessonDialog}
          busy={busy}
          onClose={() => setLessonDialog(null)}
          onCreate={handleLessonCreate}
          onUpdate={handleLessonUpdate}
        />
      )}

      {/* Lesson delete confirmation */}
      <AlertDialog
        open={lessonDeleteTarget !== null}
        onOpenChange={(open) => !open && setLessonDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lesson?</AlertDialogTitle>
            <AlertDialogDescription>
              {lessonDeleteTarget && `"${lessonDeleteTarget.title}" will be permanently removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleLessonDelete();
              }}
            >
              Delete lesson
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move lesson to another section */}
      {lessonMoveTarget && (
        <MoveLessonDialog
          key={lessonMoveTarget.id}
          course={course}
          lesson={lessonMoveTarget}
          busy={busy}
          onClose={() => setLessonMoveTarget(null)}
          onSubmit={handleLessonMove}
        />
      )}

      {/* Quiz/assignment authoring for QUIZ/ASSIGNMENT lessons. Mounted only
          while open so each builder starts a fresh load (same reset pattern
          as the other dialogs above). */}
      {assessmentLesson && (
        <Dialog open onOpenChange={(open) => !open && setAssessmentLesson(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {assessmentLesson.type === 'QUIZ' ? (
                  <BookOpenCheck className="size-4 text-primary" />
                ) : (
                  <FileCheck className="size-4 text-primary" />
                )}
                {assessmentLesson.type === 'QUIZ' ? 'Quiz builder' : 'Assignment editor'}
              </DialogTitle>
              <DialogDescription>{assessmentLesson.title}</DialogDescription>
            </DialogHeader>
            {assessmentLesson.type === 'QUIZ' ? (
              <QuizBuilder
                key={assessmentLesson.id}
                lessonId={assessmentLesson.id}
                lessonTitle={assessmentLesson.title}
              />
            ) : (
              <AssignmentEditor
                key={assessmentLesson.id}
                lessonId={assessmentLesson.id}
                lessonTitle={assessmentLesson.title}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section dialog (create + rename)
// ---------------------------------------------------------------------------

interface SectionDialogProps {
  // Non-null: the parent mounts this dialog only while it is open, so the
  // form state initializes fresh from props on every open.
  state: NonNullable<SectionDialogState>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}

function SectionDialog({ state, busy, onClose, onSubmit }: SectionDialogProps) {
  const isRename = state.mode === 'rename';
  const [title, setTitle] = useState(isRename ? state.section.title : '');

  const handleSubmit = async () => {
    const parsed = sectionCreateSchema.safeParse({ title });
    if (!parsed.success) {
      showValidationIssuesToast(parsed.error, 'Please fix the section title.');
      return;
    }
    await onSubmit(parsed.data.title);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isRename ? 'Rename section' : 'Add section'}</DialogTitle>
          <DialogDescription>
            Sections group related lessons in the learning player.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="section-title">Section title</Label>
          <Input
            id="section-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g., Getting Started"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSubmit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
            {isRename ? 'Save' : 'Create section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lesson dialog (create + edit)
// ---------------------------------------------------------------------------

interface LessonDialogProps {
  // Non-null: the parent mounts this dialog only while it is open.
  state: NonNullable<LessonDialogState>;
  busy: boolean;
  onClose: () => void;
  onCreate: (
    sectionId: string,
    body: LessonCreateBody,
    videoFile: File | null,
    onProgress: (percent: number) => void,
  ) => Promise<boolean>;
  onUpdate: (
    lessonId: string,
    body: LessonUpdateBody,
    videoFile: File | null,
    onProgress: (percent: number) => void,
  ) => Promise<boolean>;
}

function LessonDialog({ state, busy, onClose, onCreate, onUpdate }: LessonDialogProps) {
  const isEdit = state.mode === 'edit';
  const lesson = isEdit ? state.lesson : null;

  const [title, setTitle] = useState(lesson?.title ?? '');
  const [type, setType] = useState<LessonTypeValue>(lesson?.type ?? 'VIDEO');
  // Duration is entered in minutes and stored as integer seconds.
  const [durationMinutes, setDurationMinutes] = useState(
    lesson ? String(lesson.durationSeconds / 60) : '0',
  );
  const [isPreview, setIsPreview] = useState(lesson?.isPreview ?? false);
  const [content, setContent] = useState(lesson?.content ?? '');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (!busy || !videoFile) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [busy, videoFile]);

  const durationSeconds = Math.round((Number(durationMinutes) || 0) * 60);

  const handleSubmit = async () => {
    const shared = { title, type, durationSeconds, isPreview };
    // On edit the type may have changed: null clears stale content/media.
    if (state.mode === 'create') {
      const createBody = {
        ...shared,
        ...(type === 'TEXT' && content.trim() !== '' ? { content } : {}),
      };
      const parsed = lessonCreateSchema.safeParse(createBody);
      if (!parsed.success) {
        showValidationIssuesToast(parsed.error, 'Please fix the highlighted lesson fields.');
        return;
      }
      const saved = await onCreate(state.section.id, parsed.data, videoFile, setUploadProgress);
      if (!saved) return;
    } else {
      const updateBody = {
        ...shared,
        content: type === 'TEXT' ? content : null,
        videoUrl: type === 'VIDEO' ? state.lesson.videoUrl : null,
      };
      const parsed = lessonUpdateSchema.safeParse(updateBody);
      if (!parsed.success) {
        showValidationIssuesToast(parsed.error, 'Please fix the highlighted lesson fields.');
        return;
      }
      const saved = await onUpdate(state.lesson.id, parsed.data, videoFile, setUploadProgress);
      if (!saved) return;
    }
    onClose();
  };

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit lesson' : 'Add lesson'}</DialogTitle>
          <DialogDescription>
            {state?.mode === 'create' && `New lessons are added at the end of "${state.section.title}".`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lesson-title">Lesson title</Label>
            <Input
              id="lesson-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g., Introduction to the Course"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lesson type</Label>
              <Select value={type} onValueChange={(value) => setType(value as LessonTypeValue)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {LESSON_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {LESSON_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-duration">Duration (minutes)</Label>
              <Input
                id="lesson-duration"
                type="number"
                min="0"
                step="0.1"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {formatLessonDuration(durationSeconds)} (max{' '}
                {formatLessonDuration(LESSON_DURATION_MAX_SECONDS)})
              </p>
            </div>
          </div>
          {type === 'TEXT' && (
            <div className="space-y-2">
              <Label htmlFor="lesson-content">Lesson content</Label>
              <Textarea
                id="lesson-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={6}
                placeholder="Write the lesson body here..."
              />
            </div>
          )}
          {type === 'VIDEO' && (
            <div className="space-y-2">
              <Label htmlFor="lesson-video">Recorded lecture video</Label>
              <Input
                id="lesson-video"
                type="file"
                accept={LESSON_VIDEO_CONTENT_TYPES.join(',')}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (!file) {
                    setVideoFile(null);
                    return;
                  }
                  if (!(LESSON_VIDEO_CONTENT_TYPES as readonly string[]).includes(file.type)) {
                    toast.error('Choose an MP4 or WebM lecture video.');
                    event.target.value = '';
                    return;
                  }
                  if (file.size > MAX_LESSON_VIDEO_BYTES) {
                    toast.error('The lecture video must be 20 GB or smaller.');
                    event.target.value = '';
                    return;
                  }
                  setVideoFile(file);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {videoFile
                  ? `${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`
                  : lesson?.videoFileName
                    ? `Current: ${lesson.videoFileName}${lesson.videoSizeBytes ? ` (${(lesson.videoSizeBytes / 1024 / 1024).toFixed(1)} MB)` : ''}`
                    : 'MP4 or WebM, up to 20 GB. Large uploads are split into retryable parts.'}
              </p>
              {busy && videoFile && uploadProgress > 0 && (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uploading {uploadProgress}% — keep this dialog open.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Checkbox
              id="lesson-preview"
              checked={isPreview}
              onCheckedChange={(checked) => setIsPreview(checked === true)}
            />
            <Label htmlFor="lesson-preview" className="text-sm font-normal cursor-pointer">
              Free preview lesson (visible to visitors before enrolling)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
            {isEdit ? 'Save lesson' : 'Create lesson'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Move-lesson dialog
// ---------------------------------------------------------------------------

interface MoveLessonDialogProps {
  course: OwnerCourseDetailDto;
  // Non-null: the parent mounts this dialog only while a lesson is targeted.
  lesson: OwnerLessonDto;
  busy: boolean;
  onClose: () => void;
  onSubmit: (sectionId: string, position: number) => Promise<void>;
}

function MoveLessonDialog({ course, lesson, busy, onClose, onSubmit }: MoveLessonDialogProps) {
  const otherSections = course.sections.filter((section) => section.id !== lesson.sectionId);
  // Mounted fresh per lesson, so defaulting to the first other section is safe.
  const [targetSectionId, setTargetSectionId] = useState(otherSections[0]?.id ?? '');

  const handleSubmit = async () => {
    if (!targetSectionId) return;
    const target = course.sections.find((section) => section.id === targetSectionId);
    // Appending keeps the action predictable: no position picker needed.
    const appendPosition = (target?.lessons.length ?? 0) + 1;
    await onSubmit(targetSectionId, appendPosition);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move lesson</DialogTitle>
          <DialogDescription>
            {`Move "${lesson.title}" to another section. It will be added at the end.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Target section</Label>
          <Select value={targetSectionId} onValueChange={setTargetSectionId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              {otherSections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  #{section.position} {section.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={busy || otherSections.length === 0}
          >
            {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
            Move lesson
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
