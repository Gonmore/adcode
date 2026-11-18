import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, isPlatformAdmin, isTenantAdmin, canManageComplex, assertTenantActive, managedComplexIds } from "../../../lib/auth.js";

export default async function usersRoutes(app: FastifyInstance) {
  app.get("/memberships", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { tenantId, role } = (req.query || {}) as any;
    if (!tenantId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "tenantId requerido" });
    const user = req.authUser!;
    const allowed = isPlatformAdmin(user) || user.memberships.some((m) => m.tenantId === tenantId && ["TENANT_ADMIN","COMPLEX_ADMIN","SELLER"].includes(m.role));
    if (!allowed) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    let complexFilter: any = {};
    const isTAdmin = isPlatformAdmin(user) || isTenantAdmin(user, tenantId);
    if (!isTAdmin) {
      const ids = managedComplexIds(user, tenantId);
      if (ids && ids.length) complexFilter = { OR: [{ complexIds: { hasSome: ids } }, { role: "CLIENT" }] }; // sellers/admins see clients too
      else if (ids && ids.length === 0) complexFilter = { id: "__none__" };
    }
    const data = await prisma.membership.findMany({
      where: { tenantId, ...(role ? { role } : {}), ...(isTAdmin ? {} : { OR: [{ role: "CLIENT" }, { complexIds: { hasSome: managedComplexIds(user, tenantId) || [] } }] }) },
      include: { user: { select: { id: true, email: true, name: true, phone: true, avatarUrl: true, isActive: true, createdAt: true, passwordHash: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: data.map((m) => ({ ...m, user: m.user ? { id: m.user.id, email: m.user.email, name: m.user.name, phone: m.user.phone, avatarUrl: m.user.avatarUrl, isActive: m.user.isActive, createdAt: m.user.createdAt, hasPassword: Boolean(m.user.passwordHash) } : null })) };
  });

  app.post("/memberships", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      tenantId: z.string().min(1),
      email: z.string().email(),
      name: z.string().optional(),
      phone: z.string().optional().nullable(),
      role: z.enum(["TENANT_ADMIN", "COMPLEX_ADMIN", "SELLER", "CLIENT"]),
      complexIds: z.array(z.string()).default([]),
      clientTier: z.enum(["NORMAL", "HABITUAL", "PREFERENCIAL"]).default("NORMAL"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const d = body.data;
    const actor = req.authUser!;
    if (!(await assertTenantActive(d.tenantId, reply))) return;

    const actorIsPlatform = isPlatformAdmin(actor);
    const actorIsTenantAdmin = actorIsPlatform || isTenantAdmin(actor, d.tenantId);
    const actorIsComplexAdmin = !actorIsTenantAdmin && actor.memberships.some((m) => m.tenantId === d.tenantId && m.role === "COMPLEX_ADMIN");
    const actorComplexIds = actor.memberships.filter((m) => m.tenantId === d.tenantId && m.role === "COMPLEX_ADMIN").flatMap((m) => m.complexIds || []);

    if (d.role === "TENANT_ADMIN") {
      if (!actorIsTenantAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede crear administradores de tenant" });
    } else if (d.role === "COMPLEX_ADMIN") {
      if (!actorIsTenantAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede crear administradores de complejo" });
    } else if (d.role === "SELLER") {
      if (!actorIsTenantAdmin && !actorIsComplexAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo admin de tenant o admin de complejo puede crear vendedores" });
      if (!actorIsTenantAdmin) {
        if (!d.complexIds?.length) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Selecciona al menos un complejo" });
        const bad = d.complexIds.some((id) => !actorComplexIds.includes(id));
        if (bad) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo puedes crear vendedores para tus complejos asignados" });
      }
    } else if (d.role === "CLIENT") {
      if (!actorIsTenantAdmin && !actorIsComplexAdmin && !actor.memberships.some((m)=>m.tenantId===d.tenantId && m.role==="SELLER")) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos para crear clientes" });
      }
    }

    const isStaffComplexRole = d.role === "COMPLEX_ADMIN" || d.role === "SELLER";
    if (isStaffComplexRole && (!d.complexIds || d.complexIds.length === 0)) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Selecciona al menos un complejo para este rol" });
    }
    const user = await prisma.user.upsert({
      where: { email: d.email.toLowerCase() },
      update: { name: d.name || undefined, phone: d.phone ?? undefined },
      create: { email: d.email.toLowerCase(), name: d.name || d.email.split("@")[0], phone: d.phone || null, isActive: true },
    });
    const existing = await prisma.membership.findFirst({ where: { userId: user.id, tenantId: d.tenantId, role: d.role as any } });
    const payload: any = {
      complexIds: (d.role === "TENANT_ADMIN" || d.role === "CLIENT") ? [] : (d.complexIds || []),
      clientTier: (d.role === "CLIENT" ? d.clientTier : "NORMAL") as any,
    };
    const membership = existing
      ? await prisma.membership.update({ where: { id: existing.id }, data: payload })
      : await prisma.membership.create({ data: { userId: user.id, tenantId: d.tenantId, role: d.role as any, ...payload } });
    return reply.code(existing ? 200 : 201).send({ data: { ...membership, user: { id: user.id, email: user.email, name: user.name, phone: user.phone, hasPassword: Boolean(user.passwordHash) } } });
  });

  app.patch("/memberships/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({
      role: z.enum(["TENANT_ADMIN", "COMPLEX_ADMIN", "SELLER", "CLIENT"]).optional(),
      complexIds: z.array(z.string()).optional(),
      clientTier: z.enum(["NORMAL", "HABITUAL", "PREFERENCIAL"]).optional(),
      phone: z.string().optional().nullable(),
      name: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.membership.findUnique({ where: { id }, include: { user: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Membresía no encontrada" });
    if (!(await assertTenantActive(existing.tenantId, reply))) return;
    const actor = req.authUser!;
    const actorIsPlatform = isPlatformAdmin(actor);
    const actorIsTenantAdmin = actorIsPlatform || isTenantAdmin(actor, existing.tenantId);
    const actorIsComplexAdmin = !actorIsTenantAdmin && actor.memberships.some((m) => m.tenantId === existing.tenantId && m.role === "COMPLEX_ADMIN");
    const actorComplexIds = actor.memberships.filter((m) => m.tenantId === existing.tenantId && m.role === "COMPLEX_ADMIN").flatMap((m) => m.complexIds || []);
    const targetRole = body.data.role || existing.role;

    if (targetRole === "TENANT_ADMIN" || targetRole === "COMPLEX_ADMIN" || existing.role === "TENANT_ADMIN" || existing.role === "COMPLEX_ADMIN") {
      if (!actorIsTenantAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede gestionar administradores" });
    } else if (existing.role === "SELLER" || targetRole === "SELLER") {
      if (!actorIsTenantAdmin && !actorIsComplexAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    }

    const nextRole = targetRole as any;
    const nextComplexIds = body.data.complexIds ?? existing.complexIds;
    if ((nextRole === "COMPLEX_ADMIN" || nextRole === "SELLER") && (!nextComplexIds || nextComplexIds.length === 0)) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Selecciona al menos un complejo para este rol" });
    }
    if (!actorIsTenantAdmin && nextRole === "SELLER") {
      const bad = (nextComplexIds||[]).some((cid) => !actorComplexIds.includes(cid));
      if (bad) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo puedes asignar tus complejos" });
    }
    if (body.data.phone !== undefined || body.data.name !== undefined) {
      await prisma.user.update({ where: { id: existing.userId }, data: { ...(body.data.phone !== undefined ? { phone: body.data.phone } : {}), ...(body.data.name !== undefined ? { name: body.data.name || null } : {}) } as any });
    }
    const updated = await prisma.membership.update({
      where: { id },
      data: {
        ...(body.data.role ? { role: body.data.role as any } : {}),
        complexIds: (nextRole === "TENANT_ADMIN" || nextRole === "CLIENT") ? [] : nextComplexIds,
        clientTier: (nextRole === "CLIENT" ? (body.data.clientTier || existing.clientTier) : "NORMAL") as any,
      },
      include: { user: { select: { id: true, email: true, name: true, phone: true, passwordHash: true } } },
    });
    return { data: { ...updated, user: updated.user ? { id: updated.user.id, email: updated.user.email, name: updated.user.name, phone: updated.user.phone, hasPassword: Boolean(updated.user.passwordHash) } : null } };
  });

  app.delete("/memberships/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.membership.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Membresía no encontrada" });
    if (!(await assertTenantActive(existing.tenantId, reply))) return;
    const actor = req.authUser!;
    const actorIsTenantAdmin = isPlatformAdmin(actor) || isTenantAdmin(actor, existing.tenantId);
    if (existing.role === "TENANT_ADMIN" || existing.role === "COMPLEX_ADMIN") {
      if (!actorIsTenantAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede eliminar administradores" });
    } else if (existing.role === "SELLER") {
      const actorIsComplexAdmin = !actorIsTenantAdmin && actor.memberships.some((m)=>m.tenantId===existing.tenantId && m.role==="COMPLEX_ADMIN");
      if (!actorIsTenantAdmin && !actorIsComplexAdmin) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    } else {
      // client: staff allowed
      if (!actorIsTenantAdmin && !canManageComplex(actor, existing.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    }
    await prisma.membership.delete({ where: { id } });
    return reply.code(204).send();
  });
}
