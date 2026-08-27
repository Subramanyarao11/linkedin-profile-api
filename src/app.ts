import { timingSafeEqual } from "node:crypto";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { ScrapeError } from "./errors.js";
import { InvalidProfileUrlError, normalizeLinkedInProfileUrl } from "./profile-url.js";
import type { ScrapeService } from "./scrape-service.js";

const profileRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: { type: "string", format: "uri", examples: ["https://www.linkedin.com/in/satyanadella/"] },
    refresh: { type: "boolean", default: false }
  }
} as const;

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" }
      }
    }
  }
} as const;

const nullableString = { type: "string", nullable: true } as const;
const yearMonthSchema = {
  type: "object",
  nullable: true,
  required: ["year", "month"],
  properties: { year: { type: "integer" }, month: { type: "integer", nullable: true } }
} as const;
const dateRangeSchema = {
  type: "object",
  nullable: true,
  required: ["start", "end", "isCurrent"],
  properties: {
    start: yearMonthSchema,
    end: yearMonthSchema,
    isCurrent: { type: "boolean" }
  }
} as const;
const profileResponseSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "object",
      required: [
        "source", "name", "headline", "location", "about", "experience", "education", "skills",
        "certifications", "languages", "profileImages"
      ],
      properties: {
        source: {
          type: "object",
          required: ["profileUrl", "publicIdentifier", "fetchedAt", "extractionMode", "partial"],
          properties: {
            profileUrl: { type: "string", format: "uri" },
            publicIdentifier: { type: "string" },
            fetchedAt: { type: "string", format: "date-time" },
            extractionMode: { type: "array", items: { type: "string", enum: ["network", "json-ld", "dom"] } },
            partial: { type: "boolean" }
          }
        },
        name: {
          type: "object",
          required: ["full", "first", "last"],
          properties: { full: nullableString, first: nullableString, last: nullableString }
        },
        headline: nullableString,
        location: nullableString,
        about: nullableString,
        experience: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "company", "companyLinkedInUrl", "employmentType", "location", "description", "dateRange"],
            properties: {
              title: { type: "string" },
              company: nullableString,
              companyLinkedInUrl: nullableString,
              employmentType: nullableString,
              location: nullableString,
              description: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        education: {
          type: "array",
          items: {
            type: "object",
            required: ["school", "schoolLinkedInUrl", "degree", "fieldOfStudy", "activities", "description", "dateRange"],
            properties: {
              school: { type: "string" },
              schoolLinkedInUrl: nullableString,
              degree: nullableString,
              fieldOfStudy: nullableString,
              activities: nullableString,
              description: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        skills: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "endorsementCount"],
            properties: { name: { type: "string" }, endorsementCount: { type: "integer", nullable: true } }
          }
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "authority", "licenseNumber", "credentialUrl", "dateRange"],
            properties: {
              name: { type: "string" },
              authority: nullableString,
              licenseNumber: nullableString,
              credentialUrl: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        languages: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "proficiency"],
            properties: { name: { type: "string" }, proficiency: nullableString }
          }
        },
        profileImages: {
          type: "object",
          required: ["profile", "background"],
          properties: { profile: nullableString, background: nullableString }
        }
      }
    },
    meta: {
      type: "object",
      required: ["requestId", "durationMs", "cache", "warnings"],
      properties: {
        requestId: { type: "string" },
        durationMs: { type: "integer" },
        cache: { type: "string", enum: ["hit", "miss"] },
        warnings: { type: "array", items: { type: "string" } }
      }
    }
  }
} as const;

function keyMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function buildApp(config: AppConfig, service: ScrapeService): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 16 * 1024,
    requestIdHeader: "x-request-id"
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: config.REQUESTS_PER_MINUTE,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "LinkedIn Profile API",
        version: "1.0.0",
        description: "Extracts structured fields from a LinkedIn profile visible to the configured session."
      },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: "x-api-key" }
        }
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (error.validation) {
      return reply.code(400).send({
        error: { code: "invalid_request", message: error.message, requestId: request.id }
      });
    }
    if (statusCode === 429) {
      return reply.code(429).send({
        error: { code: "rate_limit_exceeded", message: "Too many requests; retry later.", requestId: request.id }
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(statusCode).send({
      error: { code: "internal_error", message: "Unexpected server error.", requestId: request.id }
    });
  });

  app.get("/health", {
    schema: {
      tags: ["system"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            linkedInSessionConfigured: { type: "boolean" }
          }
        }
      }
    }
  }, async () => ({ status: "ok", linkedInSessionConfigured: config.hasLinkedInSession }));

  app.post<{ Body: { url: string; refresh?: boolean } }>("/v1/profiles", {
    preHandler: async (request, reply) => {
      if (config.apiKeys.length === 0) return;
      const header = request.headers["x-api-key"];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!provided || !config.apiKeys.some((expected) => keyMatches(provided, expected))) {
        return reply.code(401).send({
          error: { code: "unauthorized", message: "A valid x-api-key header is required.", requestId: request.id }
        });
      }
    },
    schema: {
      tags: ["profiles"],
      summary: "Extract a LinkedIn profile",
      security: [{ apiKey: [] }],
      body: profileRequestSchema,
      response: {
        200: profileResponseSchema,
        400: errorSchema,
        401: errorSchema,
        404: errorSchema,
        429: errorSchema,
        500: errorSchema,
        502: errorSchema,
        503: errorSchema,
        504: errorSchema
      }
    }
  }, async (request, reply) => {
    const startedAt = performance.now();
    try {
      const normalized = normalizeLinkedInProfileUrl(request.body.url);
      const { result, cache } = await service.get(
        normalized.url,
        normalized.publicIdentifier,
        request.body.refresh ?? false
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
        return reply.code(400).send({
          error: { code: "invalid_profile_url", message: error.message, requestId: request.id }
        });
      }
      if (error instanceof ScrapeError) {
        request.log.warn({ code: error.code }, "Profile extraction failed");
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message, requestId: request.id }
        });
      }
      request.log.error({ err: error }, "Unexpected profile extraction error");
      return reply.code(500).send({
        error: { code: "internal_error", message: "Unexpected server error.", requestId: request.id }
      });
    }
  });

  return app;
}
