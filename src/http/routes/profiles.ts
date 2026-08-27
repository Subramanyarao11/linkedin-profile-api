import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { ScrapeError } from "../../errors.js";
import { InvalidProfileUrlError, normalizeLinkedInProfileUrl } from "../../profile-url.js";
import type { ProfileService } from "../../scrape-service.js";
import { apiError } from "../api-error.js";
import { createApiKeyGuard } from "../api-key.js";
import {
  profileErrorResponses,
  profileRequestSchema,
  profileResponseSchema
} from "../schemas.js";

type ProfileRequestBody = {
  url: string;
  refresh?: boolean;
};

type ProfileRouteOptions = {
  config: AppConfig;
  service: ProfileService;
  apiKeyRequired: boolean;
};

export function registerProfileRoute(
  app: FastifyInstance,
  { config, service, apiKeyRequired }: ProfileRouteOptions
): void {
  app.post<{ Body: ProfileRequestBody }>(
    "/v1/profiles",
    {
      config: {
        rateLimit: {
          max: config.REQUESTS_PER_MINUTE,
          timeWindow: "1 minute"
        }
      },
      ...(apiKeyRequired ? { preHandler: createApiKeyGuard(config.apiKeys) } : {}),
      schema: {
        tags: ["profiles"],
        summary: "Extract a LinkedIn profile",
        ...(apiKeyRequired ? { security: [{ apiKey: [] }] } : {}),
        body: profileRequestSchema,
        response: {
          200: profileResponseSchema,
          ...profileErrorResponses
        }
      }
    },
    async (request, reply) => {
      const startedAt = performance.now();

      try {
        const normalized = normalizeLinkedInProfileUrl(request.body.url);
        const { result, cache } = await service.get(
          normalized.url,
          normalized.publicIdentifier,
          apiKeyRequired && (request.body.refresh ?? false)
        );

        return {
          data: result.profile,
          meta: {
            requestId: request.id,
            durationMs: Math.round(performance.now() - startedAt),
            cache,
            warnings: result.warnings
          }
        };
      } catch (error) {
        if (error instanceof InvalidProfileUrlError) {
          return reply
            .code(400)
            .send(apiError("invalid_profile_url", error.message, request.id));
        }

        if (error instanceof ScrapeError) {
          request.log.warn({ code: error.code }, "Profile extraction failed");
          return reply
            .code(error.statusCode)
            .send(apiError(error.code, error.message, request.id));
        }

        request.log.error({ err: error }, "Unexpected profile extraction error");
        return reply
          .code(500)
          .send(apiError("internal_error", "Unexpected server error.", request.id));
      }
    }
  );
}
