import type { AppConfig } from "../config.js";
import { ScrapeError } from "../errors.js";
import type { PageSnapshot, ScrapeResult } from "../types.js";
import { appendRscAbout, mergePageSnapshots, parseHtmlSnapshot } from "./html-snapshot.js";
import { normalizeProfile } from "./normalize.js";
import { classifyBlockedPage } from "./page-state.js";
import {
  collectCardText,
  findAsyncComponent,
  parseFlightRecords,
  parseHydrationRecords
} from "./rsc.js";

const ABOUT_COMPONENT_ID =
  "com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity";
const PROFILE_SCREEN_ID = "com.linkedin.sdui.flagshipnav.profile.Profile";
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DETAIL_SECTIONS = ["experience", "education", "skills", "certifications", "languages"] as const;

type Fetch = typeof fetch;

type DetailResult = {
  snapshots: PageSnapshot[];
  warnings: string[];
};

export class LinkedInHttpExtractor {
  constructor(
    private readonly config: AppConfig,
    private readonly request: Fetch = fetch
  ) {}

  async scrape(profileUrl: string, publicIdentifier: string): Promise<ScrapeResult> {
    this.assertSessionConfigured();

    try {
      const mainHtml = await this.getHtml(profileUrl, "profile");
      let mainSnapshot = parseHtmlSnapshot(mainHtml);
      const warnings: string[] = [];

      const hydration = parseHydrationRecords(mainHtml);
      const aboutRequest = findAsyncComponent(hydration, ABOUT_COMPONENT_ID);
      if (aboutRequest) {
        try {
          const aboutStream = await this.loadComponent(aboutRequest);
          const aboutText = collectCardText(parseFlightRecords(aboutStream), "About");
          if (aboutText.length) mainSnapshot = appendRscAbout(mainSnapshot, aboutText);
          else warnings.push("The About card response did not contain recognizable text.");
        } catch (error) {
          if (error instanceof ScrapeError && this.isBlockingError(error)) throw error;
          warnings.push("The About card could not be loaded from LinkedIn's component endpoint.");
        }
      } else {
        warnings.push("LinkedIn did not advertise an About component for this profile response.");
      }

      const detailResult = this.config.INCLUDE_DETAIL_PAGES
        ? await this.loadDetailPages(profileUrl)
        : { snapshots: [], warnings: [] };
      const snapshot = mergePageSnapshots(mainSnapshot, detailResult.snapshots);
      const result = normalizeProfile([], snapshot, profileUrl, publicIdentifier);
      result.warnings.push(...warnings, ...detailResult.warnings);
      result.profile.source.partial = result.warnings.length > 0;

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
    if (this.config.hasLinkedInSession) return;
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

  private async loadComponent(component: NonNullable<ReturnType<typeof findAsyncComponent>>): Promise<string> {
    const endpoint = new URL("https://www.linkedin.com/flagship-web/rsc-action/actions/component");
    endpoint.searchParams.set("componentId", component.newComponentId);
    const requestedArguments = component.requestedArguments;
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
        "x-li-rsc-stream": "true"
      },
      body: JSON.stringify({
        clientArguments: {
          payload: requestedArguments?.payload ?? {},
          states: [],
          requestMetadata: requestedArguments?.requestMetadata ?? {},
          screenId: PROFILE_SCREEN_ID,
          knownTemplateIds: []
        }
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(this.config.SCRAPE_TIMEOUT_MS)
    });
    return this.readLinkedInResponse(response, "About component");
  }

  private async loadDetailPages(profileUrl: string): Promise<DetailResult> {
    const snapshots: PageSnapshot[] = [];
    const warnings: string[] = [];

    for (const section of DETAIL_SECTIONS) {
      const detailUrl = new URL(`details/${section}/`, profileUrl).href;
      try {
        const html = await this.getHtml(detailUrl, `${section} detail`);
        const snapshot = parseHtmlSnapshot(html);
        if (snapshot.sections.some((entry) => entry.heading.toLowerCase().includes(section))) {
          snapshots.push(snapshot);
        }
      } catch (error) {
        if (error instanceof ScrapeError && error.code === "profile_not_found") continue;
        if (error instanceof ScrapeError && this.isBlockingError(error)) throw error;
        warnings.push(`The ${section} detail page could not be loaded.`);
      }
    }

    return { snapshots, warnings };
  }

  private headers(): Record<string, string> {
    const liAt = this.config.LINKEDIN_LI_AT ?? "";
    const jsessionId = this.config.LINKEDIN_JSESSIONID ?? "";
    return {
      accept: "text/html,application/xhtml+xml,application/octet-stream;q=0.9,*/*;q=0.8",
      cookie: `li_at=${liAt}; JSESSIONID=${jsessionId}`,
      "csrf-token": jsessionId.replace(/^"|"$/g, ""),
      "user-agent": "linkedin-profile-api/1.0"
    };
  }

  private async readLinkedInResponse(response: Response, label: string): Promise<string> {
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

  private isBlockingError(error: ScrapeError): boolean {
    return error.code === "authentication_required" || error.code === "challenge_required";
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
