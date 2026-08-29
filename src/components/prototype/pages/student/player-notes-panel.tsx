'use client';

import { useEffect, useState } from 'react';
import { Loader2, StickyNote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { deleteLessonNote, fetchLessonNote, saveLessonNote } from '@/features/learning/api';
import { ApiClientError } from '@/lib/client/api-client';
import { NOTE_BODY_MAX } from '@/contracts/learning';

/**
 * Private per-lesson notes (ENROLLED access only — the page gates rendering).
 * Explicit save only: autosave is out of scope, so the Save button is wired to
 * dirty-state tracking (disabled until the draft differs from the saved body).
 */
export default function PlayerNotesPanel({ lessonId }: { lessonId: string }) {
  const [draft, setDraft] = useState('');
  const [savedBody, setSavedBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${lessonId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchLessonNote(lessonId)
      .then((note) => {
        if (cancelled) return;
        setSavedBody(note?.body ?? '');
        setDraft(note?.body ?? '');
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A failed note read must not block the panel: start from an empty note
        // and let the next explicit save repair the state (upsert endpoint).
        if (!(err instanceof ApiClientError && err.status === 404)) {
          toast.error(err instanceof Error ? err.message : 'Could not load your note.');
        }
        setSavedBody('');
        setDraft('');
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  const dirty = draft !== savedBody;
  // The server rejects whitespace-only bodies (noteUpsertSchema trims + min 1).
  const canSave = dirty && !saving && draft.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const note = await saveLessonNote(lessonId, draft);
      setSavedBody(note.body);
      // Adopt the server-persisted body in case it differs from the draft
      // (the upsert schema trims surrounding whitespace).
      setDraft(note.body);
      toast.success('Note saved');
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not save your note.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete the note for this lesson?')) return;
    setDeleting(true);
    try {
      await deleteLessonNote(lessonId);
      setSavedBody('');
      setDraft('');
      toast.success('Note deleted');
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not delete your note.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-4 w-56' />
        <Skeleton className='min-h-[180px] w-full' />
        <div className='flex justify-end gap-2'>
          <Skeleton className='h-9 w-20' />
          <Skeleton className='h-9 w-20' />
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
          <StickyNote className='size-3.5 shrink-0' />
          Private notes for this lesson. Saved explicitly — no autosave.
        </p>
        {!dirty && savedBody.length > 0 && (
          <span className='shrink-0 text-xs font-medium text-emerald-600'>Saved</span>
        )}
      </div>

      <Textarea
        placeholder='Type your notes here...'
        value={draft}
        maxLength={NOTE_BODY_MAX}
        onChange={(e) => setDraft(e.target.value)}
        className='min-h-[200px] resize-y'
      />

      <div className='flex items-center justify-between gap-3'>
        <span
          className={`text-xs tabular-nums ${
            draft.length >= NOTE_BODY_MAX ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {draft.length}/{NOTE_BODY_MAX}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            className='gap-1.5'
            onClick={handleDelete}
            disabled={deleting || (!savedBody && !draft)}
          >
            {deleting ? <Loader2 className='size-3.5 animate-spin' /> : <Trash2 className='size-3.5' />}
            Delete
          </Button>
          <Button size='sm' onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className='size-3.5 animate-spin' />}
            Save note
          </Button>
        </div>
      </div>
    </div>
  );
}
