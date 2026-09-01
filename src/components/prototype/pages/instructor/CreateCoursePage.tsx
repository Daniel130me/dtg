'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BookOpen,
  ImageIcon,
  Layers,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import InstructorLayout from './InstructorLayout';
import CoursePreviewDialog from './CoursePreviewDialog';
import {
  createCourse,
  createOwnerCatalogOption,
  listOwnerCatalogOptions,
  listCategories,
  uploadCourseThumbnail,
  uploadLessonVideo,
} from '@/features/owner/api';
import {
  showActionErrorToast,
  showValidationIssuesToast,
} from '@/features/owner/toast-helpers';
import {
  createCourseSchema,
  LESSON_TYPES,
} from '@/contracts/owner-courses';
import type { CourseLevelValue, LessonTypeValue } from '@/contracts/owner-courses';
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
import { formatLevel } from '@/lib/client/format';

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

/** "49.9" (major units) -> 4990 minor units; invalid input -> null. */
function parsePriceToMinor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

interface DraftLesson {
  clientId: string;
  title: string;
  type: LessonTypeValue;
  durationMinutes: string;
  isPreview: boolean;
  content: string;
  videoFile: File | null;
}

interface DraftSection {
  clientId: string;
  title: string;
  lessons: DraftLesson[];
}

function createDraftLesson(): DraftLesson {
  return {
    clientId: crypto.randomUUID(),
    title: '',
    type: 'VIDEO',
    durationMinutes: '0',
    isPreview: false,
    content: '',
    videoFile: null,
  };
}

