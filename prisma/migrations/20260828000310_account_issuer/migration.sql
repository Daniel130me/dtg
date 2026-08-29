ALTER TABLE "Account" ADD COLUMN "issuer" VARCHAR(512);

UPDATE "Account"
SET "issuer" = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "providerId"
END;

ALTER TABLE "Account" ALTER COLUMN "issuer" SET NOT NULL;
DROP INDEX "Account_providerId_accountId_key";
CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");
