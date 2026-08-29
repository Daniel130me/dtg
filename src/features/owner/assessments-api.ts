import type {
  AssignmentAuthoringDto,
  AssignmentAuthoringInput,
  GradeCreateInput,
  GradingDetailDto,
  PaginatedGradingQueueDto,
  QuizAuthoringDto,
  QuizAuthoringInput,
} from "@/contracts/assessments";
import type { z } from "zod";
import { gradingQueueQuerySchema } from "@/contracts/assessments";
import { apiRequest } from "@/lib/client/api-client";

const OWNER_API_BASE = "/api/v1/owner";

// Owner assessment authoring + grading wrappers. Envelopes mirror the routes:
// authoring singletons arrive as { quiz } / { assignment }, grading mutations
// as { submission, grade }.

/** Input form of the grading queue query (the API fills status/limit defaults). */
export type GradingQueueQueryInput = z.input<typeof gradingQueueQuerySchema>;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

// --- Quiz authoring ---------------------------------------------------------

/** GET /api/v1/owner/lessons/{lessonId}/quiz — null when none is configured. */
export function fetchQuizAuthoring(
  lessonId: string,
): Promise<{ quiz: QuizAuthoringDto | null }> {
  return apiRequest<{ quiz: QuizAuthoringDto | null }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/quiz`,
  );
}

/** PUT /api/v1/owner/lessons/{lessonId}/quiz — replaces questions transactionally. */
export async function saveQuizAuthoring(
  lessonId: string,
  input: QuizAuthoringInput,
): Promise<QuizAuthoringDto> {
  const { quiz } = await apiRequest<{ quiz: QuizAuthoringDto }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/quiz`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return quiz;
}

/** DELETE /api/v1/owner/lessons/{lessonId}/quiz — idempotent detach. */
export function deleteQuizAuthoring(lessonId: string): Promise<{ quiz: null }> {
  return apiRequest<{ quiz: null }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/quiz`,
    { method: "DELETE" },
  );
}

// --- Assignment authoring ---------------------------------------------------

/** GET /api/v1/owner/lessons/{lessonId}/assignment — null when none is configured. */
export function fetchAssignmentAuthoring(
  lessonId: string,
): Promise<{ assignment: AssignmentAuthoringDto | null }> {
  return apiRequest<{ assignment: AssignmentAuthoringDto | null }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/assignment`,
  );
}

/** PUT /api/v1/owner/lessons/{lessonId}/assignment — saves the brief. */
export async function saveAssignmentAuthoring(
  lessonId: string,
  input: AssignmentAuthoringInput,
): Promise<AssignmentAuthoringDto> {
  const { assignment } = await apiRequest<{ assignment: AssignmentAuthoringDto }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/assignment`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return assignment;
}

/** DELETE /api/v1/owner/lessons/{lessonId}/assignment — idempotent detach. */
export function deleteAssignmentAuthoring(lessonId: string): Promise<{ assignment: null }> {
  return apiRequest<{ assignment: null }>(
    `${OWNER_API_BASE}/lessons/${encodeURIComponent(lessonId)}/assignment`,
    { method: "DELETE" },
  );
}

// --- Grading ----------------------------------------------------------------

/** GET /api/v1/owner/grading/submissions — cursor-paginated queue. */
export function fetchGradingQueue(
  query: GradingQueueQueryInput = {},
): Promise<PaginatedGradingQueueDto> {
  const path = `${OWNER_API_BASE}/grading/submissions${buildQueryString(query)}`;
  return apiRequest<PaginatedGradingQueueDto>(path);
}

/** GET /api/v1/owner/grading/submissions/{submissionId} — detail + grade history. */
export function fetchGradingDetail(submissionId: string): Promise<GradingDetailDto> {
  return apiRequest<GradingDetailDto>(
    `${OWNER_API_BASE}/grading/submissions/${encodeURIComponent(submissionId)}`,
  );
}

/** POST /api/v1/owner/grading/submissions/{submissionId}/grade — appends history. */
export function gradeSubmission(
  submissionId: string,
  input: GradeCreateInput,
): Promise<GradingDetailDto["grades"][number]> {
  return apiRequest<{ grade: GradingDetailDto["grades"][number] }>(
    `${OWNER_API_BASE}/grading/submissions/${encodeURIComponent(submissionId)}/grade`,
    { method: "POST", body: JSON.stringify(input) },
  ).then(({ grade }) => grade);
}
