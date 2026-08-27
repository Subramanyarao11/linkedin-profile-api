import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { ScrapeService } from "../src/scrape-service.js";

const config = loadConfig({
  NODE_ENV: "test",
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
});
