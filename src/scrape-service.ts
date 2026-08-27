import type { ScrapeResult } from "./types.js";

type Extractor = {
  scrape(profileUrl: string, publicIdentifier: string): Promise<ScrapeResult>;
};

type CacheEntry = {
  expiresAt: number;
  result: ScrapeResult;
};

export class ScrapeService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly queue: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly extractor: Extractor,
    private readonly concurrency: number,
    private readonly ttlMs: number,
    private readonly maxCacheEntries: number
  ) {}

  async get(
    profileUrl: string,
    publicIdentifier: string,
    refresh = false
  ): Promise<{ result: ScrapeResult; cache: "hit" | "miss" }> {
    const cached = this.cache.get(profileUrl);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      this.cache.delete(profileUrl);
      this.cache.set(profileUrl, cached);
      return { result: cached.result, cache: "hit" };
    }
    if (cached) this.cache.delete(profileUrl);

    await this.acquire();
    try {
      const result = await this.extractor.scrape(profileUrl, publicIdentifier);
      if (this.ttlMs > 0) this.setCache(profileUrl, result);
      return { result, cache: "miss" };
    } finally {
      this.release();
    }
  }

  private setCache(key: string, result: ScrapeResult): void {
    while (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { result, expiresAt: Date.now() + this.ttlMs });
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.();
  }
}
