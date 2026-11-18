import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, isPlatformAdmin, assertTenantActive } from "../../../lib/auth.js";

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

export default async function maintenancesRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const cx = await prisma.complex.findUnique({ where: { id: complexId }, select: { tenantId: true } });
    if (!cx) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!canAccessComplex(req.authUser, cx.tenantId, complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const data = await prisma.maintenance.findMany({ where: { complexId }, include: { scenario: { select: { id: true, name: true } } }, orderBy: { startAt: "desc" }, take: 200 });
    return { data: data.map(m => ({ ...m, cost: m.cost != null ? Number(m.cost) : null })) };
  });

  app.post("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      complexId: z.string(), scenarioId: z.string().nullable().optional(),
      type: z.enum(["ONE_TIME", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]).default("ONE_TIME"),
      startAt: z.string().datetime(), endAt: z.string().datetime(),
      dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
      reason: z.string().nullable().optional(),
      cost: z.number().nonnegative().nullable().optional(),
      registerExpense: z.boolean().optional().default(true),
      repeatCount: z.number().int().min(1).max(60).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const cx = await prisma.complex.findUnique({ where: { id: body.data.complexId }, select: { tenantId: true } });
    if (!cx) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!canAccessComplex(req.authUser, cx.tenantId, body.data.complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    if (body.data.scenarioId) {
      const sc = await prisma.scenario.findFirst({ where: { id: body.data.scenarioId, complexId: body.data.complexId } });
      if (!sc) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Escenario inválido" });
    }
    const startAt = new Date(body.data.startAt), endAt = new Date(body.data.endAt);
    if (!(endAt > startAt)) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Rango inválido" });
    const cost = body.data.cost != null ? body.data.cost : null;
    const durationMs = endAt.getTime() - startAt.getTime();
    const repeatCount = body.data.repeatCount || (body.data.type === "ONE_TIME" ? 1 : body.data.type === "WEEKLY" ? 12 : body.data.type === "MONTHLY" ? 12 : body.data.type === "QUARTERLY" ? 4 : body.data.type === "SEMIANNUAL" ? 2 : 1);
    const advance = (d: Date, n: number) => {
      const nd = new Date(d);
      if (body.data.type === "WEEKLY") nd.setDate(nd.getDate() + 7 * n);
      else if (body.data.type === "MONTHLY") nd.setMonth(nd.getMonth() + n);
      else if (body.data.type === "QUARTERLY") nd.setMonth(nd.getMonth() + 3 * n);
      else if (body.data.type === "SEMIANNUAL") nd.setMonth(nd.getMonth() + 6 * n);
      else if (body.data.type === "ANNUAL") nd.setFullYear(nd.getFullYear() + n);
      return nd;
    };
    const created = await prisma.$transaction(async (tx) => {
      let first: any = null;
      for (let i = 0; i < repeatCount; i++) {
        const s = advance(startAt, i);
        const e = new Date(s.getTime() + durationMs);
        const m = await tx.maintenance.create({ data: { complexId: body.data.complexId, scenarioId: body.data.scenarioId || null, type: body.data.type as any, startAt: s, endAt: e, dayOfWeek: body.data.dayOfWeek ?? null, reason: body.data.reason || null, cost: cost as any } });
        if (i === 0) first = m;
        if (body.data.registerExpense && cost != null && cost > 0) {
          await tx.financialTransaction.create({ data: { complexId: body.data.complexId, scenarioId: body.data.scenarioId || null, type: "EXPENSE", source: "MAINTENANCE", amount: cost as any, occurredAt: s, refType: "MAINTENANCE", refId: m.id, note: body.data.reason || "Mantenimiento" } });
        }
      }
      return first;
    });
    return reply.code(201).send({ data: created });
  });

  app.delete("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const m = await prisma.maintenance.findUnique({ where: { id }, include: { complex: { select: { tenantId: true } } } });
    if (!m) return reply.code(404).send({ error: "NOT_FOUND", message: "Mantenimiento no encontrado" });
    if (!canAccessComplex(req.authUser, m.complex.tenantId, m.complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if (!(await assertTenantActive(m.complex.tenantId, reply))) return;
    await prisma.$transaction(async (tx) => {
      await tx.financialTransaction.deleteMany({ where: { refType: "MAINTENANCE", refId: id } });
      await tx.maintenance.delete({ where: { id } });
    });
    return reply.code(204).send();
  });
}