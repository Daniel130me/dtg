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
import { createCourse, listCategories } from '@/features/owner/api';
import {
  showActionErrorToast,
  showValidationIssuesToast,
} from '@/features/owner/toast-helpers';
import {
  createCourseSchema,
  COURSE_LEVELS,
} from '@/contracts/owner-courses';
import type { CourseLevelValue } from '@/contracts/owner-courses';
import type { CategoryDto } from '@/contracts/catalog';
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
    };

    const parsed = createCourseSchema.safeParse(body);
    if (!parsed.success) {
      showValidationIssuesToast(parsed.error, 'Please fix the highlighted fields.');
      return;
    }

    setSubmitting(true);
    try {
      const course = await createCourse(parsed.data);
      toast.success(`"${course.title}" has been created.`, {
        description: 'Add sections and lessons next — publishing happens in the editor.',
      });
      router.push(`/owner/courses/${course.id}`);
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

          {/* 2. Course Media (not backed by the authoring API yet) */}
          <motion.div variants={item}>
            <Card className="opacity-75">
              <CardHeader>
                <CardTitle className="text-base">2. Course Media</CardTitle>
                <CardDescription>
                  Thumbnail and promo video are not part of the authoring API yet — you will be
                  able to add them later.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Course Thumbnail</Label>
                  <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center bg-muted/30 cursor-not-allowed">
                    <div className="p-3 rounded-full bg-muted mb-3">
                      <ImageIcon className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Media uploads coming soon
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG, JPG or WebP (recommended: 1280×720)
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="promo-video">Promo Video Link</Label>
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="promo-video"
                      placeholder="Available after creation"
                      className="pl-9"
                      disabled
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 3. Curriculum (managed in the editor after creation) */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">3. Curriculum</CardTitle>
                <CardDescription>
                  Sections and lessons are added in the course editor right after creation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border border-dashed rounded-xl p-8 flex flex-col items-center justify-center bg-muted/30 text-center">
                  <div className="p-3 rounded-full bg-muted mb-3">
                    <Layers className="size-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">Curriculum editor opens after creation</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    A course needs at least one section with one lesson before it can be published.
                    You will be taken there automatically.
                  </p>
                  <Button variant="outline" size="sm" className="mt-4 border-dashed" disabled>
                    <Plus className="size-4 mr-2" />
                    Add Section
                  </Button>
                </div>
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
                    After creation you will land in the course editor to add sections and lessons —
                    the Publish button lives there.
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
