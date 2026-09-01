import "server-only";

import { randomUUID } from "node:crypto";
import type {
  CompleteThumbnailUploadBody,
  CourseThumbnailResult,
  ThumbnailUploadRequest,
  ThumbnailUploadTicket,
} from "@/contracts/course-media";
import { THUMBNAIL_UPLOAD_URL_TTL_SECONDS } from "@/contracts/course-media";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { logger } from "@/server/observability/logger";
import {
  buildPublicObjectUrl,
  createSignedPutUrl,
  deleteObject,
  inspectObject,
} from "@/server/storage/r2";

const CONTENT_TYPE_EXTENSIONS: Record<ThumbnailUploadRequest["contentType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function thumbnailKeyPrefix(courseId: string): string {
  return `courses/${courseId}/thumbnail/`;
}

async function requireCourse(courseId: string): Promise<void> {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");
}

export async function createThumbnailUploadTicket(
  courseId: string,
  input: ThumbnailUploadRequest,
): Promise<ThumbnailUploadTicket> {
  await requireCourse(courseId);
  const extension = CONTENT_TYPE_EXTENSIONS[input.contentType];
  const objectKey = `${thumbnailKeyPrefix(courseId)}${randomUUID()}.${extension}`;
  const uploadUrl = await createSignedPutUrl({
    objectKey,
    contentType: input.contentType,
    expiresInSeconds: THUMBNAIL_UPLOAD_URL_TTL_SECONDS,
  });

  return {
    uploadUrl,
    objectKey,
    expiresInSeconds: THUMBNAIL_UPLOAD_URL_TTL_SECONDS,
  };
}

export async function completeThumbnailUpload(
  actorId: string,
  courseId: string,
  input: CompleteThumbnailUploadBody,
  requestId?: string,
): Promise<CourseThumbnailResult> {
  if (!input.objectKey.startsWith(thumbnailKeyPrefix(courseId))) {
    throw new ApiError(422, "INVALID_MEDIA_KEY", "The uploaded object does not belong to this course.");
  }

  await requireCourse(courseId);
  const uploaded = await inspectObject(input.objectKey).catch(() => {
    throw new ApiError(422, "MEDIA_OBJECT_NOT_FOUND", "The uploaded thumbnail could not be verified.");
  });
  if (
    uploaded.contentLength !== input.expectedSizeBytes ||
    uploaded.contentType !== input.expectedContentType
  ) {
    await deleteObject(input.objectKey).catch(() => undefined);
    throw new ApiError(422, "INVALID_MEDIA_OBJECT", "The uploaded thumbnail did not match the approved file.");
  }

  const thumbnailUrl = buildPublicObjectUrl(input.objectKey);
  const previous = await withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true, thumbnailKey: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    const updated = await transaction.course.update({
      where: { id: courseId },
      data: {
        thumbnailKey: input.objectKey,
        thumbnailUrl,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.thumbnail.updated",
        entityType: "Course",
        entityId: courseId,
        requestId,
        metadata: { objectKey: input.objectKey },
      },
      select: { id: true },
    });
    return { previousKey: course.thumbnailKey, version: updated.version };
  });

  if (previous.previousKey && previous.previousKey !== input.objectKey) {
    deleteObject(previous.previousKey).catch((error: unknown) => {
      logger.warn("Superseded course thumbnail could not be removed", {
        courseId,
        objectKey: previous.previousKey,
        error,
      });
    });
  }

  return { thumbnailUrl, courseVersion: previous.version };
}
