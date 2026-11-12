import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../lib/env.js";
import { calculatePrice } from "@adcode/shared";

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

export default async function reservationsRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const { complexId, scenarioId, status } = (req.query || {}) as { complexId?: string; scenarioId?: string; status?: string };
    const reservations = await prisma.reservation.findMany({
      where: {
        ...(complexId ? { complexId } : {}),
        ...(scenarioId ? { scenarioId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: { scenario: { include: { complex: true } }, payments: true, conversation: { include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } } },
      orderBy: { startAt: "desc" },
      take: 200,
    });
    return { data: reservations };
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: { scenario: { include: { complex: { include: { paymentSettings: { include: { qrs: true } } } }, pricingRules: true } }, payments: true, conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } }, order: { include: { lines: { include: { product: true } } } } },
    });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    return { data: reservation };
  });

  app.post("/", async (req, reply) => {
    const body = z.object({
      scenarioId: z.string().min(1),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      people: z.number().int().positive().optional(),
      clientName: z.string().optional(),
      isVip: z.boolean().optional(),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });

    const startAt = new Date(body.data.startAt);
    const endAt = new Date(body.data.endAt);
    if (!(endAt > startAt)) return reply.code(400).send({ error: "INVALID_RANGE", message: "Rango horario inválido" });

    const scenario = await prisma.scenario.findUnique({ where: { id: body.data.scenarioId }, include: { complex: true, pricingRules: true } });
    if (!scenario) return reply.code(404).send({ error: "NOT_FOUND", message: "Escenario no encontrado" });

    const blocking = await prisma.reservation.findMany({
      where: {
        scenarioId: scenario.id,
        status: { in: ["PENDING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED"] as any },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, status: true, holdExpiresAt: true },
    });
    const now = new Date();
    const activeConflict = blocking.some((r) => r.status !== "PENDING_PAYMENT" || !r.holdExpiresAt || r.holdExpiresAt > now);
    if (scenario.exclusive && activeConflict) {
      return reply.code(409).send({ error: "SLOT_UNAVAILABLE", message: "El horario seleccionado no está disponible" });
    }

    const dayRule = scenario.pricingRules.find(r => r.period === "DAY");
    const nightRule = scenario.pricingRules.find(r => r.period === "NIGHT") || dayRule;
    const pricing = calculatePrice({
      rentalFormat: scenario.rentalFormat as any,
      startAt,
      endAt,
      people: body.data.people,
      nightStartHour: hourFromHHMM(scenario.complex.nightStart || "18:00", 18),
      nightEndHour: hourFromHHMM(scenario.complex.nightEnd || "06:00", 6),
      pricePerHourDay: dayRule?.pricePerHour ? Number(dayRule.pricePerHour) : 0,
      pricePerHourNight: nightRule?.pricePerHour ? Number(nightRule.pricePerHour) : (dayRule?.pricePerHour ? Number(dayRule.pricePerHour) : 0),
      pricePerPersonDay: dayRule?.pricePerPerson ? Number(dayRule.pricePerPerson) : 0,
      pricePerPersonNight: nightRule?.pricePerPerson ? Number(nightRule.pricePerPerson) : (dayRule?.pricePerPerson ? Number(dayRule.pricePerPerson) : 0),
      basePriceDay: dayRule?.basePrice ? Number(dayRule.basePrice) : 0,
      basePriceNight: nightRule?.basePrice ? Number(nightRule.basePrice) : (dayRule?.basePrice ? Number(dayRule.basePrice) : 0),
    });

    const holdMinutes = Number(env.RESERVATION_HOLD_MINUTES || 15);
    const holdExpiresAt = body.data.isVip ? null : new Date(Date.now() + holdMinutes * 60 * 1000);
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.reservation.findUnique({ where: { code } });
      if (!exists) break;
      code = makeCode();
    }

    const reservation = await prisma.reservation.create({
      data: {
        code,
        complexId: scenario.complexId,
        scenarioId: scenario.id,
        clientName: body.data.clientName || null,
        startAt,
        endAt,
        people: body.data.people || null,
        status: body.data.isVip ? "CONFIRMED" : "PENDING_PAYMENT",
        holdExpiresAt,
        isVip: Boolean(body.data.isVip),
        priceSubtotal: pricing.subtotal as any,
        discountAmount: pricing.discount as any,
        totalAmount: pricing.total as any,
        note: body.data.note || null,
        conversation: { create: { complexId: scenario.complexId } },
      },
      include: { scenario: { include: { complex: { include: { paymentSettings: { include: { qrs: true } } } } } }, conversation: true, payments: true },
    });

    await prisma.message.create({
      data: {
        conversationId: reservation.conversation!.id,
        kind: "SYSTEM",
        body: `Reserva ${reservation.code} creada para ${scenario.name} (${startAt.toISOString()} - ${endAt.toISOString()}). Total: ${pricing.total}. Envía tu comprobante para confirmar.`,
      },
    }).catch(() => {});

    if (body.data.isVip) {
      await prisma.financialTransaction.create({
        data: {
          complexId: scenario.complexId,
          scenarioId: scenario.id,
          type: "INCOME",
          source: "RESERVATION",
          amount: pricing.total as any,
          method: "CREDIT",
          refType: "Reservation",
          refId: reservation.id,
          note: "Reserva VIP (crédito)",
        },
      }).catch(() => {});
    }

    return reply.code(201).send({ data: reservation, pricing, holdMinutes });
  });

  app.post("/:id/receipt-sent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    const updated = await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "PENDING_CONFIRMATION" } });
    if (reservation.conversation) {
      await prisma.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: "Comprobante enviado por el cliente. Pendiente de confirmación del vendedor." } }).catch(() => {});
    }
    return { data: updated };
  });

  app.post("/:id/confirm-payment", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { payments: true, conversation: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    const updated = await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
    await prisma.payment.updateMany({ where: { reservationId: reservation.id, status: "PENDING" }, data: { status: "CONFIRMED" } }).catch(() => {});
    await prisma.financialTransaction.create({
      data: {
        complexId: reservation.complexId,
        scenarioId: reservation.scenarioId,
        type: "INCOME",
        source: "RESERVATION",
        amount: reservation.totalAmount as any,
        method: "QR",
        refType: "Reservation",
        refId: reservation.id,
        note: "Pago confirmado",
      },
    }).catch(() => {});
    if (reservation.conversation) {
      await prisma.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: "Pago confirmado por el encargado. Reserva confirmada." } }).catch(() => {});
    }
    return { data: updated };
  });

  app.post("/:id/reject-payment", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id }, { code: id }] }, include: { conversation: true } });
    if (!reservation) return reply.code(404).send({ error: "NOT_FOUND", message: "Reserva no encontrada" });
    const updated = await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "REJECTED", holdExpiresAt: null } });
    if (reservation.conversation) {
      await prisma.message.create({ data: { conversationId: reservation.conversation.id, kind: "SYSTEM", body: "Comprobante/pago rechazado por el encargado. La reserva fue liberada." } }).catch(() => {});
    }
    return { data: updated };
  });
}