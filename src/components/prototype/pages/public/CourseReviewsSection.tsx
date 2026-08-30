'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, MessageSquareText, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import StarRating from '@/components/prototype/shared/StarRating';
import {
  deleteMyReview,
  fetchMyReview,
  listCourseReviews,
  upsertMyReview,
} from '@/features/engagement/api';
import { ApiClientError } from '@/lib/client/api-client';
import { cn } from '@/lib/utils';
import {
  REVIEW_BODY_MAX,
  REVIEW_PAGE_LIMIT_DEFAULT,
  type ReviewDto,
} from '@/contracts/reviews';

// Public reviews section for the course detail page: the live aggregate
// (recomputed by the server on every review write), the paginated VISIBLE-only
// list, and — for enrolled learners — the write/update/withdraw affordance.

// House date convention ("29 Aug 2026"), mirrored from CertificatesPage.
const REVIEW_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(iso: string): string {
  return REVIEW_DATE_FORMAT.format(new Date(iso));
}

/** Skeleton mirroring one review row so the list keeps its height. */
function ReviewRowSkeleton() {
  return (
    <li className='py-5'>
      <div className='flex items-center justify-between gap-3'>
        <div className='space-y-1.5'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-20' />
        </div>
        <Skeleton className='h-4 w-24' />
      </div>
      <Skeleton className='h-3.5 w-full mt-3' />
      <Skeleton className='h-3.5 w-4/5 mt-2' />
    </li>
  );
}

function ReviewCard({ review }: { review: ReviewDto }) {
  return (
    <li className='py-5 border-b last:border-b-0'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-sm font-medium truncate'>{review.author.name}</p>
          <p className='text-xs text-muted-foreground mt-0.5'>{formatDate(review.createdAt)}</p>
        </div>
        <StarRating rating={review.rating} size='sm' className='shrink-0' />
      </div>
      <p className='text-sm text-muted-foreground mt-2.5 whitespace-pre-line leading-relaxed'>
        {review.body}
      </p>
      {review.reply !== null && (
        /* Owner reply: indented card so the response reads as a separate voice. */
        <div className='mt-3 ml-2 sm:ml-4 rounded-lg bg-muted/60 border-l-2 border-primary/40 p-3'>
          <p className='text-xs font-semibold'>
            Response from {review.replyAuthor?.name ?? 'the instructor'}
          </p>
          <p className='text-sm text-muted-foreground mt-1 whitespace-pre-line leading-relaxed'>
            {review.reply}
          </p>
        </div>
      )}
    </li>
  );
}

interface RatingInputProps {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
}

/** Interactive 1-5 star input for the learner's own review. */
function RatingInput({ value, onChange, disabled }: RatingInputProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <div
      className='flex items-center gap-0.5'
      onMouseLeave={() => setHovered(0)}
      role='radiogroup'
      aria-label='Your star rating'
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type='button'
          role='radio'
          aria-checked={value === star}
          aria-label={`Rate ${star} out of 5`}
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          className='rounded-sm p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <Star
            className={cn(
              'size-6 transition-colors',
              star <= display ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30',
            )}
          />
        </button>
      ))}
    </div>
  );
}

// --- Own-review write card -----------------------------------------------------

interface OwnReviewCardProps {
  slug: string;
  /** Present only after a successful save/deletion, so the list merge can match rows. */
  onReviewChanged: (review: ReviewDto | null, previousId: string | null) => void;
  loginHref: string;
}

/**
 * Write/update/withdraw the caller's own review. Rendered only for enrolled
 * learners; the prefill comes from GET .../reviews/mine.
 */
