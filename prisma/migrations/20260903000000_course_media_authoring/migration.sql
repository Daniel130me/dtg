-- Course media references are deliberately provider-neutral: thumbnailKey is
-- the storage identifier while thumbnailUrl is the current delivery address.
ALTER TABLE "Course"
ADD COLUMN "thumbnailKey" VARCHAR(512),
ADD COLUMN "promoVideoUrl" VARCHAR(2048);
