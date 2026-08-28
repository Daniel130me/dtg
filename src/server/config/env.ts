import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DB_READINESS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
    R2_BUCKET: optionalString,
    R2_ENDPOINT: optionalUrl,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    EMAIL_FROM: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
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
