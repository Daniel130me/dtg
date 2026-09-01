import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_COURSE_THUMBNAIL_BYTES,
  completeThumbnailUploadSchema,
  thumbnailUploadRequestSchema,
} from "@/contracts/course-media";

describe("course media contracts", () => {
  it("accepts supported thumbnail metadata at the size boundary", () => {
    const parsed = thumbnailUploadRequestSchema.parse({
      fileName: "course.webp",
      contentType: "image/webp",
      sizeBytes: MAX_COURSE_THUMBNAIL_BYTES,
    });
    assert.equal(parsed.contentType, "image/webp");
  });

  it("rejects unsupported types, empty files, and oversized uploads", () => {
    assert.equal(
      thumbnailUploadRequestSchema.safeParse({
        fileName: "course.svg",
        contentType: "image/svg+xml",
        sizeBytes: 100,
      }).success,
      false,
    );
    assert.equal(
      thumbnailUploadRequestSchema.safeParse({
        fileName: "course.png",
        contentType: "image/png",
        sizeBytes: 0,
      }).success,
      false,
    );
    assert.equal(
      thumbnailUploadRequestSchema.safeParse({
        fileName: "course.png",
        contentType: "image/png",
        sizeBytes: MAX_COURSE_THUMBNAIL_BYTES + 1,
      }).success,
      false,
    );
  });

  it("requires completion metadata to match the approved upload contract", () => {
    const result = completeThumbnailUploadSchema.safeParse({
      objectKey: "courses/course-id/thumbnail/object.png",
      expectedSizeBytes: 2048,
      expectedContentType: "image/png",
    });
    assert.equal(result.success, true);
  });
});
