import { existsSync } from "node:fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page
} from "playwright";
import type { AppConfig } from "../config.js";
import { ScrapeError } from "../errors.js";
import type { DomSnapshot, ScrapeResult } from "../types.js";
import { normalizeProfile } from "./normalize.js";
import { classifyBlockedPage } from "./page-state.js";

const NETWORK_PAYLOAD_LIMIT = 150;
const NETWORK_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const PROFILE_DETAIL_SECTIONS = [
  { label: "experience", path: "experience" },
  { label: "education", path: "education" },
  { label: "skills", path: "skills" },
  { label: "certifications", path: "certifications" },
  { label: "languages", path: "languages" }
] as const;
const DOM_SNAPSHOT_SCRIPT = String.raw`(() => {
  const text = (element) => {
    const value = element?.textContent?.replace(/\s+/g, " ").trim();
    return value || null;
  };
  const lines = (element) =>
    ((element instanceof HTMLElement ? element.innerText : element.textContent) || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(
    (script) => {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
  );
  const h1 = document.querySelector("main h1, h1");
  const titleMatch = document.title.match(/^(.+?)\s*\|\s*LinkedIn$/i);
  const titleName = titleMatch?.[1]?.trim() || null;
  const h1Text = text(h1) || titleName;
  const profileImage = Array.from(document.querySelectorAll("main img")).find((image) => {
    const source = image.src || "";
    const alt = image.alt || "";
    if (/profile-background|background/i.test(source + " " + alt)) return false;
    return source.includes("profile-displayphoto") || Boolean(h1Text && alt.toLowerCase().includes(h1Text.toLowerCase()));
  });
  const backgroundImage = document.querySelector(
    'main img[alt*="background" i], main img[src*="profile-background"]'
  );
  const h1Parent = h1?.parentElement;
  const nearby = h1Parent ? Array.from(h1Parent.querySelectorAll(":scope > div, :scope > span")) : [];
  const nearbyText = nearby.map((element) => text(element)).filter(Boolean);
  const sections = Array.from(document.querySelectorAll("main section")).map((section) => {
    const sectionLines = lines(section);
    const firstLine = sectionLines[0] || "";
    const semanticFirstLine = /^(about|experience|education|skills|licenses\s*&\s*certifications|certifications|languages)$/i.test(firstLine);
    const heading = semanticFirstLine ? firstLine : text(section.querySelector("h2, h3")) || firstLine;
    const items = Array.from(section.querySelectorAll(":scope li")).map(lines);
    const links = Array.from(section.querySelectorAll("a")).map((anchor) => {
      let path = null;
      try {
        const url = new URL(anchor.href);
        if (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) path = url.pathname;
      } catch {
        // Ignore malformed/non-HTTP link targets.
      }
      return { text: lines(anchor), path };
    });
    return { heading, text: text(section) || "", items, lines: sectionLines, links };
  });
  return {
    name: text(h1) || titleName,
    headline: nearbyText.find((value) => value !== text(h1) && value.length > 5) || null,
    location: nearbyText.find((value) => /,| area$| region$/i.test(value)) || null,
    profileImage: profileImage?.src || null,
    backgroundImage: backgroundImage?.src || null,
    jsonLd,
    sections
  };
})()`;

