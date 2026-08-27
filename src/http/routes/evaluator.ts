import type { FastifyInstance } from "fastify";
import { profileUiHtml } from "../../ui.js";

export function registerEvaluatorRoute(app: FastifyInstance, apiKeyRequired: boolean): void {
  app.get(
    "/",
    {
      schema: {
        hide: true,
        response: { 200: { type: "string" } }
      }
    },
    async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(profileUiHtml(apiKeyRequired))
  );
}
