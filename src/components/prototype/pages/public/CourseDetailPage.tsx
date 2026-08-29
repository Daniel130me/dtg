'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Clock, Users, Globe, PlayCircle, FileText, HelpCircle, ClipboardList, CheckCircle2, Eye, Lock, BookOpen, BarChart3, Cloud, Code, Palette, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import StarRating from '@/components/prototype/shared/StarRating';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { fetchCourseDetail } from '@/features/catalog/api';
import { ApiClientError } from '@/lib/client/api-client';
import { formatCount, formatDuration, formatLessonDuration, formatLevel, formatPrice } from '@/lib/client/format';
import type { CourseDetailDto, CourseLessonDto } from '@/contracts/catalog';

type DetailLessonType = CourseLessonDto['type'];

const lessonIconMap: Record<DetailLessonType, React.ReactNode> = {
  'VIDEO': <PlayCircle className='size-4 text-primary' />,
  'TEXT': <FileText className='size-4 text-amber-600' />,
  'QUIZ': <HelpCircle className='size-4 text-orange-500' />,
  'ASSIGNMENT': <ClipboardList className='size-4 text-rose-500' />,
};

/** Gradient placeholders keyed by category slug (same palette as CourseCard). */
const categoryGradients: Record<string, string> = {
  'web-development': 'from-[#1d4ed8] to-[#0a1a3e]',
  'data-science': 'from-[#2563eb] to-[#0f2847]',
  'mobile-development': 'from-[#3b82f6] to-[#1e3a8a]',
  'devops-and-cloud': 'from-[#0f2847] to-[#0a1a3e]',
  'design-and-ui-ux': 'from-[#4338ca] to-[#0a1a3e]',
};

const categoryIconNameMap: Record<string, string> = {
  'web-development': 'Code',
  'data-science': 'BarChart3',
  'mobile-development': 'Smartphone',
  'devops-and-cloud': 'Cloud',
  'design-and-ui-ux': 'Palette',
};

const categoryIconMap: Record<string, React.ReactNode> = {
  'Code': <Code className='size-20 text-white/70' />,
  'BarChart3': <BarChart3 className='size-20 text-white/70' />,
  'Smartphone': <Smartphone className='size-20 text-white/70' />,
  'Cloud': <Cloud className='size-20 text-white/70' />,
  'Palette': <Palette className='size-20 text-white/70' />,
};

const DEFAULT_GRADIENT = 'from-[#1d4ed8] to-[#0a1a3e]';

