'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  HelpCircle,
  List,
  Loader2,
  Lock,
  PartyPopper,
  PenTool,
  PlayCircle,
  X,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import PlayerNotesPanel from '@/components/prototype/pages/student/player-notes-panel';
import PlayerQAPanel from '@/components/prototype/pages/student/player-qa-panel';
import PlayerQuizPanel from '@/components/prototype/pages/student/player-quiz-panel';
import PlayerAssignmentPanel from '@/components/prototype/pages/student/player-assignment-panel';
import { fetchCourseProgress, fetchLessonAccess, markLessonComplete } from '@/features/learning/api';
import { claimCertificate } from '@/features/learning/certificates-api';
import { ApiClientError } from '@/lib/client/api-client';
import { formatLessonDuration } from '@/lib/client/format';
import { LESSON_NOT_FOUND, type CourseProgressDto, type LessonAccessDto } from '@/contracts/learning';
import type { LessonType } from '@/contracts/catalog';
import { cn } from '@/lib/utils';

/**
 * The real course player (Phase 8). `[courseId]` in the route is the course
 * SLUG for prototype-historical reasons (same quirk as /courses/[courseId] —
 * see CourseDetailPage); `[lessonId]` is the lesson UUID.
 */

// --- Display maps -----------------------------------------------------------

const lessonTypeIconMap: Record<LessonType, React.ReactNode> = {
  VIDEO: <PlayCircle className='size-3.5' />,
  TEXT: <FileText className='size-3.5' />,
  QUIZ: <HelpCircle className='size-3.5' />,
  ASSIGNMENT: <PenTool className='size-3.5' />,
};

/** Tailwind-based prose styling for markdown lesson bodies (no extra deps). */
const markdownWrapperClasses =
  'text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 ' +
  '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:font-medium [&_h3]:mt-3 ' +
  '[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 ' +
  '[&_a]:text-primary [&_a]:underline [&_strong]:font-semibold ' +
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs ' +
  '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground ' +
  '[&_hr]:my-4 [&_img]:rounded-lg';

/** The three progress numbers the sidebar and celebration panel render. */
interface ProgressTotals {
  totalLessons: number;
  completedLessons: number;
  progressPercent: number;
}

// --- Loading skeleton -------------------------------------------------------

function PlayerSkeleton() {
  return (
    <div className='min-h-screen bg-background flex flex-col'>
      <header className='sticky top-0 z-40 bg-card border-b pt-safe'>
        <div className='flex items-center gap-3 px-3 sm:px-4 h-14'>
          <Skeleton className='size-9 rounded-md' />
          <Skeleton className='h-4 w-40' />
        </div>
      </header>
      <div className='flex-1 flex'>
        <div className='flex-1 p-4 sm:p-6 space-y-4'>
          <Skeleton className='aspect-video w-full max-h-[60vh] rounded-lg' />
          <Skeleton className='h-6 w-2/3' />
          <Skeleton className='h-4 w-1/3' />
          <Skeleton className='h-24 w-full' />
        </div>
        <aside className='hidden lg:flex flex-col w-80 xl:w-96 border-l bg-card p-4 space-y-3'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-4 w-48' />
          <Skeleton className='h-2 w-full' />
          <Skeleton className='h-32 w-full' />
          <Skeleton className='h-32 w-full' />
        </aside>
      </div>
    </div>
  );
}

// --- Curriculum sidebar (shared by the desktop aside and the mobile drawer) --

interface PlayerCurriculumProps {
  slug: string;
  lessonId: string;
  progress: CourseProgressDto;
  completedSet: Set<string>;
  totals: ProgressTotals;
  /** Preview badges matter while browsing without an enrolment. */
  showPreviewBadges: boolean;
  /** Lets the mobile drawer close itself when a lesson row is clicked. */
  onLessonClick?: () => void;
}

