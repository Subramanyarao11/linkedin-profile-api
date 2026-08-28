import type { AppConfig } from "./config.js";

const AUTH_COOKIE_NAMES = new Set(["li_at", "JSESSIONID"]);

export class LinkedInSession {
  private liAt: string;
  private jsessionId: string;
  private readonly additionalCookies: string;

  constructor(
    config: Pick<
      AppConfig,
      "LINKEDIN_LI_AT" | "LINKEDIN_JSESSIONID" | "LINKEDIN_ADDITIONAL_COOKIES"
    >
  ) {
    this.liAt = config.LINKEDIN_LI_AT?.trim() ?? "";
    this.jsessionId = config.LINKEDIN_JSESSIONID?.trim() ?? "";
    this.additionalCookies = sanitizeAdditionalCookies(config.LINKEDIN_ADDITIONAL_COOKIES);
  }

  get configured(): boolean {
    return Boolean(this.liAt && this.jsessionId);
  }

  authHeaders(): Record<string, string> {
    const cookies = [`li_at=${this.liAt}`, `JSESSIONID=${this.jsessionId}`];
    if (this.additionalCookies) cookies.push(this.additionalCookies);

    return {
      cookie: cookies.join("; "),
      "csrf-token": this.jsessionId.replace(/^"|"$/g, ""),
      "user-agent":
        "Mozilla/5.0 (Linux; Android 16; Pixel 9 Build/BP2A.250705.008; wv) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 " +
        "Chrome/151.0.0.0 Mobile Safari/537.36"
    };
  }

  captureRotations(headers: Headers): void {
    const setCookies = headers.getSetCookie();
    for (const setCookie of setCookies) {
      const separator = setCookie.indexOf("=");
      if (separator < 1) continue;

      const name = setCookie.slice(0, separator).trim();
      if (!AUTH_COOKIE_NAMES.has(name)) continue;
      const cookieValue = setCookie.slice(separator + 1).split(";", 1)[0]?.trim() ?? "";
      const value = isDeletion(setCookie) ? "" : cookieValue;

      if (name === "li_at") this.liAt = value;
      if (name === "JSESSIONID") this.jsessionId = value;
    }
  }
}

function sanitizeAdditionalCookies(value: string): string {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return false;
      return !AUTH_COOKIE_NAMES.has(part.slice(0, separator).trim());
    })
    .join("; ");
}

function isDeletion(setCookie: string): boolean {
  const maxAge = setCookie.match(/;\s*Max-Age\s*=\s*(-?\d+)/i)?.[1];
  if (maxAge !== undefined && Number(maxAge) <= 0) return true;
  const expires = setCookie.match(/;\s*Expires=([^;]+)/i)?.[1];
  if (!expires) return false;
  const timestamp = Date.parse(expires);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
