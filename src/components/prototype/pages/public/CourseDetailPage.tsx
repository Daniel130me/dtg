'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Clock, Users, Globe, PlayCircle, FileText, HelpCircle, ClipboardList, CheckCircle2, Eye, Lock, BookOpen, BarChart3, Cloud, Code, Palette, Smartphone, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import StarRating from '@/components/prototype/shared/StarRating';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import CourseReviewsSection from '@/components/prototype/pages/public/CourseReviewsSection';
import { fetchCourseDetail } from '@/features/catalog/api';
import { enrollInCourse, fetchCourseEnrolmentState, reconcileOrder, startCheckout } from '@/features/learning/api';
import { ApiClientError } from '@/lib/client/api-client';
import { authClient } from '@/lib/client/auth-client';
import { formatCount, formatDuration, formatLessonDuration, formatLevel, formatPrice } from '@/lib/client/format';
import type { CourseDetailDto, CourseLessonDto } from '@/contracts/catalog';
import { PAYMENT_PROVIDER_NOT_CONFIGURED, type CourseEnrolmentStateDto } from '@/contracts/enrolments';
import { CHECKOUT_RETURN_PARAM, type OrderStatusDto } from '@/contracts/payments';

type DetailLessonType = CourseLessonDto['type'];

/** Sidebar status panel shown after returning from the hosted checkout. */
type ReconcileOutcome = 'pending' | 'failed' | 'refunded';

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

/**
 * Flutterwave redirects back with `transaction_id=<number>` alongside
 * `?checkout={orderId}` (see reconcileOrderRequestSchema in contracts/payments).
 */
const TRANSACTION_ID_PARAM = 'transaction_id';

