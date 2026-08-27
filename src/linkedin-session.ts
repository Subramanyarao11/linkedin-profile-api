import type { AppConfig } from "./config.js";

const AUTH_COOKIE_NAMES = new Set(["li_at", "JSESSIONID"]);

export class LinkedInSession {
  private liAt: string;
  private jsessionId: string;

  constructor(config: Pick<AppConfig, "LINKEDIN_LI_AT" | "LINKEDIN_JSESSIONID">) {
    this.liAt = config.LINKEDIN_LI_AT?.trim() ?? "";
    this.jsessionId = config.LINKEDIN_JSESSIONID?.trim() ?? "";
  }

  get configured(): boolean {
    return Boolean(this.liAt && this.jsessionId);
  }

  authHeaders(): Record<string, string> {
    return {
      cookie: `li_at=${this.liAt}; JSESSIONID=${this.jsessionId}`,
      "csrf-token": this.jsessionId.replace(/^"|"$/g, ""),
      "user-agent": "linkedin-profile-api/1.0"
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

function isDeletion(setCookie: string): boolean {
  const maxAge = setCookie.match(/;\s*Max-Age\s*=\s*(-?\d+)/i)?.[1];
  if (maxAge !== undefined && Number(maxAge) <= 0) return true;
  const expires = setCookie.match(/;\s*Expires=([^;]+)/i)?.[1];
  if (!expires) return false;
  const timestamp = Date.parse(expires);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
