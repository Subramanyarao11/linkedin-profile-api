import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { ScrapeService } from "../src/scrape-service.js";

const config = loadConfig({
  NODE_ENV: "test",
  API_ACCESS_MODE: "api-key",
  API_KEYS: "test-secret",
  ALLOW_GUEST_MODE: "true"
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
          extractionMode: ["dom" as const],
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
} as unknown as ScrapeService;

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
    expect(response.json()).toEqual({ status: "ok", linkedInSessionConfigured: false });
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
    const publicService = { get } as unknown as ScrapeService;
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
