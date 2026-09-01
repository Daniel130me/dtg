import { z } from "zod";

export const LESSON_VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"] as const;

// R2 supports much larger objects, but a bounded product limit protects storage
// costs and keeps browser uploads practical. It can be raised without a schema change.
export const MAX_LESSON_VIDEO_BYTES = 20 * 1024 * 1024 * 1024;
export const LESSON_VIDEO_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const LESSON_VIDEO_PART_BATCH_SIZE = 8;
export const LESSON_VIDEO_UPLOAD_CONCURRENCY = 4;
export const LESSON_VIDEO_PART_URL_TTL_SECONDS = 30 * 60;
export const LESSON_VIDEO_PLAYBACK_URL_TTL_SECONDS = 6 * 60 * 60;
export const LESSON_VIDEO_MAX_RETRIES = 3;

const uploadIdentitySchema = z.object({
  objectKey: z.string().min(1).max(512),
  uploadId: z.string().min(1).max(2048),
});

const lessonVideoFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\u0000-\u001f]/.test(value), "File name contains invalid characters.");

export const lessonVideoInitiateSchema = z.object({
  fileName: lessonVideoFileNameSchema,
  contentType: z.enum(LESSON_VIDEO_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_LESSON_VIDEO_BYTES),
});

export const lessonVideoUploadTicketSchema = uploadIdentitySchema.extend({
  partSizeBytes: z.number().int().positive(),
  partCount: z.number().int().positive().max(10_000),
});

export const lessonVideoPartUrlsSchema = uploadIdentitySchema.extend({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(
    LESSON_VIDEO_PART_BATCH_SIZE,
  ),
});

export const lessonVideoPartUrlResultSchema = z.object({
  partNumber: z.number().int().positive(),
  uploadUrl: z.url(),
});

export const lessonVideoCompletedPartSchema = z.object({
  partNumber: z.number().int().min(1).max(10_000),
  etag: z.string().trim().min(1).max(256),
});

export const lessonVideoCompleteSchema = uploadIdentitySchema.extend({
  fileName: lessonVideoFileNameSchema,
  contentType: z.enum(LESSON_VIDEO_CONTENT_TYPES),
  expectedSizeBytes: z.number().int().positive().max(MAX_LESSON_VIDEO_BYTES),
  parts: z.array(lessonVideoCompletedPartSchema).min(1).max(10_000),
});

export const lessonVideoAbortSchema = uploadIdentitySchema;

export const lessonVideoResultSchema = z.object({
  lessonId: z.uuid(),
  fileName: z.string(),
  contentType: z.enum(LESSON_VIDEO_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.string(),
});

export type LessonVideoInitiateBody = z.infer<typeof lessonVideoInitiateSchema>;
export type LessonVideoUploadTicket = z.infer<typeof lessonVideoUploadTicketSchema>;
export type LessonVideoPartUrlsBody = z.infer<typeof lessonVideoPartUrlsSchema>;
export type LessonVideoPartUrlResult = z.infer<typeof lessonVideoPartUrlResultSchema>;
export type LessonVideoCompletedPart = z.infer<typeof lessonVideoCompletedPartSchema>;
export type LessonVideoCompleteBody = z.infer<typeof lessonVideoCompleteSchema>;
export type LessonVideoAbortBody = z.infer<typeof lessonVideoAbortSchema>;
export type LessonVideoResult = z.infer<typeof lessonVideoResultSchema>;
