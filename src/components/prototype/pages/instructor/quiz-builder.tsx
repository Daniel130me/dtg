'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Loader2,
  Plus,
  RotateCw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteQuizAuthoring,
  fetchQuizAuthoring,
  saveQuizAuthoring,
} from '@/features/owner/assessments-api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import type { QuizAuthoringDto, QuizAuthoringInput } from '@/contracts/assessments';
import {
  QUIZ_EXPLANATION_MAX,
  QUIZ_MAX_ATTEMPTS_MAX,
  QUIZ_OPTION_TEXT_MAX,
  QUIZ_OPTIONS_MAX,
  QUIZ_OPTIONS_MIN,
  QUIZ_PASS_PERCENT_MAX,
  QUIZ_PASS_PERCENT_MIN,
  QUIZ_POINTS_MAX,
  QUIZ_PROMPT_MAX,
  QUIZ_QUESTIONS_MIN,
  QUIZ_TIME_LIMIT_MAX_MINUTES,
} from '@/contracts/assessments';

// Self-contained quiz authoring form for one lesson. The parent mounts it only
// while its dialog is open, so the load-on-mount effect runs once per open and
// no reset effects are needed. All limits live in the contract.

interface QuizBuilderProps {
  lessonId: string;
  lessonTitle: string;
}

// Draft shape: numeric contract fields are kept as strings so "empty input"
// (unlimited attempts / no time limit) survives typing without coercion noise.
interface QuizOptionDraft {
  text: string;
  isCorrect: boolean;
}

interface QuizQuestionDraft {
  prompt: string;
  points: string;
  explanation: string;
  options: QuizOptionDraft[];
}

interface QuizDraft {
  passPercent: string;
  maxAttempts: string;
  timeLimitMinutes: string;
  questions: QuizQuestionDraft[];
}

/** Field errors keyed by stable paths (e.g. "q0-options") rendered inline. */
type QuizFieldErrors = Record<string, string>;

// Sensible product defaults for a freshly created quiz; both are editable.
const DEFAULT_PASS_PERCENT = 70;
const DEFAULT_QUESTION_POINTS = 1;

const BLANK_QUESTION: QuizQuestionDraft = {
  prompt: '',
  points: String(DEFAULT_QUESTION_POINTS),
  explanation: '',
  options: [
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
};

/** A fresh, valid-shaped draft: one blank question with two blank options. */
function emptyDraft(): QuizDraft {
  return {
    passPercent: String(DEFAULT_PASS_PERCENT),
    maxAttempts: '',
    timeLimitMinutes: '',
    questions: [{ ...BLANK_QUESTION }],
  };
}

function draftFromDto(quiz: QuizAuthoringDto): QuizDraft {
  return {
    passPercent: String(quiz.passPercent),
    maxAttempts: quiz.maxAttempts === null ? '' : String(quiz.maxAttempts),
    timeLimitMinutes: quiz.timeLimitMinutes === null ? '' : String(quiz.timeLimitMinutes),
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      points: String(question.points),
      explanation: question.explanation ?? '',
      options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
    })),
  };
}

type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/** "" -> null (unset); otherwise an integer inside [min, max]. */
function parseOptionalInt(raw: string, min: number, max: number): ParsedNumber {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < min || value > max) return { ok: false };
  return { ok: true, value };
}

function parseRequiredInt(raw: string, min: number, max: number): ParsedNumber {
  if (raw.trim() === '') return { ok: false };
  return parseOptionalInt(raw, min, max);
}

