import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

const complexSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  timezone: z.string().min(3).default("America/La_Paz"),
  currency: z.string().min(3).max(3).default("BOB"),
  nightStart: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  nightEnd: z.string().regex(/^\d{2}:\d{2}$/).default("06:00"),
});

export default async function complexesRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const { tenantId, slug } = (req.query || {}) as { tenantId?: string; slug?: string };
    const complexes = await prisma.complex.findMany({
      where: { ...(tenantId ? { tenantId } : {}), ...(slug ? { slug } : {}) },
      include: {
        tenant: { select: { id: true, name: true, slug: true, maxComplexes: true } },
        paymentSettings: { include: { qrs: true } },
        scenarioGroups: { include: { scenarios: { include: { pricingRules: true } } } },
        scenarios: { include: { pricingRules: true, group: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return { data: complexes };
  });

  app.get("/mine", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const user = req.authUser!;
    if (isPlatformAdmin(user)) {
      const complexes = await prisma.complex.findMany({ include: { tenant: { select: { id: true, name: true, slug: true, maxComplexes: true } }, scenarios: { select: { id: true } } }, orderBy: { createdAt: "desc" } });
      return { data: complexes };
    }
    const tenantIds = Array.from(new Set(user.memberships.map((m) => m.tenantId)));
    const complexes = await prisma.complex.findMany({
      where: { tenantId: { in: tenantIds } },
      include: { tenant: { select: { id: true, name: true, slug: true, maxComplexes: true } }, scenarios: { select: { id: true } }, paymentSettings: { include: { qrs: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: complexes };
  });

  app.get("/:idOrSlug", async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const complex = await prisma.complex.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        tenant: { select: { id: true, name: true, slug: true, maxComplexes: true } },
        paymentSettings: { include: { qrs: true } },
        scenarioGroups: { include: { scenarios: { include: { pricingRules: true } } } },
        scenarios: { include: { pricingRules: true, group: true }, orderBy: { name: "asc" } },
        kiosks: { include: { warehouse: true } },
      },
    });
    if (!complex) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    return { data: complex };
  });

  app.post("/", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const user = req.authUser!;
    const parsed = complexSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Datos inválidos" });
    const { tenantId, ...data } = parsed.data;
    if (!canManageTenant(user, tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos para crear complejos en este tenant" });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { complexes: true } });
    if (!tenant) return reply.code(404).send({ error: "NOT_FOUND", message: "Tenant no encontrado" });
    if (tenant.complexes.length >= tenant.maxComplexes) return reply.code(400).send({ error: "QUOTA_EXCEEDED", message: "Se alcanzó la cuota máxima de complejos del tenant" });
    const complex = await prisma.complex.create({
      data: { tenantId, ...data, paymentSettings: { create: { methods: ["CASH", "TRANSFER", "QR"] } } },
      include: { paymentSettings: { include: { qrs: true } }, tenant: { select: { id: true, name: true, slug: true, maxComplexes: true } }, scenarios: true },
    });
    await prisma.auditLog.create({ data: { tenantId, actorUserId: user.id, action: "COMPLEX_CREATED", entity: "Complex", entityId: complex.id, metadata: { slug: complex.slug } as any } }).catch(() => {});
    return reply.code(201).send({ data: complex });
  });

  app.patch("/:id", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(2).optional(),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
      timezone: z.string().min(3).optional(),
      currency: z.string().min(3).max(3).optional(),
      nightStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      nightEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.complex.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!canManageTenant(req.authUser, existing.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const updated = await prisma.complex.update({ where: { id }, data: body.data as any, include: { tenant: { select: { id: true, name: true, slug: true } }, scenarios: true } });
    return { data: updated };
  });

  app.delete("/:id", async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.complex.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!canManageTenant(req.authUser, existing.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    await prisma.complex.delete({ where: { id } });
    return reply.code(204).send();
  });
}
