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
    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.maintenance.create({ data: { complexId: body.data.complexId, scenarioId: body.data.scenarioId || null, type: body.data.type as any, startAt, endAt, dayOfWeek: body.data.dayOfWeek ?? null, reason: body.data.reason || null, cost: cost as any } });
      if (body.data.registerExpense && cost != null && cost > 0) {
        await tx.financialTransaction.create({ data: { complexId: body.data.complexId, scenarioId: body.data.scenarioId || null, type: "EXPENSE", source: "MAINTENANCE", amount: cost as any, occurredAt: startAt, refType: "MAINTENANCE", refId: m.id, note: body.data.reason || "Mantenimiento" } });
      }
      // Programar notificaciones de aviso para mantenimientos recurrentes
      const recurring = body.data.type !== "ONE_TIME";
      if (recurring) {
        // Calcular fecha del siguiente mantenimiento segun periodicidad
        const next = new Date(startAt);
        if (body.data.type === "WEEKLY") next.setDate(next.getDate() + 7);
        else if (body.data.type === "MONTHLY") next.setMonth(next.getMonth() + 1);
        else if (body.data.type === "QUARTERLY") next.setMonth(next.getMonth() + 3);
        else if (body.data.type === "SEMIANNUAL") next.setMonth(next.getMonth() + 6);
        else if (body.data.type === "ANNUAL") next.setFullYear(next.getFullYear() + 1);
        // Dias de aviso segun periodicidad
        let noticeDays: number[] = [];
        if (body.data.type === "WEEKLY" || body.data.type === "MONTHLY") noticeDays = [2];
        else if (body.data.type === "QUARTERLY" || body.data.type === "SEMIANNUAL") noticeDays = [14, 7];
        else if (body.data.type === "ANNUAL") noticeDays = [30, 7];
        const staff = await tx.membership.findMany({ where: { tenantId: cx.tenantId, role: { in: ["TENANT_ADMIN", "COMPLEX_ADMIN", "SELLER"] as any } } });
        const userIds = Array.from(new Set(staff.map((m:any) => m.userId)));
        for (const days of noticeDays) {
          const scheduled = new Date(next.getTime() - days * 24 * 60 * 60 * 1000);
          if (scheduled > new Date()) {
            for (const uid of userIds) {
              await tx.notification.create({ data: { userId: uid, complexId: body.data.complexId, type: "MAINTENANCE_REMINDER", title: "Mantenimiento próximo", body: `El mantenimiento "${body.data.reason || "programado"}" se realizó el ${startAt.toLocaleDateString()} con costo ${cost != null ? cost : "-"}. El siguiente mantenimiento está programado para el ${next.toLocaleDateString()}.`, scheduledAt: scheduled, data: { maintenanceId: m.id, previousCost: cost, nextDate: next.toISOString(), type: body.data.type } as any } });
            }
          }
        }
      }
      return m;
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