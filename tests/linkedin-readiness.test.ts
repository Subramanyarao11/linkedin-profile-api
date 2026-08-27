import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { LinkedInReadinessProbe } from "../src/linkedin-readiness.js";

function configured() {
  return loadConfig({
    NODE_ENV: "test",
    LINKEDIN_LI_AT: "synthetic-li-at",
    LINKEDIN_JSESSIONID: '"ajax:synthetic"',
    READINESS_KEY: "synthetic-readiness-key"
  });
}

describe("LinkedInReadinessProbe", () => {
  it("validates the lightweight member endpoint and caches the result", async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).cookie).toContain("li_at=synthetic-li-at");
      return new Response(JSON.stringify({ data: { $type: "Member" } }), {
        status: 200,
        headers: { "content-type": "application/vnd.linkedin.normalized+json+2.1" }
      });
    });
    const probe = new LinkedInReadinessProbe(configured(), request as typeof fetch);

    const first = await probe.check();
    const second = await probe.check();

    expect(first).toEqual(expect.objectContaining({
      authenticated: true,
      reason: null,
      cache: "miss"
    }));
    expect(second).toEqual(expect.objectContaining({ authenticated: true, cache: "hit" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0]?.[0])).toBe("https://www.linkedin.com/voyager/api/me");
  });

  it("classifies a login redirect as an expired session", async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://www.linkedin.com/login" }
    }));
    const probe = new LinkedInReadinessProbe(configured(), request as typeof fetch);

    await expect(probe.check()).resolves.toEqual(expect.objectContaining({
      authenticated: false,
      reason: "authentication_required",
      cache: "miss"
    }));
  });

  it("classifies server-issued li_at deletion as an expired session", async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: {
        location: "https://www.linkedin.com/voyager/api/me",
        "set-cookie": "li_at=obsolete-value; Max-Age=0; Expires=Thu, 01-Jan-1970 00:00:00 GMT"
      }
    }));
    const probe = new LinkedInReadinessProbe(configured(), request as typeof fetch);

    await expect(probe.check()).resolves.toEqual(expect.objectContaining({
      authenticated: false,
      reason: "authentication_required"
    }));
  });

  it("does not make an outbound request when cookies are absent", async () => {
    const request = vi.fn();
    const probe = new LinkedInReadinessProbe(loadConfig({ NODE_ENV: "test" }), request as typeof fetch);

    await expect(probe.check()).resolves.toEqual(expect.objectContaining({
      authenticated: false,
      reason: "not_configured"
    }));
    expect(request).not.toHaveBeenCalled();
  });
});
