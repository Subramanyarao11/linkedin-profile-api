import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AppConfig } from "../../config.js";
import type { SessionProbe } from "../../linkedin-readiness.js";
import { apiError } from "../api-error.js";
import { createHeaderKeyGuard } from "../api-key.js";
import {
  errorResponseSchema,
  readinessResponseSchema
} from "../schemas.js";

export function registerReadinessRoute(
  app: FastifyInstance,
  config: AppConfig,
  probe: SessionProbe
): void {
  app.get(
    "/ready",
    {
      preHandler: readinessGuard(config),
      schema: {
        tags: ["system"],
        headers: {
          type: "object",
          properties: {
            "x-readiness-key": { type: "string", description: "Private monitoring key" }
          }
        },
        response: {
          200: readinessResponseSchema,
          401: errorResponseSchema,
          503: readinessResponseSchema
        }
      }
    },
    async (_request, reply) => {
      const result = await probe.check();
      return reply.code(result.authenticated ? 200 : 503).send({
        status: result.authenticated ? "ready" : "not_ready",
        linkedIn: result
      });
    }
  );
}

function readinessGuard(config: AppConfig): preHandlerHookHandler {
  if (config.READINESS_KEY.trim()) {
    return createHeaderKeyGuard(
      "x-readiness-key",
      [config.READINESS_KEY],
      "A valid x-readiness-key header is required."
    );
  }

  return async (request, reply) => reply.code(401).send(
    apiError(
      "readiness_not_configured",
      "The protected LinkedIn readiness check is not configured.",
      request.id
    )
  );
}
