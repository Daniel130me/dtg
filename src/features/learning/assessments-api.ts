import type {
  AssignmentLearnerViewDto,
  LearnerSubmissionDto,
  QuizActiveAttemptDto,
  QuizAttemptResultDto,
  QuizLearnerViewDto,
  QuizSubmitInput,
  SubmissionCreateInput,
} from "@/contracts/assessments";
import { apiRequest } from "@/lib/client/api-client";

const BASE_PATH = "/api/v1";

// Learner assessment wrappers (client-safe fetch helpers over apiRequest).
// Envelope shapes mirror the route handlers exactly: singletons return the DTO
// directly, mutations unwrap their named object ({ attempt } / { submission }).

/** GET /api/v1/learning/lessons/{lessonId}/quiz — sanitized quiz + attempt state. */
export function fetchQuizLearnerView(lessonId: string): Promise<QuizLearnerViewDto> {
  return apiRequest<QuizLearnerViewDto>(
    `${BASE_PATH}/learning/lessons/${encodeURIComponent(lessonId)}/quiz`,
  );
}

/**
 * POST /api/v1/learning/lessons/{lessonId}/quiz/attempts — starts a new
 * attempt or transparently resumes the in-flight one (same payload either way).
 */
export async function startQuizAttempt(lessonId: string): Promise<QuizActiveAttemptDto> {
  const { attempt } = await apiRequest<{ attempt: QuizActiveAttemptDto }>(
    `${BASE_PATH}/learning/lessons/${encodeURIComponent(lessonId)}/quiz/attempts`,
    { method: "POST" },
  );
  return attempt;
}

/** POST /api/v1/learning/quiz/attempts/{attemptId}/submit — server-side scoring. */
export function submitQuizAttempt(
  attemptId: string,
  input: QuizSubmitInput,
): Promise<QuizAttemptResultDto> {
  return apiRequest<QuizAttemptResultDto>(
    `${BASE_PATH}/learning/quiz/attempts/${encodeURIComponent(attemptId)}/submit`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** GET /api/v1/learning/quiz/attempts/{attemptId} — post-submission review. */
export function fetchQuizAttemptResult(attemptId: string): Promise<QuizAttemptResultDto> {
  return apiRequest<QuizAttemptResultDto>(
    `${BASE_PATH}/learning/quiz/attempts/${encodeURIComponent(attemptId)}`,
  );
}

/** GET /api/v1/learning/lessons/{lessonId}/assignment — brief + my submissions. */
export function fetchAssignmentLearnerView(lessonId: string): Promise<AssignmentLearnerViewDto> {
  return apiRequest<AssignmentLearnerViewDto>(
    `${BASE_PATH}/learning/lessons/${encodeURIComponent(lessonId)}/assignment`,
  );
}

/** POST /api/v1/learning/lessons/{lessonId}/assignment/submissions. */
export async function createAssignmentSubmission(
  lessonId: string,
  input: SubmissionCreateInput,
): Promise<LearnerSubmissionDto> {
  const { submission } = await apiRequest<{ submission: LearnerSubmissionDto }>(
    `${BASE_PATH}/learning/lessons/${encodeURIComponent(lessonId)}/assignment/submissions`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return submission;
}
