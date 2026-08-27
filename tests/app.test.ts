import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ScrapeError } from "../src/errors.js";
import type { ProfileService } from "../src/scrape-service.js";

const config = loadConfig({
  NODE_ENV: "test",
  API_ACCESS_MODE: "api-key",
  API_KEYS: "test-secret"
});

const fakeService = {
  get: async (url: string, publicIdentifier: string) => ({
    cache: "miss" as const,
    result: {
      warnings: [],
      profile: {
        source: {
          profileUrl: url,
          publicIdentifier,
          fetchedAt: "2026-01-01T00:00:00.000Z",
          extractionMode: ["html" as const],
          partial: false
        },
        name: { full: "Demo Person", first: "Demo", last: "Person" },
        headline: null,
        location: null,
        about: null,
        experience: [],
        education: [],
        skills: [],
        certifications: [],
        languages: [],
        profileImages: { profile: null, background: null }
      }
    }
  })
} satisfies ProfileService;

describe("API", () => {
  it("serves a profile form at the base URL", async () => {
    const app = await buildApp(config, fakeService);
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("One profile URL. Clean JSON.");
    expect(response.body).toContain('id="api-key"');
    await app.close();
  });

  it("exposes an unauthenticated health endpoint", async () => {
    const app = await buildApp(config, fakeService);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      linkedInSessionConfigured: false,
      readinessCheckConfigured: false,
      sessionEmailAlertConfigured: false
    });
    await app.close();
  });

  it("triggers an immediate alert when readiness detects an expired session", async () => {
    const readyConfig = loadConfig({
      NODE_ENV: "test",
      READINESS_KEY: "readiness-secret",
      LINKEDIN_LI_AT: "synthetic-li-at",
      LINKEDIN_JSESSIONID: '"ajax:synthetic"'
    });
    const probe = {
      check: vi.fn().mockResolvedValue({
        authenticated: false,
        checkedAt: "2026-08-27T00:00:00.000Z",
        durationMs: 12,
        reason: "authentication_required" as const,
        cache: "miss" as const
      })
    };
    const sessionAlerts = { notify: vi.fn().mockResolvedValue("sent" as const) };
    const app = await buildApp(readyConfig, fakeService, probe, sessionAlerts);

    const response = await app.inject({
      method: "GET",
      url: "/ready",
      headers: { "x-readiness-key": "readiness-secret" }
    });

    expect(response.statusCode).toBe(503);
    expect(sessionAlerts.notify).toHaveBeenCalledWith({
      reason: "authentication_required",
      source: "readiness_check"
    });
    await app.close();
  });

  it("protects the active LinkedIn readiness check with a separate key", async () => {
    const readyConfig = loadConfig({
      NODE_ENV: "test",
      READINESS_KEY: "readiness-secret",
      LINKEDIN_LI_AT: "synthetic-li-at",
      LINKEDIN_JSESSIONID: '"ajax:synthetic"'
    });
    const probe = {
      check: vi.fn().mockResolvedValue({
        authenticated: true,
        checkedAt: "2026-08-27T00:00:00.000Z",
        durationMs: 12,
        reason: null,
        cache: "miss"
      })
    };
    const app = await buildApp(readyConfig, fakeService, probe);

    const unauthorized = await app.inject({ method: "GET", url: "/ready" });
    const ready = await app.inject({
      method: "GET",
      url: "/ready",
      headers: { "x-readiness-key": "readiness-secret" }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(probe.check).toHaveBeenCalledTimes(1);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      linkedIn: expect.objectContaining({ authenticated: true, reason: null })
    });
    await app.close();
  });

  it("requires an API key for extraction", async () => {
    const app = await buildApp(config, fakeService);
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/demo-person/" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
    await app.close();
  });

  it("triggers an immediate alert when profile extraction loses authentication", async () => {
    const failingService = {
      async get(): Promise<never> {
        throw new ScrapeError(
          "authentication_required",
          "The configured LinkedIn session is missing or expired.",
          503
        );
      }
    };
    const unusedProbe = {
      check: vi.fn().mockRejectedValue(new Error("Readiness is not used by this test"))
    };
    const sessionAlerts = { notify: vi.fn().mockResolvedValue("sent" as const) };
    const app = await buildApp(config, failingService, unusedProbe, sessionAlerts);

    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { "x-api-key": "test-secret" },
      payload: { url: "https://www.linkedin.com/in/demo-person/" }
    });

    expect(response.statusCode).toBe(503);
    expect(sessionAlerts.notify).toHaveBeenCalledWith({
      reason: "authentication_required",
      source: "profile_extraction"
    });
    await app.close();
  });

  it("returns a structured profile for a valid request", async () => {
    const app = await buildApp(config, fakeService);
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { "x-api-key": "test-secret" },
      payload: { url: "https://in.linkedin.com/in/demo-person/?trk=test" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.source.profileUrl).toBe("https://www.linkedin.com/in/demo-person/");
    expect(response.json().data.name.full).toBe("Demo Person");
    await app.close();
  });

  it("supports a zero-friction public deployment", async () => {
    const publicConfig = loadConfig({ NODE_ENV: "test", API_ACCESS_MODE: "public" });
    const app = await buildApp(publicConfig, fakeService);
    const page = await app.inject({ method: "GET", url: "/" });
    const spec = await app.inject({ method: "GET", url: "/docs/json" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/demo-person/" }
    });

    expect(page.body).not.toContain('id="api-key"');
    expect(spec.json().components?.securitySchemes).toBeUndefined();
    expect(spec.json().paths["/v1/profiles"].post.security).toBeUndefined();
    expect(response.statusCode).toBe(200);
    expect(response.json().data.name.full).toBe("Demo Person");
    await app.close();
  });

  it("does not allow public callers to bypass the cache", async () => {
    const get = vi.fn().mockImplementation(fakeService.get.bind(fakeService));
    const publicService = { get } satisfies ProfileService;
    const publicConfig = loadConfig({ NODE_ENV: "test", API_ACCESS_MODE: "public" });
    const app = await buildApp(publicConfig, publicService);

    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/demo-person/", refresh: true }
    });

    expect(response.statusCode).toBe(200);
    expect(get).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/demo-person/",
      "demo-person",
      false
    );
    await app.close();
  });
});
