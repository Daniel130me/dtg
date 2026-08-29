'use client';

import React, { useEffect, useState } from 'react';
import { FileCheck, Loader2, RotateCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteAssignmentAuthoring,
  fetchAssignmentAuthoring,
  saveAssignmentAuthoring,
} from '@/features/owner/assessments-api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import type { AssignmentAuthoringDto, AssignmentAuthoringInput } from '@/contracts/assessments';
import { ASSIGNMENT_INSTRUCTIONS_MAX, ASSIGNMENT_MAX_POINTS_MAX } from '@/contracts/assessments';

// Self-contained assignment brief editor for one lesson. Same lifecycle as the
// quiz builder: the parent mounts it only while its dialog is open, so the
// load-on-mount effect runs once per open. All limits live in the contract.

interface AssignmentEditorProps {
  lessonId: string;
  lessonTitle: string;
}

interface AssignmentDraft {
  instructions: string;
  maxPoints: string;
  /** "" = no deadline; otherwise a datetime-local value (browser local time). */
  dueAtLocal: string;
  allowResubmission: boolean;
}

// Sensible default for a freshly created assignment; editable before saving.
const DEFAULT_MAX_POINTS = 100;

/** ISO timestamp -> value for <input type="datetime-local"> (local time). */
function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local value -> ISO string (the API contract); '' -> null. */
function localInputToIso(value: string): string | null {
  if (value === '') return null;
  const date = new Date(value);
  // datetime-local values parse as LOCAL time, so the ISO carries the offset.
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function draftFromDto(assignment: AssignmentAuthoringDto): AssignmentDraft {
  return {
    instructions: assignment.instructions,
    maxPoints: String(assignment.maxPoints),
    dueAtLocal: assignment.dueAt ? isoToLocalInput(assignment.dueAt) : '',
    allowResubmission: assignment.allowResubmission,
  };
}

function emptyDraft(): AssignmentDraft {
  return {
    instructions: '',
    maxPoints: String(DEFAULT_MAX_POINTS),
    dueAtLocal: '',
    allowResubmission: false,
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}

export default function AssignmentEditor({ lessonId, lessonTitle }: AssignmentEditorProps) {
  const [assignment, setAssignment] = useState<AssignmentAuthoringDto | null>(null);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ instructions?: string; maxPoints?: string; dueAt?: string }>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Request-key pattern: loading is DERIVED (loadedKey !== requestKey), and
  // every setState lives inside the async callbacks or event handlers.
  const requestKey = `${lessonId}:${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchAssignmentAuthoring(lessonId)
      .then((result) => {
        if (cancelled) return;
        setAssignment(result.assignment);
        setDraft(result.assignment ? draftFromDto(result.assignment) : null);
        setFieldErrors({});
        setDirty(false);
        setLoadError(null);
        setLoadedKey(requestKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the assignment.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  const updateDraft = (patch: Partial<AssignmentDraft>) => {
    setDirty(true);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const handleSave = async () => {
    if (!draft || saving || deleting) return;

    // Client-side mirror of assignmentAuthoringInputSchema before hitting the API.
    const errors: typeof fieldErrors = {};
    const instructions = draft.instructions.trim();
    if (instructions === '') errors.instructions = 'The instructions are required.';
    else if (instructions.length > ASSIGNMENT_INSTRUCTIONS_MAX) {
      errors.instructions = `The instructions must be at most ${ASSIGNMENT_INSTRUCTIONS_MAX} characters.`;
    }

    let maxPoints: number | null = null;
    const parsedPoints = Number(draft.maxPoints.trim());
    if (draft.maxPoints.trim() === '' || !Number.isInteger(parsedPoints) || parsedPoints < 1 || parsedPoints > ASSIGNMENT_MAX_POINTS_MAX) {
      errors.maxPoints = `Max points must be a whole number between 1 and ${ASSIGNMENT_MAX_POINTS_MAX}.`;
    } else {
      maxPoints = parsedPoints;
    }

    let dueAt: string | null = null;
    if (draft.dueAtLocal !== '') {
      const parsedDate = new Date(draft.dueAtLocal);
      if (Number.isNaN(parsedDate.getTime())) {
        errors.dueAt = 'The due date could not be read. Pick it again.';
      } else {
        dueAt = parsedDate.toISOString();
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    const input: AssignmentAuthoringInput = {
      instructions,
      maxPoints: maxPoints as number,
      dueAt,
      allowResubmission: draft.allowResubmission,
    };

    setSaving(true);
    try {
      const saved = await saveAssignmentAuthoring(lessonId, input);
      setAssignment(saved);
      setDraft(draftFromDto(saved));
      setFieldErrors({});
      setDirty(false);
      toast.success('Assignment saved');
    } catch (error) {
      // 422 ASSIGNMENT_AUTHORING_INVALID and friends surface via the server message.
      showActionErrorToast(error, 'The assignment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || saving) return;
    if (!window.confirm(`Delete the assignment on "${lessonTitle}"? Existing submissions stay in the grading queue.`)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAssignmentAuthoring(lessonId);
      toast.success('Assignment deleted');
      setAssignment(null);
      setDraft(null);
      setFieldErrors({});
      setDirty(false);
    } catch (error) {
      showActionErrorToast(error, 'The assignment could not be deleted.');
    } finally {
      setDeleting(false);
    }
  };

  // --- render -----------------------------------------------------------------

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-10">
        <div className="size-14 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-3">
          <FileCheck className="size-6 text-destructive" />
        </div>
        <h3 className="font-semibold mb-1">Could not load the assignment</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{loadError}</p>
        <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
          <RotateCw className="size-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  // No brief AND no local draft: the "nothing configured" state. The CTA
  // creates a draft; the editor falls through with a "New" badge until the
  // first successful save.
  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck className="size-4 text-primary" />
            No assignment brief yet
          </CardTitle>
          <CardDescription>
            &quot;{lessonTitle}&quot; is an assignment lesson. Write the brief students will answer
            before they can submit anything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              setFieldErrors({});
              setDirty(false);
              setDraft(emptyDraft());
            }}
          >
            <FileCheck className="size-4 mr-2" />
            Create assignment
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck className="size-4 text-primary" />
              Assignment brief
            </CardTitle>
            <CardDescription>
              Students read these instructions and submit a written answer (optionally with a link).
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {assignment ? 'Configured' : 'New'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="assignment-instructions">Instructions</Label>
            <span
              className={`text-xs tabular-nums ${
                draft.instructions.length >= ASSIGNMENT_INSTRUCTIONS_MAX ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {draft.instructions.length}/{ASSIGNMENT_INSTRUCTIONS_MAX}
            </span>
          </div>
          <Textarea
            id="assignment-instructions"
            value={draft.instructions}
            maxLength={ASSIGNMENT_INSTRUCTIONS_MAX}
            rows={8}
            placeholder="What should students deliver, how will it be graded, any resources to use..."
            onChange={(event) => updateDraft({ instructions: event.target.value })}
            aria-invalid={Boolean(fieldErrors.instructions)}
            className="max-h-96 overflow-y-auto custom-scrollbar"
          />
          <FieldError message={fieldErrors.instructions} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="assignment-max-points">Max points (1–{ASSIGNMENT_MAX_POINTS_MAX})</Label>
            <Input
              id="assignment-max-points"
              type="number"
              min={1}
              max={ASSIGNMENT_MAX_POINTS_MAX}
              value={draft.maxPoints}
              onChange={(event) => updateDraft({ maxPoints: event.target.value })}
              aria-invalid={Boolean(fieldErrors.maxPoints)}
            />
            <FieldError message={fieldErrors.maxPoints} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-due-at">Due date (optional)</Label>
            <Input
              id="assignment-due-at"
              type="datetime-local"
              value={draft.dueAtLocal}
              onChange={(event) => updateDraft({ dueAtLocal: event.target.value })}
              aria-invalid={Boolean(fieldErrors.dueAt)}
            />
            <p className="text-xs text-muted-foreground">Empty = no deadline.</p>
            <FieldError message={fieldErrors.dueAt} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="assignment-resubmission"
            checked={draft.allowResubmission}
            onCheckedChange={(checked) => updateDraft({ allowResubmission: checked })}
          />
          <Label htmlFor="assignment-resubmission" className="text-sm font-normal cursor-pointer">
            Allow resubmission after a grade (students can hand in another attempt)
          </Label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void handleDelete()}
            disabled={deleting || saving}
          >
            {deleting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
            Delete assignment
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || deleting}>
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
            {dirty && <span className="size-1.5 rounded-full bg-amber-500 mr-1" aria-hidden="true" />}
            Save assignment
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
