import type { FastifyInstance } from "fastify";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, isPlatformAdmin, assertTenantActive } from "../../../lib/auth.js";
import { uploadsEnabled, env } from "../../../lib/env.js";

function canAccessComplex(user: any, tenantId: string, complexId?: string) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return (user.memberships || []).some((m: any) => {
    if (m.tenantId !== tenantId) return false;
    if (m.role === "TENANT_ADMIN") return true;
    if (["COMPLEX_ADMIN", "SELLER"].includes(m.role)) return !complexId || !m.complexIds?.length || m.complexIds.includes(complexId);
    return false;
  });
}

function safeExt(name: string, mime: string) {
  const ext = path.extname(name || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (ext) return ext.slice(0, 10);
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "application/pdf") return ".pdf";
  return ".jpg";
}

export default async function uploadsRoutes(app: FastifyInstance) {
  app.get("/status", async () => ({ uploadsEnabled, mode: uploadsEnabled ? "s3" : "local" }));

  // Local multipart upload fallback (works without S3). Stores under /workspace/apps/api/uploads (mounted in dev).
  app.post("/file", async (req: any, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const parts = req.parts ? req.parts() : null;
    if (!parts) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "multipart/form-data requerido (@fastify/multipart)" });
    let file: any = null;
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === "file" && !file) file = part; else if (part.type === "field") fields[part.fieldname] = String(part.value ?? "");
    }
    if (!file) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Archivo requerido" });
    const mime = String(file.mimetype || "");
    const allowed = String(env.UPLOAD_ALLOWED_MIME || "").split(",").map(s => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(mime)) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Tipo de archivo no permitido" });

    const complexId = fields.complexId;
    if (complexId) {
      const cx = await prisma.complex.findUnique({ where: { id: complexId }, select: { tenantId: true } });
      if (!cx) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
      if (!canAccessComplex(req.authUser, cx.tenantId, complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
      if (!(await assertTenantActive(cx.tenantId, reply))) return;
    }

    const dir = path.resolve(process.cwd(), "uploads");
    fs.mkdirSync(dir, { recursive: true });
    const key = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt(file.filename, mime)}`;
    const dest = path.join(dir, key);
    await pipeline(file.file, fs.createWriteStream(dest));
    const url = `/api/v1/uploads/files/${encodeURIComponent(key)}`;
    return { data: { key, url, mime, name: file.filename || key } };
  });

  app.get("/files/:key", async (req: any, reply) => {
    const { key } = req.params as { key: string };
    const safe = path.basename(String(key || ""));
    const filePath = path.resolve(process.cwd(), "uploads", safe);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "NOT_FOUND", message: "Archivo no encontrado" });
    const ext = path.extname(safe).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".pdf" ? "application/pdf" : "image/jpeg";
    reply.type(type);
    return reply.send(fs.createReadStream(filePath));
  });

  app.post("/presign", async (_req, reply) => {
    if (!uploadsEnabled) return reply.code(503).send({ error: "UPLOADS_DISABLED", message: "S3/MinIO no configurado. Use /uploads/file." });
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Presigned uploads pendiente" });
  });
}