export default function CreateCoursePage() {
  const router = useRouter();

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [categoriesState, setCategoriesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [level, setLevel] = useState<CourseLevelValue | ''>('');
  const [language, setLanguage] = useState('English');
  const [priceInput, setPriceInput] = useState('0');
  const [isFree, setIsFree] = useState(true);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [promoVideoUrl, setPromoVideoUrl] = useState('');
  const [curriculum, setCurriculum] = useState<DraftSection[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [catalogDialog, setCatalogDialog] = useState<'category' | 'level' | null>(null);
  const [catalogName, setCatalogName] = useState('');
  const [videoUploadProgress, setVideoUploadProgress] = useState<{
    title: string;
    percent: number;
    current: number;
    total: number;
  } | null>(null);

  // Categories load: state updates only from the async callbacks, never
  // synchronously inside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    listOwnerCatalogOptions().then(
      ({ categories: categoryList, levels: levelList }) => {
        if (cancelled) return;
        setCategories(categoryList);
        setLevels(levelList);
        setCategoriesState('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        setCategoriesState('error');
        showActionErrorToast(error, 'Categories could not be loaded.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!videoUploadProgress) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [videoUploadProgress]);

  const retryCategories = () => {
    setCategoriesState('loading');
    setReloadToken((token) => token + 1);
  };

  const addCatalogOption = async (type: 'category' | 'level') => {
    const label = type === 'category' ? 'category' : 'level';
    const name = catalogName.trim();
    if (!name) return;
    try {
      await createOwnerCatalogOption(type, name);
      setCategoriesState('loading');
      setReloadToken((token) => token + 1);
      toast.success(`${name} added.`);
      setCatalogName('');
      setCatalogDialog(null);
    } catch (error) {
      showActionErrorToast(error, `The ${label} could not be added.`);
    }
  };

  const effectivePriceMinor = isFree ? 0 : parsePriceToMinor(priceInput);

  const handleThumbnailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setThumbnailFile(null);
      return;
    }
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

  const addSection = () => {
    setCurriculum((sections) => [
      ...sections,
      { clientId: crypto.randomUUID(), title: '', lessons: [] },
    ]);
  };

  const addLectureVideo = () => {
    const lesson = createDraftLesson();

    setCurriculum((sections) => {
      if (sections.length === 0) {
        return [
          {
            clientId: crypto.randomUUID(),
            title: '',
            lessons: [lesson],
          },
        ];
      }

      // Put the new lecture in the latest section. The owner can move it after
      // saving, while this keeps the one-click authoring action predictable.
      const targetSectionId = sections.at(-1)?.clientId;
      return sections.map((section) =>
        section.clientId === targetSectionId
          ? { ...section, lessons: [...section.lessons, lesson] }
          : section,
      );
    });

    // React commits the new lesson before the next paint, so the file control
    // can be brought into view without timing constants or a DOM polling loop.
    requestAnimationFrame(() => {
      const input = document.getElementById(`lesson-video-${lesson.clientId}`);
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
    });
  };

  const updateSectionTitle = (sectionId: string, value: string) => {
    setCurriculum((sections) =>
      sections.map((section) =>
        section.clientId === sectionId ? { ...section, title: value } : section,
      ),
    );
  };

  const removeSection = (sectionId: string) => {
    setCurriculum((sections) => sections.filter((section) => section.clientId !== sectionId));
  };

  const addLesson = (sectionId: string) => {
    setCurriculum((sections) =>
      sections.map((section) =>
        section.clientId === sectionId
          ? { ...section, lessons: [...section.lessons, createDraftLesson()] }
          : section,
      ),
    );
  };

  const updateLesson = (
    sectionId: string,
    lessonId: string,
    fields: Partial<Omit<DraftLesson, 'clientId'>>,
  ) => {
    setCurriculum((sections) =>
      sections.map((section) =>
        section.clientId === sectionId
          ? {
              ...section,
              lessons: section.lessons.map((lesson) =>
                lesson.clientId === lessonId ? { ...lesson, ...fields } : lesson,
              ),
            }
          : section,
      ),
    );
  };

  const removeLesson = (sectionId: string, lessonId: string) => {
    setCurriculum((sections) =>
      sections.map((section) =>
        section.clientId === sectionId
          ? {
              ...section,
              lessons: section.lessons.filter((lesson) => lesson.clientId !== lessonId),
            }
          : section,
      ),
    );
  };

  const handleLessonVideoChange = (
    sectionId: string,
    lessonId: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      updateLesson(sectionId, lessonId, { videoFile: null });
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
    updateLesson(sectionId, lessonId, { videoFile: file });
  };

  const handleSubmit = async () => {
    if (effectivePriceMinor === null) {
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
      priceMinor: effectivePriceMinor,
      ...(promoVideoUrl.trim() ? { promoVideoUrl: promoVideoUrl.trim() } : {}),
      curriculum: curriculum.map((section) => ({
        title: section.title,
        lessons: section.lessons.map((lesson) => ({
          title: lesson.title,
          type: lesson.type,
          durationSeconds: Math.round((Number(lesson.durationMinutes) || 0) * 60),
          isPreview: lesson.isPreview,
          ...(lesson.type === 'TEXT' && lesson.content.trim()
            ? { content: lesson.content.trim() }
            : {}),
        })),
      })),
    };

    const parsed = createCourseSchema.safeParse(body);
    if (!parsed.success) {
      showValidationIssuesToast(parsed.error, 'Please fix the highlighted fields.');
      return;
    }

    setSubmitting(true);
    try {
      const course = await createCourse(parsed.data);
      let thumbnailUploaded = false;
      if (thumbnailFile) {
        try {
          await uploadCourseThumbnail(course.id, thumbnailFile);
          thumbnailUploaded = true;
        } catch (error) {
          showActionErrorToast(
            error,
            'The course was created, but its thumbnail could not be uploaded.',
          );
        }
      }
      const pendingVideos = curriculum.flatMap((section, sectionIndex) =>
        section.lessons.flatMap((lesson, lessonIndex) =>
          lesson.type === 'VIDEO' && lesson.videoFile
            ? [{ sectionIndex, lessonIndex, draft: lesson, file: lesson.videoFile }]
            : [],
        ),
      );
      let uploadedVideoCount = 0;
      for (const [index, pending] of pendingVideos.entries()) {
        const createdLesson = course.sections[pending.sectionIndex]?.lessons[pending.lessonIndex];
        if (!createdLesson) continue;
        setVideoUploadProgress({
          title: pending.draft.title,
          percent: 0,
          current: index + 1,
          total: pendingVideos.length,
        });
        try {
          await uploadLessonVideo(createdLesson.id, pending.file, (percent) => {
            setVideoUploadProgress({
              title: pending.draft.title,
              percent,
              current: index + 1,
              total: pendingVideos.length,
            });
          });
          uploadedVideoCount += 1;
        } catch (error) {
          showActionErrorToast(
            error,
            `The course was created, but "${pending.draft.title}" needs its video uploaded again.`,
          );
        }
      }
      setVideoUploadProgress(null);
      toast.success(`"${course.title}" has been created.`, {
        description: `${course.totalSections} section(s) and ${course.totalLessons} lesson(s) saved${
          pendingVideos.length > 0
            ? `; ${uploadedVideoCount}/${pendingVideos.length} lecture video(s) uploaded`
            : ''
        }${
          thumbnailFile ? (thumbnailUploaded ? '; thumbnail uploaded.' : '; thumbnail needs retry.') : '.'
        }`,
      });
      router.push(`/owner/courses/${course.id}?tab=curriculum`);
    } catch (error) {
      setVideoUploadProgress(null);
      showActionErrorToast(error, 'The course could not be created.');
      setSubmitting(false);
      return;
    }
  };

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item}>
            <h1 className="text-2xl sm:text-3xl font-bold">Create New Course</h1>
            <p className="text-muted-foreground mt-1">
              Fill in the details below to create your new course.
            </p>
          </motion.div>

          {/* 1. Basic Info */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Basic Information</CardTitle>
                <CardDescription>Add the core details about your course.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Course Title</Label>
                  <Input
                    id="title"
                    placeholder="e.g., Complete Next.js 15 Masterclass"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="short-description">Short Description</Label>
                  <Input
                    id="short-description"
                    placeholder="One or two sentences shown on course cards"
                    value={shortDescription}
                    onChange={(event) => setShortDescription(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe what students will learn in this course..."
                    rows={4}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Category</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCatalogDialog('category')}>
                        <Plus className="mr-1 size-3" /> Add
                      </Button>
                    </div>
                    {categoriesState === 'loading' ? (
                      <Skeleton className="h-9 w-full" />
                    ) : categoriesState === 'error' ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={retryCategories}
                      >
                        <RefreshCw className="size-4 mr-2" />
                        Retry categories
                      </Button>
                    ) : (
                      <Select value={categoryId} onValueChange={setCategoryId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Level</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCatalogDialog('level')}>
                        <Plus className="mr-1 size-3" /> Add
                      </Button>
                    </div>
                    <Select
                      value={level === '' ? undefined : level}
                      onValueChange={(value) => setLevel(value as CourseLevelValue)}
                    >
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
                    <Label htmlFor="language">Language</Label>
                    <Input
                      id="language"
                      placeholder="e.g., English"
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 2. Course Media */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Course Media</CardTitle>
                <CardDescription>
                  Add a catalog thumbnail and an optional public promo-video link.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="course-thumbnail">Course Thumbnail</Label>
                  <label
                    htmlFor="course-thumbnail"
                    className="border-2 border-dashed rounded-xl p-8 flex cursor-pointer flex-col items-center justify-center bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/50"
                  >
                    <div className="p-3 rounded-full bg-muted mb-3">
                      {thumbnailFile ? (
                        <ImageIcon className="size-6 text-primary" />
                      ) : (
                        <Upload className="size-6 text-muted-foreground" />
                      )}
                    </div>
                    <p className="max-w-full truncate text-sm font-medium">
                      {thumbnailFile?.name ?? 'Choose a course thumbnail'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG, JPG or WebP · max 5 MB · recommended 1280×720
                    </p>
                  </label>
                  <Input
                    id="course-thumbnail"
                    type="file"
                    accept={COURSE_THUMBNAIL_CONTENT_TYPES.join(',')}
                    onChange={handleThumbnailChange}
                    className="sr-only"
                  />
                  {thumbnailFile && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setThumbnailFile(null)}>
                      Remove selected thumbnail
                    </Button>
                  )}
                </div>
                <Separator />
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background">
                      <Video className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Recorded lecture videos</p>
                      <p className="text-xs text-muted-foreground">
                        Upload MP4 or WebM files from your computer. Each recording is attached to
                        a video lesson in the curriculum.
                      </p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" onClick={addLectureVideo}>
                    <Upload className="mr-2 size-4" />
                    Add lecture video
                  </Button>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="promo-video">Optional promotional video link</Label>
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="promo-video"
                      type="url"
                      placeholder="https://youtube.com/watch?v=..."
                      className="pl-9"
                      value={promoVideoUrl}
                      onChange={(event) => setPromoVideoUrl(event.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 3. Curriculum */}
          <motion.div variants={item}>
            <Card id="course-curriculum">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base">3. Curriculum</CardTitle>
                    <CardDescription>
                      Draft the initial sections and lessons. Upload recordings inside video
                      lessons; you can refine and reorder them later.
                    </CardDescription>
                  </div>
                  <Button type="button" size="sm" onClick={addLectureVideo}>
                    <Upload className="mr-2 size-4" />
                    Add lecture video
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {curriculum.length === 0 ? (
                  <div className="border border-dashed rounded-xl p-8 flex flex-col items-center justify-center bg-muted/30 text-center">
                    <div className="p-3 rounded-full bg-muted mb-3">
                      <Layers className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Start the curriculum</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Add at least one section and one lesson before publishing.
                    </p>
                    <Button type="button" size="sm" className="mt-4" onClick={addLectureVideo}>
                      <Upload className="mr-2 size-4" />
                      Add your first video lesson
                    </Button>
                  </div>
                ) : (
                  curriculum.map((section, sectionIndex) => (
                    <div key={section.clientId} className="space-y-3 rounded-xl border p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">
                          {sectionIndex + 1}
                        </span>
                        <Input
                          aria-label={`Section ${sectionIndex + 1} title`}
                          placeholder="Section title"
                          value={section.title}
                          onChange={(event) => updateSectionTitle(section.clientId, event.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove section ${sectionIndex + 1}`}
                          onClick={() => removeSection(section.clientId)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className="space-y-3 pl-0 sm:pl-7">
                        {section.lessons.map((lesson, lessonIndex) => (
                          <div key={lesson.clientId} className="space-y-3 rounded-lg bg-muted/40 p-3">
                            <div className="grid gap-2 sm:grid-cols-[1fr_150px_90px_auto]">
                              <Input
                                aria-label={`Lesson ${lessonIndex + 1} title`}
                                placeholder="Lesson title"
                                value={lesson.title}
                                onChange={(event) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    title: event.target.value,
                                  })
                                }
                              />
                              <Select
                                value={lesson.type}
                                onValueChange={(value) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    type: value as LessonTypeValue,
                                  })
                                }
                              >
                                <SelectTrigger aria-label={`Lesson ${lessonIndex + 1} type`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {LESSON_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                      {type.charAt(0) + type.slice(1).toLowerCase()}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                aria-label={`Lesson ${lessonIndex + 1} duration in minutes`}
                                type="number"
                                min="0"
                                step="1"
                                value={lesson.durationMinutes}
                                onChange={(event) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    durationMinutes: event.target.value,
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove lesson ${lessonIndex + 1}`}
                                onClick={() => removeLesson(section.clientId, lesson.clientId)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                            {lesson.type === 'VIDEO' && (
                              <div className="space-y-2">
                                <Label htmlFor={`lesson-video-${lesson.clientId}`}>
                                  Recorded lecture video
                                </Label>
                                <Input
                                  id={`lesson-video-${lesson.clientId}`}
                                  type="file"
                                  accept={LESSON_VIDEO_CONTENT_TYPES.join(',')}
                                  onChange={(event) =>
                                    handleLessonVideoChange(
                                      section.clientId,
                                      lesson.clientId,
                                      event,
                                    )
                                  }
                                />
                                <p className="text-xs text-muted-foreground">
                                  {lesson.videoFile
                                    ? `${lesson.videoFile.name} (${(lesson.videoFile.size / 1024 / 1024).toFixed(1)} MB)`
                                    : 'MP4 or WebM, up to 20 GB. Upload starts after the course draft is created.'}
                                </p>
                              </div>
                            )}
                            {lesson.type === 'TEXT' && (
                              <Textarea
                                placeholder="Optional lesson content (Markdown supported)"
                                value={lesson.content}
                                onChange={(event) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    content: event.target.value,
                                  })
                                }
                              />
                            )}
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`preview-${lesson.clientId}`}
                                checked={lesson.isPreview}
                                onCheckedChange={(checked) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    isPreview: checked === true,
                                  })
                                }
                              />
                              <Label htmlFor={`preview-${lesson.clientId}`} className="font-normal">
                                Free preview lesson
                              </Label>
                            </div>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addLesson(section.clientId)}
                        >
                          <Plus className="size-4 mr-2" />
                          Add lesson
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                <Button type="button" variant="outline" onClick={addSection}>
                  <Plus className="size-4 mr-2" />
                  Add section
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* 4. Pricing */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">4. Pricing</CardTitle>
                <CardDescription>Set the price for your course or offer it for free.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isFree && (
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (USD)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        id="price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="49.99"
                        className="pl-7"
                        value={priceInput}
                        onChange={(event) => setPriceInput(event.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="free-course"
                    checked={isFree}
                    onCheckedChange={(checked) => setIsFree(checked === true)}
                  />
                  <Label htmlFor="free-course" className="text-sm font-normal cursor-pointer">
                    This is a free course
                  </Label>
                </div>
                {effectivePriceMinor === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Students will be able to enrol for free.
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* 5. Review & Create (publishing happens in the editor) */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">5. Review &amp; Create</CardTitle>
                <CardDescription>
                  Publishing becomes available in the course editor once the curriculum is ready.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>
                    The course, its curriculum, and media reference will be saved as a draft.
                    Publishing remains a separate review action in the editor.
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button variant="outline" className="gap-2" onClick={() => router.push('/owner/courses')}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviewOpen(true)}
                    disabled={submitting}
                    className="gap-2"
                  >
                    <BookOpen className="size-4" /> Preview course
                  </Button>
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={submitting || categoriesState !== 'ready'}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    {videoUploadProgress
                      ? `Uploading ${videoUploadProgress.current}/${videoUploadProgress.total}: ${videoUploadProgress.percent}%`
                      : 'Create Course'}
                  </Button>
                </div>
                {videoUploadProgress && (
                  <div className="space-y-1.5" aria-live="polite">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{ width: `${videoUploadProgress.percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Uploading “{videoUploadProgress.title}”. Keep this page open.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Bottom spacing */}
          <div className="h-8" />
        </motion.div>
      </div>
      <CoursePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={title}
        shortDescription={shortDescription}
        description={description}
        categoryName={categories.find((category) => category.id === categoryId)?.name ?? ''}
        level={level}
        language={language}
        sections={curriculum}
      />
      <Dialog
        open={catalogDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCatalogDialog(null);
            setCatalogName('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {catalogDialog === 'category' ? 'category' : 'level'}</DialogTitle>
            <DialogDescription>Create a reusable option for your course catalog.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="catalog-option-name">Name</Label>
            <Input
              id="catalog-option-name"
              autoFocus
              value={catalogName}
              onChange={(event) => setCatalogName(event.target.value)}
              placeholder={catalogDialog === 'category' ? 'e.g. Graphic Design' : 'e.g. Professional'}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (catalogDialog) void addCatalogOption(catalogDialog);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatalogDialog(null)}>Cancel</Button>
            <Button type="button" onClick={() => catalogDialog && void addCatalogOption(catalogDialog)} disabled={!catalogName.trim()}>
              Add {catalogDialog === 'category' ? 'category' : 'level'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InstructorLayout>
  );
}
