import { describe, expect, it, vi } from "vitest";
import { ScrapeService } from "../src/scrape-service.js";
import type { ScrapeResult } from "../src/types.js";

const result = {
  warnings: [],
  profile: {
    source: {
      profileUrl: "https://www.linkedin.com/in/demo-person/",
      publicIdentifier: "demo-person",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      extractionMode: ["network"],
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
} satisfies ScrapeResult;

describe("ScrapeService", () => {
  it("caches successful results and supports refresh", async () => {
    const scrape = vi.fn().mockResolvedValue(result);
    const service = new ScrapeService({ scrape }, 1, 60_000, 10);
    const url = "https://www.linkedin.com/in/demo-person/";

    expect((await service.get(url, "demo-person")).cache).toBe("miss");
    expect((await service.get(url, "demo-person")).cache).toBe("hit");
    expect((await service.get(url, "demo-person", true)).cache).toBe("miss");
    expect(scrape).toHaveBeenCalledTimes(2);
  });
});