/** Parses the redirect's `transaction_id` query value; absent/invalid → undefined. */
function parseTransactionIdParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

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
  const router = useRouter();
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

  // --- Enrolment state (Phase 7) -------------------------------------------
  // authClient.useSession() mirrors navigation.tsx: better-auth fields beyond the
  // standard user shape would need a cast, but `id` is standard.
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const signedInUserId = session?.user?.id ?? null;

  const [enrolmentState, setEnrolmentState] = useState<CourseEnrolmentStateDto | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [enrolmentLoadedKey, setEnrolmentLoadedKey] = useState<string | null>(null);
  // Order ids this page instance already reconciled. Lives above the probe
  // effect because the probe yields its enrolment write to this flow (below).
  const reconciledOrderIdsRef = useRef<Set<string>>(new Set());
  // Keyed by user so switching accounts re-probes; "signed-out" settles instantly.
  const enrolmentRequestKey = signedInUserId ? `enrol:${signedInUserId}:${slug}` : 'signed-out';
  // Only meaningful while signed in; the CTA renders after the course detail settles.
  const enrolmentLoading =
    Boolean(signedInUserId) && enrolmentLoadedKey !== enrolmentRequestKey;

  useEffect(() => {
    // Probe only once the session is known AND the course detail has loaded.
    if (!signedInUserId || loading) return;
    let cancelled = false;
    fetchCourseEnrolmentState(slug)
      .then((state) => {
        if (cancelled) return;
        // On a checkout-return visit the reconciliation effect owns the
        // enrolment state (its PAID branch re-probes); skip writing so a slow
        // not-enrolled probe result can't clobber the freshly-probed enrolled
        // state. Empty ref = no checkout-return flow = behave exactly as before.
        if (reconciledOrderIdsRef.current.size === 0) setEnrolmentState(state);
        setEnrolmentLoadedKey(enrolmentRequestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 401 = stale session: leave the state unknown; the CTA falls through to
        // the not-enrolled branches and a fresh enroll attempt re-routes to
        // login. Other failures also land on the safe not-enrolled CTA — the
        // enroll endpoint is idempotent, so this can never double-charge/double-enrol.
        setEnrolmentLoadedKey(enrolmentRequestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [signedInUserId, loading, slug, enrolmentRequestKey]);

  // --- Return-from-checkout reconciliation (paid flow) ----------------------
  // Flutterwave redirects back to /courses/{slug}?checkout={orderId}; the
  // redirect query is NEVER trusted as proof of payment — the order is
  // reconciled server-side before any UI claims success.
  const [returnFlowActive, setReturnFlowActive] = useState(false);
  const [reconcileOutcome, setReconcileOutcome] = useState<ReconcileOutcome | null>(null);
  // Derived, never stored: a checkout return is active and the reconcile
  // request hasn't settled yet — drives the "Verifying your payment…" panel.
  const reconciling = returnFlowActive && reconcileOutcome === null;

  // Applies a reconciled order to the UI. Shared by the automatic
  // post-redirect check and the manual "Refresh status" retry.
  const settleReconciledOrder = useCallback(
    async (order: OrderStatusDto) => {
      if (order.status === 'PAID') {
        // Re-probe enrolment so the existing enrolled branch renders — the
        // fulfilled enrolment is what grants access, not the order itself.
        const state = await fetchCourseEnrolmentState(slug);
        setEnrolmentState(state);
        setReturnFlowActive(false);
        toast.success("Payment confirmed — you're enrolled");
        // Strip the return params so refreshing can't re-reconcile.
        router.replace(`/courses/${slug}`, { scroll: false });
        return;
      }
      if (order.status === 'PENDING') {
        // Recoverable: keep the checkout params in the URL so the manual
        // "Refresh status" retry can re-read the order id.
        setReconcileOutcome('pending');
        return;
      }
      if (order.status === 'REFUNDED') {
        setReconcileOutcome('refunded');
        router.replace(`/courses/${slug}`, { scroll: false });
        return;
      }
      // FAILED / CANCELLED: the payment will not grant access — restore the
      // normal purchase CTA and clean the URL.
      setReconcileOutcome('failed');
      router.replace(`/courses/${slug}`, { scroll: false });
    },
    [slug, router],
  );

  // Runs one reconciliation round and maps every failure to its panel state.
  const runReconcile = useCallback(
    async (orderId: string, transactionId: number | undefined) => {
      try {
        const order = await reconcileOrder(orderId, { transactionId });
        await settleReconciledOrder(order);
      } catch (err: unknown) {
        if (err instanceof ApiClientError && err.status === 404) {
          // Ownership edge (someone else's order / stale link): silently fall
          // back to the normal CTA instead of showing a scary error.
          setReturnFlowActive(false);
          router.replace(`/courses/${slug}`, { scroll: false });
          return;
        }
        // Network/5xx: the outcome is genuinely unknown — treat it like the
        // pending state (recoverable) and surface the error honestly.
        setReconcileOutcome('pending');
        toast.error(err instanceof Error ? err.message : 'Payment verification failed. Please try again.');
      }
    },
    [settleReconciledOrder, router, slug],
  );

  useEffect(() => {
    // Reconcile only once the session AND the course detail have settled.
    if (!signedInUserId || loading) return;

    // window.location.search is read here instead of useSearchParams() — that
    // hook would force a Suspense boundary, and reading inside the effect keeps
    // every setState in async callbacks (react-hooks/set-state-in-effect).
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get(CHECKOUT_RETURN_PARAM);
    if (!orderId) return;
    if (reconciledOrderIdsRef.current.has(orderId)) return;
    reconciledOrderIdsRef.current.add(orderId);

    // No `cancelled` guard on purpose: StrictMode remounts the same instance
    // (state/refs persist), and the ref claim above is what prevents a second
    // request. A late result after a real unmount is a harmless no-op.
    void (async () => {
      setReturnFlowActive(true); // shows the derived "Verifying your payment…" panel
      await runReconcile(orderId, parseTransactionIdParam(params.get(TRANSACTION_ID_PARAM)));
    })();
  }, [signedInUserId, loading, slug, runReconcile]);

  const returnToPath = `/courses/${encodeURIComponent(slug)}`;
  const loginWithReturnTo = `/login?returnTo=${encodeURIComponent(returnToPath)}`;

  // Idempotent free enrolment: optimistic local state update (no full refetch).
  const handleEnroll = async () => {
    if (enrolling) return;
    setEnrolling(true);
    try {
      const enrolment = await enrollInCourse(slug);
      setEnrolmentState({ enrolled: true, status: enrolment.status });
      toast.success("You're enrolled");
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.status === 401) {
        // Session expired mid-flight — finish the enrolment after sign-in.
        router.push(loginWithReturnTo);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Enrolment failed. Please try again.');
    } finally {
      setEnrolling(false);
    }
  };

  // Paid course: create a hosted-checkout session and leave the app entirely —
  // Flutterwave redirects back to this page with ?checkout={orderId}.
  const handleStartCheckout = async () => {
    if (startingCheckout) return;
    setStartingCheckout(true);
    try {
      const checkout = await startCheckout(slug);
      window.location.assign(checkout.checkoutUrl);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.code === PAYMENT_PROVIDER_NOT_CONFIGURED) {
          // No provider keys configured — degrade gracefully.
          toast.error('Paid enrolment is not available yet. Free courses can be enrolled in directly.');
        } else if (err.status === 401) {
          // Session expired mid-flight — finish the purchase after sign-in.
          router.push(loginWithReturnTo);
          return;
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Checkout could not be started. Please try again.');
      }
    } finally {
      setStartingCheckout(false);
    }
  };

  // Manual retry for the recoverable pending state: the checkout param is kept
  // in the URL for exactly this path, so re-read it here.
  const handleRefreshReconcile = () => {
    if (reconciling) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get(CHECKOUT_RETURN_PARAM);
    if (!orderId) return;
    setReconcileOutcome(null); // panel flips back to the verifying spinner
    void runReconcile(orderId, parseTransactionIdParam(params.get(TRANSACTION_ID_PARAM)));
  };

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
              <div
                className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center relative bg-cover bg-center`}
                style={course.thumbnailUrl ? { backgroundImage: `url("${course.thumbnailUrl}")` } : undefined}
              >
                {!course.thumbnailUrl &&
                  (categoryIconMap[iconKey] ?? <BookOpen className='size-20 text-white/70' />)}
                {course.promoVideoUrl && (
                  <a
                    href={course.promoVideoUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/35'
                    aria-label='Watch course preview video'
                  >
                    <span className='flex size-14 items-center justify-center rounded-full bg-white/95 text-primary shadow-lg'>
                      <PlayCircle className='size-7' />
                    </span>
                  </a>
                )}
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

                {/* Return-from-checkout status panel (paid-flow reconciliation). */}
                {reconciling ? (
                  <div className='mb-5 flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground'>
                    <Loader2 className='size-4 shrink-0 animate-spin' />
                    Verifying your payment&hellip;
                  </div>
                ) : reconcileOutcome === 'pending' ? (
                  /* Recoverable: provider hasn't confirmed yet (or verification
                     failed) — keep the checkout params for the manual retry. */
                  <div className='mb-5 space-y-2.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400'>
                    <p className='flex items-start gap-2'>
                      <Clock className='mt-0.5 size-4 shrink-0' />
                      Your payment is still processing. Your access will appear here automatically once the provider confirms it — no action needed.
                    </p>
                    <Button variant='outline' size='sm' className='gap-1.5' onClick={handleRefreshReconcile} disabled={reconciling}>
                      <RefreshCw className='size-3.5' /> Refresh status
                    </Button>
                  </div>
                ) : reconcileOutcome === 'failed' ? (
                  <div className='mb-5 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive'>
                    <AlertCircle className='mt-0.5 size-4 shrink-0' />
                    The payment didn&apos;t go through. You can try again.
                  </div>
                ) : reconcileOutcome === 'refunded' ? (
                  <div className='mb-5 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400'>
                    <AlertCircle className='mt-0.5 size-4 shrink-0' />
                    This payment was refunded.
                  </div>
                ) : null}

                {/* Enrolment CTA — driven by session + enrolment state (Phase 7). */}
                {enrolmentState?.enrolled ? (
                  <div className='space-y-3'>
                    <div className='flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary'>
                      <CheckCircle2 className='size-4 shrink-0' />
                      You&apos;re enrolled in this course
                    </div>
                    {/* The lesson player is a later phase — /learning is the honest destination. */}
                    <Button className='w-full' size='lg' asChild>
                      <Link href='/learning'>Go to Classroom</Link>
                    </Button>
                  </div>
                ) : sessionPending || enrolmentLoading ? (
                  /* Course/session/enrolment state still resolving — no behaviour yet. */
                  <Button className='w-full' size='lg' disabled>
                    {course.isFree ? 'Enroll' : 'Enroll Now'}
                  </Button>
                ) : !signedInUserId ? (
                  /* Signed out: sign in first, then land back on this course. */
                  <Button
                    className='w-full'
                    size='lg'
                    onClick={() => router.push(loginWithReturnTo)}
                  >
                    {course.isFree ? 'Enroll' : 'Enroll Now'}
                  </Button>
                ) : course.isFree ? (
                  /* Signed in + free course: idempotent one-click enrolment. */
                  <Button className='w-full' size='lg' onClick={handleEnroll} disabled={enrolling}>
                    {enrolling ? (
                      <>
                        <Loader2 className='size-4 animate-spin' /> Enrolling&hellip;
                      </>
                    ) : (
                      'Enroll'
                    )}
                  </Button>
                ) : (
                  /* Signed in + paid course: hosted Flutterwave checkout —
                     full-page redirect to the provider's payment page. */
                  <Button className='w-full' size='lg' onClick={handleStartCheckout} disabled={startingCheckout}>
                    {startingCheckout ? (
                      <>
                        <Loader2 className='size-4 animate-spin' /> Redirecting&hellip;
                      </>
                    ) : (
                      'Enroll Now'
                    )}
                  </Button>
                )}

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

      {/* Reviews (Phase 10): aggregate + paginated VISIBLE list + own-review
          affordance for enrolled learners. Sits after the curriculum, before
          the instructor card. */}
      <CourseReviewsSection
        slug={slug}
        ratingAverage={course.ratingAverage}
        ratingCount={course.ratingCount}
        enrolled={enrolmentState?.enrolled ?? false}
        loginHref={loginWithReturnTo}
      />

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
