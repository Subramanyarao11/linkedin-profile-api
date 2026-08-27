import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LinkedInBrowserExtractor } from "./extractor/browser.js";
import { ScrapeService } from "./scrape-service.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const extractor = new LinkedInBrowserExtractor(config);
  const service = new ScrapeService({
    extractor,
    concurrency: config.SCRAPE_CONCURRENCY,
    ttlMs: config.PROFILE_CACHE_TTL_SECONDS * 1000,
    maxCacheEntries: config.MAX_CACHE_ENTRIES
  });
  const app = await buildApp(config, service);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");

    const closeErrors: unknown[] = [];
    try {
      await app.close();
    } catch (error) {
      closeErrors.push(error);
    }
    try {
      await extractor.close();
    } catch (error) {
      closeErrors.push(error);
    }

    if (closeErrors.length) {
      app.log.error({ errors: closeErrors }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  console.error("Failed to start the server", error);
  process.exitCode = 1;
});
