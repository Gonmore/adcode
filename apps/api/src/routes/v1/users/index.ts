import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function usersRoutes(app: FastifyInstance) {
  app.get("/memberships", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { tenantId, role } = (req.query || {}) as any;
    if (!tenantId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "tenantId requerido" });
    if (!canManageTenant(req.authUser, tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const data = await prisma.membership.findMany({
      where: { tenantId, ...(role ? { role } : {}) },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true, isActive: true, createdAt: true, passwordHash: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: data.map((m) => ({ ...m, user: m.user ? { id: m.user.id, email: m.user.email, name: m.user.name, avatarUrl: m.user.avatarUrl, isActive: m.user.isActive, createdAt: m.user.createdAt, hasPassword: Boolean(m.user.passwordHash) } : null })) };
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
    if (!canManageTenant(req.authUser, d.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const user = await prisma.user.upsert({
      where: { email: d.email.toLowerCase() },
      update: { name: d.name || undefined },
      create: { email: d.email.toLowerCase(), name: d.name || d.email.split("@")[0], isActive: true },
    });
    const existing = await prisma.membership.findFirst({ where: { userId: user.id, tenantId: d.tenantId, role: d.role as any } });
    const membership = existing
      ? await prisma.membership.update({ where: { id: existing.id }, data: { complexIds: d.complexIds, clientTier: d.clientTier as any } })
      : await prisma.membership.create({ data: { userId: user.id, tenantId: d.tenantId, role: d.role as any, complexIds: d.complexIds, clientTier: d.clientTier as any } });
    return reply.code(existing ? 200 : 201).send({ data: { ...membership, user: { id: user.id, email: user.email, name: user.name, hasPassword: Boolean(user.passwordHash) } } });
  });

  app.patch("/memberships/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({
      role: z.enum(["TENANT_ADMIN", "COMPLEX_ADMIN", "SELLER", "CLIENT"]).optional(),
      complexIds: z.array(z.string()).optional(),
      clientTier: z.enum(["NORMAL", "HABITUAL", "PREFERENCIAL"]).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.membership.findUnique({ where: { id }, include: { user: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Membresía no encontrada" });
    if (!canManageTenant(req.authUser, existing.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const updated = await prisma.membership.update({ where: { id }, data: body.data as any, include: { user: { select: { id: true, email: true, name: true, passwordHash: true } } } });
    return { data: { ...updated, user: updated.user ? { id: updated.user.id, email: updated.user.email, name: updated.user.name, hasPassword: Boolean(updated.user.passwordHash) } : null } };
  });

  app.delete("/memberships/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.membership.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Membresía no encontrada" });
    if (!canManageTenant(req.authUser, existing.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    await prisma.membership.delete({ where: { id } });
    return reply.code(204).send();
  });
}
