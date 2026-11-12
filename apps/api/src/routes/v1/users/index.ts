import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth } from "../../../lib/auth.js";

function canManageTenant(req: any, tenantId: string) {
  const u = req.authUser;
  if (!u) return false;
  if (u.email?.toLowerCase() === process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase()) return true;
  return u.memberships?.some((m: any) => m.tenantId === tenantId && ["PLATFORM_ADMIN", "TENANT_ADMIN", "COMPLEX_ADMIN"].includes(m.role));
}

export default async function usersRoutes(app: FastifyInstance) {
  app.get("/memberships", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { tenantId, role } = (req.query || {}) as any;
    if (!tenantId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "tenantId requerido" });
    if (!canManageTenant(req, tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const data = await prisma.membership.findMany({ where: { tenantId, ...(role ? { role } : {}) }, include: { user: { select: { id: true, email: true, name: true, avatarUrl: true, isActive: true } } }, orderBy: { createdAt: "desc" } });
    return { data };
  });

  app.post("/memberships", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      tenantId: z.string().min(1),
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(["TENANT_ADMIN", "COMPLEX_ADMIN", "SELLER", "CLIENT"]),
      complexIds: z.array(z.string()).default([]),
      clientTier: z.enum(["NORMAL", "HABITUAL", "PREFERENCIAL"]).default("NORMAL"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const d = body.data;
    if (!canManageTenant(req, d.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const user = await prisma.user.upsert({ where: { email: d.email.toLowerCase() }, update: { name: d.name || undefined }, create: { email: d.email.toLowerCase(), name: d.name || d.email.split("@")[0], isActive: true } });
    const existing = await prisma.membership.findFirst({ where: { userId: user.id, tenantId: d.tenantId, role: d.role as any } });
    const membership = existing
      ? await prisma.membership.update({ where: { id: existing.id }, data: { complexIds: d.complexIds, clientTier: d.clientTier as any } })
      : await prisma.membership.create({ data: { userId: user.id, tenantId: d.tenantId, role: d.role as any, complexIds: d.complexIds, clientTier: d.clientTier as any } });
    return reply.code(201).send({ data: membership });
  });
}