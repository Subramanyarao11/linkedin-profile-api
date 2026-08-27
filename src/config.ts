import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  API_KEYS: z.string().default(""),
  REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  LINKEDIN_LI_AT: z.string().optional(),
  LINKEDIN_JSESSIONID: z.string().optional(),
  LINKEDIN_STORAGE_STATE_JSON: z.string().optional(),
  LINKEDIN_STORAGE_STATE_PATH: z.string().optional(),
  ALLOW_GUEST_MODE: booleanFromString,
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
  SCRAPE_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  PROFILE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(900),
  MAX_CACHE_ENTRIES: z.coerce.number().int().min(1).max(10000).default(250),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(env);
  const apiKeys = value.API_KEYS.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (value.NODE_ENV === "production" && apiKeys.length === 0) {
    throw new Error("API_KEYS must contain at least one key in production");
  }

  return {
    ...value,
    apiKeys,
    hasLinkedInSession: Boolean(
      value.LINKEDIN_STORAGE_STATE_JSON || value.LINKEDIN_STORAGE_STATE_PATH || value.LINKEDIN_LI_AT
    )
  };
}
