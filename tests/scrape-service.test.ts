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
    const service = new ScrapeService({
      extractor: { scrape },
      concurrency: 1,
      ttlMs: 60_000,
      maxCacheEntries: 10
    });
    const url = "https://www.linkedin.com/in/demo-person/";

    expect((await service.get(url, "demo-person")).cache).toBe("miss");
    expect((await service.get(url, "demo-person")).cache).toBe("hit");
    expect((await service.get(url, "demo-person", true)).cache).toBe("miss");
    expect(scrape).toHaveBeenCalledTimes(2);
  });

  it("never exceeds the configured extraction concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const scrape = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return result;
    });
    const service = new ScrapeService({
      extractor: { scrape },
      concurrency: 1,
      ttlMs: 0,
      maxCacheEntries: 10
    });

    await Promise.all([
      service.get("https://www.linkedin.com/in/first-person/", "first-person"),
      service.get("https://www.linkedin.com/in/second-person/", "second-person"),
      service.get("https://www.linkedin.com/in/third-person/", "third-person")
    ]);

    expect(scrape).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(1);
  });

  it("releases a queue slot after an extraction failure", async () => {
    const scrape = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce(result);
    const service = new ScrapeService({
      extractor: { scrape },
      concurrency: 1,
      ttlMs: 0,
      maxCacheEntries: 10
    });

    const first = service.get("https://www.linkedin.com/in/failing-person/", "failing-person");
    const second = service.get("https://www.linkedin.com/in/demo-person/", "demo-person");

    await expect(first).rejects.toThrow("synthetic failure");
    await expect(second).resolves.toEqual({ result, cache: "miss" });
    expect(scrape).toHaveBeenCalledTimes(2);
  });
});
