-- Update default currency from USD to NGN for new courses
ALTER TABLE "Course" ALTER COLUMN "currency" SET DEFAULT 'NGN';

-- Update default currency in platform settings
ALTER TABLE "PlatformSettings" ALTER COLUMN "defaultCurrency" SET DEFAULT 'NGN';

-- Convert existing USD courses to NGN
UPDATE "Course" SET "currency" = 'NGN' WHERE "currency" = 'USD';
