ALTER TABLE "Lesson"
  ADD COLUMN "videoKey" VARCHAR(512),
  ADD COLUMN "videoFileName" VARCHAR(255),
  ADD COLUMN "videoContentType" VARCHAR(100),
  ADD COLUMN "videoSizeBytes" BIGINT,
  ADD COLUMN "videoUploadedAt" TIMESTAMP(3);
