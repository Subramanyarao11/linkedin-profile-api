import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AppConfig } from "../../config.js";
import type { SessionProbe } from "../../linkedin-readiness.js";
import type { SessionAlertService } from "../../session-alert.js";
import { apiError } from "../api-error.js";
import { createHeaderKeyGuard } from "../api-key.js";
import {
  errorResponseSchema,
  readinessResponseSchema
} from "../schemas.js";

export function registerReadinessRoute(
  app: FastifyInstance,
  config: AppConfig,
  probe: SessionProbe,
  sessionAlerts: SessionAlertService
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
    async (request, reply) => {
      const result = await probe.check();
      if (result.reason === "authentication_required" || result.reason === "challenge_required") {
        void sessionAlerts.notify({
          reason: result.reason,
          source: "readiness_check"
        }).then((outcome) => {
          request.log.info({ outcome }, "LinkedIn session alert processed");
        }).catch((alertError: unknown) => {
          request.log.error({ err: alertError }, "LinkedIn session email alert failed");
        });
      }
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
