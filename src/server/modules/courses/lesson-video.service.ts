import "server-only";

import { LessonType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  LessonVideoAbortBody,
  LessonVideoCompleteBody,
  LessonVideoInitiateBody,
  LessonVideoPartUrlResult,
  LessonVideoPartUrlsBody,
  LessonVideoResult,
  LessonVideoUploadTicket,
} from "@/contracts/lesson-video";
import {
  LESSON_VIDEO_PART_SIZE_BYTES,
  LESSON_VIDEO_PART_URL_TTL_SECONDS,
} from "@/contracts/lesson-video";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { logger } from "@/server/observability/logger";
import {
  abortMultipartUpload,
  createMultipartUpload,
  createSignedUploadPartUrl,
  deleteObject,
  finishMultipartUpload,
  inspectObject,
} from "@/server/storage/r2";

const CONTENT_TYPE_EXTENSIONS: Record<LessonVideoInitiateBody["contentType"], string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

interface LessonVideoOwner {
  id: string;
  courseId: string;
  type: LessonType;
}

function videoKeyPrefix(lesson: LessonVideoOwner): string {
  return `courses/${lesson.courseId}/lessons/${lesson.id}/videos/`;
}

async function requireVideoLesson(lessonId: string): Promise<LessonVideoOwner> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, type: true },
  });
  if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "The lesson was not found.");
  if (lesson.type !== LessonType.VIDEO) {
    throw new ApiError(422, "INVALID_LESSON_TYPE", "Only video lessons accept lecture uploads.");
  }
  return lesson;
}

function assertOwnedObjectKey(lesson: LessonVideoOwner, objectKey: string): void {
  if (!objectKey.startsWith(videoKeyPrefix(lesson))) {
    throw new ApiError(422, "INVALID_MEDIA_KEY", "The uploaded object does not belong to this lesson.");
  }
}

export async function initiateLessonVideoUpload(
  lessonId: string,
  input: LessonVideoInitiateBody,
): Promise<LessonVideoUploadTicket> {
  const lesson = await requireVideoLesson(lessonId);
  const extension = CONTENT_TYPE_EXTENSIONS[input.contentType];
  const objectKey = `${videoKeyPrefix(lesson)}${randomUUID()}.${extension}`;
  const uploadId = await createMultipartUpload({ objectKey, contentType: input.contentType });

  return {
    objectKey,
    uploadId,
    partSizeBytes: LESSON_VIDEO_PART_SIZE_BYTES,
    partCount: Math.ceil(input.sizeBytes / LESSON_VIDEO_PART_SIZE_BYTES),
  };
}

export async function createLessonVideoPartUrls(
  lessonId: string,
  input: LessonVideoPartUrlsBody,
): Promise<LessonVideoPartUrlResult[]> {
  const lesson = await requireVideoLesson(lessonId);
  assertOwnedObjectKey(lesson, input.objectKey);

  const uniquePartNumbers = new Set(input.partNumbers);
  if (uniquePartNumbers.size !== input.partNumbers.length) {
    throw new ApiError(422, "DUPLICATE_UPLOAD_PART", "Upload part numbers must be unique.");
  }

  return Promise.all(
    input.partNumbers.map(async (partNumber) => ({
      partNumber,
      uploadUrl: await createSignedUploadPartUrl({
        objectKey: input.objectKey,
        uploadId: input.uploadId,
        partNumber,
        expiresInSeconds: LESSON_VIDEO_PART_URL_TTL_SECONDS,
      }),
    })),
  );
}

export async function completeLessonVideoUpload(
  actorId: string,
  lessonId: string,
  input: LessonVideoCompleteBody,
  requestId?: string,
): Promise<LessonVideoResult> {
  const lesson = await requireVideoLesson(lessonId);
  assertOwnedObjectKey(lesson, input.objectKey);

  const expectedPartCount = Math.ceil(input.expectedSizeBytes / LESSON_VIDEO_PART_SIZE_BYTES);
  const sortedParts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
  const hasInvalidSequence =
    sortedParts.length !== expectedPartCount ||
    sortedParts.some((part, index) => part.partNumber !== index + 1);
  if (hasInvalidSequence) {
    throw new ApiError(422, "INVALID_UPLOAD_PARTS", "The uploaded video has missing or duplicate parts.");
  }

  await finishMultipartUpload({
    objectKey: input.objectKey,
    uploadId: input.uploadId,
    parts: sortedParts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
  }).catch(() => {
    throw new ApiError(422, "MEDIA_UPLOAD_INCOMPLETE", "The video upload could not be completed.");
  });

  const uploaded = await inspectObject(input.objectKey).catch(() => {
    throw new ApiError(422, "MEDIA_OBJECT_NOT_FOUND", "The uploaded video could not be verified.");
  });
  if (
    uploaded.contentLength !== input.expectedSizeBytes ||
    uploaded.contentType !== input.contentType
  ) {
    await deleteObject(input.objectKey).catch(() => undefined);
    throw new ApiError(422, "INVALID_MEDIA_OBJECT", "The uploaded video did not match the approved file.");
  }

  const uploadedAt = new Date();
  let previous: string | null;
  try {
    previous = await withTransaction(async (transaction) => {
      const currentLesson = await transaction.lesson.findUnique({
        where: { id: lessonId },
        select: { id: true, courseId: true, videoKey: true },
      });
      if (!currentLesson) {
        throw new ApiError(404, "LESSON_NOT_FOUND", "The lesson was not found.");
      }

      await transaction.lesson.update({
        where: { id: lessonId },
        data: {
          videoUrl: null,
          videoKey: input.objectKey,
          videoFileName: input.fileName,
          videoContentType: input.contentType,
          videoSizeBytes: BigInt(input.expectedSizeBytes),
          videoUploadedAt: uploadedAt,
        },
        select: { id: true },
      });
      await transaction.course.update({
        where: { id: currentLesson.courseId },
        data: { version: { increment: 1 } },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actorId,
          action: "lesson.video.updated",
          entityType: "Lesson",
          entityId: lessonId,
          requestId,
          metadata: {
            objectKey: input.objectKey,
            contentType: input.contentType,
            sizeBytes: input.expectedSizeBytes,
          },
        },
        select: { id: true },
      });
      return currentLesson.videoKey;
    });
  } catch (error) {
    await deleteObject(input.objectKey).catch(() => undefined);
    throw error;
  }

  if (previous && previous !== input.objectKey) {
    deleteObject(previous).catch((error: unknown) => {
      logger.warn("Superseded lesson video could not be removed", {
        lessonId,
        objectKey: previous,
        error,
      });
    });
  }

  return {
    lessonId,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.expectedSizeBytes,
    uploadedAt: uploadedAt.toISOString(),
  };
}

export async function abortLessonVideoUpload(
  lessonId: string,
  input: LessonVideoAbortBody,
): Promise<void> {
  const lesson = await requireVideoLesson(lessonId);
  assertOwnedObjectKey(lesson, input.objectKey);
  await abortMultipartUpload(input).catch(() => undefined);
}
