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

const NETWORK_PAYLOAD_LIMIT = 150;
const NETWORK_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export class LinkedInBrowserExtractor {
  private browser: Browser | undefined;

  constructor(private readonly config: AppConfig) {}

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  async scrape(profileUrl: string, publicIdentifier: string): Promise<ScrapeResult> {
    if (!this.config.hasLinkedInSession && !this.config.ALLOW_GUEST_MODE) {
      throw new ScrapeError(
        "authentication_required",
        "No LinkedIn session is configured. Set LINKEDIN_STORAGE_STATE_PATH, LINKEDIN_STORAGE_STATE_JSON, or LINKEDIN_LI_AT.",
        503
      );
    }

    const browser = await this.getBrowser();
    const context = await this.createContext(browser);
    const page = await context.newPage();
    const payloads: unknown[] = [];

    page.on("response", async (response) => {
      if (payloads.length >= NETWORK_PAYLOAD_LIMIT) return;
      const url = response.url();
      if (!url.includes("linkedin.com/voyager/api/") && !url.includes("linkedin.com/graphql")) return;
      const contentType = response.headers()["content-type"] ?? "";
      const contentLength = Number(response.headers()["content-length"] ?? 0);
      if (!contentType.includes("json") || contentLength > NETWORK_BODY_LIMIT_BYTES) return;
      try {
        payloads.push(await response.json());
      } catch {
        // Some successful GraphQL responses are streamed or empty; the DOM fallback remains available.
      }
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
      await this.loadVisibleSections(page);
      const snapshot = await this.snapshotDom(page);
      const result = normalizeProfile(payloads, snapshot, profileUrl, publicIdentifier);

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
      await context.close();
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage"]
      });
    }
    return this.browser;
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    let storageState: BrowserContextOptions["storageState"];
    if (this.config.LINKEDIN_STORAGE_STATE_JSON) {
      try {
        storageState = JSON.parse(this.config.LINKEDIN_STORAGE_STATE_JSON) as Exclude<
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
    } else if (this.config.LINKEDIN_STORAGE_STATE_PATH) {
      storageState = this.config.LINKEDIN_STORAGE_STATE_PATH;
    }

    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      locale: "en-US",
      timezoneId: "UTC",
      viewport: { width: 1440, height: 1200 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
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
    const currentUrl = page.url();
    if (/\/checkpoint\/(challenge|lg)\b/i.test(currentUrl)) {
      throw new ScrapeError(
        "challenge_required",
        "LinkedIn requires an interactive checkpoint. Refresh the session manually; this service does not bypass challenges.",
        503
      );
    }
    if (/\/login\b|\/authwall\b/i.test(currentUrl)) {
      throw new ScrapeError(
        "authentication_required",
        "The configured LinkedIn session is missing or expired.",
        503
      );
    }
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

  private async snapshotDom(page: Page): Promise<DomSnapshot> {
    return page.evaluate(() => {
      const text = (element: Element | null): string | null => {
        const value = element?.textContent?.replace(/\s+/g, " ").trim();
        return value || null;
      };
      const lines = (element: Element): string[] =>
        (element.textContent ?? "")
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(
        (script): unknown[] => {
          try {
            const parsed = JSON.parse(script.textContent ?? "null") as unknown;
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            return [];
          }
        }
      );
      const h1 = document.querySelector("main h1, h1");
      const profileImage = document.querySelector<HTMLImageElement>(
        'main img[alt*="profile" i], main img[alt*="photo" i], main img[src*="profile-displayphoto"]'
      );
      const backgroundImage = document.querySelector<HTMLImageElement>(
        'main img[alt*="background" i], main img[src*="profile-background"]'
      );
      const h1Parent = h1?.parentElement;
      const nearby = h1Parent ? Array.from(h1Parent.querySelectorAll(":scope > div, :scope > span")) : [];
      const nearbyText = nearby.map((element) => text(element)).filter((value): value is string => Boolean(value));

      const sections = Array.from(document.querySelectorAll("main section")).map((section) => {
        const heading = text(section.querySelector("h2, h3")) ?? "";
        const items = Array.from(section.querySelectorAll(":scope li")).map(lines);
        return { heading, text: text(section) ?? "", items };
      });

      return {
        name: text(h1),
        headline: nearbyText.find((value) => value !== text(h1) && value.length > 5) ?? null,
        location: nearbyText.find((value) => /,| area$| region$/i.test(value)) ?? null,
        profileImage: profileImage?.src ?? null,
        backgroundImage: backgroundImage?.src ?? null,
        jsonLd,
        sections
      };
    });
  }
}
