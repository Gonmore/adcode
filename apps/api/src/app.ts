import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import healthRoutes from "./routes/health.js";
import v1Routes from "./routes/v1/index.js";
import { env } from "./lib/env.js";
import { attachAuthUser } from "./lib/auth.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL || "info",
    },
  });

  const origins = (env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: origins.length ? origins : true,
    credentials: true,
  });
  await app.register(cookie, { hook: "onRequest" });
  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

  app.addHook("onRequest", async (req) => {
    await attachAuthUser(req);
  });

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(v1Routes, { prefix: "/api/v1" });

  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error);
    const err = error as { statusCode?: number; code?: string; message?: string };
    const status = err.statusCode || 500;
    reply.status(status).send({
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal Server Error",
    });
  });

  return app;
}
