import { apiRequest } from "@/lib/client/api-client";
import type { CursorPage } from "@/contracts/api";
import type { CategoryDto, CatalogOptionDto } from "@/contracts/catalog";
import type {
  CourseThumbnailResult,
  ThumbnailUploadTicket,
} from "@/contracts/course-media";
import {
  LESSON_VIDEO_MAX_RETRIES,
  LESSON_VIDEO_PART_BATCH_SIZE,
  LESSON_VIDEO_UPLOAD_CONCURRENCY,
} from "@/contracts/lesson-video";
import type {
  LessonVideoCompletedPart,
  LessonVideoPartUrlResult,
  LessonVideoResult,
  LessonVideoUploadTicket,
} from "@/contracts/lesson-video";
import { ApiClientError } from "@/lib/client/api-client";
import type {
  CreateCourseBody,
  LessonCreateBody,
  LessonUpdateBody,
  MoveLessonBody,
  OwnerChildDeletedResult,
  OwnerCourseDetailDto,
  OwnerCourseLifecycleResult,
  OwnerCourseListItemDto,
  OwnerLessonMutationResult,
  OwnerSectionMutationResult,
  OwnerSectionReorderResult,
  SectionCreateBody,
  SectionUpdateBody,
  UpdateCourseBody,
} from "@/contracts/owner-courses";
import type { CourseStatusValue } from "@/contracts/owner-courses";

// Typed client for the owner authoring API. Route paths and verbs mirror the
// handlers under src/app/api/v1/owner/ (all of them require the OWNER role —
// the browser session cookie is attached automatically by apiRequest).

const OWNER_API_BASE = "/api/v1/owner";
const CATALOG_CATEGORIES_PATH = "/api/v1/catalog/categories";
const OWNER_CATALOG_PATH = `${OWNER_API_BASE}/catalog`;

export interface OwnerCourseListQuery {
  status?: CourseStatusValue;
  search?: string;
  cursor?: string;
  limit?: number;
}

function buildQueryString(query: OwnerCourseListQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

// -------------------------------------------------------------------------
// Courses
// -------------------------------------------------------------------------

export async function listOwnerCourses(
  query: OwnerCourseListQuery = {},
): Promise<CursorPage<OwnerCourseListItemDto>> {
  // The list handler wraps the page: { data: { courses: { items, nextCursor } } }.
  const { courses } = await apiRequest<{ courses: CursorPage<OwnerCourseListItemDto> }>(
    `${OWNER_API_BASE}/courses${buildQueryString(query)}`,
  );
  return courses;
}

export async function getOwnerCourse(courseId: string): Promise<OwnerCourseDetailDto> {
  const { course } = await apiRequest<{ course: OwnerCourseDetailDto }>(
    `${OWNER_API_BASE}/courses/${courseId}`,
  );
  return course;
}

export async function createCourse(body: CreateCourseBody): Promise<OwnerCourseDetailDto> {
  const { course } = await apiRequest<{ course: OwnerCourseDetailDto }>(
    `${OWNER_API_BASE}/courses`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return course;
}

export async function updateCourse(
  courseId: string,
  body: UpdateCourseBody,
): Promise<OwnerCourseDetailDto> {
  const { course } = await apiRequest<{ course: OwnerCourseDetailDto }>(
    `${OWNER_API_BASE}/courses/${courseId}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return course;
}

export async function deleteCourse(courseId: string): Promise<{ deleted: true; id: string }> {
  return apiRequest(`${OWNER_API_BASE}/courses/${courseId}`, { method: "DELETE" });
}

// Lifecycle transitions return the compact status result.
export async function publishCourse(courseId: string): Promise<OwnerCourseLifecycleResult> {
  const { course } = await apiRequest<{ course: OwnerCourseLifecycleResult }>(
    `${OWNER_API_BASE}/courses/${courseId}/publish`,
    { method: "POST" },
  );
  return course;
}

export async function archiveCourse(courseId: string): Promise<OwnerCourseLifecycleResult> {
  const { course } = await apiRequest<{ course: OwnerCourseLifecycleResult }>(
    `${OWNER_API_BASE}/courses/${courseId}/archive`,
    { method: "POST" },
  );
  return course;
}

export async function unpublishCourse(courseId: string): Promise<OwnerCourseLifecycleResult> {
  const { course } = await apiRequest<{ course: OwnerCourseLifecycleResult }>(
    `${OWNER_API_BASE}/courses/${courseId}/unpublish`,
    { method: "POST" },
  );
  return course;
}

// -------------------------------------------------------------------------
// Course media
// -------------------------------------------------------------------------

export async function uploadCourseThumbnail(
  courseId: string,
  file: File,
): Promise<CourseThumbnailResult> {
  const { upload } = await apiRequest<{ upload: ThumbnailUploadTicket }>(
    `${OWNER_API_BASE}/courses/${courseId}/thumbnail/upload`,
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    },
  );

  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new ApiClientError(
      uploadResponse.status,
      "MEDIA_UPLOAD_FAILED",
      "The thumbnail could not be uploaded to media storage.",
    );
  }

  const { thumbnail } = await apiRequest<{ thumbnail: CourseThumbnailResult }>(
    `${OWNER_API_BASE}/courses/${courseId}/thumbnail/complete`,
    {
      method: "POST",
      body: JSON.stringify({
        objectKey: upload.objectKey,
        expectedSizeBytes: file.size,
        expectedContentType: file.type,
      }),
    },
  );
  return thumbnail;
}

function uploadVideoPart(
  uploadUrl: string,
  blob: Blob,
  onProgress: (loadedBytes: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Media storage rejected upload part (${request.status}).`));
        return;
      }
      const etag = request.getResponseHeader("etag");
      if (!etag) {
        reject(new Error("Media storage did not expose the uploaded part ETag."));
        return;
      }
      onProgress(blob.size);
      resolve(etag);
    });
    request.addEventListener("error", () => reject(new Error("The video upload was interrupted.")));
    request.addEventListener("abort", () => reject(new Error("The video upload was cancelled.")));
    request.send(blob);
  });
}

