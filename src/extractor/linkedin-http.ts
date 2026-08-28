import type { AppConfig } from "../config.js";
import { ScrapeError } from "../errors.js";
import { LinkedInSession } from "../linkedin-session.js";
import type { ScrapeResult } from "../types.js";
import { parseHtmlSnapshot } from "./html-snapshot.js";
import { normalizeProfile } from "./normalize.js";
import { classifyBlockedPage } from "./page-state.js";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

type Fetch = typeof fetch;

export class LinkedInHttpExtractor {
  constructor(
    private readonly config: AppConfig,
    private readonly request: Fetch = fetch,
    private readonly session = new LinkedInSession(config)
  ) {}

  async scrape(profileUrl: string, publicIdentifier: string): Promise<ScrapeResult> {
    this.assertSessionConfigured();

    try {
      const mobileUrl = new URL(
        `/mwlite/profile/in/${encodeURIComponent(publicIdentifier)}`,
        "https://www.linkedin.com"
      ).href;
      const mainHtml = await this.getHtml(mobileUrl, "mobile profile");
      const snapshot = parseHtmlSnapshot(mainHtml);
      const result = normalizeProfile([], snapshot, profileUrl, publicIdentifier);

      if (!result.profile.name.full && !result.profile.headline) {
        throw new ScrapeError(
          "extraction_failed",
          "LinkedIn returned a profile response, but recognizable profile fields were not found.",
          502
        );
      }

      return result;
    } catch (error) {
      throw this.toScrapeError(error);
    }
  }

  private assertSessionConfigured(): void {
    if (this.session.configured) return;
    throw new ScrapeError(
      "authentication_required",
      "No complete LinkedIn session is configured. Set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID.",
      503
    );
  }

  private async getHtml(url: string, label: string): Promise<string> {
    const response = await this.request(url, {
      headers: this.headers(),
      redirect: "manual",
      signal: AbortSignal.timeout(this.config.SCRAPE_TIMEOUT_MS)
    });
    return this.readLinkedInResponse(response, label);
  }

  private headers(): Record<string, string> {
    return {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.linkedin.com/feed/",
      "sec-ch-ua": '"Google Chrome";v="151", "Chromium";v="151", "Not=A?Brand";v="99"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "upgrade-insecure-requests": "1",
      ...this.session.authHeaders()
    };
  }

  private async readLinkedInResponse(response: Response, label: string): Promise<string> {
    this.session.captureRotations(response.headers);
    if (!this.session.configured) {
      throw new ScrapeError(
        "authentication_required",
        "LinkedIn invalidated the configured session. Replace both session cookies.",
        503
      );
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400) {
      const redirectUrl = location
        ? new URL(location, response.url || "https://www.linkedin.com/").href
        : response.url || "https://www.linkedin.com/";
      const blocked = classifyBlockedPage(redirectUrl);
      if (blocked) throw new ScrapeError(blocked.code, blocked.message, blocked.statusCode);
      throw new ScrapeError("profile_unavailable", `LinkedIn redirected the ${label} request.`, 502);
    }
    if (response.status === 404) {
      throw new ScrapeError("profile_not_found", `LinkedIn returned 404 for the ${label} request.`, 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ScrapeError("authentication_required", "The configured LinkedIn session is missing or expired.", 503);
    }
    if (response.status === 429 || response.status === 999) {
      throw new ScrapeError("profile_unavailable", `LinkedIn rejected the ${label} request (HTTP ${response.status}).`, 502);
    }
    if (!response.ok) {
      throw new ScrapeError("profile_unavailable", `LinkedIn returned HTTP ${response.status} for the ${label} request.`, 502);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new ScrapeError("profile_unavailable", `LinkedIn's ${label} response was too large.`, 502);
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new ScrapeError("profile_unavailable", `LinkedIn's ${label} response was too large.`, 502);
    }
    const blocked = classifyBlockedPage(response.url || "https://www.linkedin.com/", body);
    if (blocked) throw new ScrapeError(blocked.code, blocked.message, blocked.statusCode);
    return body;
  }

  private toScrapeError(error: unknown): ScrapeError {
    if (error instanceof ScrapeError) return error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return new ScrapeError("scrape_timeout", "LinkedIn did not respond before the configured timeout.", 504);
    }
    return new ScrapeError(
      "extraction_failed",
      error instanceof Error ? error.message : "Unknown extraction error",
      502
    );
  }
}
