import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { LinkedInReadinessProbe, type SessionProbe } from "./linkedin-readiness.js";
import { registerErrorHandler } from "./http/api-error.js";
import { registerHttpPlugins } from "./http/plugins.js";
import { registerEvaluatorRoute } from "./http/routes/evaluator.js";
import { registerHealthRoute } from "./http/routes/health.js";
import { registerProfileRoute } from "./http/routes/profiles.js";
import { registerReadinessRoute } from "./http/routes/readiness.js";
import type { ProfileService } from "./scrape-service.js";

export async function buildApp(
  config: AppConfig,
  service: ProfileService,
  sessionProbe: SessionProbe = new LinkedInReadinessProbe(config)
): Promise<FastifyInstance> {
  const apiKeyRequired = config.API_ACCESS_MODE === "api-key";
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 16 * 1024,
    requestIdHeader: "x-request-id"
  });

  await registerHttpPlugins(app, apiKeyRequired);
  registerErrorHandler(app);
  registerEvaluatorRoute(app, apiKeyRequired);
  registerHealthRoute(app, config);
  registerReadinessRoute(app, config, sessionProbe);
  registerProfileRoute(app, { config, service, apiKeyRequired });

  return app;
}
