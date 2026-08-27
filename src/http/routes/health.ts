import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { healthResponseSchema } from "../schemas.js";

export function registerHealthRoute(app: FastifyInstance, config: AppConfig): void {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        response: { 200: healthResponseSchema }
      }
    },
    async () => ({
      status: "ok",
      linkedInSessionConfigured: config.hasLinkedInSession,
      readinessCheckConfigured: config.readinessCheckConfigured
    })
  );
}
