import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function reportsRoutes(app: FastifyInstance) {
  app.get("/summary", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    try {
      const user = req.authUser!;
      let whereTx: any = complexId ? { complexId } : undefined;
      let whereRes: any = complexId ? { complexId } : undefined;
      if (!isPlatformAdmin(user)) {
        const tenantIds = Array.from(new Set(user.memberships.map((m) => m.tenantId)));
        const scope = { complex: { tenantId: { in: tenantIds } } };
        whereTx = complexId ? { complexId } : scope;
        whereRes = complexId ? { complexId } : { complex: { tenantId: { in: tenantIds } } };
      }
      const [tenants, complexes, reservations, transactions, incomeAgg, expenseAgg] = await Promise.all([
        isPlatformAdmin(user) ? prisma.tenant.count() : prisma.tenant.count({ where: { id: { in: Array.from(new Set(user.memberships.map(m=>m.tenantId))) } } }),
        prisma.complex.count({ where: isPlatformAdmin(user) ? (complexId ? { id: complexId } : {}) : { tenantId: { in: Array.from(new Set(user.memberships.map(m=>m.tenantId))) }, ...(complexId?{id:complexId}:{}) } }),
        prisma.reservation.count({ where: whereRes || {} }),
        prisma.financialTransaction.count({ where: whereTx || {} }),
        prisma.financialTransaction.aggregate({ where: { ...(whereTx || {}), type: "INCOME" as any }, _sum: { amount: true } }),
        prisma.financialTransaction.aggregate({ where: { ...(whereTx || {}), type: "EXPENSE" as any }, _sum: { amount: true } }),
      ]);
      const income = Number(incomeAgg._sum.amount || 0);
      const expense = Number(expenseAgg._sum.amount || 0);
      return { data: { tenants, complexes, reservations, transactions, income, expense, net: income - expense } };
    } catch (err) {
      app.log.warn({ err }, "Failed to compute report summary");
      return { data: null, warning: "Database not ready or not migrated" };
    }
  });

  app.get("/income-vs-expense", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const q = z.object({ complexId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), groupBy: z.enum(["day", "week", "month", "year"]).default("day") }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Parámetros inválidos" });
    const { complexId, from, to, groupBy } = q.data;
    try {
      const where: any = {};
      if (complexId) where.complexId = complexId;
      if (!isPlatformAdmin(req.authUser)) {
        const tenantIds = Array.from(new Set((req.authUser?.memberships||[]).map((m) => m.tenantId)));
        where.complex = { tenantId: { in: tenantIds } };
      }
      if (from || to) where.occurredAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
      const rows = await prisma.financialTransaction.findMany({ where, orderBy: { occurredAt: "asc" } });
      const buckets = new Map<string, { period: string; income: number; expense: number }>();
      for (const r of rows) {
        const d = new Date(r.occurredAt);
        let key = d.toISOString().slice(0, 10);
        if (groupBy === "month") key = d.toISOString().slice(0, 7);
        if (groupBy === "year") key = d.toISOString().slice(0, 4);
        if (groupBy === "week") { const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day); const ys = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1)); const weekNo = Math.ceil((((dt.getTime() - ys.getTime()) / 86400000) + 1) / 7); key = `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`; }
        const b = buckets.get(key) || { period: key, income: 0, expense: 0 }; const amount = Number(r.amount); if (r.type === "INCOME") b.income += amount; else b.expense += amount; buckets.set(key, b);
      }
      const data = Array.from(buckets.values()).map((b) => ({ ...b, net: b.income - b.expense }));
      const totals = data.reduce((acc, r) => ({ income: acc.income + r.income, expense: acc.expense + r.expense }), { income: 0, expense: 0 });
      return { data, totals: { ...totals, net: totals.income - totals.expense }, groupBy };
    } catch (err) {
      app.log.warn({ err }, "Failed income-vs-expense report");
      return reply.code(503).send({ error: "DB_NOT_READY", message: "Base de datos no disponible/migrada" });
    }
  });

  app.get("/by-source", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const q = z.object({ complexId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Parámetros inválidos" });
    try {
      const where: any = {};
      if (q.data.complexId) where.complexId = q.data.complexId;
      if (!isPlatformAdmin(req.authUser)) {
        const tenantIds = Array.from(new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId)));
        where.complex = { tenantId: { in: tenantIds } };
      }
      if (q.data.from || q.data.to) where.occurredAt = { ...(q.data.from ? { gte: new Date(q.data.from) } : {}), ...(q.data.to ? { lte: new Date(q.data.to) } : {}) };
      const rows = await prisma.financialTransaction.findMany({ where });
      const map = new Map<string, { source: string; type: string; amount: number }>();
      for (const r of rows) {
        const k = r.source + ':' + r.type;
        const b = map.get(k) || { source: String(r.source), type: String(r.type), amount: 0 };
        b.amount += Number(r.amount || 0); map.set(k, b);
      }
      return { data: Array.from(map.values()).sort((a,b)=>b.amount-a.amount) };
    } catch (err) {
      app.log.warn({ err }, "Failed by-source report");
      return reply.code(503).send({ error: "DB_NOT_READY", message: "Base de datos no disponible/migrada" });
    }
  });

}