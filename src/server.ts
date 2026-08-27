import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LinkedInHttpExtractor } from "./extractor/linkedin-http.js";
import { LinkedInReadinessProbe } from "./linkedin-readiness.js";
import { LinkedInSession } from "./linkedin-session.js";
import { ScrapeService } from "./scrape-service.js";
import { EmailSessionAlert } from "./session-alert.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const linkedInSession = new LinkedInSession(config);
  const extractor = new LinkedInHttpExtractor(config, fetch, linkedInSession);
  const sessionProbe = new LinkedInReadinessProbe(config, fetch, linkedInSession);
  const sessionAlerts = new EmailSessionAlert(config);
  const service = new ScrapeService({
    extractor,
    concurrency: config.SCRAPE_CONCURRENCY,
    ttlMs: config.PROFILE_CACHE_TTL_SECONDS * 1000,
    maxCacheEntries: config.MAX_CACHE_ENTRIES
  });
  const app = await buildApp(config, service, sessionProbe, sessionAlerts);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");

    try {
      await app.close();
    } catch (error) {
      app.log.error({ error }, "Graceful shutdown failed");
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
