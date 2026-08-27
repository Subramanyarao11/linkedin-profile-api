import type { FastifyError, FastifyInstance } from "fastify";

export function apiError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(apiError("invalid_request", error.message, request.id));
    }

    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(apiError("rate_limit_exceeded", "Too many requests; retry later.", request.id));
    }

    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error }, "Unhandled request error");
    return reply
      .code(statusCode)
      .send(apiError("internal_error", "Unexpected server error.", request.id));
  });
}
