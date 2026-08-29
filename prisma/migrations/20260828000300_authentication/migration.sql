-- Adapt the foundation identity tables to Better Auth without replacing stable IDs.
ALTER TABLE "User"
ADD COLUMN "name" VARCHAR(120),
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "image" VARCHAR(2048);

UPDATE "User"
SET
  "name" = COALESCE(NULLIF(SPLIT_PART("email", '@', 1), ''), "email"),
  "emailVerified" = "emailVerifiedAt" IS NOT NULL;

ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" DROP COLUMN "emailVerifiedAt";

DROP INDEX "Account_provider_providerAccountId_key";
ALTER TABLE "Account" RENAME COLUMN "providerAccountId" TO "accountId";
ALTER TABLE "Account" RENAME COLUMN "provider" TO "providerId";
ALTER TABLE "Account"
ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "password" VARCHAR(255),
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Account" DROP COLUMN "type";
ALTER TABLE "Account" DROP COLUMN "expiresAt";
ALTER TABLE "Account" DROP COLUMN "tokenType";
ALTER TABLE "Account" DROP COLUMN "sessionState";
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

DROP INDEX "Session_sessionToken_key";
DROP INDEX "Session_userId_expires_idx";
DROP INDEX "Session_expires_idx";
ALTER TABLE "Session" RENAME COLUMN "sessionToken" TO "token";
ALTER TABLE "Session" RENAME COLUMN "expires" TO "expiresAt";
ALTER TABLE "Session"
ADD COLUMN "ipAddress" VARCHAR(64),
ADD COLUMN "userAgent" VARCHAR(512);
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

DROP INDEX "VerificationToken_tokenHash_key";
DROP INDEX "VerificationToken_expires_idx";
DROP INDEX "VerificationToken_identifier_tokenHash_key";
ALTER TABLE "VerificationToken" RENAME TO "Verification";
ALTER TABLE "Verification" RENAME COLUMN "tokenHash" TO "value";
ALTER TABLE "Verification" RENAME COLUMN "expires" TO "expiresAt";
ALTER TABLE "Verification"
ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Verification" ALTER COLUMN "identifier" TYPE VARCHAR(512);
ALTER TABLE "Verification" ALTER COLUMN "value" TYPE TEXT;
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_pkey" PRIMARY KEY ("id");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

DROP TABLE "PasswordResetToken";
