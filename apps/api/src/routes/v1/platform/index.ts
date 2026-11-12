import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../lib/env.js";
import { requireAuth, isPlatformAdmin } from "../../../lib/auth.js";

const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional().nullable(),
  maxComplexes: z.number().int().positive().default(1),
});

function ensurePlatformAdmin(req: any, reply: any) {
  if (!isPlatformAdmin(req.authUser)) {
    reply.code(403).send({ error: "FORBIDDEN", message: "Solo platform admin" });
    return false;
  }
  return true;
}

export default async function platformRoutes(app: FastifyInstance) {
  app.get("/tenants", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!ensurePlatformAdmin(req, reply)) return;
    const tenants = await prisma.tenant.findMany({
      include: { complexes: true, subscriptions: true, memberships: { include: { user: { select: { id: true, email: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: tenants };
  });

  // tenant admin / staff: list tenants they belong to
  app.get("/my-tenants", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const user = req.authUser!;
    if (isPlatformAdmin(user)) {
      const tenants = await prisma.tenant.findMany({ include: { complexes: true, subscriptions: true, memberships: { include: { user: { select: { id: true, email: true, name: true } } } } }, orderBy: { createdAt: "desc" } });
      return { data: tenants };
    }
    const tenantIds = Array.from(new Set(user.memberships.map((m) => m.tenantId)));
    if (!tenantIds.length) return { data: [] };
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      include: { complexes: { include: { scenarios: { include: { pricingRules: true } } } }, subscriptions: true, memberships: { include: { user: { select: { id: true, email: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: tenants };
  });

  app.post("/tenants", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!ensurePlatformAdmin(req, reply)) return;
    const parsed = tenantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Datos inválidos" });
    const data = parsed.data;

    const tenant = await prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        contactName: data.contactName,
        contactEmail: data.contactEmail.toLowerCase(),
        contactPhone: data.contactPhone || null,
        maxComplexes: data.maxComplexes,
      },
      include: { complexes: true, subscriptions: true },
    });

    for (const t of [
      { name: "Normal", type: "NORMAL" as const, allowVipBooking: false },
      { name: "Habitual", type: "HABITUAL" as const, allowVipBooking: true },
      { name: "Preferencial", type: "PREFERENCIAL" as const, allowVipBooking: true },
    ]) {
      await prisma.clientTier.upsert({
        where: { tenantId_type: { tenantId: tenant.id, type: t.type } },
        update: { name: t.name, allowVipBooking: t.allowVipBooking },
        create: { tenantId: tenant.id, name: t.name, type: t.type, allowVipBooking: t.allowVipBooking },
      });
    }

    const contactUser = await prisma.user.upsert({
      where: { email: data.contactEmail.toLowerCase() },
      update: { name: data.contactName },
      create: { email: data.contactEmail.toLowerCase(), name: data.contactName, isActive: true },
    });
    const existingMembership = await prisma.membership.findFirst({ where: { userId: contactUser.id, tenantId: tenant.id, role: "TENANT_ADMIN" } });
    if (!existingMembership) {
      await prisma.membership.create({ data: { userId: contactUser.id, tenantId: tenant.id, role: "TENANT_ADMIN", clientTier: "NORMAL" } });
    }

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, actorUserId: req.authUser?.id, action: "TENANT_CREATED", entity: "Tenant", entityId: tenant.id, metadata: { slug: tenant.slug } as any },
    }).catch(() => {});

    return reply.code(201).send({ data: tenant });
  });

  app.get("/tenants/:id", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const { id } = req.params as { id: string };
    const user = req.authUser!;
    if (!isPlatformAdmin(user) && !user.memberships.some((m) => m.tenantId === id)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { complexes: { include: { scenarios: { include: { pricingRules: true } } } }, subscriptions: true, memberships: { include: { user: { select: { id: true, email: true, name: true } } } } },
    });
    if (!tenant) return reply.code(404).send({ error: "NOT_FOUND", message: "Tenant no encontrado" });
    return { data: tenant };
  });

  app.post("/tenants/:id/subscriptions", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!ensurePlatformAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = z.object({
      module: z.enum(["USERS", "SCENARIOS", "SALES", "INVENTORY"]),
      complexId: z.string().optional().nullable(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    if (body.data.module === "INVENTORY") {
      const sales = await prisma.moduleSubscription.findFirst({ where: { tenantId: id, module: "SALES", endsAt: { gte: new Date(body.data.startsAt) } } });
      if (!sales) return reply.code(400).send({ error: "DEPENDENCY_ERROR", message: "INVENTORY requiere módulo SALES activo" });
    }
    const sub = await prisma.moduleSubscription.create({
      data: {
        tenantId: id,
        module: body.data.module as any,
        complexId: body.data.complexId || null,
        startsAt: new Date(body.data.startsAt),
        endsAt: new Date(body.data.endsAt),
      },
    });
    await prisma.auditLog.create({ data: { tenantId: id, actorUserId: req.authUser?.id, action: "MODULE_SUBSCRIPTION_CREATED", entity: "ModuleSubscription", entityId: sub.id, metadata: body.data as any } }).catch(() => {});
    return reply.code(201).send({ data: sub });
  });
}