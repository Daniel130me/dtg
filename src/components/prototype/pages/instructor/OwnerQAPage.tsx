'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Send,
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
import InstructorLayout from './InstructorLayout';
import {
  fetchOwnerThread,
  listOwnerThreads,
  moderateOwnerPost,
  moderateOwnerThread,
  replyToThreadAsOwner,
} from '@/features/learning/api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import {
  OWNER_THREAD_PAGE_LIMIT_DEFAULT,
  OWNER_THREAD_STATUS_FILTERS,
  POST_BODY_MAX,
  type DiscussionPostDto,
  type OwnerThreadDetailDto,
  type OwnerThreadStatusFilter,
  type OwnerThreadSummaryDto,
} from '@/contracts/learning';

// Owner Q&A console: every course's student question threads, with answers,
// moderation, and owner replies. Structure mirrors ReviewsModerationPage
// (request-key + cancelled-flag fetching, cursor Load more, per-card actions).

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const STATUS_FILTER_VALUES = OWNER_THREAD_STATUS_FILTERS;

/** Status -> Badge presentation (same shapes as the reviews console). */
const STATUS_BADGES: Record<'ACTIVE' | 'HIDDEN', { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  HIDDEN: { label: 'Hidden', className: 'bg-muted text-muted-foreground border-border' },
};

/** Date format mirrors the grading queue's compact "29 Aug 2026". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ThreadListSkeleton() {
  return (
    <Card>
      <CardContent className='p-6 space-y-5'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className='space-y-2 pb-4 border-b last:border-b-0 last:pb-0'>
            <div className='flex items-center justify-between gap-3'>
              <Skeleton className='h-4 w-56' />
              <Skeleton className='h-5 w-16' />
            </div>
            <Skeleton className='h-3.5 w-40' />
            <Skeleton className='h-3.5 w-2/3' />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** One conversation: the question post plus every reply, newest last. */
