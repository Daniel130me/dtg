'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ImageIcon,
  Layers,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import InstructorLayout from './InstructorLayout';
import { createCourse, listCategories, uploadCourseThumbnail } from '@/features/owner/api';
import {
  showActionErrorToast,
  showValidationIssuesToast,
} from '@/features/owner/toast-helpers';
import {
  createCourseSchema,
  COURSE_LEVELS,
  LESSON_TYPES,
} from '@/contracts/owner-courses';
import type { CourseLevelValue, LessonTypeValue } from '@/contracts/owner-courses';
import type { CategoryDto } from '@/contracts/catalog';
import {
  COURSE_THUMBNAIL_CONTENT_TYPES,
  MAX_COURSE_THUMBNAIL_BYTES,
} from '@/contracts/course-media';
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
  videoUrl: string;
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
    videoUrl: '',
  };
}

export default function CreateCoursePage() {
  const router = useRouter();

  const [categories, setCategories] = useState<CategoryDto[]>([]);
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

  // Categories load: state updates only from the async callbacks, never
  // synchronously inside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    listCategories().then(
      (list) => {
        if (cancelled) return;
        setCategories(list);
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

  const retryCategories = () => {
    setCategoriesState('loading');
    setReloadToken((token) => token + 1);
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
          ...(lesson.type === 'VIDEO' && lesson.videoUrl.trim()
            ? { videoUrl: lesson.videoUrl.trim() }
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
      toast.success(`"${course.title}" has been created.`, {
        description: `${course.totalSections} section(s) and ${course.totalLessons} lesson(s) saved${
          thumbnailFile ? (thumbnailUploaded ? '; thumbnail uploaded.' : '; thumbnail needs retry.') : '.'
        }`,
      });
      router.push(`/owner/courses/${course.id}?tab=curriculum`);
    } catch (error) {
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
                    <Label>Category</Label>
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
                    <Label>Level</Label>
                    <Select
                      value={level === '' ? undefined : level}
                      onValueChange={(value) => setLevel(value as CourseLevelValue)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                      <SelectContent>
                        {COURSE_LEVELS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatLevel(option)}
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
                <div className="space-y-2">
                  <Label htmlFor="promo-video">Promo Video Link</Label>
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
            <Card>
              <CardHeader>
                <CardTitle className="text-base">3. Curriculum</CardTitle>
                <CardDescription>
                  Draft the initial sections and lessons. You can refine and reorder them later.
                </CardDescription>
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
                              <Input
                                type="url"
                                placeholder="Optional video URL"
                                value={lesson.videoUrl}
                                onChange={(event) =>
                                  updateLesson(section.clientId, lesson.clientId, {
                                    videoUrl: event.target.value,
                                  })
                                }
                              />
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
                    onClick={() => void handleSubmit()}
                    disabled={submitting || categoriesState !== 'ready'}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Create Course
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Bottom spacing */}
          <div className="h-8" />
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
