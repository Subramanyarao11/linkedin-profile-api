import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config.js";
import { ScrapeError } from "../errors.js";
import type { DomSnapshot, ScrapeResult } from "../types.js";
import { captureDomSnapshot, mergeDomSnapshots } from "./dom-snapshot.js";
import { captureLinkedInNetworkPayloads } from "./network-capture.js";
import { normalizeProfile } from "./normalize.js";
import { classifyBlockedPage } from "./page-state.js";
import { createLinkedInContext } from "./storage-state.js";

const PROFILE_DETAIL_SECTIONS = [
  { label: "experience", path: "experience" },
  { label: "education", path: "education" },
  { label: "skills", path: "skills" },
  { label: "certifications", path: "certifications" },
  { label: "languages", path: "languages" }
] as const;

type DetailPageResult = {
  snapshots: DomSnapshot[];
  warnings: string[];
};

export class LinkedInBrowserExtractor {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private contextPromise: Promise<BrowserContext> | undefined;

  constructor(private readonly config: AppConfig) {}

  async close(): Promise<void> {
    await this.context?.close().catch(() => {
      // The browser process may already be gone during a development watcher restart.
    });
    this.context = undefined;
    this.contextPromise = undefined;

    await this.browser?.close().catch(() => {
      // Closing is best-effort and must remain idempotent during shutdown.
    });
    this.browser = undefined;
  }

  async scrape(profileUrl: string, publicIdentifier: string): Promise<ScrapeResult> {
    this.assertSessionConfigured();

    const browser = await this.getBrowser();
    const context = await this.getContext(browser);
    const page = await context.newPage();
    const networkCapture = captureLinkedInNetworkPayloads(page);

    try {
      await this.loadProfilePage(page, profileUrl);
      const mainSnapshot = await captureDomSnapshot(page);
      const detailResult = this.config.INCLUDE_DETAIL_PAGES
        ? await this.loadDetailPages(page, profileUrl)
        : { snapshots: [], warnings: [] };

      await networkCapture.waitForPending();
      await this.persistStorageState(context);

      const snapshot = mergeDomSnapshots(mainSnapshot, detailResult.snapshots);
      const result = normalizeProfile(
        networkCapture.payloads,
        snapshot,
        profileUrl,
        publicIdentifier
      );
      this.appendDetailWarnings(result, detailResult.warnings);

      if (!result.profile.name.full && !result.profile.headline) {
        throw new ScrapeError(
          "extraction_failed",
          "The profile loaded, but recognizable profile fields were not found.",
          502
        );
      }

      return result;
    } catch (error) {
      throw this.toScrapeError(error);
    } finally {
      await page.close();
    }
  }

  private assertSessionConfigured(): void {
    if (this.config.hasLinkedInSession || this.config.ALLOW_GUEST_MODE) return;

    throw new ScrapeError(
      "authentication_required",
      "No LinkedIn session is configured. Set LINKEDIN_STORAGE_STATE_PATH, LINKEDIN_STORAGE_STATE_SEED_PATH, LINKEDIN_STORAGE_STATE_JSON, or LINKEDIN_LI_AT.",
      503
    );
  }

  private async loadProfilePage(page: Page, profileUrl: string): Promise<void> {
    const response = await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.SCRAPE_TIMEOUT_MS
    });

    if (response?.status() === 404) {
      throw new ScrapeError("profile_not_found", "LinkedIn returned 404 for this profile.", 404);
    }
    if (response?.status() === 999) {
      throw new ScrapeError(
        "profile_unavailable",
        "LinkedIn rejected the automated request (HTTP 999).",
        502
      );
    }

    await this.detectBlockedPage(page);
    try {
      await this.loadVisibleSections(page);
    } catch (error) {
      await this.detectBlockedPage(page);
      throw error;
    }
    await this.detectBlockedPage(page);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.isConnected()) {
      this.context = undefined;
      this.contextPromise = undefined;
      this.browser = await chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage"]
      });
    }
    return this.browser;
  }

  private async getContext(browser: Browser): Promise<BrowserContext> {
    if (this.context) return this.context;

    if (!this.contextPromise) {
      this.contextPromise = createLinkedInContext(browser, this.config)
        .then((context) => {
          this.context = context;
          return context;
        })
        .finally(() => {
          this.contextPromise = undefined;
        });
    }

    return this.contextPromise;
  }

  private async persistStorageState(context: BrowserContext): Promise<void> {
    if (!this.config.LINKEDIN_STORAGE_STATE_PATH) return;
    await context.storageState({ path: this.config.LINKEDIN_STORAGE_STATE_PATH });
  }

  private async detectBlockedPage(page: Page): Promise<void> {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const blocked = classifyBlockedPage(page.url(), bodyText);
    if (blocked) throw new ScrapeError(blocked.code, blocked.message, blocked.statusCode);
  }

  private async loadVisibleSections(page: Page): Promise<void> {
    for (const ratio of [0.2, 0.45, 0.7, 0.95]) {
      await page.evaluate((scrollRatio) => {
        window.scrollTo({ top: document.body.scrollHeight * scrollRatio, behavior: "instant" });
      }, ratio);
      await page.waitForTimeout(450);
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(300);
  }

  private async loadDetailPages(page: Page, profileUrl: string): Promise<DetailPageResult> {
    const snapshots: DomSnapshot[] = [];
    const warnings: string[] = [];

    for (const detail of PROFILE_DETAIL_SECTIONS) {
      const detailUrl = new URL(`details/${detail.path}/`, profileUrl).href;

      try {
        const response = await page.goto(detailUrl, {
          waitUntil: "domcontentloaded",
          timeout: this.config.SCRAPE_TIMEOUT_MS
        });
        if (response?.status() === 404) continue;
        if (response?.status() === 999) {
          throw new ScrapeError(
            "profile_unavailable",
            "LinkedIn rejected a profile detail request (HTTP 999).",
            502
          );
        }

        await this.detectBlockedPage(page);
        await this.loadVisibleSections(page);
        await this.detectBlockedPage(page);
        snapshots.push(await captureDomSnapshot(page));
      } catch (error) {
        if (error instanceof ScrapeError) throw error;
        warnings.push(`The ${detail.label} detail page could not be loaded.`);
      }
    }

    return { snapshots, warnings };
  }

  private appendDetailWarnings(result: ScrapeResult, warnings: string[]): void {
    if (!warnings.length) return;
    result.warnings.push(...warnings);
    result.profile.source.partial = true;
  }

  private toScrapeError(error: unknown): ScrapeError {
    if (error instanceof ScrapeError) return error;
    if (error instanceof Error && error.name === "TimeoutError") {
      return new ScrapeError(
        "scrape_timeout",
        "LinkedIn did not load before the configured timeout.",
        504
      );
    }
    return new ScrapeError(
      "extraction_failed",
      error instanceof Error ? error.message : "Unknown extraction error",
      502
    );
  }
}
