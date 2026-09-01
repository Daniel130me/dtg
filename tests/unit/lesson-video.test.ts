import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LESSON_VIDEO_PART_BATCH_SIZE,
  MAX_LESSON_VIDEO_BYTES,
  lessonVideoCompleteSchema,
  lessonVideoInitiateSchema,
  lessonVideoPartUrlsSchema,
} from "@/contracts/lesson-video";

describe("lesson video contracts", () => {
  it("accepts MP4 and WebM lectures at the configured size boundary", () => {
    for (const contentType of ["video/mp4", "video/webm"] as const) {
      const parsed = lessonVideoInitiateSchema.parse({
        fileName: contentType === "video/mp4" ? "lecture.mp4" : "lecture.webm",
        contentType,
        sizeBytes: MAX_LESSON_VIDEO_BYTES,
      });
      assert.equal(parsed.contentType, contentType);
    }
  });

  it("rejects unsupported formats, unsafe names, and oversized files", () => {
    assert.equal(
      lessonVideoInitiateSchema.safeParse({
        fileName: "lecture.mov",
        contentType: "video/quicktime",
        sizeBytes: 1024,
      }).success,
      false,
    );
    assert.equal(
      lessonVideoInitiateSchema.safeParse({
        fileName: "../lecture.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
      }).success,
      false,
    );
    assert.equal(
      lessonVideoInitiateSchema.safeParse({
        fileName: "lecture.mp4",
        contentType: "video/mp4",
        sizeBytes: MAX_LESSON_VIDEO_BYTES + 1,
      }).success,
      false,
    );
  });

  it("bounds signed part batches and accepts ordered completion metadata", () => {
    assert.equal(
      lessonVideoPartUrlsSchema.safeParse({
        objectKey: "courses/course/lessons/lesson/videos/video.mp4",
        uploadId: "upload-id",
        partNumbers: Array.from({ length: LESSON_VIDEO_PART_BATCH_SIZE + 1 }, (_, i) => i + 1),
      }).success,
      false,
    );
    assert.equal(
      lessonVideoCompleteSchema.safeParse({
        objectKey: "courses/course/lessons/lesson/videos/video.mp4",
        uploadId: "upload-id",
        fileName: "lecture.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: 1024,
        parts: [{ partNumber: 1, etag: '"etag"' }],
      }).success,
      true,
    );
  });
});
