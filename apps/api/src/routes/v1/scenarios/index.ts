import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function scenariosRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const { complexId, slug } = (req.query || {}) as { complexId?: string; slug?: string };
    let resolvedComplexId = complexId;
    if (!resolvedComplexId && slug) {
      const c = await prisma.complex.findFirst({ where: { slug } });
      resolvedComplexId = c?.id;
    }
    const scenarios = await prisma.scenario.findMany({
      where: resolvedComplexId ? { complexId: resolvedComplexId } : undefined,
      include: { pricingRules: true, group: true, complex: { select: { id: true, slug: true, name: true, timezone: true, currency: true, tenantId: true } } },
      orderBy: [{ complexId: "asc" }, { name: "asc" }],
    });
    return { data: scenarios };
  });

  app.get("/:id/availability", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(req.query || {});
    const now = new Date();
    const from = q.success && q.data.from ? new Date(q.data.from) : now;
    const to = q.success && q.data.to ? new Date(q.data.to) : new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const scenario = await prisma.scenario.findUnique({ where: { id }, include: { complex: true } });
    if (!scenario) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    const holds = await prisma.reservation.findMany({ where: { scenarioId: id, status: "PENDING_PAYMENT", holdExpiresAt: { lt: new Date() } }, select: { id: true } });
    if (holds.length) await prisma.reservation.updateMany({ where: { id: { in: holds.map(h => h.id) } }, data: { status: "EXPIRED" as any } }).catch(() => {});
    const activeReservations = await prisma.reservation.findMany({
      where: { scenarioId: id, startAt: { lt: to }, endAt: { gt: from }, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED"] as any }, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }, { status: { not: "PENDING_PAYMENT" as any } }] },
      select: { id: true, startAt: true, endAt: true, status: true }, orderBy: { startAt: "asc" },
    });
    const maintenances = await prisma.maintenance.findMany({ where: { complexId: scenario.complexId, startAt: { lt: to }, endAt: { gt: from }, OR: [{ scenarioId: id }, { scenarioId: null }] }, select: { id: true, startAt: true, endAt: true, reason: true }, orderBy: { startAt: "asc" } });
    return { data: { scenarioId: id, from: from.toISOString(), to: to.toISOString(), blocks: [...activeReservations.map((r) => ({ type: "RESERVATION", id: r.id, startAt: r.startAt, endAt: r.endAt, status: r.status })), ...maintenances.map((m) => ({ type: "MAINTENANCE", id: m.id, startAt: m.startAt, endAt: m.endAt, reason: m.reason }))] } };
  });

  app.post("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      complexId: z.string().min(1), groupId: z.string().optional().nullable(), name: z.string().min(2),
      rentalFormat: z.enum(["PER_HOUR", "PER_PERSON", "MIXED", "FLAT_BLOCK"]).default("PER_HOUR"),
      exclusive: z.boolean().default(true), capacity: z.number().int().positive().optional().nullable(),
      minDuration: z.number().int().positive().optional().nullable(), stepMinutes: z.number().int().positive().optional().nullable(),
      pricing: z.array(z.object({ period: z.enum(["DAY", "NIGHT"]), pricePerHour: z.number().optional(), pricePerPerson: z.number().optional(), basePrice: z.number().optional() })).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const { pricing, ...data } = body.data;
    const complex = await prisma.complex.findUnique({ where: { id: data.complexId } });
    if (!complex) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    const user = req.authUser!;
    if (!canManageTenant(user, complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos para crear escenarios" });
    const scenario = await prisma.scenario.create({
      data: { ...data, groupId: data.groupId || null, capacity: data.capacity ?? null, minDuration: data.minDuration ?? null, stepMinutes: data.stepMinutes ?? null, pricingRules: pricing?.length ? { create: pricing.map(p => ({ period: p.period, pricePerHour: p.pricePerHour as any, pricePerPerson: p.pricePerPerson as any, basePrice: p.basePrice as any })) } : undefined },
      include: { pricingRules: true, group: true, complex: { select: { id: true, name: true, tenantId: true } } },
    });
    return reply.code(201).send({ data: scenario });
  });

  app.patch("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(2).optional(), rentalFormat: z.enum(["PER_HOUR","PER_PERSON","MIXED","FLAT_BLOCK"]).optional(), exclusive: z.boolean().optional(), capacity: z.number().int().positive().nullable().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.scenario.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!canManageTenant(req.authUser, existing.complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const updated = await prisma.scenario.update({ where: { id }, data: body.data as any, include: { pricingRules: true } });
    return { data: updated };
  });

  app.delete("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.scenario.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!canManageTenant(req.authUser, existing.complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    await prisma.scenario.delete({ where: { id } });
    return reply.code(204).send();
  });
}