function PostList({
  posts,
  pendingPostId,
  onModeratePost,
}: {
  posts: DiscussionPostDto[];
  pendingPostId: string | null;
  onModeratePost: (post: DiscussionPostDto) => void;
}) {
  return (
    <ol className='space-y-3'>
      {posts.map((post, index) => {
        const hidden = post.status === 'HIDDEN';
        return (
          <li
            key={post.id}
            className={`rounded-lg border p-3 ${hidden ? 'border-dashed bg-muted/40 opacity-80' : index === 0 ? 'bg-muted/60 border-l-2 border-l-primary/40' : 'bg-background'}`}
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex items-center gap-2 min-w-0'>
                <span className='text-xs font-semibold truncate'>
                  {post.author.name}
                  {index === 0 && <span className='text-muted-foreground font-normal'> · asked</span>}
                </span>
              </div>
              <div className='flex items-center gap-2 shrink-0'>
                {hidden && (
                  <Badge variant='outline' className={STATUS_BADGES.HIDDEN.className}>
                    {STATUS_BADGES.HIDDEN.label}
                  </Badge>
                )}
                <span className='text-xs text-muted-foreground'>{formatDate(post.createdAt)}</span>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7 text-muted-foreground hover:text-foreground'
                  aria-label={hidden ? 'Restore this post' : 'Hide this post'}
                  onClick={() => onModeratePost(post)}
                  disabled={pendingPostId !== null}
                >
                  {pendingPostId === post.id ? (
                    <Loader2 className='size-3.5 animate-spin' aria-hidden />
                  ) : hidden ? (
                    <Eye className='size-3.5' aria-hidden />
                  ) : (
                    <EyeOff className='size-3.5' aria-hidden />
                  )}
                </Button>
              </div>
            </div>
            <p className='text-sm whitespace-pre-line leading-relaxed mt-1.5'>{post.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

interface OwnerThreadCardProps {
  thread: OwnerThreadSummaryDto;
  /** Applies the server-returned thread fields back into the parent list. */
  onThreadPatched: (next: OwnerThreadSummaryDto) => void;
}

function OwnerThreadCard({ thread, onThreadPatched }: OwnerThreadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<OwnerThreadDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  // One action runs per card at a time (duplicate-submit guard).
  const [pendingAction, setPendingAction] = useState<'moderate' | 'reply' | null>(null);
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

  const hidden = thread.status === 'HIDDEN';

  const loadDetail = () => {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    fetchOwnerThread(thread.id)
      .then((payload) => {
        setDetail(payload);
        setDetailError(null);
      })
      .catch((error: unknown) => {
        setDetailError(
          error instanceof ApiClientError ? error.message : 'Could not load the conversation.',
        );
      })
      .finally(() => setDetailLoading(false));
  };

  const toggleExpanded = () => {
    if (!expanded) loadDetail();
    setExpanded((value) => !value);
  };

  const handleModerate = async () => {
    if (pendingAction !== null) return;
    const nextStatus = hidden ? 'ACTIVE' : 'HIDDEN';
    setPendingAction('moderate');
    try {
      const updated = await moderateOwnerThread(thread.id, nextStatus);
      onThreadPatched({ ...thread, ...updated });
    } catch (error) {
      showActionErrorToast(error, 'Could not update the thread status.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleSendReply = async () => {
    if (pendingAction !== null) return;
    const trimmed = replyDraft.trim();
    if (trimmed.length === 0) return;
    setPendingAction('reply');
    try {
      const post = await replyToThreadAsOwner(thread.id, trimmed);
      // Adopt the server's post and bump the denormalized counter locally.
      setDetail((current) =>
        current
          ? {
              ...current,
              posts: [...current.posts, post],
              totalPosts: current.totalPosts + 1,
              thread: { ...current.thread, postCount: current.thread.postCount + 1 },
            }
          : current,
      );
      onThreadPatched({
        ...thread,
        postCount: thread.postCount + 1,
        lastActivityAt: post.createdAt,
      });
      setReplyDraft('');
    } catch (error) {
      showActionErrorToast(error, 'Could not send the reply.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleLoadMorePosts = async () => {
    const cursor = detail?.nextCursor;
    if (!cursor || loadingMorePosts) return;
    setLoadingMorePosts(true);
    try {
      const page = await fetchOwnerThread(thread.id, { cursor });
      setDetail((current) => {
        if (!current) return page;
        const loadedIds = new Set(current.posts.map((post) => post.id));
        return {
          ...current,
          posts: [...current.posts, ...page.posts.filter((post) => !loadedIds.has(post.id))],
          nextCursor: page.nextCursor,
          totalPosts: page.totalPosts,
        };
      });
    } catch (error) {
      showActionErrorToast(error, 'Could not load more replies.');
    } finally {
      setLoadingMorePosts(false);
    }
  };

  const handleModeratePost = async (post: DiscussionPostDto) => {
    if (pendingPostId !== null) return;
    const nextStatus = post.status === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN';
    setPendingPostId(post.id);
    try {
      const updated = await moderateOwnerPost(post.id, nextStatus);
      setDetail((current) =>
        current
          ? {
              ...current,
              posts: current.posts.map((entry) => (entry.id === updated.id ? updated : entry)),
            }
          : current,
      );
    } catch (error) {
      showActionErrorToast(error, 'Could not update the post status.');
    } finally {
      setPendingPostId(null);
    }
  };

  return (
    <li className={hidden ? 'opacity-70' : undefined}>
      <Card className={hidden ? 'border-dashed' : undefined}>
        <CardContent className='p-4 sm:p-5 space-y-3'>
          {/* Row header: question title, author, course/lesson, date, status */}
          <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-2'>
            <div className='flex items-center gap-2 min-w-0'>
              <button
                type='button'
                onClick={toggleExpanded}
                aria-expanded={expanded}
                className='text-sm font-semibold text-left hover:text-primary transition-colors truncate'
              >
                {thread.title}
              </button>
            </div>
            <div className='flex items-center gap-2 shrink-0'>
              <Badge variant='outline' className={STATUS_BADGES[thread.status].className}>
                {STATUS_BADGES[thread.status].label}
              </Badge>
              <span className='text-xs text-muted-foreground'>
                {thread.postCount} {thread.postCount === 1 ? 'post' : 'posts'} · updated{' '}
                {formatDate(thread.lastActivityAt)}
              </span>
              <button
                type='button'
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse conversation' : 'Expand conversation'}
                className='inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
              >
                {expanded ? <ChevronUp className='size-4' aria-hidden /> : <ChevronDown className='size-4' aria-hidden />}
              </button>
            </div>
          </div>
          <p className='text-xs text-muted-foreground truncate'>
            <span className='font-medium text-foreground/80'>{thread.courseTitle}</span>
            <span className='mx-1' aria-hidden>·</span>
            {thread.lessonTitle}
            <span className='mx-1' aria-hidden>·</span>
            asked by <span className='font-medium text-foreground/80'>{thread.author.name}</span>
          </p>

          {/* Conversation (lazy-loaded on expand) */}
          {expanded && (
            <div className='space-y-3 pt-1'>
              {detailLoading ? (
                <div className='space-y-2'>
                  <Skeleton className='h-16 w-full' />
                  <Skeleton className='h-16 w-3/4' />
                </div>
              ) : detailError ? (
                <div className='flex items-center justify-between gap-3 rounded-lg bg-destructive/5 border border-destructive/20 p-3'>
                  <p className='text-sm text-destructive'>{detailError}</p>
                  <Button variant='outline' size='sm' onClick={loadDetail} className='gap-1.5 shrink-0'>
                    <RefreshCw className='size-3.5' /> Retry
                  </Button>
                </div>
              ) : detail ? (
                <>
                  <PostList
                    posts={detail.posts}
                    pendingPostId={pendingPostId}
                    onModeratePost={(post) => void handleModeratePost(post)}
                  />

                  {detail.nextCursor && (
                    <div className='flex justify-center'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => void handleLoadMorePosts()}
                        disabled={loadingMorePosts}
                      >
                        {loadingMorePosts && <Loader2 className='size-3.5 mr-2 animate-spin' />}
                        Load more replies
                      </Button>
                    </div>
                  )}

                  {/* Reply editor — hidden threads must be restored first */}
                  {hidden ? (
                    <p className='text-xs text-muted-foreground rounded-lg border border-dashed p-3'>
                      This thread is hidden from students. Restore it to reply.
                    </p>
                  ) : (
                    <div className='space-y-2'>
                      <Textarea
                        value={replyDraft}
                        onChange={(event) => setReplyDraft(event.target.value.slice(0, POST_BODY_MAX))}
                        rows={3}
                        maxLength={POST_BODY_MAX}
                        aria-label='Your reply to this question'
                        placeholder='Answer this student publicly…'
                        disabled={pendingAction !== null}
                      />
                      <p className='text-right text-xs text-muted-foreground tabular-nums'>
                        {replyDraft.length}/{POST_BODY_MAX}
                      </p>
                      <div className='flex justify-end'>
                        <Button
                          size='sm'
                          className='gap-1.5 min-h-11 sm:min-h-8'
                          onClick={() => void handleSendReply()}
                          disabled={pendingAction !== null || replyDraft.trim().length === 0}
                        >
                          {pendingAction === 'reply' ? (
                            <Loader2 className='size-4 animate-spin' aria-hidden />
                          ) : (
                            <Send className='size-3.5' aria-hidden />
                          )}
                          Send reply
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className='flex justify-start'>
                    <Button
                      variant='outline'
                      size='sm'
                      className='gap-1.5 min-h-11 sm:min-h-8'
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
                      {hidden ? 'Restore thread' : 'Hide thread'}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export default function OwnerQAPage() {
  // Queue state.
  const [items, setItems] = useState<OwnerThreadSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [statusFilter, setStatusFilter] = useState<OwnerThreadStatusFilter>('ALL');

  // Request-key pattern: loading is DERIVED, every setState lives in async
  // callbacks or event handlers.
  const requestKey = `${statusFilter}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Page 1 for the current filter.
  useEffect(() => {
    let cancelled = false;
    listOwnerThreads({ status: statusFilter })
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
            : 'Something went wrong while loading the questions.',
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
      const page = await listOwnerThreads({ status: statusFilter, cursor: nextCursor });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showActionErrorToast(error, 'Could not load more questions.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  /** Applies a moderation/reply result back into the loaded list in place. */
  const handleThreadPatched = (next: OwnerThreadSummaryDto) => {
    const remainsInView = statusFilter === 'ALL' || next.status === statusFilter;
    setItems((current) =>
      remainsInView
        ? current.map((entry) => (entry.id === next.id ? next : entry))
        : current.filter((entry) => entry.id !== next.id),
    );
    if (!remainsInView) setTotal((current) => Math.max(0, current - 1));
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
              <MessagesSquare className='size-5 text-primary-foreground' />
            </div>
            <div>
              <h1 className='text-2xl sm:text-3xl font-bold'>Q&amp;A</h1>
              <p className='text-muted-foreground mt-1'>
                {loading
                  ? 'Student questions across your courses'
                  : `${total} ${total === 1 ? 'question' : 'questions'} in view`}
              </p>
            </div>
          </motion.div>

          {/* Status filter */}
          <motion.div variants={item} className='flex flex-col sm:flex-row gap-3'>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as OwnerThreadStatusFilter)}
            >
              <SelectTrigger className='w-full sm:w-48 min-h-11 sm:min-h-9' aria-label='Filter by status'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === 'ALL' ? 'All statuses' : STATUS_BADGES[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          {/* Queue */}
          <motion.div variants={item}>
            {loading ? (
              <ThreadListSkeleton />
            ) : loadError ? (
              <div className='text-center py-16'>
                <div className='size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4'>
                  <MessagesSquare className='size-7 text-destructive' />
                </div>
                <h3 className='font-semibold text-lg mb-1'>Could not load the questions</h3>
                <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>{loadError}</p>
                <Button variant='outline' onClick={handleRetry} className='gap-1.5'>
                  <RefreshCw className='size-4' /> Try Again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className='py-14 text-center'>
                  <div className='size-14 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
                    <MessagesSquare className='size-6 text-muted-foreground' />
                  </div>
                  <h3 className='font-semibold mb-1'>No questions here yet</h3>
                  <p className='text-sm text-muted-foreground max-w-sm mx-auto'>
                    Student questions from your courses appear here the moment they are posted.
                    Adjust the status filter above if you expected something specific.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <ul className='space-y-4'>
                  {items.map((thread) => (
                    <OwnerThreadCard
                      key={thread.id}
                      thread={thread}
                      onThreadPatched={handleThreadPatched}
                    />
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
