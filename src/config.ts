import { z } from "zod";

function booleanFromString(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  API_ACCESS_MODE: z.enum(["public", "api-key"]).default("public"),
  API_KEYS: z.string().default(""),
  REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  LINKEDIN_LI_AT: z.string().optional(),
  LINKEDIN_JSESSIONID: z.string().optional(),
  READINESS_KEY: z.string().default(""),
  READINESS_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanFromString("false"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SESSION_ALERT_EMAIL_FROM: z.string().default(""),
  SESSION_ALERT_EMAIL_TO: z.string().default(""),
  SESSION_ALERT_COOLDOWN_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  SERVICE_PUBLIC_URL: z.string().default(""),
  INCLUDE_DETAIL_PAGES: booleanFromString("true"),
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
  SCRAPE_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  PROFILE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(900),
  MAX_CACHE_ENTRIES: z.coerce.number().int().min(1).max(10000).default(250),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = environmentSchema.parse(env);
  const apiKeys = value.API_KEYS.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (value.API_ACCESS_MODE === "api-key" && apiKeys.length === 0) {
    throw new Error("API_KEYS must contain at least one key when API_ACCESS_MODE=api-key");
  }

  const smtpValues = [
    value.SMTP_HOST,
    value.SMTP_USER,
    value.SMTP_PASS,
    value.SESSION_ALERT_EMAIL_TO
  ];
  const hasLinkedInSession = Boolean(
    value.LINKEDIN_LI_AT?.trim() && value.LINKEDIN_JSESSIONID?.trim()
  );

  return {
    ...value,
    apiKeys,
    hasLinkedInSession,
    readinessCheckConfigured: Boolean(value.READINESS_KEY.trim() && hasLinkedInSession),
    sessionEmailAlertConfigured: smtpValues.every((entry) => Boolean(entry.trim()))
  };
}
