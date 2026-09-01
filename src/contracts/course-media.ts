import { z } from "zod";

export const COURSE_THUMBNAIL_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_COURSE_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_UPLOAD_URL_TTL_SECONDS = 180;

export const thumbnailUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(COURSE_THUMBNAIL_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_COURSE_THUMBNAIL_BYTES),
});

export const thumbnailUploadTicketSchema = z.object({
  uploadUrl: z.url(),
  objectKey: z.string().min(1).max(512),
  expiresInSeconds: z.number().int().positive(),
});

export const completeThumbnailUploadSchema = z.object({
  objectKey: z.string().min(1).max(512),
  expectedSizeBytes: z.number().int().min(1).max(MAX_COURSE_THUMBNAIL_BYTES),
  expectedContentType: z.enum(COURSE_THUMBNAIL_CONTENT_TYPES),
});

export const courseThumbnailResultSchema = z.object({
  thumbnailUrl: z.url(),
  courseVersion: z.number().int().positive(),
});

export type ThumbnailUploadRequest = z.infer<typeof thumbnailUploadRequestSchema>;
export type ThumbnailUploadTicket = z.infer<typeof thumbnailUploadTicketSchema>;
export type CompleteThumbnailUploadBody = z.infer<typeof completeThumbnailUploadSchema>;
export type CourseThumbnailResult = z.infer<typeof courseThumbnailResultSchema>;
