import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LinkedInBrowserExtractor } from "./extractor/browser.js";
import { ScrapeService } from "./scrape-service.js";

const config = loadConfig();
const extractor = new LinkedInBrowserExtractor(config);
const service = new ScrapeService(
  extractor,
  config.SCRAPE_CONCURRENCY,
  config.PROFILE_CACHE_TTL_SECONDS * 1000,
  config.MAX_CACHE_ENTRIES
);
const app = await buildApp(config, service);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await extractor.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