/** Client-side mirror of quizAuthoringInputSchema so saves never 422 locally. */
function buildQuizInput(draft: QuizDraft): { input: QuizAuthoringInput | null; errors: QuizFieldErrors } {
  const errors: QuizFieldErrors = {};

  // Nullable locals keep the parsed values usable after the union-narrowing
  // if-blocks; the casts below are guarded by the errors-empty early return.
  let passPercent: number | null = null;
  const parsedPassPercent = parseRequiredInt(draft.passPercent, QUIZ_PASS_PERCENT_MIN, QUIZ_PASS_PERCENT_MAX);
  if (parsedPassPercent.ok) passPercent = parsedPassPercent.value;
  else {
    errors.passPercent = `Pass mark must be a whole number between ${QUIZ_PASS_PERCENT_MIN} and ${QUIZ_PASS_PERCENT_MAX}.`;
  }

  let maxAttempts: number | null = null;
  const parsedMaxAttempts = parseOptionalInt(draft.maxAttempts, 1, QUIZ_MAX_ATTEMPTS_MAX);
  if (parsedMaxAttempts.ok) maxAttempts = parsedMaxAttempts.value;
  else {
    errors.maxAttempts = `Attempt limit must be a whole number between 1 and ${QUIZ_MAX_ATTEMPTS_MAX}, or empty for unlimited.`;
  }

  let timeLimitMinutes: number | null = null;
  const parsedTimeLimit = parseOptionalInt(draft.timeLimitMinutes, 1, QUIZ_TIME_LIMIT_MAX_MINUTES);
  if (parsedTimeLimit.ok) timeLimitMinutes = parsedTimeLimit.value;
  else {
    errors.timeLimitMinutes = `Time limit must be a whole number between 1 and ${QUIZ_TIME_LIMIT_MAX_MINUTES} minutes, or empty for none.`;
  }

  const questions: QuizAuthoringInput['questions'] = [];
  draft.questions.forEach((question, questionIndex) => {
    // Snapshot before this question's validations; the push below runs only
    // when the question itself added no errors (saves never run with errors).
    const errorCountBeforeQuestion = Object.keys(errors).length;
    const prompt = question.prompt.trim();
    if (prompt === '') errors[`q${questionIndex}-prompt`] = 'The question prompt is required.';
    else if (prompt.length > QUIZ_PROMPT_MAX) {
      errors[`q${questionIndex}-prompt`] = `The prompt must be at most ${QUIZ_PROMPT_MAX} characters.`;
    }

    let points: number | null = null;
    const parsedPoints = parseRequiredInt(question.points, 1, QUIZ_POINTS_MAX);
    if (parsedPoints.ok) points = parsedPoints.value;
    else {
      errors[`q${questionIndex}-points`] = `Points must be a whole number between 1 and ${QUIZ_POINTS_MAX}.`;
    }

    const explanation = question.explanation.trim();
    if (explanation.length > QUIZ_EXPLANATION_MAX) {
      errors[`q${questionIndex}-explanation`] = `The explanation must be at most ${QUIZ_EXPLANATION_MAX} characters.`;
    }

    if (question.options.length < QUIZ_OPTIONS_MIN) {
      errors[`q${questionIndex}-options`] = `Every question needs at least ${QUIZ_OPTIONS_MIN} options.`;
    }

    question.options.forEach((option, optionIndex) => {
      const text = option.text.trim();
      if (text === '') {
        errors[`q${questionIndex}-o${optionIndex}-text`] = 'The option text is required.';
      } else if (text.length > QUIZ_OPTION_TEXT_MAX) {
        errors[`q${questionIndex}-o${optionIndex}-text`] = `The option text must be at most ${QUIZ_OPTION_TEXT_MAX} characters.`;
      }
    });

    if (!question.options.some((option) => option.isCorrect)) {
      errors[`q${questionIndex}-options`] = 'Mark at least one option as correct.';
    }

    // Only push when this question parsed clean; saves never run while any
    // error exists.
    if (Object.keys(errors).length === errorCountBeforeQuestion) {
      questions.push({
        prompt,
        points: points as number,
        explanation: explanation === '' ? null : explanation,
        options: question.options.map((option) => ({
          text: option.text.trim(),
          isCorrect: option.isCorrect,
        })),
      });
    }
  });

  if (draft.questions.length < QUIZ_QUESTIONS_MIN) {
    errors.questions = 'Add at least one question.';
  }

  if (Object.keys(errors).length > 0) return { input: null, errors };

  return {
    input: {
      passPercent: passPercent as number,
      maxAttempts,
      timeLimitMinutes,
      questions,
    },
    errors,
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

export default function QuizBuilder({ lessonId, lessonTitle }: QuizBuilderProps) {
  const [quiz, setQuiz] = useState<QuizAuthoringDto | null>(null);
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QuizFieldErrors>({});
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
    fetchQuizAuthoring(lessonId)
      .then((result) => {
        if (cancelled) return;
        setQuiz(result.quiz);
        setDraft(result.quiz ? draftFromDto(result.quiz) : null);
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
            : 'Something went wrong while loading the quiz.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  // --- draft mutators (draft-only until Save) --------------------------------

  const markDirty = () => setDirty(true);

  const markDirtyReset = () => {
    setDirty(false);
    setFieldErrors({});
  };

  const updateQuestion = (questionIndex: number, patch: Partial<QuizQuestionDraft>) => {
    markDirty();
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, index) =>
              index === questionIndex ? { ...question, ...patch } : question,
            ),
          }
        : current,
    );
  };

  const updateOption = (questionIndex: number, optionIndex: number, patch: Partial<QuizOptionDraft>) => {
    markDirty();
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, index) =>
              index === questionIndex
                ? {
                    ...question,
                    options: question.options.map((option, oIndex) =>
                      oIndex === optionIndex ? { ...option, ...patch } : option,
                    ),
                  }
                : question,
            ),
          }
        : current,
    );
  };

  const addQuestion = () => {
    markDirty();
    setDraft((current) =>
      current ? { ...current, questions: [...current.questions, { ...BLANK_QUESTION }] } : current,
    );
  };

  const removeQuestion = (questionIndex: number) => {
    markDirty();
    setDraft((current) =>
      current
        ? { ...current, questions: current.questions.filter((_, index) => index !== questionIndex) }
        : current,
    );
  };

  const moveQuestion = (questionIndex: number, direction: -1 | 1) => {
    markDirty();
    setDraft((current) => {
      if (!current) return current;
      const target = questionIndex + direction;
      if (target < 0 || target >= current.questions.length) return current;
      const questions = [...current.questions];
      [questions[questionIndex], questions[target]] = [questions[target], questions[questionIndex]];
      return { ...current, questions };
    });
  };

  const addOption = (questionIndex: number) => {
    markDirty();
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, index) =>
              index === questionIndex
                ? { ...question, options: [...question.options, { text: '', isCorrect: false }] }
                : question,
            ),
          }
        : current,
    );
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    markDirty();
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, index) =>
              index === questionIndex
                ? {
                    ...question,
                    options: question.options.filter((_, oIndex) => oIndex !== optionIndex),
                  }
                : question,
            ),
          }
        : current,
    );
  };

  // --- mutations --------------------------------------------------------------

  const handleSave = async () => {
    if (!draft || saving || deleting) return;
    const { input, errors } = buildQuizInput(draft);
    setFieldErrors(errors);
    if (!input) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveQuizAuthoring(lessonId, input);
      setQuiz(saved);
      setDraft(draftFromDto(saved));
      setFieldErrors({});
      setDirty(false);
      toast.success('Quiz saved');
    } catch (error) {
      // 422 QUIZ_AUTHORING_INVALID and friends surface via the server message.
      showActionErrorToast(error, 'The quiz could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || saving) return;
    if (!window.confirm(`Delete the quiz on "${lessonTitle}"? Students will no longer be able to take it.`)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteQuizAuthoring(lessonId);
      toast.success('Quiz deleted');
      setQuiz(null);
      setDraft(null);
      setFieldErrors({});
      setDirty(false);
    } catch (error) {
      showActionErrorToast(error, 'The quiz could not be deleted.');
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
          <BookOpenCheck className="size-6 text-destructive" />
        </div>
        <h3 className="font-semibold mb-1">Could not load the quiz</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{loadError}</p>
        <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
          <RotateCw className="size-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  // No quiz AND no local draft: the "nothing configured" state. Once the CTA
  // creates a draft we fall through to the editor even though `quiz` stays
  // null until the first successful save (version badge shows "New" then).
  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpenCheck className="size-4 text-primary" />
            No quiz configured
          </CardTitle>
          <CardDescription>
            &quot;{lessonTitle}&quot; is a quiz lesson, but it has no questions yet. Students see an
            empty quiz until you configure one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              markDirtyReset();
              setDraft(emptyDraft());
            }}
          >
            <Plus className="size-4 mr-2" />
            Create quiz
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
              <BookOpenCheck className="size-4 text-primary" />
              Quiz settings
            </CardTitle>
            <CardDescription>
              Saving replaces the whole quiz (all questions) and bumps its version — students always
              take the latest version.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {quiz ? `v${quiz.version}` : 'New'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Quiz-level settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="quiz-pass-percent">Pass mark (%)</Label>
            <Input
              id="quiz-pass-percent"
              type="number"
              min={QUIZ_PASS_PERCENT_MIN}
              max={QUIZ_PASS_PERCENT_MAX}
              value={draft?.passPercent ?? ''}
              onChange={(event) => {
                markDirty();
                setDraft((current) => (current ? { ...current, passPercent: event.target.value } : current));
              }}
              aria-invalid={Boolean(fieldErrors.passPercent)}
            />
            <FieldError message={fieldErrors.passPercent} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quiz-max-attempts">Max attempts</Label>
            <Input
              id="quiz-max-attempts"
              type="number"
              min={1}
              max={QUIZ_MAX_ATTEMPTS_MAX}
              placeholder="Unlimited"
              value={draft?.maxAttempts ?? ''}
              onChange={(event) => {
                markDirty();
                setDraft((current) => (current ? { ...current, maxAttempts: event.target.value } : current));
              }}
              aria-invalid={Boolean(fieldErrors.maxAttempts)}
            />
            <p className="text-xs text-muted-foreground">Empty = unlimited attempts.</p>
            <FieldError message={fieldErrors.maxAttempts} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quiz-time-limit">Time limit (minutes)</Label>
            <Input
              id="quiz-time-limit"
              type="number"
              min={1}
              max={QUIZ_TIME_LIMIT_MAX_MINUTES}
              placeholder="No limit"
              value={draft?.timeLimitMinutes ?? ''}
              onChange={(event) => {
                markDirty();
                setDraft((current) => (current ? { ...current, timeLimitMinutes: event.target.value } : current));
              }}
              aria-invalid={Boolean(fieldErrors.timeLimitMinutes)}
            />
            <p className="text-xs text-muted-foreground">Empty = no time limit.</p>
            <FieldError message={fieldErrors.timeLimitMinutes} />
          </div>
        </div>

        <FieldError message={fieldErrors.questions} />

        {/* Questions builder */}
        <div className="space-y-2">
          <Label>Questions ({draft?.questions.length ?? 0})</Label>
          <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-3 pr-1">
            {draft?.questions.map((question, questionIndex) => (
              <div key={questionIndex} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Question {questionIndex + 1}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={questionIndex === 0}
                      onClick={() => moveQuestion(questionIndex, -1)}
                      aria-label="Move question up"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={questionIndex === draft.questions.length - 1}
                      onClick={() => moveQuestion(questionIndex, 1)}
                      aria-label="Move question down"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      disabled={draft.questions.length <= QUIZ_QUESTIONS_MIN}
                      onClick={() => removeQuestion(questionIndex)}
                      aria-label="Remove question"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quiz-q${questionIndex}-prompt`} className="text-xs text-muted-foreground">
                    Prompt
                  </Label>
                  <Textarea
                    id={`quiz-q${questionIndex}-prompt`}
                    value={question.prompt}
                    maxLength={QUIZ_PROMPT_MAX}
                    rows={2}
                    placeholder="What are you asking?"
                    onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })}
                    aria-invalid={Boolean(fieldErrors[`q${questionIndex}-prompt`])}
                  />
                  <FieldError message={fieldErrors[`q${questionIndex}-prompt`]} />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor={`quiz-q${questionIndex}-points`}
                    className="text-xs text-muted-foreground"
                  >
                    Points (1–{QUIZ_POINTS_MAX})
                  </Label>
                  <Input
                    id={`quiz-q${questionIndex}-points`}
                    type="number"
                    min={1}
                    max={QUIZ_POINTS_MAX}
                    value={question.points}
                    onChange={(event) => updateQuestion(questionIndex, { points: event.target.value })}
                    className="w-28"
                    aria-invalid={Boolean(fieldErrors[`q${questionIndex}-points`])}
                  />
                  <FieldError message={fieldErrors[`q${questionIndex}-points`]} />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor={`quiz-q${questionIndex}-explanation`}
                    className="text-xs text-muted-foreground"
                  >
                    Explanation (optional, shown after submission)
                  </Label>
                  <Textarea
                    id={`quiz-q${questionIndex}-explanation`}
                    value={question.explanation}
                    maxLength={QUIZ_EXPLANATION_MAX}
                    rows={2}
                    placeholder="Why is the correct answer correct?"
                    onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })}
                    aria-invalid={Boolean(fieldErrors[`q${questionIndex}-explanation`])}
                  />
                  <FieldError message={fieldErrors[`q${questionIndex}-explanation`]} />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Options ({question.options.length} · mark the correct one
                    {question.options.some((option) => option.isCorrect) ? '' : ' — none marked yet'})
                  </Label>
                  <div className="space-y-2">
                    {question.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-start gap-2">
                        <Checkbox
                          id={`quiz-q${questionIndex}-o${optionIndex}-correct`}
                          checked={option.isCorrect}
                          onCheckedChange={(checked) =>
                            updateOption(questionIndex, optionIndex, { isCorrect: checked === true })
                          }
                          className="mt-2.5"
                          aria-label={`Option ${optionIndex + 1} is correct`}
                        />
                        <div className="flex-1 space-y-1">
                          <Input
                            id={`quiz-q${questionIndex}-o${optionIndex}-text`}
                            value={option.text}
                            maxLength={QUIZ_OPTION_TEXT_MAX}
                            placeholder={`Option ${optionIndex + 1}`}
                            onChange={(event) =>
                              updateOption(questionIndex, optionIndex, { text: event.target.value })
                            }
                            aria-invalid={Boolean(fieldErrors[`q${questionIndex}-o${optionIndex}-text`])}
                          />
                          <FieldError message={fieldErrors[`q${questionIndex}-o${optionIndex}-text`]} />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 mt-1 text-destructive hover:text-destructive"
                          disabled={question.options.length <= QUIZ_OPTIONS_MIN}
                          onClick={() => removeOption(questionIndex, optionIndex)}
                          aria-label="Remove option"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <FieldError message={fieldErrors[`q${questionIndex}-options`]} />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={question.options.length >= QUIZ_OPTIONS_MAX}
                    onClick={() => addOption(questionIndex)}
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    Add option
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addQuestion}>
            <Plus className="size-4 mr-2" />
            Add question
          </Button>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void handleDelete()}
            disabled={deleting || saving}
          >
            {deleting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
            Delete quiz
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || deleting}>
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
            {dirty && <span className="size-1.5 rounded-full bg-amber-500 mr-1" aria-hidden="true" />}
            Save quiz
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
