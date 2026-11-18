import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../lib/env.js";
import { calculatePrice } from "@adcode/shared";
import { requireAuth, canManageComplex, isPlatformAdmin, attachAuthUser, assertTenantActive } from "../../../lib/auth.js";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "ADC-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function hourFromHHMM(v: string, fallback: number) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  if (!m) return fallback;
  return Number(m[1]) + Number(m[2]) / 60;
}
function parseHHMM(v: string | null | undefined, fallback: string) {
  const s = (v || fallback || "00:00").slice(0, 5);
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function timeToMinutes(hhmm: string) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }

function assertWithinSchedule(complex: any, scenario: any, startAt: Date, endAt: Date) {
  const open = parseHHMM(scenario?.openTime || complex?.openTime, "08:00");
  const close = parseHHMM(scenario?.closeTime || complex?.closeTime, "22:00");
  const availableDays: number[] = Array.isArray(scenario?.availableDays) && scenario.availableDays.length ? scenario.availableDays : [0, 1, 2, 3, 4, 5, 6];
  if (open >= close) return;
  if (startAt.toDateString() !== endAt.toDateString()) {
    const err: any = new Error("La reserva debe estar dentro del mismo día y horario de atención/disponibilidad.");
    err.code = "OUTSIDE_SCHEDULE"; throw err;
  }
  if (!availableDays.includes(startAt.getDay())) {
    const err: any = new Error("El escenario no está disponible ese día.");
    err.code = "OUTSIDE_SCHEDULE"; throw err;
  }
  const startMin = startAt.getHours() * 60 + startAt.getMinutes();
  const endMin = endAt.getHours() * 60 + endAt.getMinutes();
  const openMin = timeToMinutes(open); const closeMin = timeToMinutes(close);
  if (startMin < openMin || endMin > closeMin) {
    const err: any = new Error(`Horario fuera de atención/disponibilidad (${open}-${close}).`);
    err.code = "OUTSIDE_SCHEDULE"; throw err;
  }
}

async function canManageReservation(req: any, reservation: { complex?: { tenantId: string } | null; complexId?: string }) {
  if (!req.authUser) return false;
  if (isPlatformAdmin(req.authUser)) return true;
  let tenantId = reservation.complex?.tenantId;
  let complexId = (reservation as any).complexId;
  if (!tenantId && complexId) {
    const c = await prisma.complex.findUnique({ where: { id: complexId }, select: { tenantId: true } });
    tenantId = c?.tenantId;
  }
  if (!tenantId) return false;
  return canManageComplex(req.authUser, tenantId, complexId);
}
function isStaffForComplex(req: any, tenantId: string, complexId: string) {
  return !!(req.authUser && (isPlatformAdmin(req.authUser) || canManageComplex(req.authUser, tenantId, complexId)));
}

async function getStaffTargets(tx: any, tenantId: string, complexId: string) {
  const staff = await tx.membership.findMany({
    where: { tenantId, role: { in: ["COMPLEX_ADMIN", "SELLER", "TENANT_ADMIN"] as any } },
    include: { user: { select: { id: true, email: true, name: true, phone: true } } },
  });
  return staff.filter((m: any) => m.role === "TENANT_ADMIN" || (m.complexIds || []).length === 0 || (m.complexIds || []).includes(complexId));
}
async function createNotifications(tx: any, params: { userIds: string[]; complexId: string; type: string; title: string; body: string; data?: any }) {
  const uniq = Array.from(new Set((params.userIds || []).filter(Boolean)));
  if (!uniq.length) return;
  await tx.notification.createMany({ data: uniq.map((userId) => ({ userId, complexId: params.complexId, type: params.type, title: params.title, body: params.body, data: params.data || null })) });
}
async function getClientUserId(tx: any, membershipId?: string | null) {
  if (!membershipId) return null;
  const m = await tx.membership.findUnique({ where: { id: membershipId }, select: { userId: true } });
  return m?.userId || null;
}
async function resolveStaffClient(tx: any, tenantId: string, body: { membershipId?: string | null; client?: { email?: string; name?: string; phone?: string | null; clientTier?: "NORMAL"|"HABITUAL"|"PREFERENCIAL" } | null; clientName?: string | null }) {
  if (body.membershipId) {
    const m = await tx.membership.findFirst({ where: { id: body.membershipId, tenantId, role: "CLIENT" as any }, include: { user: { select: { id: true, email: true, name: true, phone: true } } } });
    if (!m) { const err: any = new Error("Cliente/membresía no encontrada en este tenant."); err.code = "CLIENT_NOT_FOUND"; throw err; }
    return { membershipId: m.id as string, membership: m, clientName: body.clientName || m.user?.name || m.user?.email || null };
  }
  const c = body.client;
  if (c?.email) {
    const email = c.email.toLowerCase().trim();
    const user = await tx.user.upsert({ where: { email }, update: { ...(c.name ? { name: c.name } : {}), ...(c.phone !== undefined ? { phone: c.phone || null } : {}) }, create: { email, name: c.name || email.split("@")[0], phone: c.phone || null, isActive: true } });
    let membership = await tx.membership.findFirst({ where: { userId: user.id, tenantId, role: "CLIENT" as any } });
    const tier = (c.clientTier || "NORMAL") as any;
    if (membership) membership = await tx.membership.update({ where: { id: membership.id }, data: { clientTier: tier } as any, include: { user: { select: { id: true, email: true, name: true, phone: true } } } });
    else membership = await tx.membership.create({ data: { userId: user.id, tenantId, role: "CLIENT" as any, clientTier: tier, complexIds: [] } as any, include: { user: { select: { id: true, email: true, name: true, phone: true } } } });
    return { membershipId: membership.id as string, membership, clientName: body.clientName || c.name || user.name || user.email || null };
  }
  return { membershipId: null, membership: null, clientName: body.clientName || null };
}

