import { existsSync } from "node:fs";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import type { AppConfig } from "../config.js";
import { ScrapeError } from "../errors.js";

export function resolveStorageState(config: AppConfig): BrowserContextOptions["storageState"] {
  if (config.LINKEDIN_STORAGE_STATE_PATH && existsSync(config.LINKEDIN_STORAGE_STATE_PATH)) {
    return config.LINKEDIN_STORAGE_STATE_PATH;
  }

  if (
    config.LINKEDIN_STORAGE_STATE_SEED_PATH &&
    existsSync(config.LINKEDIN_STORAGE_STATE_SEED_PATH)
  ) {
    return config.LINKEDIN_STORAGE_STATE_SEED_PATH;
  }

  if (config.LINKEDIN_STORAGE_STATE_JSON) {
    try {
      return JSON.parse(config.LINKEDIN_STORAGE_STATE_JSON) as Exclude<
        BrowserContextOptions["storageState"],
        string | undefined
      >;
    } catch {
      throw new ScrapeError(
        "authentication_required",
        "LINKEDIN_STORAGE_STATE_JSON is not valid JSON.",
        503
      );
    }
  }

  if (config.LINKEDIN_STORAGE_STATE_PATH || config.LINKEDIN_STORAGE_STATE_SEED_PATH) {
    throw new ScrapeError(
      "authentication_required",
      "The configured LinkedIn storage-state file does not exist and no JSON seed was provided.",
      503
    );
  }

  return undefined;
}

export async function createLinkedInContext(
  browser: Browser,
  config: AppConfig
): Promise<BrowserContext> {
  const storageState = resolveStorageState(config);
  const context = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: { width: 1440, height: 1200 }
  });

  if (storageState || !config.LINKEDIN_LI_AT) return context;

  const cookies = [
    {
      name: "li_at",
      value: config.LINKEDIN_LI_AT,
      domain: ".linkedin.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "None" as const
    }
  ];

  if (config.LINKEDIN_JSESSIONID) {
    cookies.push({
      name: "JSESSIONID",
      value: config.LINKEDIN_JSESSIONID,
      domain: ".linkedin.com",
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "None" as const
    });
  }

  await context.addCookies(cookies);
  return context;
}