export function mergeDomSnapshots(primary: DomSnapshot, details: DomSnapshot[]): DomSnapshot {
  return {
    ...primary,
    jsonLd: [primary, ...details].flatMap((snapshot) => snapshot.jsonLd),
    sections: [primary, ...details].flatMap((snapshot) => snapshot.sections)
  };
}

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
    if (!this.config.hasLinkedInSession && !this.config.ALLOW_GUEST_MODE) {
      throw new ScrapeError(
        "authentication_required",
        "No LinkedIn session is configured. Set LINKEDIN_STORAGE_STATE_PATH, LINKEDIN_STORAGE_STATE_SEED_PATH, LINKEDIN_STORAGE_STATE_JSON, or LINKEDIN_LI_AT.",
        503
      );
    }

    const browser = await this.getBrowser();
    const context = await this.getContext(browser);
    const page = await context.newPage();
    const payloads: unknown[] = [];
    const pendingPayloads = new Set<Promise<void>>();

    page.on("response", (response) => {
      if (payloads.length >= NETWORK_PAYLOAD_LIMIT) return;
      const url = response.url();
      if (!url.includes("linkedin.com/voyager/api/") && !url.includes("linkedin.com/graphql")) return;
      const contentType = response.headers()["content-type"] ?? "";
      const contentLength = Number(response.headers()["content-length"] ?? 0);
      if (!contentType.includes("json") || contentLength > NETWORK_BODY_LIMIT_BYTES) return;
      let pending: Promise<void>;
      pending = response
        .json()
        .then((payload) => {
          payloads.push(payload);
        })
        .catch(() => {
          // Some successful GraphQL responses are streamed or empty; the DOM fallback remains available.
        })
        .finally(() => pendingPayloads.delete(pending));
      pendingPayloads.add(pending);
    });

    try {
      const response = await page.goto(profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.SCRAPE_TIMEOUT_MS
      });

      if (response?.status() === 404) {
        throw new ScrapeError("profile_not_found", "LinkedIn returned 404 for this profile.", 404);
      }
      if (response?.status() === 999) {
        throw new ScrapeError("profile_unavailable", "LinkedIn rejected the automated request (HTTP 999).", 502);
      }

      await this.detectBlockedPage(page);
      try {
        await this.loadVisibleSections(page);
      } catch (error) {
        await this.detectBlockedPage(page);
        throw error;
      }
      await this.detectBlockedPage(page);
      const mainSnapshot = await this.snapshotDom(page);
      const detailResult = this.config.INCLUDE_DETAIL_PAGES
        ? await this.loadDetailPages(page, profileUrl)
        : { snapshots: [], warnings: [] };
      await Promise.allSettled([...pendingPayloads]);
      if (this.config.LINKEDIN_STORAGE_STATE_PATH) {
        await context.storageState({ path: this.config.LINKEDIN_STORAGE_STATE_PATH });
      }
      const snapshot = mergeDomSnapshots(mainSnapshot, detailResult.snapshots);
      const result = normalizeProfile(payloads, snapshot, profileUrl, publicIdentifier);
      if (detailResult.warnings.length) {
        result.warnings.push(...detailResult.warnings);
        result.profile.source.partial = true;
      }

      if (!result.profile.name.full && !result.profile.headline) {
        throw new ScrapeError(
          "extraction_failed",
          "The profile loaded, but recognizable profile fields were not found.",
          502
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ScrapeError("scrape_timeout", "LinkedIn did not load before the configured timeout.", 504);
      }
      throw new ScrapeError(
        "extraction_failed",
        error instanceof Error ? error.message : "Unknown extraction error",
        502
      );
    } finally {
      await page.close();
    }
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
      this.contextPromise = this.createContext(browser)
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

  private async createContext(browser: Browser): Promise<BrowserContext> {
    const storageState = resolveStorageState(this.config);

    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      viewport: { width: 1440, height: 1200 }
    });

    if (!storageState && this.config.LINKEDIN_LI_AT) {
      const cookies = [
        {
          name: "li_at",
          value: this.config.LINKEDIN_LI_AT,
          domain: ".linkedin.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "None" as const
        }
      ];
      if (this.config.LINKEDIN_JSESSIONID) {
        cookies.push({
          name: "JSESSIONID",
          value: this.config.LINKEDIN_JSESSIONID,
          domain: ".linkedin.com",
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "None" as const
        });
      }
      await context.addCookies(cookies);
    }

    return context;
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

  private async loadDetailPages(
    page: Page,
    profileUrl: string
  ): Promise<{ snapshots: DomSnapshot[]; warnings: string[] }> {
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
        snapshots.push(await this.snapshotDom(page));
      } catch (error) {
        if (error instanceof ScrapeError) throw error;
        warnings.push(`The ${detail.label} detail page could not be loaded.`);
      }
    }

    return { snapshots, warnings };
  }

  private async snapshotDom(page: Page): Promise<DomSnapshot> {
    return page.evaluate<DomSnapshot>(DOM_SNAPSHOT_SCRIPT);
  }
}