function pricingFor(scenario: any, startAt: Date, endAt: Date, people: number | undefined, tierDiscountPercent: number, tierDiscountAmount: number) {
  const dayRule = scenario.pricingRules.find((r: any) => r.period === "DAY");
  const nightRule = scenario.pricingRules.find((r: any) => r.period === "NIGHT") || dayRule;
  return calculatePrice({
    rentalFormat: scenario.rentalFormat as any, startAt, endAt, people,
    nightStartHour: hourFromHHMM(scenario.complex.nightStart || "18:00", 18), nightEndHour: hourFromHHMM(scenario.complex.nightEnd || "06:00", 6),
    pricePerHourDay: dayRule?.pricePerHour ? Number(dayRule.pricePerHour) : 0, pricePerHourNight: nightRule?.pricePerHour ? Number(nightRule.pricePerHour) : (dayRule?.pricePerHour ? Number(dayRule.pricePerHour) : 0),
    pricePerPersonDay: dayRule?.pricePerPerson ? Number(dayRule.pricePerPerson) : 0, pricePerPersonNight: nightRule?.pricePerPerson ? Number(nightRule.pricePerPerson) : (dayRule?.pricePerPerson ? Number(dayRule.pricePerPerson) : 0),
    basePriceDay: dayRule?.basePrice ? Number(dayRule.basePrice) : 0, basePriceNight: nightRule?.basePrice ? Number(nightRule.basePrice) : (dayRule?.basePrice ? Number(dayRule.basePrice) : 0),
    discountPercent: tierDiscountPercent || undefined, discountAmount: tierDiscountAmount || undefined,
  });
}

