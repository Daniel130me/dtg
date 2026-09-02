import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.email().transform((value) => value.trim().toLowerCase()).optional(),
);

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DB_READINESS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // Observability knobs (Phase 12). RELEASE_ID falls back to the package
    // version inside observability/release.ts when unset; METRICS_ENABLED
    // gates the owner-facing /metrics endpoint (collection itself stays on).
    RELEASE_ID: optionalString,
    METRICS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    DATABASE_URL: z
      .url()
      .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
        message: "must be a PostgreSQL connection URL",
      }),
    DIRECT_URL: optionalUrl,
    TEST_DATABASE_URL: optionalUrl,
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    TRUST_PROXY_HEADERS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    RATE_LIMIT_SALT: z.string().min(16).default("development-only-rate-limit-salt"),
    BETTER_AUTH_SECRET: z.string().min(32).default("development-only-auth-secret-change-me"),
    // Reserved for the one provisioned instructor; public sign-up rejects it.
    OWNER_EMAIL: optionalEmail,
    R2_BUCKET: optionalString,
    // R2's S3 API endpoint and public delivery URL serve different purposes.
    // Presigned requests only work with the r2.cloudflarestorage.com endpoint.
    R2_S3_ENDPOINT: optionalUrl,
    R2_PUBLIC_BASE_URL: optionalUrl,
    // Deprecated compatibility alias for the public Worker/custom-domain URL.
    R2_ENDPOINT: optionalUrl,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    EMAIL_FROM: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    FLUTTERWAVE_SECRET_KEY: optionalString,
    FLUTTERWAVE_WEBHOOK_HASH: optionalString,
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === "production" &&
      /development|replace|example/i.test(value.RATE_LIMIT_SALT)
    ) {
      context.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_SALT"],
        message: "must be set to a secret value in production",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      /development|replace|example|change-me/i.test(value.BETTER_AUTH_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "must be set to a cryptographically random value in production",
      });
    }

    const smtpValues = [value.EMAIL_FROM, value.SMTP_HOST, value.SMTP_USER, value.SMTP_PASSWORD];
    const configuredSmtpValues = smtpValues.filter(Boolean).length;
    if (configuredSmtpValues > 0 && configuredSmtpValues !== smtpValues.length) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "EMAIL_FROM, SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must be configured together",
      });
    }

    // A secret key without the webhook hash (or vice versa) would let paid
    // checkout start but leave webhook fulfilment unverifiable, so both halves
    // of the Flutterwave integration must be configured together.
    const flutterwaveValues = [value.FLUTTERWAVE_SECRET_KEY, value.FLUTTERWAVE_WEBHOOK_HASH];
    const configuredFlutterwaveValues = flutterwaveValues.filter(Boolean).length;
    if (configuredFlutterwaveValues > 0 && configuredFlutterwaveValues !== flutterwaveValues.length) {
      context.addIssue({
        code: "custom",
        path: ["FLUTTERWAVE_SECRET_KEY"],
        message: "FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH must be configured together",
      });
    }

    // Media remains a degradable capability: incomplete R2 configuration must
    // not prevent authentication, catalog, or learning routes from starting.
    if (
      value.R2_S3_ENDPOINT &&
      new URL(value.R2_S3_ENDPOINT).hostname !== "r2.cloudflarestorage.com" &&
      !new URL(value.R2_S3_ENDPOINT).hostname.endsWith(".r2.cloudflarestorage.com")
    ) {
      context.addIssue({
        code: "custom",
        path: ["R2_S3_ENDPOINT"],
        message: "must be the Cloudflare R2 S3 API endpoint",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  corsOrigins: ReadonlySet<string>;
};

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnv {
  if (source === process.env && cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }

  const env: ServerEnv = {
    ...parsed.data,
    corsOrigins: new Set(
      parsed.data.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };

  if (source === process.env) cachedEnv = env;
  return env;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
