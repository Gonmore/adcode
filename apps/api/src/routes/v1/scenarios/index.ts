import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, isPlatformAdmin, isTenantAdmin, assertTenantActive } from "../../../lib/auth.js";

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
      where: { scenarioId: id, startAt: { lt: to }, endAt: { gt: from }, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "SCHEDULED"] as any }, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }, { status: { not: "PENDING_PAYMENT" as any } }] },
      select: { id: true, startAt: true, endAt: true, status: true, clientName: true, people: true, note: true, membershipId: true, reservationSeriesId: true, seriesPaidAt: true, membership: { select: { user: { select: { id: true, name: true, phone: true, email: true } } } } }, orderBy: { startAt: "asc" },
    });
    const maintenances = await prisma.maintenance.findMany({ where: { complexId: scenario.complexId, startAt: { lt: to }, endAt: { gt: from }, OR: [{ scenarioId: id }, { scenarioId: null }] }, select: { id: true, startAt: true, endAt: true, reason: true }, orderBy: { startAt: "asc" } });
    const weeklySchedule = (scenario.complex as any).weeklySchedule || null;
    const schedule = {
      complexOpenTime: (scenario.complex as any).openTime || "08:00",
      complexCloseTime: (scenario.complex as any).closeTime || "22:00",
      complexWeekendOpenTime: (scenario.complex as any).weekendOpenTime || null,
      complexWeekendCloseTime: (scenario.complex as any).weekendCloseTime || null,
      weeklySchedule,
      openTime: (scenario as any).openTime || null,
      closeTime: (scenario as any).closeTime || null,
      availableDays: Array.isArray((scenario as any).availableDays) ? (scenario as any).availableDays : [0,1,2,3,4,5,6],
    };
    const closedBlocks: any[] = [];
    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const daySchedule = (d: Date) => weeklySchedule ? (weeklySchedule[String(d.getDay())] || null) : null;
    const openStr = (d: Date) => {
      if ((scenario as any).openTime) return (scenario as any).openTime;
      const ds = daySchedule(d);
      if (ds) { if (ds.closed) return null; return ds.open || schedule.complexOpenTime; }
      if (isWeekend(d) && schedule.complexWeekendOpenTime) return schedule.complexWeekendOpenTime;
      return schedule.complexOpenTime;
    };
    const closeStr = (d: Date) => {
      if ((scenario as any).closeTime) return (scenario as any).closeTime;
      const ds = daySchedule(d);
      if (ds) { if (ds.closed) return null; return ds.close || schedule.complexCloseTime; }
      if (isWeekend(d) && schedule.complexWeekendCloseTime) return schedule.complexWeekendCloseTime;
      return schedule.complexCloseTime;
    };
    const dayMs = 24*60*60*1000;
    let cur = new Date(from); cur.setHours(0,0,0,0);
    const endDay = new Date(to); endDay.setHours(0,0,0,0);
    for (let d = new Date(cur); d <= endDay; d = new Date(d.getTime() + dayMs)) {
      const dayStart = new Date(d); const dayEnd = new Date(d); dayEnd.setHours(23,59,59,999);
      if (!schedule.availableDays.includes(dayStart.getDay())) {
        const s = dayStart < from ? from : dayStart; const e = dayEnd > to ? to : dayEnd;
        if (s < e) closedBlocks.push({ type: "CLOSED", startAt: s.toISOString(), endAt: e.toISOString(), reason: "Día no disponible" });
        continue;
      }
      const os = openStr(d); const cs = closeStr(d);
      if (os === null || cs === null) {
        const s = dayStart < from ? from : dayStart; const e = dayEnd > to ? to : dayEnd;
        if (s < e) closedBlocks.push({ type: "CLOSED", startAt: s.toISOString(), endAt: e.toISOString(), reason: "Complejo cerrado este día" });
        continue;
      }
      const [oh,om] = os.split(":").map(Number); const [ch,cm] = cs.split(":").map(Number);
      const openAt = new Date(d); openAt.setHours(oh||0, om||0, 0, 0);
      const closeAt = new Date(d); closeAt.setHours(ch||22, cm||0, 0, 0);
      if (openAt > closeAt) continue;
      const beforeS = dayStart < from ? from : dayStart; const beforeE = openAt > to ? to : openAt;
      if (beforeS < beforeE) closedBlocks.push({ type: "CLOSED", startAt: beforeS.toISOString(), endAt: beforeE.toISOString(), reason: "Fuera de horario" });
      const afterS = closeAt < from ? from : closeAt; const afterE = dayEnd > to ? to : dayEnd;
      if (afterS < afterE) closedBlocks.push({ type: "CLOSED", startAt: afterS.toISOString(), endAt: afterE.toISOString(), reason: "Fuera de horario" });
    }
    return { data: { scenarioId: id, from: from.toISOString(), to: to.toISOString(), schedule, blocks: [...activeReservations.map((r) => ({ type: "RESERVATION", id: r.id, startAt: r.startAt, endAt: r.endAt, status: r.status, clientName: r.clientName, people: r.people, note: r.note, membershipId: r.membershipId, reservationSeriesId: r.reservationSeriesId, seriesPaidAt: r.seriesPaidAt, client: r.membership?.user || null })), ...maintenances.map((m) => ({ type: "MAINTENANCE", id: m.id, startAt: m.startAt, endAt: m.endAt, reason: m.reason })), ...closedBlocks] } };
  });

  app.post("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      complexId: z.string().min(1), groupId: z.string().optional().nullable(), name: z.string().min(2),
      rentalFormat: z.enum(["PER_HOUR", "PER_PERSON", "MIXED", "FLAT_BLOCK"]).default("PER_HOUR"),
      exclusive: z.boolean().default(true), capacity: z.number().int().positive().optional().nullable(),
      minDuration: z.number().int().positive().optional().nullable(), stepMinutes: z.number().int().positive().optional().nullable(),
      openTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      availableDays: z.array(z.number().int().min(0).max(6)).optional(),
      pricing: z.array(z.object({ period: z.enum(["DAY", "NIGHT"]), pricePerHour: z.number().optional(), pricePerPerson: z.number().optional(), childPrice: z.number().optional(), childAgeThreshold: z.number().int().min(1).max(18).optional(), basePrice: z.number().optional(), blockType: z.string().optional() })).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const { pricing, ...data } = body.data;
    const complex = await prisma.complex.findUnique({ where: { id: data.complexId } });
    if (!complex) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    const user = req.authUser!;
    if (!isPlatformAdmin(user) && !isTenantAdmin(user, complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede crear escenarios" });
    if (!(await assertTenantActive(complex.tenantId, reply))) return;
    const scenario = await prisma.scenario.create({
      data: { ...data, groupId: data.groupId || null, capacity: data.capacity ?? null, minDuration: data.minDuration ?? null, stepMinutes: data.stepMinutes ?? null, pricingRules: pricing?.length ? { create: pricing.map(p => ({ period: p.period, pricePerHour: p.pricePerHour as any, pricePerPerson: p.pricePerPerson as any, childPrice: p.childPrice as any, childAgeThreshold: p.childAgeThreshold as any, basePrice: p.basePrice as any, blockType: p.blockType || null })) } : undefined },
      include: { pricingRules: true, group: true, complex: { select: { id: true, name: true, tenantId: true } } },
    });
    return reply.code(201).send({ data: scenario });
  });

  app.patch("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(2).optional(), rentalFormat: z.enum(["PER_HOUR","PER_PERSON","MIXED","FLAT_BLOCK"]).optional(), exclusive: z.boolean().optional(), capacity: z.number().int().positive().nullable().optional(), openTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), closeTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), availableDays: z.array(z.number().int().min(0).max(6)).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.scenario.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!isPlatformAdmin(req.authUser) && !isTenantAdmin(req.authUser, existing.complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede editar escenarios" });
    if (!(await assertTenantActive(existing.complex.tenantId, reply))) return;
    const updated = await prisma.scenario.update({ where: { id }, data: body.data as any, include: { pricingRules: true } });
    return { data: updated };
  });

  app.delete("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.scenario.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!isPlatformAdmin(req.authUser) && !isTenantAdmin(req.authUser, existing.complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Solo el admin del tenant puede eliminar escenarios" });
    if (!(await assertTenantActive(existing.complex.tenantId, reply))) return;
    await prisma.scenario.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get("/search", async (req, reply) => {
    const q = z.object({
      department: z.string().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      type: z.string().optional(),
      complexSlug: z.string().optional(),
    }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Parámetros inválidos. Requiere date,start,end." });
    const { department, date, start, end, type, complexSlug } = q.data;
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(`${date}T${end}:00`);
    if (!(endAt > startAt)) return reply.code(400).send({ error: "INVALID_RANGE", message: "Rango horario inválido" });
    const weekday = startAt.getDay();

    function parseHM(v: string | null | undefined, fb: string){ const s=(v||fb||"00:00").slice(0,5); const m=/^(\d{1,2}):(\d{2})$/.exec(s); if(!m) return fb; return `${String(Math.min(23,Number(m[1]))).padStart(2,'0')}:${String(Math.min(59,Number(m[2]))).padStart(2,'0')}`; }
    function toMin(hm: string){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
    function inSchedule(complex: any, scenario: any){
      const days: number[] = Array.isArray(scenario.availableDays) && scenario.availableDays.length ? scenario.availableDays : [0,1,2,3,4,5,6];
      if (!days.includes(weekday)) return false;
      const open = parseHM(scenario.openTime || complex.openTime, "08:00");
      const close = parseHM(scenario.closeTime || complex.closeTime, "22:00");
      if (open >= close) return false;
      const sMin = startAt.getHours()*60 + startAt.getMinutes();
      const eMin = endAt.getHours()*60 + endAt.getMinutes();
      return sMin >= toMin(open) && eMin <= toMin(close);
    }
    function estimate(scenario: any){
      const dayRule = scenario.pricingRules?.find((r:any)=>r.period==='DAY');
      const nightRule = scenario.pricingRules?.find((r:any)=>r.period==='NIGHT') || dayRule;
      const complex = scenario.complex || {};
      const hour = (v:any)=> v!=null ? Number(v): 0;
      const fmt = scenario.rentalFormat;
      const hours = Math.max(0,(endAt.getTime()-startAt.getTime())/3600000);
      const midH = startAt.getHours() + startAt.getMinutes()/60 + hours/2;
      const ns = /^(\d{1,2}):(\d{2})$/.exec(complex.nightStart||'18:00'); const ne=/^(\d{1,2}):(\d{2})$/.exec(complex.nightEnd||'06:00');
      const nStart = ns?Number(ns[1])+Number(ns[2])/60:18; const nEnd = ne?Number(ne[1])+Number(ne[2])/60:6;
      const isNight = nStart===nEnd?false:(nStart<nEnd ? (midH>=nStart&&midH<nEnd) : (midH>=nStart||midH<nEnd));
      const rule = isNight ? nightRule : dayRule;
      let base = 0;
      if (fmt==='PER_HOUR' || fmt==='MIXED') base = hour(rule?.pricePerHour) * hours;
      if (fmt==='PER_PERSON') base = hour(rule?.pricePerPerson) * hours;
      if (fmt==='FLAT_BLOCK') base = hour(rule?.basePrice) * Math.max(1, Math.ceil(hours));
      base = Math.round(base*100)/100;
      const tiers = (complex.tenant?.clientTiers || []).map((t:any)=>{
        let disc = 0; if (t.discountPercent) disc += base * (Number(t.discountPercent)/100); if (t.discountAmount) disc += Number(t.discountAmount);
        disc = Math.min(base, Math.round(disc*100)/100);
        return { type: t.type, name: t.name, discountPercent: t.discountPercent?Number(t.discountPercent):0, discountAmount: t.discountAmount?Number(t.discountAmount):0, total: Math.round((base-disc)*100)/100, allowVipBooking: !!t.allowVipBooking };
      });
      return { base, currency: complex.currency||'BOB', tiers };
    }

    const scenarios = await prisma.scenario.findMany({
      where: {
        isActive: true,
        ...(complexSlug ? { complex: { slug: complexSlug } } : {}),
        ...(department ? { complex: { department } } : {}),
        ...(type ? { OR: [ { name: { contains: type, mode: 'insensitive' as any } }, { group: { name: { contains: type, mode: 'insensitive' as any } } } ] } : {}),
      },
      include: { pricingRules: true, group: true, complex: { include: { tenant: { select: { id: true, name: true, slug: true, clientTiers: true } } } } },
      orderBy: [{ complexId: 'asc' }, { name: 'asc' }],
      take: 200,
    });

    const results: any[] = [];
    for (const s of scenarios) {
      if (!inSchedule(s.complex, s)) continue;
      await prisma.reservation.updateMany({ where: { scenarioId: s.id, status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' as any } }).catch(()=>{});
      const blocking = await prisma.reservation.findMany({ where: { scenarioId: s.id, status: { in: ['PENDING_PAYMENT','PENDING_CONFIRMATION','CONFIRMED','SCHEDULED'] as any }, startAt: { lt: endAt }, endAt: { gt: startAt } }, select: { id:true, status:true, holdExpiresAt:true } });
      const now = new Date();
      const conflict = blocking.some(r => r.status !== 'PENDING_PAYMENT' || !r.holdExpiresAt || r.holdExpiresAt > now);
      if (s.exclusive && conflict) continue;
      results.push({
        scenarioId: s.id, scenarioName: s.name, rentalFormat: s.rentalFormat, openTime: s.openTime || s.complex.openTime, closeTime: s.closeTime || s.complex.closeTime, availableDays: s.availableDays,
        group: s.group ? { id: s.group.id, name: s.group.name } : null,
        complex: { id: s.complex.id, name: s.complex.name, slug: s.complex.slug, department: s.complex.department, currency: s.complex.currency, openTime: s.complex.openTime, closeTime: s.complex.closeTime, allowClientPayLater: s.complex.allowClientPayLater },
        priceEstimate: estimate(s),
      });
    }

    const byComplex: Record<string, any> = {};
    for (const r of results) {
      if (!byComplex[r.complex.id]) byComplex[r.complex.id] = { complex: r.complex, scenarios: [] };
      byComplex[r.complex.id].scenarios.push(r);
    }
    return { data: Object.values(byComplex), query: { department, date, start, end, type: type||null } };
  });
}