function DetailSkeleton() {
  return (
    <main className='flex-1'>
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'>
        <div className='grid lg:grid-cols-3 gap-8'>
          <div className='lg:col-span-2 space-y-4'>
            <div className='flex gap-2'>
              <Skeleton className='h-5 w-24' />
              <Skeleton className='h-5 w-28' />
            </div>
            <Skeleton className='h-10 w-3/4' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
            <Skeleton className='h-5 w-44' />
            <div className='flex gap-4 pt-2'>
              <Skeleton className='h-4 w-28' />
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-16' />
            </div>
          </div>
          <Card className='p-0 overflow-hidden gap-0 h-fit'>
            <Skeleton className='h-40 w-full rounded-b-none' />
            <CardContent className='p-6 space-y-3'>
              <Skeleton className='h-9 w-1/2' />
              <Skeleton className='h-10 w-full' />
              <Skeleton className='h-3 w-2/3 mx-auto' />
              <Skeleton className='h-24 w-full' />
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  // The route segment is named `[courseId]` for prototype-historical reasons, but
  // its value is the course SLUG (e.g. /courses/nextjs-masterclass) — the catalog
  // API looks courses up by slug, so we treat it as one.
  const slug = params.courseId;

  // Loading is DERIVED from the request key (see HomePage) so effects never
  // call setState synchronously; all state writes happen in async callbacks.
  const [course, setCourse] = useState<CourseDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${slug}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchCourseDetail(slug)
      .then((dto) => {
        if (cancelled) return;
        setCourse(dto);
        setNotFound(false);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load this course.');
        }
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, requestKey]);

  if (loading) return <DetailSkeleton />;

  if (notFound) {
    return (
      <main className='flex-1'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center'>
          <div className='size-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
            <BookOpen className='size-7 text-muted-foreground' />
          </div>
          <h1 className='font-semibold text-lg mb-1'>Course not found</h1>
          <p className='text-sm text-muted-foreground mb-6 max-w-sm mx-auto'>
            This course doesn&apos;t exist or is no longer published. Browse the catalog to find something else.
          </p>
          <Button variant='outline' asChild>
            <Link href='/courses'>Browse Courses</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (error || !course) {
    return (
      <main className='flex-1'>
        <FetchErrorState
          title="Couldn't load this course"
          message={error ?? undefined}
          onRetry={() => setRetrySeed((s) => s + 1)}
          className='py-24'
        />
      </main>
    );
  }

  const gradient = categoryGradients[course.categorySlug] ?? DEFAULT_GRADIENT;
  const iconKey = categoryIconNameMap[course.categorySlug] ?? 'Code';
  const bioFirstSentence = course.instructor.bio
    ? `${course.instructor.bio.split('.')[0]}.`
    : 'This instructor has not added a bio yet.';
  const instructorInitials = course.instructor.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  const firstSectionId = course.sections[0]?.id;

  return (
    <main className='flex-1'>
      {/* Back Button */}
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4'>
        <Button variant='ghost' size='sm' asChild className='gap-1.5 text-muted-foreground hover:text-foreground'>
          <Link href='/courses'>
            <ArrowLeft className='size-4' /> Back to Courses
          </Link>
        </Button>
      </div>

      {/* Course Header */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'>
        <div className='grid lg:grid-cols-3 gap-8'>
          <div className='lg:col-span-2'>
            <div className='flex flex-wrap gap-2 mb-3'>
              <Badge>{formatLevel(course.level)}</Badge>
              <Badge variant='secondary' asChild>
                <Link href={`/courses?category=${course.categorySlug}`}>{course.categoryName}</Link>
              </Badge>
              {course.badge === 'popular' && <Badge className='bg-orange-500 text-white border-orange-500'>Popular</Badge>}
              {course.badge === 'new' && <Badge className='bg-amber-500 text-white border-amber-500'>New</Badge>}
            </div>
            <h1 className='text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 leading-tight'>{course.title}</h1>
            <p className='text-muted-foreground leading-relaxed mb-4'>{course.description}</p>
            {course.ratingAverage !== null ? (
              <StarRating rating={course.ratingAverage} size='lg' showCount count={course.ratingCount} />
            ) : (
              <span className='text-sm text-muted-foreground'>No ratings yet</span>
            )}
            <div className='flex items-center gap-2 mt-2 text-sm text-muted-foreground'>
              <span>Created by <span className='text-foreground font-medium'>{course.instructor.name}</span></span>
            </div>
            {/* Stats row */}
            <div className='flex flex-wrap items-center gap-4 mt-4 text-sm text-muted-foreground'>
              <span className='flex items-center gap-1.5'><Users className='size-4' /> {formatCount(course.enrollmentCount)} students</span>
              <span className='flex items-center gap-1.5'><Clock className='size-4' /> {formatDuration(course.totalMinutes)}</span>
              <span className='flex items-center gap-1.5'><Globe className='size-4' /> {course.language}</span>
              <span className='flex items-center gap-1.5'><BookOpen className='size-4' /> {course.totalLessons} lessons</span>
            </div>
          </div>

          {/* Sidebar Card */}
          <div>
            <Card className='sticky top-20 p-0 overflow-hidden gap-0'>
              <div className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                {categoryIconMap[iconKey] ?? <BookOpen className='size-20 text-white/70' />}
              </div>
              <CardContent className='p-6'>
                <div className='text-3xl font-bold mb-1'>
                  {course.isFree ? (
                    <span className='text-[#1d4ed8]'>{formatPrice(course.priceMinor, course.currency)}</span>
                  ) : (
                    <>{formatPrice(course.priceMinor, course.currency)}</>
                  )}
                </div>
                <p className='text-xs text-muted-foreground mb-5'>30-day money-back guarantee</p>

                {/* Enrolment is a later phase — the CTA is disabled until payments land. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className='block w-full cursor-not-allowed'>
                      <Button className='w-full' size='lg' disabled>
                        {course.isFree ? 'Enroll' : 'Enroll Now'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Enrolment opens soon</TooltipContent>
                </Tooltip>

                <p className='text-center text-xs text-muted-foreground mt-3'>Includes {course.totalSections} sections &middot; {course.totalLessons} lessons</p>

                <div className='mt-5 space-y-3 text-sm'>
                  <h3 className='font-semibold text-sm'>This course includes:</h3>
                  <ul className='space-y-2 text-muted-foreground'>
                    <li className='flex items-center gap-2'><PlayCircle className='size-4 text-primary shrink-0' /> {formatDuration(course.totalMinutes)} of video content</li>
                    <li className='flex items-center gap-2'><FileText className='size-4 text-primary shrink-0' /> Downloadable resources</li>
                    <li className='flex items-center gap-2'><HelpCircle className='size-4 text-primary shrink-0' /> Quizzes & assignments</li>
                    <li className='flex items-center gap-2'><CheckCircle2 className='size-4 text-primary shrink-0' /> Certificate of completion</li>
                    <li className='flex items-center gap-2'><Globe className='size-4 text-primary shrink-0' /> Full lifetime access</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* What You'll Learn */}
      {course.outcomes.length > 0 && (
        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
          <Card className='p-6'>
            <h2 className='text-lg font-bold mb-4'>What You&apos;ll Learn</h2>
            <div className='grid sm:grid-cols-2 gap-3'>
              {course.outcomes.map((item, i) => (
                <div key={i} className='flex items-start gap-2.5'>
                  <CheckCircle2 className='size-5 text-primary shrink-0 mt-0.5' />
                  <span className='text-sm text-muted-foreground'>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* Requirements */}
      {course.requirements.length > 0 && (
        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
          <Card className='p-6'>
            <h2 className='text-lg font-bold mb-4'>Requirements</h2>
            <ul className='space-y-2.5'>
              {course.requirements.map((item, i) => (
                <li key={i} className='flex items-start gap-2.5'>
                  <span className='size-1.5 rounded-full bg-primary mt-2 shrink-0' />
                  <span className='text-sm text-muted-foreground'>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Curriculum */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-bold'>Course Curriculum</h2>
          <span className='text-sm text-muted-foreground'>{course.sections.length} sections &middot; {course.totalLessons} lessons &middot; {formatDuration(course.totalMinutes)} total</span>
        </div>
        {course.sections.length > 0 ? (
          <Accordion type='multiple' defaultValue={firstSectionId ? [firstSectionId] : []} className='w-full'>
            {course.sections.map((section) => (
              <AccordionItem key={section.id} value={section.id}>
                <AccordionTrigger className='hover:no-underline'>
                  <div className='flex items-center gap-3 text-left'>
                    <span className='text-sm font-semibold'>{section.title}</span>
                    <span className='text-xs text-muted-foreground'>{section.lessons.length} lessons</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className='space-y-1'>
                    {section.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className='flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors'
                      >
                        <div className='flex items-center gap-3'>
                          {lessonIconMap[lesson.type]}
                          <span className='text-sm'>{lesson.title}</span>
                          {lesson.isPreview ? (
                            <Badge variant='secondary' className='text-[10px] gap-1'>
                              <Eye className='size-3' /> Preview
                            </Badge>
                          ) : (
                            <Lock className='size-3.5 text-muted-foreground/60' />
                          )}
                        </div>
                        <span className='text-xs text-muted-foreground'>{formatLessonDuration(lesson.durationSeconds)}</span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <Card className='p-8 text-center'>
            <p className='text-muted-foreground'>The curriculum for this course is being prepared.</p>
          </Card>
        )}
      </section>

      {/* Instructor Card */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-16'>
        <Card className='p-6'>
          <h2 className='text-lg font-bold mb-4'>Instructor</h2>
          <div className='flex flex-col sm:flex-row gap-5 items-start'>
            <div className='size-16 rounded-xl bg-gradient-to-br from-[#1d4ed8] to-[#0a1a3e] flex items-center justify-center shrink-0'>
              <span className='text-xl font-bold text-white'>{instructorInitials}</span>
            </div>
            <div className='flex-1'>
              <p className='text-base font-bold'>{course.instructor.name}</p>
              <p className='text-sm text-primary mb-2'>{course.instructor.title}</p>
              <p className='text-sm text-muted-foreground leading-relaxed'>
                {bioFirstSentence}
              </p>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
