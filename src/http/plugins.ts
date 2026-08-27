import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

export async function registerHttpPlugins(
  app: FastifyInstance,
  apiKeyRequired: boolean
): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "LinkedIn Profile API",
        version: "1.0.0",
        description: "Extracts structured fields from a LinkedIn profile visible to the configured session."
      },
      ...(apiKeyRequired
        ? {
            components: {
              securitySchemes: {
                apiKey: { type: "apiKey" as const, in: "header" as const, name: "x-api-key" }
              }
            }
          }
        : {})
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