async function uploadVideoPartWithRetry(
  part: LessonVideoPartUrlResult,
  blob: Blob,
  onProgress: (loadedBytes: number) => void,
): Promise<LessonVideoCompletedPart> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LESSON_VIDEO_MAX_RETRIES; attempt += 1) {
    try {
      const etag = await uploadVideoPart(part.uploadUrl, blob, onProgress);
      return { partNumber: part.partNumber, etag };
    } catch (error) {
      lastError = error;
      onProgress(0);
      if (attempt < LESSON_VIDEO_MAX_RETRIES) {
        await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Uploads lecture bytes directly from the browser to R2. The app server only
 * signs bounded multipart operations; it never buffers or proxies the video.
 */
export async function uploadLessonVideo(
  lessonId: string,
  file: File,
  onProgress: (percent: number) => void = () => undefined,
): Promise<LessonVideoResult> {
  const basePath = `${OWNER_API_BASE}/lessons/${lessonId}/video/uploads`;
  const { upload } = await apiRequest<{ upload: LessonVideoUploadTicket }>(basePath, {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
  });

  const completedParts: LessonVideoCompletedPart[] = [];
  let completedBytes = 0;
  const inFlightBytes = new Map<number, number>();
  const reportProgress = () => {
    const activeBytes = [...inFlightBytes.values()].reduce((total, bytes) => total + bytes, 0);
    onProgress(Math.min(99, Math.round(((completedBytes + activeBytes) / file.size) * 100)));
  };

  try {
    for (
      let batchStart = 1;
      batchStart <= upload.partCount;
      batchStart += LESSON_VIDEO_PART_BATCH_SIZE
    ) {
      const partNumbers = Array.from(
        { length: Math.min(LESSON_VIDEO_PART_BATCH_SIZE, upload.partCount - batchStart + 1) },
        (_, index) => batchStart + index,
      );
      const { parts } = await apiRequest<{ parts: LessonVideoPartUrlResult[] }>(
        `${basePath}/parts`,
        {
          method: "POST",
          body: JSON.stringify({
            objectKey: upload.objectKey,
            uploadId: upload.uploadId,
            partNumbers,
          }),
        },
      );

      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(LESSON_VIDEO_UPLOAD_CONCURRENCY, parts.length) },
        async () => {
          while (nextIndex < parts.length) {
            const part = parts[nextIndex];
            nextIndex += 1;
            const start = (part.partNumber - 1) * upload.partSizeBytes;
            const blob = file.slice(start, Math.min(start + upload.partSizeBytes, file.size));
            const completed = await uploadVideoPartWithRetry(part, blob, (loadedBytes) => {
              inFlightBytes.set(part.partNumber, loadedBytes);
              reportProgress();
            });
            inFlightBytes.delete(part.partNumber);
            completedBytes += blob.size;
            completedParts.push(completed);
            reportProgress();
          }
        },
      );
      await Promise.all(workers);
    }

    const { video } = await apiRequest<{ video: LessonVideoResult }>(`${basePath}/complete`, {
      method: "POST",
      body: JSON.stringify({
        objectKey: upload.objectKey,
        uploadId: upload.uploadId,
        fileName: file.name,
        contentType: file.type,
        expectedSizeBytes: file.size,
        parts: completedParts.sort((a, b) => a.partNumber - b.partNumber),
      }),
    });
    onProgress(100);
    return video;
  } catch (error) {
    await apiRequest(`${basePath}/abort`, {
      method: "POST",
      body: JSON.stringify({ objectKey: upload.objectKey, uploadId: upload.uploadId }),
    }).catch(() => undefined);
    throw error;
  }
}

// -------------------------------------------------------------------------
// Sections
// -------------------------------------------------------------------------

export async function createSection(
  courseId: string,
  body: SectionCreateBody,
): Promise<OwnerSectionMutationResult> {
  return apiRequest(`${OWNER_API_BASE}/courses/${courseId}/sections`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function renameSection(
  sectionId: string,
  body: SectionUpdateBody,
): Promise<OwnerSectionMutationResult> {
  return apiRequest(`${OWNER_API_BASE}/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteSection(sectionId: string): Promise<OwnerChildDeletedResult> {
  return apiRequest(`${OWNER_API_BASE}/sections/${sectionId}`, { method: "DELETE" });
}

export async function reorderSection(
  sectionId: string,
  position: number,
): Promise<OwnerSectionReorderResult> {
  return apiRequest(`${OWNER_API_BASE}/sections/${sectionId}/position`, {
    method: "POST",
    body: JSON.stringify({ position }),
  });
}

// -------------------------------------------------------------------------
// Lessons
// -------------------------------------------------------------------------

export async function createLesson(
  sectionId: string,
  body: LessonCreateBody,
): Promise<OwnerLessonMutationResult> {
  return apiRequest(`${OWNER_API_BASE}/sections/${sectionId}/lessons`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateLesson(
  lessonId: string,
  body: LessonUpdateBody,
): Promise<OwnerLessonMutationResult> {
  return apiRequest(`${OWNER_API_BASE}/lessons/${lessonId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteLesson(lessonId: string): Promise<OwnerChildDeletedResult> {
  return apiRequest(`${OWNER_API_BASE}/lessons/${lessonId}`, { method: "DELETE" });
}

export async function moveLesson(
  lessonId: string,
  body: MoveLessonBody,
): Promise<OwnerLessonMutationResult> {
  return apiRequest(`${OWNER_API_BASE}/lessons/${lessonId}/move`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// -------------------------------------------------------------------------
// Catalog (real categories for the category selects)
// -------------------------------------------------------------------------

export async function listCategories(): Promise<CategoryDto[]> {
  const { categories } = await apiRequest<{ categories: CategoryDto[] }>(
    CATALOG_CATEGORIES_PATH,
  );
  return categories;
}

export async function listOwnerCatalogOptions(): Promise<{
  categories: (CategoryDto & { sortOrder: number })[];
  levels: CatalogOptionDto[];
}> {
  return apiRequest(`${OWNER_CATALOG_PATH}`);
}

export async function createOwnerCatalogOption(
  type: "category" | "level",
  name: string,
): Promise<unknown> {
  const { option } = await apiRequest<{ option: unknown }>(OWNER_CATALOG_PATH, {
    method: "POST",
    body: JSON.stringify({ type, name }),
  });
  return option;
}
