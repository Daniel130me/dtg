'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  Reply,
  Star,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import StarRating from '@/components/prototype/shared/StarRating';
import InstructorLayout from './InstructorLayout';
import { listOwnerReviews, moderateReview, replyToReview } from '@/features/engagement/api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import type { OwnerReviewDto } from '@/contracts/reviews';
import {
  OWNER_REVIEW_PAGE_LIMIT_DEFAULT,
  REVIEW_REPLY_MAX,
  REVIEW_STATUSES,
  type ReviewStatusValue,
} from '@/contracts/reviews';

// Owner reviews moderation console: every course's reviews across all
// moderation states, with hide/restore and owner-reply actions per row.
// Structure mirrors GradingQueuePage (request-key + cancelled-flag fetching,
// cursor Load more, skeleton/error/empty states).

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const STATUS_FILTER_VALUES = ['ALL', ...REVIEW_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

/** Status -> Badge presentation, mirroring grading-status.ts's map shape. */
const STATUS_BADGES: Record<ReviewStatusValue, { label: string; className: string }> = {
  VISIBLE: { label: 'Visible', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  HIDDEN: { label: 'Hidden', className: 'bg-muted text-muted-foreground border-border' },
};

/** Bodies longer than this get a Read more/Show less inline expansion. */
const BODY_PREVIEW_MAX_LENGTH = 220;

/** Date format mirrors the grading queue's compact "29 Aug 2026". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ModerationSkeleton() {
  return (
    <Card>
      <CardContent className='p-6 space-y-5'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className='space-y-2 pb-4 border-b last:border-b-0 last:pb-0'>
            <div className='flex items-center justify-between gap-3'>
              <Skeleton className='h-4 w-40' />
              <Skeleton className='h-5 w-16' />
            </div>
            <Skeleton className='h-3.5 w-full' />
            <Skeleton className='h-3.5 w-2/3' />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface OwnerReviewCardProps {
  review: OwnerReviewDto;
  /** Applies the server-returned review fields back into the parent list. */
  onPatched: (next: OwnerReviewDto) => void;
}

/** One moderation row: stars/author/course/body + Hide/Restore and Reply actions. */
function OwnerReviewCard({ review, onPatched }: OwnerReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  // Only one action runs per row at a time (duplicate-submit guard).
  const [pendingAction, setPendingAction] = useState<'moderate' | 'reply' | null>(null);

  const hidden = review.status === 'HIDDEN';
  const bodyLong = review.body.length > BODY_PREVIEW_MAX_LENGTH;

  const handleModerate = async () => {
    if (pendingAction !== null) return;
    const nextStatus: ReviewStatusValue = hidden ? 'VISIBLE' : 'HIDDEN';
    setPendingAction('moderate');
    try {
      const updated = await moderateReview(review.id, nextStatus);
      onPatched({ ...review, ...updated });
    } catch (error) {
      showActionErrorToast(error, 'Could not update the review status.');
    } finally {
      setPendingAction(null);
    }
  };

  const openReplyEditor = () => {
    // Pre-fill with the existing reply; PUT has upsert semantics.
    setReplyDraft(review.reply ?? '');
    setReplyOpen(true);
  };

  const handleSaveReply = async () => {
    if (pendingAction !== null) return;
    const trimmed = replyDraft.trim();
    if (trimmed.length === 0) return;
    setPendingAction('reply');
    try {
      const updated = await replyToReview(review.id, trimmed);
      onPatched({ ...review, ...updated });
      setReplyOpen(false);
    } catch (error) {
      showActionErrorToast(error, 'Could not save the reply.');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <li className={hidden ? 'opacity-70' : undefined}>
      <Card className={hidden ? 'border-dashed' : undefined}>
        <CardContent className='p-4 sm:p-5 space-y-3'>
          {/* Row header: stars, author, course, date, status */}
          <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-2'>
            <div className='flex items-center gap-2 min-w-0'>
              <StarRating rating={review.rating} size='sm' className='shrink-0' />
              <span className='text-sm font-medium truncate'>{review.author.name}</span>
            </div>
            <div className='flex items-center gap-2 shrink-0'>
              <Badge variant='outline' className={STATUS_BADGES[review.status].className}>
                {STATUS_BADGES[review.status].label}
              </Badge>
              <span className='text-xs text-muted-foreground'>{formatDate(review.createdAt)}</span>
            </div>
          </div>
          <p className='text-xs text-muted-foreground truncate' title={review.course.title}>
            Course: <span className='font-medium text-foreground/80'>{review.course.title}</span>
          </p>

          {/* Body with inline expansion (line-clamp when collapsed) */}
          <p className={`text-sm whitespace-pre-line leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
            {review.body}
          </p>
          {bodyLong && (
            <button
              type='button'
              onClick={() => setExpanded((value) => !value)}
              className='inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm'
            >
              {expanded ? (
                <>
                  Show less <ChevronUp className='size-3' aria-hidden />
                </>
              ) : (
                <>
                  Read more <ChevronDown className='size-3' aria-hidden />
                </>
              )}
            </button>
          )}

          {/* Existing owner reply */}
          {review.reply !== null && !replyOpen && (
            <div className='rounded-lg bg-muted/60 border-l-2 border-primary/40 p-3'>
              <p className='text-xs font-semibold'>
                Your reply{review.repliedAt ? ` · ${formatDate(review.repliedAt)}` : ''}
              </p>
              <p className='text-sm text-muted-foreground mt-1 whitespace-pre-line leading-relaxed'>
                {review.reply}
              </p>
            </div>
          )}

          {/* Reply editor (inline, pre-filled; PUT is an upsert) */}
          {replyOpen ? (
            <div className='space-y-2'>
              <Textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value.slice(0, REVIEW_REPLY_MAX))}
                rows={3}
                maxLength={REVIEW_REPLY_MAX}
                aria-label='Your reply to this review'
                placeholder='Respond to this learner publicly…'
                disabled={pendingAction !== null}
                autoFocus
              />
              <p className='text-right text-xs text-muted-foreground tabular-nums'>
                {replyDraft.length}/{REVIEW_REPLY_MAX}
              </p>
              <div className='flex items-center justify-end gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setReplyOpen(false)}
                  disabled={pendingAction !== null}
                >
                  Cancel
                </Button>
                <Button size='sm' onClick={() => void handleSaveReply()} disabled={pendingAction !== null || replyDraft.trim().length === 0}>
                  {pendingAction === 'reply' && <Loader2 className='size-4 animate-spin' aria-hidden />}
                  Save reply
                </Button>
              </div>
            </div>
          ) : (
            <div className='flex flex-wrap items-center gap-2 pt-1'>
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5'
                onClick={() => void handleModerate()}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'moderate' ? (
                  <Loader2 className='size-3.5 animate-spin' aria-hidden />
                ) : hidden ? (
                  <Eye className='size-3.5' aria-hidden />
                ) : (
                  <EyeOff className='size-3.5' aria-hidden />
                )}
                {hidden ? 'Restore' : 'Hide'}
              </Button>
              <Button
                variant={review.reply === null ? 'default' : 'secondary'}
                size='sm'
                className='gap-1.5'
                onClick={openReplyEditor}
                disabled={pendingAction !== null}
              >
                <Reply className='size-3.5' aria-hidden />
                {review.reply === null ? 'Reply' : 'Edit reply'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export default function ReviewsModerationPage() {
  // Queue state.
  const [items, setItems] = useState<OwnerReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Request-key pattern (see GradingQueuePage): loading is DERIVED, every
  // setState lives in async callbacks or event handlers.
  const requestKey = `${statusFilter}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Moderation page 1 for the current filter.
  useEffect(() => {
    let cancelled = false;
    listOwnerReviews({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
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
            : 'Something went wrong while loading the reviews.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listOwnerReviews({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more reviews.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  /** Applies a moderate/reply result back into the loaded list in place. */
  const handlePatched = (next: OwnerReviewDto) => {
    setItems((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
  };

  return (
    <InstructorLayout>
      <div className='p-4 sm:p-6 lg:p-8'>
        <motion.div
          variants={container}
          initial='hidden'
          animate='show'
          className='max-w-4xl mx-auto space-y-6'
        >
          {/* Header */}
          <motion.div variants={item} className='flex items-start gap-3'>
            <div className='size-10 rounded-lg bg-primary flex items-center justify-center shrink-0'>
              <MessageSquareQuote className='size-5 text-primary-foreground' />
            </div>
            <div>
              <h1 className='text-2xl sm:text-3xl font-bold'>Reviews</h1>
              <p className='text-muted-foreground mt-1'>
                {loading
                  ? 'Learner reviews across your courses'
                  : `${total} ${total === 1 ? 'review' : 'reviews'} in view`}
              </p>
            </div>
          </motion.div>

          {/* Status filter */}
          <motion.div variants={item} className='flex flex-col sm:flex-row gap-3'>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className='w-full sm:w-48' aria-label='Filter by status'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === 'ALL' ? 'All statuses' : STATUS_BADGES[status as ReviewStatusValue].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          {/* Queue */}
          <motion.div variants={item}>
            {loading ? (
              <ModerationSkeleton />
            ) : loadError ? (
              <div className='text-center py-16'>
                <div className='size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4'>
                  <Star className='size-7 text-destructive' />
                </div>
                <h3 className='font-semibold text-lg mb-1'>Could not load the reviews</h3>
                <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>{loadError}</p>
                <Button variant='outline' onClick={handleRetry} className='gap-1.5'>
                  <RefreshCw className='size-4' /> Try Again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className='py-14 text-center'>
                  <div className='size-14 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
                    <MessageSquareQuote className='size-6 text-muted-foreground' />
                  </div>
                  <h3 className='font-semibold mb-1'>No reviews here yet</h3>
                  <p className='text-sm text-muted-foreground max-w-sm mx-auto'>
                    Learner reviews appear here the moment they are published. Adjust the status
                    filter above if you expected something specific.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <ul className='space-y-4'>
                  {items.map((review) => (
                    <OwnerReviewCard key={review.id} review={review} onPatched={handlePatched} />
                  ))}
                </ul>
                {nextCursor && (
                  <div className='flex justify-center pt-4'>
                    <Button variant='outline' onClick={() => void handleLoadMore()} disabled={loadingMore}>
                      {loadingMore && <Loader2 className='size-4 mr-2 animate-spin' />}
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </motion.div>

          <div className='h-8' />
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