function PlayerCurriculum({ slug, lessonId, progress, completedSet, totals, showPreviewBadges, onLessonClick }: PlayerCurriculumProps) {
  // The accordion follows the current lesson's section until the learner
  // toggles sections themselves (openSections !== null afterwards).
  const [openSections, setOpenSections] = useState<string[] | null>(null);
  const currentSectionId =
    progress.sections.find((section) => section.lessons.some((lesson) => lesson.id === lessonId))?.id ??
    null;
  const accordionValue = openSections ?? (currentSectionId ? [currentSectionId] : []);

  return (
    <div className='flex flex-col h-full'>
      <div className='p-4 border-b space-y-3'>
        <Link
          href='/learning'
          className='inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors'
        >
          <ArrowLeft className='size-3.5' />
          Back to My Learning
        </Link>
        <Link href={`/courses/${encodeURIComponent(slug)}`} className='block'>
          <h3 className='font-semibold text-sm line-clamp-2 hover:text-primary transition-colors'>
            {progress.course.title}
          </h3>
        </Link>
        <div>
          <div className='flex items-center gap-2'>
            <Progress value={totals.progressPercent} className='h-1.5 flex-1' />
            <span className='text-xs font-medium text-muted-foreground shrink-0 tabular-nums'>
              {totals.progressPercent}%
            </span>
          </div>
          <p className='text-xs text-muted-foreground mt-1.5'>
            {totals.completedLessons} of {totals.totalLessons} lessons completed
          </p>
        </div>
      </div>

      <ScrollArea className='flex-1'>
        <div className='p-3'>
          <Accordion type='multiple' value={accordionValue} onValueChange={setOpenSections}>
            {progress.sections.map((section) => {
              const done = section.lessons.filter((lesson) => completedSet.has(lesson.id)).length;
              return (
                <AccordionItem key={section.id} value={section.id} className='border-b-0'>
                  <AccordionTrigger className='py-2 px-2 hover:no-underline rounded-lg hover:bg-muted text-left'>
                    <div className='flex-1 min-w-0'>
                      <p className='text-xs font-medium truncate'>{section.title}</p>
                      <p className='text-xs text-muted-foreground mt-0.5 font-normal'>
                        {done}/{section.lessons.length} lessons
                      </p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className='pb-2'>
                    <div className='ml-3 pl-3 border-l space-y-0.5'>
                      {section.lessons.map((lesson) => {
                        const isCurrent = lesson.id === lessonId;
                        const isCompleted = completedSet.has(lesson.id);
                        return (
                          <Link
                            key={lesson.id}
                            href={`/learning/${encodeURIComponent(slug)}/${encodeURIComponent(lesson.id)}`}
                            onClick={onLessonClick}
                            className={cn(
                              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-xs',
                              isCurrent
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className='size-3.5 shrink-0 text-emerald-600' />
                            ) : (
                              <span className='shrink-0'>{lessonTypeIconMap[lesson.type]}</span>
                            )}
                            <span className='flex-1 truncate'>{lesson.title}</span>
                            {showPreviewBadges && lesson.isPreview && (
                              <Badge variant='outline' className='text-[10px] px-1 py-0 h-4'>
                                Preview
                              </Badge>
                            )}
                            <span className='shrink-0 tabular-nums text-[10px]'>
                              {formatLessonDuration(lesson.durationSeconds)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}

// --- Page -------------------------------------------------------------------

export default function LearningPlayerPage() {
  const params = useParams<{ courseId: string; lessonId: string }>();
  const router = useRouter();
  // Route segment named `[courseId]` but holds the slug (see file header).
  const slug = params.courseId;
  const lessonId = params.lessonId;

  // Loading is DERIVED from the request key (house pattern): the effect only
  // writes state inside async callbacks, never synchronously.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${slug}|${lessonId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  const [lessonAccess, setLessonAccess] = useState<LessonAccessDto | null>(null);
  const [progress, setProgress] = useState<CourseProgressDto | null>(null);
  // ONE completion source: seeded from the progress DTO, then grown from the
  // ProgressResultDto of every markLessonComplete call.
  const [completedSet, setCompletedSet] = useState<Set<string>>(new Set());
  const [totals, setTotals] = useState<ProgressTotals | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  // Certificate claim pending guard (celebration panel affordance).
  const [claimingCertificate, setClaimingCertificate] = useState(false);
  // Coursera-style assessment gate for QUIZ/ASSIGNMENT lessons: the assessment
  // panels report satisfaction here so "Mark as complete" can explain itself.
  // Defaults to satisfied (VIDEO/TEXT lessons and pre-fetch states are ungated);
  // the server remains the authoritative gate either way.
  const [reportedAssessmentGate, setReportedAssessmentGate] = useState<{
    lessonId: string;
    satisfied: boolean;
    message: string | null;
  } | null>(null);
  // A report only applies to the lesson that produced it. This derives the
  // default for a newly selected lesson without a synchronous effect update.
  const assessmentGate =
    reportedAssessmentGate?.lessonId === lessonId
      ? reportedAssessmentGate
      : { satisfied: true, message: null };

  const handleGateChange = useCallback((satisfied: boolean, message: string | null) => {
    setReportedAssessmentGate((prev) =>
      prev?.lessonId === lessonId && prev.satisfied === satisfied && prev.message === message
        ? prev
        : { lessonId, satisfied, message },
    );
  }, [lessonId]);

  useEffect(() => {
    let cancelled = false;
    // Lesson access resolves first; the course progress read is keyed by the
    // course SLUG, and the `[courseId]` URL param is not always a slug (some
    // notification deep links fall back to the course UUID) — so the progress
    // call uses the slug from the access payload, never the raw URL param.
    const load = async () => {
      try {
        const accessDto = await fetchLessonAccess(lessonId);
        if (cancelled) return;
        setLessonAccess(accessDto);
        setNotFound(false);
        setLoadError(null);
        try {
          const progressDto = await fetchCourseProgress(accessDto.course.slug || slug);
          if (cancelled) return;
          setProgress(progressDto);
          setCompletedSet(
            new Set(
              progressDto.sections.flatMap((section) =>
                section.lessons.filter((lesson) => lesson.completed).map((lesson) => lesson.id),
              ),
            ),
          );
          setTotals({
            totalLessons: progressDto.totalLessons,
            completedLessons: progressDto.completedLessons,
            progressPercent: progressDto.progressPercent,
          });
        } catch (progressErr: unknown) {
          if (cancelled) return;
          // Only a still-current progress failure may latch the error UI — a
          // superseded attempt is filtered by the cancelled guard above, and
          // while a matching attempt is in flight the requestKey loading gate
          // renders the skeleton instead of this branch.
          setLoadError(
            progressErr instanceof Error
              ? progressErr.message
              : 'Failed to load the course curriculum.',
          );
        }
      } catch (accessErr: unknown) {
        if (cancelled) return;
        if (
          accessErr instanceof ApiClientError &&
          accessErr.status === 404 &&
          accessErr.code === LESSON_NOT_FOUND
        ) {
          setNotFound(true);
        } else {
          setLoadError(accessErr instanceof Error ? accessErr.message : 'Failed to load this lesson.');
        }
      } finally {
        // Only the still-current attempt may close out the request key; a
        // superseded one stays cancelled and cannot flip the loading gate.
        if (!cancelled) setLoadedKey(requestKey);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, lessonId, requestKey]);

  const accessLevel = lessonAccess?.access ?? null;
  const isEnrolled = accessLevel === 'ENROLLED';
  const isCurrentCompleted = completedSet.has(lessonId);

  // Mirrors ProgressResultDto.courseCompleted without an extra request: with
  // monotonic completion, percent reaches 100 exactly when the course is done.
  const courseCompleted = Boolean(
    isEnrolled && totals && totals.totalLessons > 0 && totals.completedLessons >= totals.totalLessons,
  );

  // Flat lesson list from the progress DTO for the "x / y" position readout.
  const flatLessons = useMemo(
    () => progress?.sections.flatMap((section) => section.lessons) ?? [],
    [progress],
  );
  const currentIndex = flatLessons.findIndex((lesson) => lesson.id === lessonId);

  async function handleMarkComplete() {
    if (!lessonAccess || completing || isCurrentCompleted) return;
    setCompleting(true);
    try {
      const result = await markLessonComplete(lessonId);
      setCompletedSet((prev) => new Set(prev).add(result.lessonId));
      setTotals({
        totalLessons: result.totalLessons,
        completedLessons: result.completedLessons,
        progressPercent: result.progressPercent,
      });
    } catch (err: unknown) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not mark this lesson complete.',
      );
    } finally {
      setCompleting(false);
    }
  }

  /** Claim is idempotent server-side; CERTIFICATE_NOT_ELIGIBLE surfaces the
   *  honest unmet-requirements message from the API. */
  async function handleClaimCertificate() {
    if (claimingCertificate) return;
    setClaimingCertificate(true);
    try {
      // The claim endpoint is slug-keyed; prefer the payload slug (the URL
      // param can be a UUID on notification deep links).
      await claimCertificate(lessonAccess?.course.slug || slug);
      toast.success('Certificate issued');
      router.push('/certificates');
    } catch (err: unknown) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not claim your certificate.',
      );
    } finally {
      setClaimingCertificate(false);
    }
  }

  function goToLesson(target: { id: string } | null) {
    if (!target) return;
    router.push(`/learning/${encodeURIComponent(slug)}/${encodeURIComponent(target.id)}`);
  }

  if (loading) {
    return <PlayerSkeleton />;
  }

  if (notFound) {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-6'>
        <div className='text-center'>
          <div className='size-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
            <FileText className='size-7 text-muted-foreground' />
          </div>
          <h1 className='font-semibold text-lg mb-1'>Lesson not found</h1>
          <p className='text-sm text-muted-foreground mb-4'>
            This lesson doesn&apos;t exist or the link is out of date.
          </p>
          <Button asChild variant='outline' className='gap-1.5'>
            <Link href={`/courses/${encodeURIComponent(slug)}`}>
              <ArrowLeft className='size-4' />
              Back to course
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (loadError || !lessonAccess || !progress || !totals) {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-6'>
        <FetchErrorState
          title='Could not load this lesson'
          message={loadError ?? undefined}
          onRetry={() => setRetrySeed((seed) => seed + 1)}
        />
      </div>
    );
  }

  const { lesson } = lessonAccess;

  // --- Lesson body per type -------------------------------------------------
  let lessonBody: React.ReactNode;
  if (lesson.type === 'VIDEO') {
    lessonBody = lesson.videoUrl ? (
      <video
        controls
        src={lesson.videoUrl}
        className='w-full rounded-lg aspect-video bg-black'
      />
    ) : (
      <div className='rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground'>
        No video has been published for this lesson yet.
      </div>
    );
  } else if (lesson.type === 'TEXT') {
    lessonBody = lesson.content ? (
      <div className={markdownWrapperClasses}>
        <ReactMarkdown>{lesson.content}</ReactMarkdown>
      </div>
    ) : (
      <div className='rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground'>
        No content has been published for this lesson yet.
      </div>
    );
  } else {
    // QUIZ / ASSIGNMENT (Phase 9): the real assessment panels render for
    // enrolled learners (access gating is decided here, same as notes);
    // preview visitors get the enroll message. The panels also report the
    // Coursera-style completion gate (pass the quiz / submit the assignment).
    lessonBody = isEnrolled ? (
      lesson.type === 'QUIZ' ? (
        <PlayerQuizPanel
          lessonId={lessonId}
          onGateChange={handleGateChange}
          onComplete={() => {
            void handleMarkComplete();
          }}
        />
      ) : (
        <PlayerAssignmentPanel
          lessonId={lessonId}
          onGateChange={handleGateChange}
          onComplete={() => {
            void handleMarkComplete();
          }}
        />
      )
    ) : (
      <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
        {lesson.type === 'QUIZ' ? (
          <HelpCircle className='mt-0.5 size-4 shrink-0 text-amber-600' />
        ) : (
          <PenTool className='mt-0.5 size-4 shrink-0 text-amber-600' />
        )}
        <p className='text-sm text-amber-800 dark:text-amber-200'>
          {lesson.type === 'QUIZ' ? 'Quizzes' : 'Assignments'} are available after enrolling in the
          course.
        </p>
      </div>
    );
  }

  const curriculum = (
    <PlayerCurriculum
      slug={slug}
      lessonId={lessonId}
      progress={progress}
      completedSet={completedSet}
      totals={totals}
      showPreviewBadges={accessLevel !== 'ENROLLED'}
    />
  );

  const mobileCurriculum = (
    <PlayerCurriculum
      slug={slug}
      lessonId={lessonId}
      progress={progress}
      completedSet={completedSet}
      totals={totals}
      showPreviewBadges={accessLevel !== 'ENROLLED'}
      onLessonClick={() => setCurriculumOpen(false)}
    />
  );

  return (
    <div className='min-h-screen bg-background flex flex-col'>
      {/* Top bar — pt-safe clears the status bar in PWA standalone mode */}
      <header className='sticky top-0 z-40 bg-card border-b pt-safe'>
        <div className='flex items-center justify-between px-3 sm:px-4 h-14'>
          <div className='flex items-center gap-2 min-w-0'>
            <Button asChild variant='ghost' size='icon' className='min-h-11 min-w-11 shrink-0'>
              <Link href='/learning' aria-label='Back to My Learning'>
                <ArrowLeft className='size-4' />
              </Link>
            </Button>
            <div className='min-w-0 hidden sm:block'>
              <p className='text-sm font-medium truncate'>{lessonAccess.course.title}</p>
              <p className='text-xs text-muted-foreground truncate'>{lesson.title}</p>
            </div>
            <div className='min-w-0 sm:hidden'>
              <p className='text-sm font-medium truncate'>{lesson.title}</p>
            </div>
          </div>

          <div className='flex items-center gap-2 shrink-0'>
            <Button
              variant='outline'
              size='sm'
              className='lg:hidden min-h-11 gap-1.5'
              onClick={() => setCurriculumOpen(true)}
              aria-label='Open curriculum'
            >
              <List className='size-4' />
              <span className='hidden sm:inline'>Curriculum</span>
            </Button>
            <div className='hidden md:flex items-center gap-2 bg-muted rounded-full px-3 py-1.5'>
              <Progress value={totals.progressPercent} className='h-1.5 w-24' />
              <span className='text-xs font-medium tabular-nums'>{totals.progressPercent}%</span>
            </div>
          </div>
        </div>
      </header>

      <div className='flex-1 flex'>
        {/* Left: lesson content + notes/Q&A */}
        <div className='flex-1 flex flex-col min-w-0'>
          {/* Bottom padding keeps the last content lines clear of the sticky bar */}
          <div className='p-4 pb-6 sm:p-6 sm:pb-8 space-y-4 flex-1'>
            {/* Preview banner */}
            {accessLevel === 'PREVIEW' && (
              <div className='flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                <Eye className='size-4 shrink-0' />
                Preview lesson — enroll to unlock the full course.
              </div>
            )}

            {/* Lesson header */}
            <div className='flex items-start justify-between gap-4'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='text-primary'>{lessonTypeIconMap[lesson.type]}</span>
                  <Badge variant='secondary' className='text-xs'>
                    {lesson.type}
                  </Badge>
                </div>
                <h1 className='text-lg sm:text-xl font-bold mt-2'>{lesson.title}</h1>
                <p className='text-sm text-muted-foreground mt-1'>
                  {lessonAccess.sectionTitle} · {formatLessonDuration(lesson.durationSeconds)}
                </p>
              </div>
              <div className='flex items-center gap-1.5 text-xs text-muted-foreground shrink-0'>
                <Clock className='size-3.5' />
                {formatLessonDuration(lesson.durationSeconds)}
              </div>
            </div>

            {/* Locked panel for non-enrolled, non-preview lessons */}
            {accessLevel === 'NONE' ? (
              <Card className='p-8 text-center'>
                <div className='size-14 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
                  <Lock className='size-6 text-muted-foreground' />
                </div>
                <h2 className='font-semibold mb-1'>This lesson is part of the course</h2>
                <p className='text-sm text-muted-foreground mb-4'>
                  Enroll in <span className='font-medium text-foreground'>{lessonAccess.course.title}</span>{' '}
                  to unlock every lesson, plus notes and Q&amp;A.
                </p>
                <Button asChild className='gap-1.5'>
                  <Link href={`/courses/${encodeURIComponent(slug)}`}>Go to course page</Link>
                </Button>
              </Card>
            ) : (
              lessonBody
            )}

            {/* Completion (enrolled learners only) */}
            {isEnrolled && (
              <div className='flex flex-col items-end gap-1'>
                {isCurrentCompleted ? (
                  <Button variant='secondary' disabled className='min-h-11 gap-1.5'>
                    <CheckCircle2 className='size-4 text-emerald-600' />
                    Completed
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={handleMarkComplete}
                      disabled={completing || !assessmentGate.satisfied}
                      className='min-h-11 gap-1.5'
                    >
                      {completing && <Loader2 className='size-4 animate-spin' />}
                      Mark as complete
                    </Button>
                    {!assessmentGate.satisfied && assessmentGate.message && (
                      <p className='text-xs text-amber-600 dark:text-amber-400'>
                        {assessmentGate.message}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Course celebration */}
            {courseCompleted && (
              <div className='flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950'>
                <PartyPopper className='size-5 shrink-0 text-emerald-600' />
                <div className='flex-1'>
                  <p className='text-sm font-semibold text-emerald-800 dark:text-emerald-200'>
                    Course complete! 🎉
                  </p>
                  <p className='text-xs text-emerald-700/80 dark:text-emerald-300/80'>
                    You finished every lesson in {lessonAccess.course.title}.
                  </p>
                </div>
                <div className='flex shrink-0 flex-col gap-2 sm:flex-row'>
                  <Button
                    size='sm'
                    onClick={handleClaimCertificate}
                    disabled={claimingCertificate}
                    className='gap-1.5'
                  >
                    {claimingCertificate && <Loader2 className='size-3.5 animate-spin' />}
                    Get your certificate
                  </Button>
                  <Button asChild size='sm' variant='outline'>
                    <Link href='/learning'>Back to My Learning</Link>
                  </Button>
                </div>
              </div>
            )}

            {/* Notes & Q&A */}
            <Tabs defaultValue='notes'>
              <TabsList className='h-auto p-0 bg-transparent gap-0'>
                <TabsTrigger
                  value='notes'
                  className='min-h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm'
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value='qa'
                  className='min-h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm'
                >
                  Q&amp;A
                </TabsTrigger>
              </TabsList>

              <TabsContent value='notes' className='pt-4'>
                {isEnrolled ? (
                  <PlayerNotesPanel lessonId={lessonId} />
                ) : (
                  <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
                    <Lock className='size-4 shrink-0 text-amber-600 mt-0.5' />
                    <p className='text-sm text-amber-800 dark:text-amber-200'>
                      Notes are available after enrolling.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value='qa' className='pt-4'>
                {/* The panel maps a 422 from the API to the enroll message itself;
                    preview reads (if allowed) render the list without the forms. */}
                <PlayerQAPanel lessonId={lessonId} canParticipate={isEnrolled} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Prev / Next navigation — bottom padding clears the home indicator
              in PWA standalone (desktop keeps the original p-3 sm:p-4 rhythm) */}
          <div
            className={cn(
              'border-t bg-card px-3 pt-3 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]',
              'sm:px-4 sm:pt-4 sm:pb-4 flex items-center justify-between sticky bottom-0',
            )}
          >
            <Button
              variant='outline'
              onClick={() => goToLesson(lessonAccess.prevLesson)}
              disabled={!lessonAccess.prevLesson}
              className='min-h-11 gap-1.5'
            >
              <ChevronLeft className='size-4' />
              <span className='hidden sm:inline'>Previous</span>
            </Button>

            <div className='text-xs text-muted-foreground text-center'>
              {currentIndex >= 0 && flatLessons.length > 0 && (
                <>
                  <span className='font-medium text-foreground tabular-nums'>{currentIndex + 1}</span>
                  {` / ${flatLessons.length}`}
                </>
              )}
            </div>

            <Button
              onClick={() => goToLesson(lessonAccess.nextLesson)}
              disabled={!lessonAccess.nextLesson}
              className='min-h-11 gap-1.5'
            >
              <span className='hidden sm:inline'>Next</span>
              <ChevronRight className='size-4' />
            </Button>
          </div>
        </div>

        {/* Right: curriculum sidebar (desktop) */}
        <aside className='hidden lg:flex flex-col w-80 xl:w-96 border-l bg-card shrink-0'>
          {curriculum}
        </aside>
      </div>

      {/* Mobile curriculum drawer — vaul right drawer: swipe-to-dismiss,
          scroll lock and focus a11y for free (replaces the hand-rolled
          framer-motion aside). Trigger stays the top-bar Curriculum button. */}
      <Drawer direction='right' open={curriculumOpen} onOpenChange={setCurriculumOpen}>
        <DrawerContent className='w-[85vw] max-w-[85vw] sm:w-80 sm:max-w-sm overflow-hidden'>
          <div className='flex items-center justify-between border-b p-4'>
            <div>
              <DrawerTitle className='font-semibold'>Curriculum</DrawerTitle>
              <DrawerDescription className='sr-only'>
                Course sections and lessons
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button
                variant='ghost'
                size='icon'
                className='min-h-11 min-w-11 shrink-0'
                aria-label='Close curriculum'
              >
                <X className='size-4' />
              </Button>
            </DrawerClose>
          </div>
          <div className='min-h-0 flex-1 custom-scrollbar'>{mobileCurriculum}</div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
