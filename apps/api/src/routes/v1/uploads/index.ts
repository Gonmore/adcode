import type { FastifyInstance } from "fastify";
import { uploadsEnabled } from "../../../lib/env.js";

export default async function uploadsRoutes(app: FastifyInstance) {
  app.get("/status", async () => ({ uploadsEnabled }));
  app.post("/presign", async (_req, reply) => {
    if (!uploadsEnabled) return reply.code(503).send({ error: "UPLOADS_DISABLED", message: "S3/MinIO no configurado" });
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Presigned uploads pendiente" });
  });
}
