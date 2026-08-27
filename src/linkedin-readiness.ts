import type { AppConfig } from "./config.js";
import { LinkedInSession } from "./linkedin-session.js";

const SESSION_CHECK_URL = "https://www.linkedin.com/voyager/api/me";
const MAX_RESPONSE_BYTES = 256 * 1024;

export type ReadinessReason =
  | "not_configured"
  | "authentication_required"
  | "challenge_required"
  | "rate_limited"
  | "timeout"
  | "upstream_unavailable"
  | "unexpected_response";

type ReadinessSnapshot = {
  authenticated: boolean;
  checkedAt: string;
  durationMs: number;
  reason: ReadinessReason | null;
};

export type ReadinessResult = ReadinessSnapshot & {
  cache: "hit" | "miss";
};

export type SessionProbe = {
  check(): Promise<ReadinessResult>;
};

export class LinkedInReadinessProbe implements SessionProbe {
  private cached: { expiresAt: number; snapshot: ReadinessSnapshot } | undefined;
  private inFlight: Promise<ReadinessSnapshot> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly request: typeof fetch = fetch,
    private readonly session = new LinkedInSession(config)
  ) {}

  async check(): Promise<ReadinessResult> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return { ...this.cached.snapshot, cache: "hit" };
    }

    if (this.inFlight) {
      return { ...(await this.inFlight), cache: "hit" };
    }

    this.inFlight = this.checkLinkedIn().finally(() => {
      this.inFlight = undefined;
    });
    const snapshot = await this.inFlight;
    this.cached = {
      snapshot,
      expiresAt: Date.now() + this.config.READINESS_CACHE_TTL_SECONDS * 1000
    };
    return { ...snapshot, cache: "miss" };
  }

  private async checkLinkedIn(): Promise<ReadinessSnapshot> {
    const startedAt = Date.now();
    if (!this.session.configured) return this.result(startedAt, false, "not_configured");

    try {
      const response = await this.request(SESSION_CHECK_URL, {
        headers: {
          accept: "application/vnd.linkedin.normalized+json+2.1",
          "x-restli-protocol-version": "2.0.0",
          ...this.session.authHeaders()
        },
        redirect: "manual",
        signal: AbortSignal.timeout(this.config.READINESS_TIMEOUT_MS)
      });
      this.session.captureRotations(response.headers);
      if (!this.session.configured) {
        return this.result(startedAt, false, "authentication_required");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        const path = location
          ? new URL(location, response.url || SESSION_CHECK_URL).pathname.toLowerCase()
          : "";
        if (/\/checkpoint\//.test(path)) return this.result(startedAt, false, "challenge_required");
        if (/\/(login|authwall|signup)\b/.test(path)) {
          return this.result(startedAt, false, "authentication_required");
        }
        return this.result(startedAt, false, "unexpected_response");
      }
      if (response.status === 401 || response.status === 403) {
        return this.result(startedAt, false, "authentication_required");
      }
      if (response.status === 429 || response.status === 999) {
        return this.result(startedAt, false, "rate_limited");
      }
      if (!response.ok) return this.result(startedAt, false, "upstream_unavailable");

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_RESPONSE_BYTES) {
        return this.result(startedAt, false, "unexpected_response");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        return this.result(startedAt, false, "unexpected_response");
      }

      const parsed = JSON.parse(body) as unknown;
      const contentType = response.headers.get("content-type") ?? "";
      const valid =
        contentType.includes("application/vnd.linkedin.normalized+json") &&
        isRecord(parsed) &&
        "data" in parsed;
      return this.result(startedAt, valid, valid ? null : "unexpected_response");
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return this.result(startedAt, false, "timeout");
      }
      return this.result(startedAt, false, "upstream_unavailable");
    }
  }

  private result(
    startedAt: number,
    authenticated: boolean,
    reason: ReadinessReason | null
  ): ReadinessSnapshot {
    return {
      authenticated,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      reason
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