export default async function reservationsRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId, scenarioId, status } = (req.query || {}) as { complexId?: string; scenarioId?: string; status?: string };
    if (complexId) { try { await prisma.$transaction(async (tx) => { const { reconcileSeriesForComplex } = await import("../../../lib/series.js"); await reconcileSeriesForComplex(tx, complexId); }); } catch {} }
    const where: any = { ...(complexId ? { complexId } : {}), ...(scenarioId ? { scenarioId } : {}), ...(status ? { status: status as any } : {}) };
    if (!status) where.AND = [...(where.AND || []), { OR: [{ reservationSeriesId: null }, { isSeriesCurrent: true }, { status: { not: "SCHEDULED" as any } }] }];
    if (!isPlatformAdmin(req.authUser)) {
      const tenantIds = Array.from(new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId)));
      where.complex = { ...(where.complex || {}), tenantId: { in: tenantIds } };
    }
    const reservations = await prisma.reservation.findMany({
      where,
      include: { scenario: { include: { complex: true } }, payments: true, conversation: { include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } }, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, series: true },
      orderBy: { startAt: "desc" }, take: 200,
    });
    return { data: reservations };
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: { scenario: { include: { complex: { include: { paymentSettings: { include: { qrs: true } } } }, pricingRules: true } }, payments: true, conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } }, order: { include: { lines: { include: { product: true } } } }, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, series: true },
    });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    return { data: reservation };
  });

  app.post("/", async (req, reply) => {
    await attachAuthUser(req);
    const body = z.object({
      scenarioId: z.string().min(1), startAt: z.string().datetime(), endAt: z.string().datetime(),
      people: z.number().int().positive().optional(), clientName: z.string().optional().nullable(),
      isVip: z.boolean().optional(), note: z.string().optional().nullable(), payLater: z.boolean().optional(),
      membershipId: z.string().optional().nullable(),
      client: z.object({ email: z.string().email(), name: z.string().optional(), phone: z.string().optional().nullable(), clientTier: z.enum(["NORMAL","HABITUAL","PREFERENCIAL"]).optional() }).optional().nullable(),
      initialStatus: z.enum(["PENDING_PAYMENT","PENDING_CONFIRMATION","CONFIRMED"]).optional(),
      paymentMethod: z.enum(["CASH","TRANSFER","QR","SHARED_QR","CREDIT"]).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const startAt = new Date(body.data.startAt), endAt = new Date(body.data.endAt);
    if (!(endAt > startAt)) return reply.code(400).send({ error: "INVALID_RANGE", message: "Rango horario inválido" });

    const scenario = await prisma.scenario.findUnique({ where: { id: body.data.scenarioId }, include: { complex: { include: { tenant: { include: { clientTiers: true } } } }, pricingRules: true } });
    if (!scenario) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!(await assertTenantActive(scenario.complex.tenantId, reply))) return;

    const staffMode = !!((body.data.membershipId || body.data.client || body.data.initialStatus) && isStaffForComplex(req, scenario.complex.tenantId, scenario.complexId));
    if ((body.data.membershipId || body.data.client || body.data.initialStatus) && !staffMode) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos para crear reservas en nombre de un cliente o definir estado inicial." });

    let membershipId: string | null = null; let membershipTier: string | null = null; let eligibleTier = false; let tierDiscountPercent = 0; let tierDiscountAmount = 0; let resolvedClientName: string | null = body.data.clientName || null;
    if (staffMode) {
      try {
        const resolved = await resolveStaffClient(prisma, scenario.complex.tenantId, { membershipId: body.data.membershipId, client: body.data.client as any, clientName: body.data.clientName });
        membershipId = resolved.membershipId; resolvedClientName = resolved.clientName;
        if (resolved.membership) {
          membershipTier = (resolved.membership as any).clientTier;
          const tierCfg = scenario.complex.tenant.clientTiers.find((t) => t.type === (resolved.membership as any).clientTier);
          eligibleTier = Boolean(tierCfg?.allowVipBooking) || membershipTier === "PREFERENCIAL" || membershipTier === "HABITUAL";
          tierDiscountPercent = tierCfg?.discountPercent ? Number(tierCfg.discountPercent) : 0;
          tierDiscountAmount = tierCfg?.discountAmount ? Number(tierCfg.discountAmount) : 0;
        }
      } catch (e: any) { if (e?.code === "CLIENT_NOT_FOUND") return reply.code(404).send({ error: e.code, message: e.message }); throw e; }
    } else if (req.authUser) {
      const membership = await prisma.membership.findFirst({ where: { userId: req.authUser.id, tenantId: scenario.complex.tenantId }, orderBy: [{ role: "asc" }] });
      if (membership) {
        membershipId = membership.id; membershipTier = membership.clientTier as any;
        const tierCfg = scenario.complex.tenant.clientTiers.find((t) => t.type === membership.clientTier);
        eligibleTier = Boolean(tierCfg?.allowVipBooking) || membership.clientTier === "PREFERENCIAL" || membership.clientTier === "HABITUAL";
        tierDiscountPercent = tierCfg?.discountPercent ? Number(tierCfg.discountPercent) : 0;
        tierDiscountAmount = tierCfg?.discountAmount ? Number(tierCfg.discountAmount) : 0;
      }
      resolvedClientName = resolvedClientName || req.authUser.name || null;
    }

    const requestedPayLater = Boolean(body.data.payLater || body.data.isVip);
    const canPayLater = requestedPayLater && eligibleTier && Boolean((scenario.complex as any).allowClientPayLater);
    if (requestedPayLater && !canPayLater) return reply.code(403).send({ error: "PAY_LATER_NOT_ALLOWED", message: !(scenario.complex as any).allowClientPayLater ? "Reserva sin pago anticipado no habilitada en este complejo." : "Reserva sin pago anticipado solo disponible para clientes habituales o preferenciales." });
    try { assertWithinSchedule(scenario.complex, scenario, startAt, endAt); } catch (e: any) { if (e?.code === "OUTSIDE_SCHEDULE") return reply.code(400).send({ error: e.code, message: e.message }); throw e; }

    const pricing = pricingFor(scenario, startAt, endAt, body.data.people, tierDiscountPercent, tierDiscountAmount);
    const holdMinutes = Number(env.RESERVATION_HOLD_MINUTES || 15);

    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scenario.id}))`;
        await tx.reservation.updateMany({ where: { scenarioId: scenario.id, status: "PENDING_PAYMENT", holdExpiresAt: { lt: new Date() } }, data: { status: "EXPIRED" as any } });
        const blocking = await tx.reservation.findMany({ where: { scenarioId: scenario.id, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "SCHEDULED"] as any }, startAt: { lt: endAt }, endAt: { gt: startAt } }, select: { id: true, status: true, holdExpiresAt: true } });
        const now = new Date();
        const activeConflict = blocking.some((r) => r.status !== "PENDING_PAYMENT" || !r.holdExpiresAt || r.holdExpiresAt > now);
        if (scenario.exclusive && activeConflict) { const err: any = new Error("SLOT_UNAVAILABLE"); err.code = "SLOT_UNAVAILABLE"; throw err; }

        let finalStatus: any = canPayLater ? "CONFIRMED" : "PENDING_PAYMENT";
        if (staffMode && body.data.initialStatus) finalStatus = body.data.initialStatus;
        const holdExpiresAt = finalStatus === "PENDING_PAYMENT" ? new Date(Date.now() + holdMinutes * 60 * 1000) : null;
        let code = makeCode();
        for (let i = 0; i < 8; i++) { const exists = await tx.reservation.findUnique({ where: { code } }); if (!exists) break; code = makeCode(); }

        const reservation = await tx.reservation.create({
          data: { code, complexId: scenario.complexId, scenarioId: scenario.id, membershipId, clientName: resolvedClientName, startAt, endAt, people: body.data.people || null, status: finalStatus, holdExpiresAt, isVip: Boolean(canPayLater), priceSubtotal: pricing.subtotal as any, discountAmount: pricing.discount as any, totalAmount: pricing.total as any, note: body.data.note || null, conversation: { create: { complexId: scenario.complexId } } },
          include: { scenario: { include: { complex: { include: { paymentSettings: { include: { qrs: true } } } } } }, conversation: true, payments: true, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } } },
        });

        const statusMsg = finalStatus === "CONFIRMED" ? "confirmada" : finalStatus === "PENDING_CONFIRMATION" ? "pendiente de confirmación de pago" : "pendiente de pago";
        await tx.message.create({ data: { conversationId: reservation.conversation!.id, kind: "SYSTEM", body: `Reserva ${reservation.code} creada (${statusMsg}). Total: ${pricing.total} ${scenario.complex.currency || "BOB"}.` } }).catch(() => {});
        if (finalStatus === "CONFIRMED") {
          const payMethod = (body.data.paymentMethod || (canPayLater ? "CREDIT" : "CASH")) as any;
          await tx.financialTransaction.create({ data: { complexId: scenario.complexId, scenarioId: scenario.id, type: "INCOME", source: "RESERVATION", amount: pricing.total as any, method: payMethod, refType: "Reservation", refId: reservation.id, note: canPayLater ? "Reserva sin pago anticipado (cliente autorizado)" : `Reserva ${reservation.code} confirmada por staff` } }).catch(() => {});
        }

        const targets = await getStaffTargets(tx, scenario.complex.tenantId, scenario.complexId);
        const clientUserId = await getClientUserId(tx, membershipId);
        const when = new Date(startAt).toLocaleString("es-BO", { timeZone: scenario.complex.timezone || "America/La_Paz" });
        const notifBody = `Reserva ${code} · ${scenario.name} · ${when} · ${scenario.complex.name}`;
        await createNotifications(tx, { userIds: [...targets.map((t: any) => t.user.id), ...(clientUserId ? [clientUserId] : [])], complexId: scenario.complexId, type: "RESERVATION_CREATED", title: "Nueva reserva", body: notifBody, data: { reservationId: reservation.id, code, complexId: scenario.complexId, status: reservation.status } });
        if (targets.length) {
          const summary = targets.map((t: any) => `${t.user.email}${t.user.phone ? ` (${t.user.phone})` : ""}`).join(", ");
          await tx.message.create({ data: { conversationId: reservation.conversation!.id, kind: "SYSTEM", body: `Reserva ${code}: notificación in-app enviada a staff y cliente. Staff: ${summary}.` } }).catch(() => {});
        }
        return { reservation, pricing, holdMinutes: reservation.status === "PENDING_PAYMENT" ? holdMinutes : null };
      }, { isolationLevel: "Serializable" } as any);

      return reply.code(201).send({ data: created.reservation, pricing: created.pricing, holdMinutes: created.holdMinutes, membershipId, membershipTier, payLater: created.reservation.status === "CONFIRMED" && canPayLater });
    } catch (e: any) {
      if (e?.code === "SLOT_UNAVAILABLE" || e?.message === "SLOT_UNAVAILABLE") return reply.code(409).send({ error: "SLOT_UNAVAILABLE", message: "El horario seleccionado no está disponible (conflicto o en hold por otra reserva)." });
      if (e?.code === "OUTSIDE_SCHEDULE") return reply.code(400).send({ error: "OUTSIDE_SCHEDULE", message: e.message || "Fuera del horario de atención/disponibilidad del complejo/escenario." });
      throw e;
    }
  });

  app.post("/:id/receipt-sent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ method: z.enum(["CASH","TRANSFER","QR","SHARED_QR"]).optional(), receiptKey: z.string().optional().nullable(), receiptName: z.string().optional().nullable(), note: z.string().optional().nullable() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true, complex: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.reservation.update({ where: { id: reservation.id }, data: { status: "PENDING_CONFIRMATION" } });
      const method = body.data.method || "QR";
      await tx.payment.create({ data: { reservationId: reservation.id, method: method as any, amount: reservation.totalAmount as any, status: "PENDING", receiptKey: body.data.receiptKey || null, metadata: { receiptName: body.data.receiptName || null, note: body.data.note || null } as any } } as any).catch(() => {});
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: body.data.receiptKey ? "ATTACHMENT" : "SYSTEM", body: `Reserva ${reservation.code}: comprobante enviado (${method})${body.data.receiptName ? ` · archivo: ${body.data.receiptName}` : ""}${body.data.note ? ` · ${body.data.note}` : ""}. Pendiente de confirmación.`, attachmentKey: body.data.receiptKey || null } as any }).catch(() => {});
      const targets = await getStaffTargets(tx, reservation.complex.tenantId, reservation.complexId);
      await createNotifications(tx, { userIds: targets.map((t: any) => t.user.id), complexId: reservation.complexId, type: "RESERVATION_RECEIPT_SENT", title: "Comprobante enviado", body: `Reserva ${reservation.code}: comprobante enviado (${method}), pendiente de confirmación.`, data: { reservationId: reservation.id, code: reservation.code, method } });
      return u;
    });
    return { data: updated };
  });

  app.post("/:id/confirm-payment", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({ method: z.enum(["CASH","TRANSFER","QR","SHARED_QR","CREDIT"]).optional() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { payments: true, conversation: true, complex: true, scenario: true, membership: { include: { user: true } }, series: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, reservation))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });

    const payMethod = (body.data.method || "CASH") as any;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED", holdExpiresAt: null, seriesPaidAt: reservation.reservationSeriesId ? new Date() : (reservation as any).seriesPaidAt } as any });
      await tx.payment.updateMany({ where: { reservationId: reservation.id, status: "PENDING" }, data: { status: "CONFIRMED" } }).catch(() => {});
      await tx.financialTransaction.create({ data: { complexId: reservation.complexId, scenarioId: reservation.scenarioId, type: "INCOME", source: "RESERVATION", amount: reservation.totalAmount as any, method: payMethod, refType: "Reservation", refId: reservation.id, note: `Pago confirmado (${payMethod}) reserva ${reservation.code}` } }).catch(() => {});
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code}: pago confirmado (${payMethod}). Reserva confirmada.` } }).catch(() => {});

      let nextInfo: any = null;
      if (reservation.reservationSeriesId) {
        const s = await tx.reservationSeries.findUnique({ where: { id: reservation.reservationSeriesId } });
        if (s) {
          const { promoteNextSeriesOccurrence } = await import("../../../lib/series.js");
          const next = await promoteNextSeriesOccurrence(tx, { ...s, currentReservationId: reservation.id, status: s.status } as any);
          if ((s as any).debtCount > 0) await tx.reservationSeries.update({ where: { id: s.id }, data: { status: "IN_ARREARS" as any } }).catch(()=>{});
          nextInfo = next ? { id: (next as any).id, code: (next as any).code } : null;
          if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: nextInfo ? `Reserva ${reservation.code} (serie): pago de semana confirmado. Siguiente ocurrencia habilitada: ${nextInfo.code}.` : `Reserva ${reservation.code} (serie): pago confirmado. No hay más ocurrencias futuras.` } }).catch(()=>{});
        }
      }

      const targets = await getStaffTargets(tx, reservation.complex.tenantId, reservation.complexId);
      const clientUserId = reservation.membership?.userId || (await getClientUserId(tx, reservation.membershipId));
      const when = new Date(reservation.startAt).toLocaleString("es-BO", { timeZone: reservation.complex.timezone || "America/La_Paz" });
      const notifBody = `Pago confirmado · ${reservation.code} · ${reservation.scenario?.name || "Escenario"} · ${when}${nextInfo?` · Siguiente: ${nextInfo.code}`:""}`;
      await createNotifications(tx, { userIds: [...targets.map((t: any) => t.user.id), ...(clientUserId ? [clientUserId] : [])], complexId: reservation.complexId, type: "RESERVATION_PAYMENT_CONFIRMED", title: "Pago confirmado", body: notifBody, data: { reservationId: reservation.id, code: reservation.code, complexId: reservation.complexId, status: "CONFIRMED", next: nextInfo } });
      return { u, next: nextInfo };
    });
    return { data: updated.u, next: updated.next };
  });

  app.post("/:id/reject-payment", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true, complex: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, reservation))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.reservation.update({ where: { id: reservation.id }, data: { status: "REJECTED", holdExpiresAt: null } });
      await tx.payment.updateMany({ where: { reservationId: reservation.id, status: "PENDING" }, data: { status: "REJECTED" } }).catch(() => {});
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code}: pago rechazado. Reserva liberada.` } }).catch(() => {});
      return u;
    });
    return { data: updated };
  });

  app.post("/:id/mark-unpaid", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true, complex: true, scenario: true, membership: { include: { user: true } }, series: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, reservation))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if (!reservation.reservationSeriesId) return reply.code(400).send({ error: "NOT_SERIES", message: "Solo aplica a reservas de una serie recurrente." });
    const out = await prisma.$transaction(async (tx) => {
      const series = await tx.reservationSeries.findUnique({ where: { id: reservation.reservationSeriesId! } });
      if (!series) throw Object.assign(new Error("Serie no encontrada"), { statusCode: 404 });
      const debtCount = ((series as any).debtCount || 0) + 2;
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: "NO_SHOW", isSeriesCurrent: false, seriesPaidAt: null, holdExpiresAt: null } as any });
      await tx.reservationSeries.update({ where: { id: series.id }, data: { debtCount, status: "IN_ARREARS" as any, currentReservationId: null } as any });
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code} (serie ${(series as any).code}): marcada como impaga/no asistida. Se generan 2 adeudos (total: ${debtCount}). Se habilita la siguiente ocurrencia con deuda pendiente.` } }).catch(()=>{});
      const { promoteNextSeriesOccurrence } = await import("../../../lib/series.js");
      const next = await promoteNextSeriesOccurrence(tx, await tx.reservationSeries.findUnique({ where: { id: series.id } }) as any);
      const targets = await getStaffTargets(tx, reservation.complex.tenantId, reservation.complexId);
      const clientUserId = reservation.membership?.userId || (await getClientUserId(tx, reservation.membershipId));
      await createNotifications(tx, { userIds: [...targets.map((t:any)=>t.user.id), ...(clientUserId?[clientUserId]:[])], complexId: reservation.complexId, type: "SERIES_PAYMENT_MISSED", title: "Reserva recurrente: impago registrado", body: `Serie ${(series as any).code} · ${reservation.code} marcada impaga. Adeudos: ${debtCount}.${next?` Siguiente: ${(next as any).code}`:""}`, data: { seriesId: series.id, reservationId: reservation.id, debtCount } });
      return { debtCount, next: next?{id:(next as any).id,code:(next as any).code}:null, seriesCode: (series as any).code };
    });
    return { ok: true, ...out };
  });

  app.post("/:id/no-show", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({ cancelSeries: z.boolean().optional().default(true), note: z.string().optional() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true, complex: true, scenario: true, membership: true, series: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, reservation))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const result = await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: "NO_SHOW", holdExpiresAt: null, isSeriesCurrent: false } as any });
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code}: marcada como no asistida${body.data.note ? `: ${body.data.note}` : ""}.` } }).catch(() => {});
      let cancelledSeries = 0; let debtCount: number | null = null; let promoted: any = null;
      if (reservation.reservationSeriesId) {
        const series = await tx.reservationSeries.findUnique({ where: { id: reservation.reservationSeriesId } });
        if (series && (reservation as any).isSeriesCurrent) {
          debtCount = ((series as any).debtCount || 0) + 2;
          await tx.reservationSeries.update({ where: { id: series.id }, data: { debtCount, status: "IN_ARREARS" as any, currentReservationId: null } as any });
          const { promoteNextSeriesOccurrence } = await import("../../../lib/series.js");
          promoted = await promoteNextSeriesOccurrence(tx, await tx.reservationSeries.findUnique({ where: { id: series.id } }) as any);
          if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code} (serie ${(series as any).code}): no asistida/impaga. Se generan 2 adeudos (total: ${debtCount}).${promoted?` Siguiente habilitada: ${(promoted as any).code}.`:""}` } }).catch(()=>{});
        }
      } else if (reservation.seriesId && body.data.cancelSeries) {
        const r = await tx.reservation.updateMany({ where: { seriesId: reservation.seriesId, id: { not: reservation.id }, startAt: { gte: reservation.startAt }, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED"] as any } }, data: { status: "CANCELLED", holdExpiresAt: null } });
        cancelledSeries = r.count;
      }
      const clientUserId = reservation.membership?.userId || (await getClientUserId(tx, reservation.membershipId));
      if (clientUserId) await createNotifications(tx, { userIds: [clientUserId], complexId: reservation.complexId, type: debtCount!=null?"SERIES_PAYMENT_MISSED":"RESERVATION_SERIES_CANCELLED", title: debtCount!=null?"Reserva recurrente: falta/impago":"Reserva marcada como falta", body: `Reserva ${reservation.code} marcada como no asistida${debtCount!=null?`. Adeudos: ${debtCount}.`:""}${cancelledSeries ? `. Se cancelaron ${cancelledSeries} reservas futuras.` : ""}`, data: { reservationId: reservation.id, code: reservation.code } });
      return { cancelledSeries, debtCount, next: promoted?{id:(promoted as any).id,code:(promoted as any).code}:null };
    });
    return { ok: true, status: "NO_SHOW", seriesId: reservation.reservationSeriesId || reservation.seriesId, ...result };
  });

  app.post("/:id/cancel", async (req, reply) => {
    await attachAuthUser(req);
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { complex: true, membership: true, conversation: true, series: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    const isOwner = !!(req.authUser && reservation.membership?.userId === req.authUser.id);
    const isStaff = await canManageReservation(req, reservation);
    if (!isOwner && !isStaff) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const updated = await prisma.$transaction(async (tx) => {
      if (reservation.reservationSeriesId && (reservation as any).isSeriesCurrent) {
        const series = await tx.reservationSeries.findUnique({ where: { id: reservation.reservationSeriesId } });
        if (series) {
          const debtCount = ((series as any).debtCount || 0) + 2;
          await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED", holdExpiresAt: null, isSeriesCurrent: false } as any });
          await tx.reservationSeries.update({ where: { id: series.id }, data: { debtCount, status: "IN_ARREARS" as any, currentReservationId: null } as any });
          if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code} (serie ${(series as any).code}) cancelada. Se generan 2 adeudos (total: ${debtCount}).` } }).catch(() => {});
          const { promoteNextSeriesOccurrence } = await import("../../../lib/series.js");
          await promoteNextSeriesOccurrence(tx, await tx.reservationSeries.findUnique({ where: { id: series.id } }) as any);
          return await tx.reservation.findUnique({ where: { id: reservation.id } });
        }
      }
      const u = await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED", holdExpiresAt: null } });
      if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code} cancelada.` } }).catch(() => {});
      return u;
    });
    return { data: updated };
  });

  app.post("/series/:seriesId/cancel", async (req, reply) => {
    await attachAuthUser(req);
    const { seriesId } = req.params as { seriesId: string };
    const series = await prisma.reservationSeries.findUnique({ where: { id: seriesId }, include: { complex: true, membership: true } as any }).catch(()=>null);
    let anyRes: any = null;
    if (series) anyRes = { complex: (series as any).complex, complexId: (series as any).complexId, membership: (series as any).membership, seriesId };
    if (series && (series as any).complex && !(await assertTenantActive((series as any).complex.tenantId, reply))) return;
    else anyRes = await prisma.reservation.findFirst({ where: { OR: [{ seriesId }, { reservationSeriesId: seriesId }] as any }, include: { complex: true, membership: true }, orderBy: { startAt: "asc" } });
    if (!anyRes) return reply.code(404).send({ error: "NOT_FOUND", message: "Serie no encontrada" });
    if (anyRes?.complex && !(await assertTenantActive(anyRes.complex.tenantId, reply))) return;
    const isOwner = !!(req.authUser && anyRes.membership?.userId === req.authUser.id);
    const isStaff = await canManageReservation(req, anyRes);
    if (!isOwner && !isStaff) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const r = await prisma.$transaction(async (tx) => {
      if (series) { const { cancelSeriesInternal } = await import("../../../lib/series.js"); await cancelSeriesInternal(tx, seriesId, "MANUAL"); return { cancelled: 1 }; }
      const u = await tx.reservation.updateMany({ where: { seriesId, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "SCHEDULED"] as any } }, data: { status: "CANCELLED", holdExpiresAt: null } });
      return { cancelled: u.count };
    });
    return { ok: true, seriesId, ...r };
  });

  app.post("/series/:seriesId/pay-debt", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { seriesId } = req.params as { seriesId: string };
    const body = z.object({ count: z.number().int().min(1).max(10).optional().default(1), method: z.enum(["CASH","TRANSFER","QR","SHARED_QR","CREDIT"]).optional().default("CASH") }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const series = await prisma.reservationSeries.findUnique({ where: { id: seriesId }, include: { complex: true, currentReservation: { include: { conversation: true } } } as any });
    if (!series) return reply.code(404).send({ error: "NOT_FOUND", message: "Serie no encontrada" });
    if (!(await assertTenantActive((series as any).complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, { complex: (series as any).complex, complexId: (series as any).complexId }))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const out = await prisma.$transaction(async (tx) => {
      const s = await tx.reservationSeries.findUnique({ where: { id: seriesId } });
      if (!s) throw Object.assign(new Error("Serie no encontrada"), { statusCode: 404 });
      const paid = Math.min(body.data.count || 1, (s as any).debtCount || 0);
      const debtCount = Math.max(0, ((s as any).debtCount || 0) - paid);
      const status = (s as any).status === "CANCELLED" ? "CANCELLED" : (debtCount > 0 ? "IN_ARREARS" : "ACTIVE");
      await tx.reservationSeries.update({ where: { id: seriesId }, data: { debtCount, status: status as any } });
      if (paid > 0) await tx.financialTransaction.create({ data: { complexId: (s as any).complexId, scenarioId: (s as any).scenarioId, type: "INCOME", source: "RESERVATION", amount: 0 as any, method: body.data.method as any, refType: "ReservationSeries", refId: seriesId, note: `Pago de adeudo(s) serie ${(s as any).code}: ${paid}` } as any }).catch(()=>{});
      const cur = await tx.reservation.findFirst({ where: { reservationSeriesId: seriesId, isSeriesCurrent: true } as any, include: { conversation: true } });
      if (cur?.conversation) await tx.message.create({ data: { conversationId: (cur as any).conversation.id, kind: "SYSTEM", body: `Serie ${(s as any).code}: pago de ${paid} adeudo(s). Adeudos restantes: ${debtCount}. ${debtCount===0?"Serie al día.":"Debe regularizar adeudos antes de que termine la siguiente semana."}` } }).catch(()=>{});
      return { paid, debtCount, status };
    });
    return { ok: true, seriesId, ...out };
  });

  app.patch("/:id", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const body = z.object({ scenarioId: z.string().min(1).optional(), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional(), clientName: z.string().optional().nullable(), note: z.string().optional().nullable() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { complex: true, conversation: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    if (!(await assertTenantActive(reservation.complex.tenantId, reply))) return;
    if (!(await canManageReservation(req, reservation))) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if ((reservation as any).reservationSeriesId) return reply.code(400).send({ error: "SERIES_EDIT_NOT_ALLOWED", message: "Las ocurrencias de una reserva fija no se editan directamente. Cancela la serie o gestiona la ocurrencia actual." });
    if (["CANCELLED", "REJECTED", "EXPIRED", "NO_SHOW", "COMPLETED"].includes(reservation.status)) return reply.code(400).send({ error: "INVALID_STATE", message: "No se puede editar una reserva en estado final." });

    const scenarioId = body.data.scenarioId || reservation.scenarioId;
    const startAt = body.data.startAt ? new Date(body.data.startAt) : new Date(reservation.startAt);
    const endAt = body.data.endAt ? new Date(body.data.endAt) : new Date(reservation.endAt);
    if (!(endAt > startAt)) return reply.code(400).send({ error: "INVALID_RANGE", message: "Rango horario inválido" });
    const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId }, include: { complex: true, pricingRules: true } });
    if (!scenario) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (scenario.complexId !== reservation.complexId) return reply.code(400).send({ error: "INVALID_SCENARIO", message: "El escenario debe pertenecer al mismo complejo." });
    try { assertWithinSchedule(scenario.complex, scenario, startAt, endAt); } catch (e: any) { if (e?.code === "OUTSIDE_SCHEDULE") return reply.code(400).send({ error: e.code, message: e.message }); throw e; }
    const pricing = pricingFor(scenario, startAt, endAt, undefined, 0, 0);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scenarioId}))`;
        await tx.reservation.updateMany({ where: { scenarioId, status: "PENDING_PAYMENT", holdExpiresAt: { lt: new Date() } }, data: { status: "EXPIRED" as any } });
        const blocking = await tx.reservation.findMany({ where: { id: { not: reservation.id }, scenarioId, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "SCHEDULED"] as any }, startAt: { lt: endAt }, endAt: { gt: startAt } }, select: { id: true, status: true, holdExpiresAt: true } });
        const now = new Date();
        const activeConflict = blocking.some((r) => r.status !== "PENDING_PAYMENT" || !r.holdExpiresAt || r.holdExpiresAt > now);
        if (scenario.exclusive && activeConflict) { const err: any = new Error("SLOT_UNAVAILABLE"); err.code = "SLOT_UNAVAILABLE"; throw err; }
        const u = await tx.reservation.update({ where: { id: reservation.id }, data: { scenarioId, startAt, endAt, ...(body.data.clientName !== undefined ? { clientName: body.data.clientName || null } : {}), ...(body.data.note !== undefined ? { note: body.data.note || null } : {}), priceSubtotal: pricing.subtotal as any, discountAmount: pricing.discount as any, totalAmount: pricing.total as any }, include: { scenario: { include: { complex: true } }, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } } } });
        if (reservation.conversation) await tx.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: `Reserva ${reservation.code} editada por staff.` } }).catch(() => {});
        return u;
      }, { isolationLevel: "Serializable" } as any);
      return { data: updated };
    } catch (e: any) {
      if (e?.code === "SLOT_UNAVAILABLE" || e?.message === "SLOT_UNAVAILABLE") return reply.code(409).send({ error: "SLOT_UNAVAILABLE", message: "El horario/escenario seleccionado no está disponible (conflicto o hold activo)." });
      if (e?.code === "OUTSIDE_SCHEDULE") return reply.code(400).send({ error: "OUTSIDE_SCHEDULE", message: e.message || "Fuera del horario de atención/disponibilidad del complejo/escenario." });
      throw e;
    }
  });

  app.post("/recurring", async (req, reply) => {
    await attachAuthUser(req);
    const body = z.object({
      scenarioId: z.string().min(1), startAt: z.string().datetime(), endAt: z.string().datetime(), weekday: z.number().int().min(0).max(6), weeks: z.number().int().min(1).max(52).default(8),
      clientName: z.string().optional().nullable(), note: z.string().optional().nullable(), payLater: z.boolean().optional(),
      membershipId: z.string().optional().nullable(),
      client: z.object({ email: z.string().email(), name: z.string().optional(), phone: z.string().optional().nullable(), clientTier: z.enum(["NORMAL","HABITUAL","PREFERENCIAL"]).optional() }).optional().nullable(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const baseStart = new Date(body.data.startAt), baseEnd = new Date(body.data.endAt);
    if (!(baseEnd > baseStart)) return reply.code(400).send({ error: "INVALID_RANGE", message: "Rango horario inválido" });
    const scenario = await prisma.scenario.findUnique({ where: { id: body.data.scenarioId }, include: { complex: { include: { tenant: { include: { clientTiers: true } } } }, pricingRules: true } });
    if (!scenario) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });
    if (!(await assertTenantActive(scenario.complex.tenantId, reply))) return;

    const staffMode = !!((body.data.membershipId || body.data.client) && isStaffForComplex(req, scenario.complex.tenantId, scenario.complexId));
    if ((body.data.membershipId || body.data.client) && !staffMode) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos para crear reservas recurrentes en nombre de un cliente." });

    let membershipId: string | null = null; let eligibleTier = false; let tierDiscountPercent = 0; let tierDiscountAmount = 0; let resolvedClientName: string | null = body.data.clientName || null;
    if (staffMode) {
      try {
        const resolved = await resolveStaffClient(prisma, scenario.complex.tenantId, { membershipId: body.data.membershipId, client: body.data.client as any, clientName: body.data.clientName });
        membershipId = resolved.membershipId; resolvedClientName = resolved.clientName;
        if (resolved.membership) {
          const mt = (resolved.membership as any).clientTier;
          const tierCfg = scenario.complex.tenant.clientTiers.find((t) => t.type === mt);
          eligibleTier = Boolean(tierCfg?.allowVipBooking) || mt === "PREFERENCIAL" || mt === "HABITUAL";
          tierDiscountPercent = tierCfg?.discountPercent ? Number(tierCfg.discountPercent) : 0;
          tierDiscountAmount = tierCfg?.discountAmount ? Number(tierCfg.discountAmount) : 0;
        }
      } catch (e: any) { if (e?.code === "CLIENT_NOT_FOUND") return reply.code(404).send({ error: e.code, message: e.message }); throw e; }
    } else if (req.authUser) {
      const membership = await prisma.membership.findFirst({ where: { userId: req.authUser.id, tenantId: scenario.complex.tenantId } as any, include: { user: { select: { id: true, email: true, name: true, phone: true } } } });
      if (membership) {
        membershipId = membership.id; resolvedClientName = resolvedClientName || (membership as any).user?.name || null;
        const tierCfg = scenario.complex.tenant.clientTiers.find((t) => t.type === membership.clientTier);
        eligibleTier = Boolean(tierCfg?.allowVipBooking) || membership.clientTier === "PREFERENCIAL" || membership.clientTier === "HABITUAL";
        tierDiscountPercent = tierCfg?.discountPercent ? Number(tierCfg.discountPercent) : 0;
        tierDiscountAmount = tierCfg?.discountAmount ? Number(tierCfg.discountAmount) : 0;
      } else { resolvedClientName = resolvedClientName || req.authUser.name || null; }
    }
    if (!eligibleTier || !Boolean((scenario.complex as any).allowClientPayLater)) return reply.code(403).send({ error: "RECURRING_NOT_ALLOWED", message: "Reserva fija disponible solo para clientes Habitual/Preferencial y cuando el complejo permite reservas sin prepago." });
    if (!membershipId) return reply.code(400).send({ error: "CLIENT_REQUIRED", message: "La reserva fija requiere un cliente Habitual/Preferencial asociado." });

    const first = new Date(baseStart); const diff = (body.data.weekday - first.getDay() + 7) % 7; first.setDate(first.getDate() + diff);
    const durationMs = baseEnd.getTime() - baseStart.getTime();
    const now = new Date(); const occs: { startAt: Date; endAt: Date; pricing: any }[] = []; let scheduleSkips = 0;
    for (let i = 0; i < body.data.weeks; i++) {
      const startAt = new Date(first.getTime() + i * 7 * 24 * 60 * 60 * 1000); const endAt = new Date(startAt.getTime() + durationMs);
      try { assertWithinSchedule(scenario.complex, scenario, startAt, endAt); } catch (e: any) { if (e?.code === "OUTSIDE_SCHEDULE") { scheduleSkips++; continue; } throw e; }
      occs.push({ startAt, endAt, pricing: pricingFor(scenario, startAt, endAt, undefined, tierDiscountPercent, tierDiscountAmount) });
    }
    if (occs.length === 0) return reply.code(400).send({ error: "NO_OCCURRENCES", message: "No se pudieron generar ocurrencias dentro del horario/disponibilidad." });
    const sundayEnd = (d: Date) => { const x=new Date(d); const day=x.getDay(); const d2=day===0?0:7-day; x.setDate(x.getDate()+d2); x.setHours(23,59,59,999); return x; };
    let currentIdx = occs.findIndex(o => sundayEnd(o.startAt) >= now); if (currentIdx < 0) currentIdx = occs.length - 1;
    const seriesCode = `SER-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const startMin = baseStart.getHours()*60 + baseStart.getMinutes(); const endMin = baseEnd.getHours()*60 + baseEnd.getMinutes();

    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scenario.id}))`;
        await tx.reservation.updateMany({ where: { scenarioId: scenario.id, status: "PENDING_PAYMENT", holdExpiresAt: { lt: new Date() } }, data: { status: "EXPIRED" as any } });
        let conflicts = 0;
        for (const o of occs) {
          const blocking = await tx.reservation.findMany({ where: { scenarioId: scenario.id, status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "SCHEDULED"] as any }, startAt: { lt: o.endAt }, endAt: { gt: o.startAt } }, select: { id: true, status: true, holdExpiresAt: true } });
          const now2 = new Date();
          const activeConflict = blocking.some((r) => r.status !== "PENDING_PAYMENT" || !r.holdExpiresAt || r.holdExpiresAt > now2);
          if (scenario.exclusive && activeConflict) conflicts++;
        }
        if (conflicts > 0) { const err: any = new Error(`Conflicto: ${conflicts} ocurrencia(s) chocan con reservas existentes.`); err.code = "SLOT_UNAVAILABLE"; throw err; }

        const series = await tx.reservationSeries.create({ data: { code: seriesCode, complexId: scenario.complexId, scenarioId: scenario.id, membershipId, clientName: resolvedClientName, weekday: body.data.weekday, startMinutes: startMin, endMinutes: endMin, status: "ACTIVE", debtCount: 0, note: body.data.note || "Reserva fija recurrente" } as any });
        const codes: string[] = []; let currentCode: string | null = null; let currentId: string | null = null;
        for (let i = 0; i < occs.length; i++) {
          const o = occs[i];
          let code = makeCode();
          for (let j = 0; j < 8; j++) { const exists = await tx.reservation.findUnique({ where: { code } }); if (!exists) break; code = makeCode(); }
          const isCurrent = i === currentIdx;
          const dueAt = isCurrent ? (()=>{ const x=new Date(o.startAt); const day=x.getDay(); const d2=day===0?0:7-day; x.setDate(x.getDate()+d2+7); x.setHours(23,59,59,999); return x; })() : null;
          const reservation = await tx.reservation.create({ data: { code, reservationSeriesId: series.id, seriesId: seriesCode, complexId: scenario.complexId, scenarioId: scenario.id, membershipId, clientName: resolvedClientName, startAt: o.startAt, endAt: o.endAt, status: isCurrent ? "PENDING_PAYMENT" : "SCHEDULED", holdExpiresAt: null, isVip: true, priceSubtotal: o.pricing.subtotal as any, discountAmount: o.pricing.discount as any, totalAmount: o.pricing.total as any, isSeriesCurrent: isCurrent, seriesDueAt: dueAt, seriesPaidAt: null, note: body.data.note || "Reserva fija recurrente", conversation: { create: { complexId: scenario.complexId } } } as any, include: { conversation: true } });
          await tx.message.create({ data: { conversationId: (reservation as any).conversation!.id, kind: "SYSTEM", body: `Reserva recurrente ${seriesCode} (${i+1}/${occs.length}) creada. Código ${code}. ${isCurrent ? "Ocurrencia actual: pendiente de pago." : "Ocurrencia futura programada (horario reservado)."}` } }).catch(() => {});
          codes.push(code);
          if (isCurrent) { currentCode = code; currentId = reservation.id; }
        }
        if (currentId) await tx.reservationSeries.update({ where: { id: series.id }, data: { currentReservationId: currentId } as any });
        const targets = await getStaffTargets(tx, scenario.complex.tenantId, scenario.complexId);
        const clientUserId = await getClientUserId(tx, membershipId);
        await createNotifications(tx, { userIds: [...targets.map((t: any) => t.user.id), ...(clientUserId ? [clientUserId] : [])], complexId: scenario.complexId, type: "RESERVATION_SERIES_CREATED", title: "Reserva fija creada", body: `Serie ${seriesCode} · ${scenario.name} · ${occs.length} ocurrencias creadas. Actual: ${currentCode || "-"}.`, data: { seriesId: series.id, seriesCode, complexId: scenario.complexId, scenarioId: scenario.id, created: occs.length, currentCode } });
        return { seriesId: series.id, seriesCode, created: occs.length, conflicts: 0, scheduleSkips, codes, currentCode, currentReservationId: currentId };
      }, { isolationLevel: "Serializable" } as any);
      return reply.code(201).send({ data: created });
    } catch (e: any) {
      if (e?.code === "SLOT_UNAVAILABLE" || e?.message === "SLOT_UNAVAILABLE") return reply.code(409).send({ error: "SLOT_UNAVAILABLE", message: e.message || "Conflicto con reservas existentes en una o más ocurrencias." });
      if (e?.code === "OUTSIDE_SCHEDULE") return reply.code(400).send({ error: "OUTSIDE_SCHEDULE", message: e.message }); throw e;
    }
  });
}
