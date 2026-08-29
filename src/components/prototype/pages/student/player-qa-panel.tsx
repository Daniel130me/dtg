'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  createLessonThread,
  fetchLessonThreads,
  fetchThread,
  replyToThread,
} from '@/features/learning/api';
import { ApiClientError } from '@/lib/client/api-client';
import { POST_BODY_MAX, THREAD_TITLE_MAX, type DiscussionPostDto, type DiscussionThreadSummaryDto } from '@/contracts/learning';

const THREAD_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** ISO datetime -> "29 Aug 2026" (date-only, matches the rest of the app). */
function formatThreadDate(iso: string): string {
  return THREAD_DATE_FORMAT.format(new Date(iso));
}

/**
 * Lesson Q&A. The threads read is public per the contract, but the server
 * answers 422 when the caller may not participate (not enrolled), which this
 * panel maps to the same enroll message the notes panel shows. When the read
 * succeeds for a non-enrolled visitor the list renders read-only (no ask or
 * reply forms). `status` is intentionally not rendered: HIDDEN threads/posts
 * never leave the API, so every row that arrives is ACTIVE.
 */
export default function PlayerQAPanel({
  lessonId,
  canParticipate,
}: {
  lessonId: string;
  canParticipate: boolean;
}) {
  const [threads, setThreads] = useState<DiscussionThreadSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${lessonId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);

  // "Ask a question" form (both fields validated non-empty client-side).
  const [askTitle, setAskTitle] = useState('');
  const [askBody, setAskBody] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLessonThreads(lessonId)
      .then((page) => {
        if (cancelled) return;
        setThreads(page.items);
        setNextCursor(page.nextCursor);
        setGated(false);
        setFetchError(null);
        setExpandedThreadId(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Not enrolled: the API refuses participation with 422 — show the
        // enroll message instead of a scary error.
        if (err instanceof ApiClientError && (err.status === 422 || err.status === 403)) {
          setGated(true);
        } else {
          setFetchError(err instanceof Error ? err.message : 'Could not load the discussion.');
        }
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  const canPost = askTitle.trim().length > 0 && askBody.trim().length > 0 && !posting;

  async function handleAskSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setPosting(true);
    try {
      const thread = await createLessonThread(lessonId, {
        title: askTitle.trim(),
        body: askBody.trim(),
      });
      setThreads((prev) => [thread, ...prev]);
      setAskTitle('');
      setAskBody('');
      toast.success('Question posted');
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not post your question.');
    } finally {
      setPosting(false);
    }
  }

  /** Keeps the row badge in sync while a thread is expanded and replied to. */
  function handlePostCountChange(threadId: string, postCount: number) {
    setThreads((prev) =>
      prev.map((thread) => (thread.id === threadId ? { ...thread, postCount } : thread)),
    );
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-3/4' />
      </div>
    );
  }

  if (gated) {
    return (
      <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
        <MessageSquare className='size-4 shrink-0 text-amber-600 mt-0.5' />
        <p className='text-sm text-amber-800 dark:text-amber-200'>
          Q&amp;A is available after enrolling in the course.
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className='text-center py-10'>
        <p className='text-sm text-destructive mb-3'>{fetchError}</p>
        <Button variant='outline' size='sm' onClick={() => setRetrySeed((s) => s + 1)}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* Ask a question (enrolled learners only — preview reads are read-only) */}
      {canParticipate && (
        <form onSubmit={handleAskSubmit} className='space-y-2'>
          <Input
            placeholder='Question title'
            value={askTitle}
            maxLength={THREAD_TITLE_MAX}
            onChange={(e) => setAskTitle(e.target.value)}
          />
          <Textarea
            placeholder='Describe your question...'
            value={askBody}
            maxLength={POST_BODY_MAX}
            onChange={(e) => setAskBody(e.target.value)}
            className='min-h-[80px] resize-y'
          />
          <div className='flex justify-end'>
            <Button type='submit' size='sm' className='gap-1.5' disabled={!canPost}>
              {posting ? <Loader2 className='size-3.5 animate-spin' /> : <Send className='size-3.5' />}
              Ask a question
            </Button>
          </div>
        </form>
      )}

      <Separator />

      {/* Thread list */}
      {threads.length === 0 ? (
        <div className='text-center py-10'>
          <MessageSquare className='size-8 text-muted-foreground/40 mx-auto' />
          <p className='text-sm text-muted-foreground mt-2'>
            No questions yet — be the first to ask.
          </p>
        </div>
      ) : (
        <div className='space-y-2'>
          {threads.map((thread) => {
            const expanded = thread.id === expandedThreadId;
            return (
              <div key={thread.id} className='rounded-lg border'>
                <button
                  type='button'
                  onClick={() => setExpandedThreadId(expanded ? null : thread.id)}
                  className='w-full flex gap-3 p-3 rounded-lg text-left hover:bg-muted/30 transition-colors'
                  aria-expanded={expanded}
                >
                  <div className='size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                    <MessageSquare className='size-3.5 text-primary' />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium'>{thread.title}</p>
                    <div className='flex items-center gap-3 mt-1.5 text-xs text-muted-foreground'>
                      <span>{thread.author.name}</span>
                      <span aria-hidden>·</span>
                      <span>{formatThreadDate(thread.lastActivityAt)}</span>
                    </div>
                  </div>
                  <div className='flex items-center gap-2 shrink-0 self-start'>
                    <Badge variant='secondary' className='text-xs'>
                      {thread.postCount} {thread.postCount === 1 ? 'post' : 'posts'}
                    </Badge>
                    <ChevronDown
                      className={`size-4 text-muted-foreground transition-transform ${
                        expanded ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </button>
                {expanded && (
                  <div className='border-t px-3 py-3'>
                    <PlayerThreadDetail
                      threadId={thread.id}
                      canParticipate={canParticipate}
                      onPostCountChange={handlePostCountChange}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Expanded view of one thread: its posts (cursor-paginated) and a reply form.
 * Loaded lazily when a thread is expanded; keeps its own request-key pattern.
 */
function PlayerThreadDetail({
  threadId,
  canParticipate,
  onPostCountChange,
}: {
  threadId: string;
  canParticipate: boolean;
  onPostCountChange: (threadId: string, postCount: number) => void;
}) {
  const [posts, setPosts] = useState<DiscussionPostDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${threadId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchThread(threadId)
      .then((detail) => {
        if (cancelled) return;
        setPosts(detail.posts);
        setNextCursor(detail.nextCursor);
        setTotalPosts(detail.totalPosts);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(
          err instanceof ApiClientError ? err.message : 'Could not load this discussion.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, requestKey]);

  const canReply = replyBody.trim().length > 0 && !replying;

  async function handleReply(event: React.FormEvent) {
    event.preventDefault();
    if (!canReply) return;
    setReplying(true);
    try {
      const post = await replyToThread(threadId, replyBody.trim());
      setPosts((prev) => [...prev, post]);
      setReplyBody('');
      // The replying guard makes concurrent submits impossible, so the
      // non-updater form is safe; the parent row badge mirrors the new total.
      const newTotalPosts = totalPosts + 1;
      setTotalPosts(newTotalPosts);
      onPostCountChange(threadId, newTotalPosts);
      toast.success('Reply posted');
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not post your reply.');
    } finally {
      setReplying(false);
    }
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchThread(threadId, { cursor: nextCursor });
      setPosts((prev) => [...prev, ...page.posts]);
      setNextCursor(page.nextCursor);
      setTotalPosts(page.totalPosts);
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not load more replies.');
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-5/6' />
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <div className='space-y-3'>
        {posts.map((post) => (
          <div key={post.id} className='flex gap-3'>
            <div className='size-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-medium'>
              {post.author.name.charAt(0).toUpperCase()}
            </div>
            <div className='flex-1 min-w-0'>
              <div className='flex items-baseline gap-2'>
                <p className='text-xs font-medium'>{post.author.name}</p>
                <p className='text-xs text-muted-foreground'>
                  {formatThreadDate(post.createdAt)}
                </p>
              </div>
              <p className='text-sm whitespace-pre-wrap mt-0.5'>{post.body}</p>
            </div>
          </div>
        ))}
      </div>

      {nextCursor && (
        <Button
          variant='ghost'
          size='sm'
          onClick={handleLoadMore}
          disabled={loadingMore}
          className='gap-1.5'
        >
          {loadingMore && <Loader2 className='size-3.5 animate-spin' />}
          Load more replies
          {totalPosts > posts.length ? ` (${posts.length}/${totalPosts})` : ''}
        </Button>
      )}

      {canParticipate && (
        <form onSubmit={handleReply} className='space-y-2'>
          <Textarea
            placeholder='Write a reply...'
            value={replyBody}
            maxLength={POST_BODY_MAX}
            onChange={(e) => setReplyBody(e.target.value)}
            className='min-h-[64px] resize-y'
          />
          <div className='flex justify-end'>
            <Button type='submit' size='sm' variant='outline' className='gap-1.5' disabled={!canReply}>
              {replying ? <Loader2 className='size-3.5 animate-spin' /> : <Send className='size-3.5' />}
              Reply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
