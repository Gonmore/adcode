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

  app.get("/details", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const q = z.object({ complexId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Parámetros inválidos" });
    try {
      const whereTx: any = {};
      if (q.data.complexId) whereTx.complexId = q.data.complexId;
      if (!isPlatformAdmin(req.authUser)) {
        const tenantIds = Array.from(new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId)));
        whereTx.complex = { tenantId: { in: tenantIds } };
      }
      if (q.data.from || q.data.to) whereTx.occurredAt = { ...(q.data.from ? { gte: new Date(q.data.from) } : {}), ...(q.data.to ? { lte: new Date(q.data.to) } : {}) };

      const txs = await prisma.financialTransaction.findMany({ where: whereTx, orderBy: { occurredAt: "desc" }, take: q.data.limit });
      const resIds = txs.filter(t => String(t.source) === "RESERVATION" && t.refId).map(t => t.refId!).filter(Boolean);
      const orderIds = txs.filter(t => String(t.source) === "SALE" && t.refId).map(t => t.refId!).filter(Boolean);
      const [reservations, orders] = await Promise.all([
        resIds.length ? prisma.reservation.findMany({ where: { id: { in: Array.from(new Set(resIds)) } }, include: { scenario: { select: { name: true } }, membership: { include: { user: { select: { name: true, email: true } } } } } }) : Promise.resolve([]),
        orderIds.length ? prisma.order.findMany({ where: { id: { in: Array.from(new Set(orderIds)) } }, include: { lines: { include: { product: { select: { name: true } }, presentation: { select: { name: true } } } } } }) : Promise.resolve([]),
      ]);
      const resById = new Map(reservations.map((r:any) => [r.id, r]));
      const orderById = new Map(orders.map((o:any) => [o.id, o]));

      const incomes: any[] = [];
      const expenses: any[] = [];
      for (const t of txs) {
        const base = { id: t.id, date: t.occurredAt, amount: Number(t.amount || 0), source: String(t.source), type: String(t.type), method: t.method ? String(t.method) : null, note: t.note || null, refType: t.refType || null, refId: t.refId || null };
        if (String(t.type) === "INCOME") {
          if (String(t.source) === "RESERVATION") {
            const r: any = t.refId ? resById.get(t.refId) : null;
            incomes.push({ ...base, client: r?.clientName || r?.membership?.user?.name || r?.membership?.user?.email || null, detail: r ? `Reserva ${r.code || ""} · ${r.scenario?.name || "Escenario"}`.trim() : (t.note || "Reserva"), reservationDate: r?.startAt || null, reservationEnd: r?.endAt || null });
          } else if (String(t.source) === "SALE") {
            const o: any = t.refId ? orderById.get(t.refId) : null;
            const items = (o?.lines || []).map((l: any) => `${l.product?.name || "Producto"}${l.presentation?.name ? ` (${l.presentation.name})` : ""} x${l.qty}`).slice(0, 6).join(", ");
            incomes.push({ ...base, client: o?.clientName || null, detail: items ? `Venta: ${items}` : (t.note || "Venta") });
          } else {
            incomes.push({ ...base, client: null, detail: t.note || String(t.source) });
          }
        } else {
          expenses.push({ ...base, supplier: null, detail: t.note || String(t.source) });
        }
      }

      const whereEntry: any = {};
      if (q.data.complexId) whereEntry.complexId = q.data.complexId;
      if (!isPlatformAdmin(req.authUser)) { const tenantIds = Array.from(new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId))); whereEntry.complex = { tenantId: { in: tenantIds } }; }
      if (q.data.from || q.data.to) whereEntry.createdAt = { ...(q.data.from ? { gte: new Date(q.data.from) } : {}), ...(q.data.to ? { lte: new Date(q.data.to) } : {}) };
      const entries = await prisma.stockEntry.findMany({ where: whereEntry, include: { supplier: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
      const supMap = new Map<string, any>();
      for (const e of entries as any[]) {
        const name = e.supplier?.name || "Sin proveedor";
        const cur = supMap.get(name) || { name, count: 0, amount: 0, detailParts: [] as string[] };
        cur.count += 1;
        cur.amount += Number(e.total || 0);
        const d = e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "";
        if (cur.detailParts.length < 4) cur.detailParts.push(`${d}${e.notes ? `: ${e.notes}` : ""}`.trim());
        supMap.set(name, cur);
        if (Number(e.total || 0) > 0) {
          expenses.unshift({ id: `entry-${e.id}`, date: e.createdAt, amount: Number(e.total || 0), source: "SUPPLIER_PAYMENT", type: "EXPENSE", method: e.paymentMethod ? String(e.paymentMethod) : null, note: e.notes || null, supplier: e.supplier?.name || null, detail: e.notes ? `Compra inventario: ${e.notes}` : "Compra/ingreso de inventario" });
        }
      }
      const suppliers = Array.from(supMap.values()).map(s => ({ name: s.name, count: s.count, amount: s.amount, detail: s.detailParts.filter(Boolean).join(" · ") })).sort((a,b)=>b.amount-a.amount);
      const seenExp = new Set<string>();
      const dedupExp = expenses.filter(e => { const k = String(e.id||`${e.date}-${e.amount}-${e.note}`); if (seenExp.has(k)) return false; seenExp.add(k); return true; });
      return { data: { incomes, expenses: dedupExp, suppliers } };
    } catch (err) {
      app.log.warn({ err }, "Failed reports details");
      return reply.code(503).send({ error: "DB_NOT_READY", message: "Base de datos no disponible/migrada" });
    }
  });

}