function OwnReviewCard({ slug, onReviewChanged, loginHref }: OwnReviewCardProps) {
  // Prefill probe: derived loading from the request key (house pattern).
  const [mine, setMine] = useState<ReviewDto | null>(null);
  const [mineLoadFailed, setMineLoadFailed] = useState(false);
  const [mineNeedsAuth, setMineNeedsAuth] = useState(false);
  const [mineRetrySeed, setMineRetrySeed] = useState(0);
  const mineRequestKey = `${slug}#${mineRetrySeed}`;
  const [mineLoadedKey, setMineLoadedKey] = useState<string | null>(null);
  const mineLoading = mineLoadedKey !== mineRequestKey;

  // Form state. Declared BEFORE the prefill probe so the probe's async
  // callbacks reference already-declared setters (react-hooks/immutability).
  // The prefill itself is applied in the probe's async callback below, never
  // during render (house rule: state writes live in async callbacks).
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [prefilledId, setPrefilledId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 401 mid-write: the session died; swap the form for a sign-in prompt.
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyReview(slug)
      .then((review) => {
        if (cancelled) return;
        setMine(review);
        if (review) {
          // Pre-fill the form from the learner's existing review.
          setRating(review.rating);
          setBody(review.body);
          setPrefilledId(review.id);
        }
        setMineNeedsAuth(false);
        setMineLoadFailed(false);
        setMineLoadedKey(mineRequestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          // Session expired between the enrolment probe and now.
          setMineNeedsAuth(true);
        } else {
          setMineLoadFailed(true);
        }
        setMineLoadedKey(mineRequestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [mineRequestKey, slug]);

  const hasExisting = mine !== null;

  const handleSave = async () => {
    if (saving) return;
    const trimmed = body.trim();
    if (rating < 1) {
      setFormError('Tap the stars to choose a rating first.');
      return;
    }
    if (trimmed.length === 0) {
      setFormError('Write a few words about the course before saving.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const saved = await upsertMyReview(slug, { rating, body: trimmed });
      toast.success(hasExisting ? 'Review updated' : 'Review published');
      onReviewChanged(saved, prefilledId);
      setMine(saved);
      setPrefilledId(saved.id);
      setBody(saved.body);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.status === 401) {
          setNeedsAuth(true);
          return;
        }
        // Every server rejection carries an honest message — surface it as-is.
        // Notably 422 REVIEW_ENROLMENT_REQUIRED (verified-enrolment gate) and
        // 422/400 validation failures with field-level copy.
        setFormError(err.message);
      } else {
        setFormError('Could not save your review. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || !mine) return;
    setDeleting(true);
    try {
      await deleteMyReview(slug);
      toast.success('Review withdrawn');
      onReviewChanged(null, mine.id);
      setMine(null);
      setPrefilledId(null);
      setRating(0);
      setBody('');
      setConfirmOpen(false);
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.status === 401) {
        setNeedsAuth(true);
        setConfirmOpen(false);
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Could not withdraw your review.');
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  if (mineLoading) {
    return (
      <Card>
        <CardContent className='p-5 space-y-3'>
          <Skeleton className='h-4 w-28' />
          <Skeleton className='h-6 w-36' />
          <Skeleton className='h-20 w-full' />
        </CardContent>
      </Card>
    );
  }

  if (needsAuth || mineNeedsAuth) {
    return (
      <Card>
        <CardContent className='p-5 text-center space-y-2'>
          <p className='text-sm text-muted-foreground'>Your session has expired.</p>
          <Button size='sm' asChild>
            <Link href={loginHref}>Sign in to review this course</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (mineLoadFailed) {
    return (
      <Card>
        <CardContent className='p-5 text-center space-y-2'>
          <p className='text-sm text-muted-foreground'>Could not load your review.</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setMineRetrySeed((seed) => seed + 1)}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className='p-5 space-y-3'>
        <h3 className='text-sm font-semibold'>{hasExisting ? 'Your review' : 'Write a review'}</h3>
        <RatingInput value={rating} onChange={(value) => { setRating(value); setFormError(null); }} disabled={saving} />
        <div className='space-y-1.5'>
          <Textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value.slice(0, REVIEW_BODY_MAX));
              setFormError(null);
            }}
            placeholder='What did you think of the course?'
            rows={4}
            maxLength={REVIEW_BODY_MAX}
            aria-label='Your review'
            disabled={saving}
          />
          <p className='text-right text-xs text-muted-foreground tabular-nums'>
            {body.length}/{REVIEW_BODY_MAX}
          </p>
        </div>
        {formError && (
          <p role='alert' className='text-sm text-destructive'>
            {formError}
          </p>
        )}
        <div className='flex items-center justify-between gap-3'>
          {hasExisting ? (
            <Button
              variant='ghost'
              size='sm'
              className='gap-1.5 text-destructive hover:text-destructive'
              onClick={() => setConfirmOpen(true)}
              disabled={saving || deleting}
            >
              <Trash2 className='size-4' /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Button size='sm' onClick={() => void handleSave()} disabled={saving || deleting}>
            {saving && <Loader2 className='size-4 animate-spin' aria-hidden />}
            {hasExisting ? 'Save changes' : 'Publish review'}
          </Button>
        </div>
      </CardContent>

      {/* Withdraw confirmation: a review delete is irreversible on the server. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw your review?</AlertDialogTitle>
            <AlertDialogDescription>
              Your rating and comments will be removed from this course and cannot be restored. You
              can write a new review later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Loader2 className='size-4 animate-spin' aria-hidden />}
              Withdraw review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// --- Section -------------------------------------------------------------------

interface CourseReviewsSectionProps {
  slug: string;
  /** Aggregate from the loaded course DTO (server-recomputed on every write). */
  ratingAverage: number | null;
  ratingCount: number;
  /** True when the enrolment probe reports an ACTIVE/COMPLETED enrolment. */
  enrolled: boolean;
  loginHref: string;
}

export default function CourseReviewsSection({
  slug,
  ratingAverage,
  ratingCount,
  enrolled,
  loginHref,
}: CourseReviewsSectionProps) {
  // --- Visible review list -----------------------------------------------------
  const [items, setItems] = useState<ReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadSeed, setReloadSeed] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const requestKey = `${slug}#${reloadSeed}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    listCourseReviews(slug, { limit: REVIEW_PAGE_LIMIT_DEFAULT })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total);
        setListError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListError(
          err instanceof Error ? err.message : 'Could not load the reviews for this course.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, slug]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listCourseReviews(slug, {
        limit: REVIEW_PAGE_LIMIT_DEFAULT,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load more reviews.');
    } finally {
      setLoadingMore(false);
    }
  };

  // --- Server reconciliation after an own-review write -------------------------
  // Optimistic merge first (instant feedback), then ONE silent page-1 refetch so
  // the server list stays the source of truth (ordering, moderation state).
  const handleReviewChanged = (review: ReviewDto | null, previousId: string | null) => {
    if (review === null) {
      if (previousId) {
        setItems((current) => current.filter((item) => item.id !== previousId));
      }
    } else {
      setItems((current) => {
        const byPrevious = previousId
          ? current.map((item) => (item.id === previousId ? review : item))
          : current;
        const replaced = byPrevious.some((item) => item.id === review.id)
          ? byPrevious.map((item) => (item.id === review.id ? review : item))
          : [review, ...byPrevious];
        return replaced;
      });
    }
    // Silent reconciliation: no spinner, errors surface only as a toast.
    listCourseReviews(slug, { limit: REVIEW_PAGE_LIMIT_DEFAULT })
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total);
      })
      .catch(() => {
        /* The optimistic state above remains; a manual retry can resync. */
      });
  };

  const displayCount = total ?? ratingCount;

  return (
    <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8' aria-label='Course reviews'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
        <h2 className='text-lg font-bold'>Reviews</h2>
        {ratingAverage !== null ? (
          <StarRating rating={ratingAverage} size='md' showCount count={displayCount} />
        ) : (
          <span className='text-sm text-muted-foreground'>No ratings yet</span>
        )}
      </div>

      <div className='space-y-4'>
        {/* Own-review affordance — enrolled learners only (enrolment probe). */}
        {enrolled && (
          <OwnReviewCard slug={slug} onReviewChanged={handleReviewChanged} loginHref={loginHref} />
        )}

        {loading ? (
          <Card>
            <CardContent className='p-6'>
              <ul>
                {Array.from({ length: 3 }).map((_, index) => (
                  <ReviewRowSkeleton key={index} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : listError ? (
          <Card>
            <CardContent className='p-8 text-center space-y-3'>
              <p className='text-sm text-destructive'>{listError}</p>
              <Button variant='outline' size='sm' onClick={() => setReloadSeed((s) => s + 1)}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className='p-8 text-center space-y-2'>
              <div className='size-12 mx-auto rounded-full bg-muted flex items-center justify-center'>
                <MessageSquareText className='size-5 text-muted-foreground' />
              </div>
              <p className='text-sm text-muted-foreground'>
                No reviews yet — be the first after enrolling.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className='p-6'>
              <ul>
                {items.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </ul>
              {nextCursor && (
                <div className='flex justify-center pt-4'>
                  <Button variant='outline' size='sm' onClick={() => void handleLoadMore()} disabled={loadingMore}>
                    {loadingMore && <Loader2 className='size-4 animate-spin' aria-hidden />}
                    Load more
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
