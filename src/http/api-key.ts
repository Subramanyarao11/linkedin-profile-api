import { timingSafeEqual } from "node:crypto";
import type { preHandlerHookHandler } from "fastify";
import { apiError } from "./api-error.js";

function keyMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createApiKeyGuard(apiKeys: readonly string[]): preHandlerHookHandler {
  return async (request, reply) => {
    const header = request.headers["x-api-key"];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || !apiKeys.some((expected) => keyMatches(provided, expected))) {
      return reply
        .code(401)
        .send(apiError("unauthorized", "A valid x-api-key header is required.", request.id));
    }
  };
}
