import type { FastifyInstance } from "fastify";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "adcode-api",
      version: process.env.APP_VERSION || "dev",
      ts: new Date().toISOString(),
    };
  });
}
