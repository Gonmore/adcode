import { prisma } from "./prisma.js";

export function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// week ends Sunday 23:59:59.999 local server time
export function endOfWeekSunday(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun
  const diff = day === 0 ? 0 : 7 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(23,59,59,999);
  return x;
}
export function weekKey(d: Date) { const s = startOfDay(addDays(d, -((d.getDay()+6)%7))); return s.toISOString().slice(0,10); } // monday-based key

export function minutesOfDay(d: Date) { return d.getHours()*60 + d.getMinutes(); }

export async function getSeriesWithReservations(tx: any, seriesId: string) {
  return tx.reservationSeries.findUnique({
    where: { id: seriesId },
    include: {
      reservations: { orderBy: { startAt: "asc" }, include: { conversation: true, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, complex: true, scenario: true } },
      currentReservation: { include: { conversation: true, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, complex: true, scenario: true } },
      complex: true, scenario: true, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } },
    },
  });
}

async function notify(tx: any, params: { userIds: string[]; complexId: string; type: string; title: string; body: string; data?: any }) {
  const uniq = Array.from(new Set((params.userIds||[]).filter(Boolean)));
  if (!uniq.length) return;
  await tx.notification.createMany({ data: uniq.map((userId) => ({ userId, complexId: params.complexId, type: params.type, title: params.title, body: params.body, data: params.data || null })) });
}
async function staffTargets(tx: any, tenantId: string, complexId: string) {
  const staff = await tx.membership.findMany({ where: { tenantId, role: { in: ["COMPLEX_ADMIN", "SELLER", "TENANT_ADMIN"] as any } }, include: { user: { select: { id: true, email: true, name: true, phone: true } } } });
  return staff.filter((m: any) => m.role === "TENANT_ADMIN" || (m.complexIds || []).length === 0 || (m.complexIds || []).includes(complexId));
}

export async function promoteNextSeriesOccurrence(tx: any, series: any) {
  if (!series || series.status === "CANCELLED") return null;
  const now = new Date();
  const next = await tx.reservation.findFirst({
    where: { reservationSeriesId: series.id, id: { not: series.currentReservationId || undefined }, startAt: { gte: now }, status: { in: ["SCHEDULED"] as any } },
    orderBy: { startAt: "asc" },
  });
  if (!next) {
    await tx.reservationSeries.update({ where: { id: series.id }, data: { currentReservationId: null, status: series.debtCount > 0 ? "IN_ARREARS" : "ACTIVE" } });
    return null;
  }
  const dueAt = endOfWeekSunday(addDays(next.startAt, 7)); // before next week's end
  await tx.reservation.updateMany({ where: { reservationSeriesId: series.id, isSeriesCurrent: true, id: { not: next.id } }, data: { isSeriesCurrent: false } }).catch(() => {});
  const updated = await tx.reservation.update({ where: { id: next.id }, data: { status: "PENDING_PAYMENT", isSeriesCurrent: true, seriesDueAt: dueAt, holdExpiresAt: null } });
  await tx.reservationSeries.update({ where: { id: series.id }, data: { currentReservationId: updated.id, status: series.debtCount > 0 ? "IN_ARREARS" : "ACTIVE" } });
  return updated;
}

export async function reconcileOneSeries(tx: any, seriesId: string, now = new Date()) {
  const series = await tx.reservationSeries.findUnique({
    where: { id: seriesId },
    include: { complex: true, scenario: true, membership: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, currentReservation: { include: { conversation: true } }, reservations: { orderBy: { startAt: "asc" } } },
  });
  if (!series || series.status === "CANCELLED") return series;
  const weekEnd = endOfWeekSunday(now);
  // if current is past due window (unpaid and week ended) -> auto mark unpaid
  if (series.currentReservationId) {
    const cur = await tx.reservation.findUnique({ where: { id: series.currentReservationId }, include: { conversation: true } });
    if (cur && !cur.seriesPaidAt && cur.status !== "CANCELLED" && cur.status !== "NO_SHOW") {
      const due = cur.seriesDueAt || endOfWeekSunday(addDays(cur.startAt, 7));
      // auto: if Sunday ended AND (end of its own week passed? spec: "al terminar la semana alguna reserva recurrente no fue pagada") -> mark unpaid at week end
      const ownWeekEnd = endOfWeekSunday(cur.startAt);
      if (now > ownWeekEnd && !cur.seriesPaidAt) {
        // mark as missed/unpaid -> +2 debt, occurrence becomes NO_SHOW (still occupied historically) and promote next
        await tx.reservation.update({ where: { id: cur.id }, data: { status: "NO_SHOW", isSeriesCurrent: false } });
        if (cur.conversation) await tx.message.create({ data: { conversationId: cur.conversation.id, kind: "SYSTEM", body: `Reserva recurrente ${series.code} (${cur.code}) marcada como no pagada automáticamente al cierre de semana. Se generan 2 adeudos.` } }).catch(()=>{});
        let newDebt = (series.debtCount || 0) + 2;
        let newStatus: any = "IN_ARREARS";
        await tx.reservationSeries.update({ where: { id: series.id }, data: { debtCount: newDebt, status: newStatus } });
        const targets = await staffTargets(tx, series.complex.tenantId, series.complexId);
        const clientUserId = series.membership?.userId || null;
        await notify(tx, { userIds: [...targets.map((t:any)=>t.user.id), ...(clientUserId?[clientUserId]:[])], complexId: series.complexId, type: "SERIES_PAYMENT_MISSED", title: "Reserva recurrente: pago no realizado", body: `Serie ${series.code} · ${series.scenario?.name||"Escenario"} · ${cur.code} no pagada. Adeudos: ${newDebt}.`, data: { seriesId: series.id, reservationId: cur.id, debtCount: newDebt } });
        series.debtCount = newDebt; series.status = newStatus; series.currentReservationId = null;
        await promoteNextSeriesOccurrence(tx, await tx.reservationSeries.findUnique({ where: { id: series.id } }));
      } else if (now > due && series.debtCount >= 2) {
        // deadline passed (before next week ends) and still 2 debts -> cancel series and free future
        await cancelSeriesInternal(tx, series.id, "AUTO_DEBT");
        return await tx.reservationSeries.findUnique({ where: { id: series.id } });
      }
    }
  } else {
    // ensure there is a current if series active
    if (series.status !== "CANCELLED") await promoteNextSeriesOccurrence(tx, series);
  }
  // if debt >=2 and past due of current -> cancel
  const refreshed = await tx.reservationSeries.findUnique({ where: { id: series.id }, include: { currentReservation: true } });
  if (refreshed && refreshed.debtCount >= 2 && refreshed.currentReservation && !refreshed.currentReservation.seriesPaidAt) {
    const due = refreshed.currentReservation.seriesDueAt || endOfWeekSunday(addDays(refreshed.currentReservation.startAt, 7));
    if (now > due) await cancelSeriesInternal(tx, series.id, "AUTO_DEBT");
  }
  return await tx.reservationSeries.findUnique({ where: { id: series.id } });
}

export async function reconcileSeriesForComplex(tx: any, complexId: string) {
  const series = await tx.reservationSeries.findMany({ where: { complexId, status: { in: ["ACTIVE","IN_ARREARS"] as any } }, select: { id: true } });
  for (const s of series) { try { await reconcileOneSeries(tx, s.id); } catch {} }
}

export async function reconcileSeriesForScenario(tx: any, scenarioId: string) {
  const series = await tx.reservationSeries.findMany({ where: { scenarioId, status: { in: ["ACTIVE","IN_ARREARS"] as any } }, select: { id: true } });
  for (const s of series) { try { await reconcileOneSeries(tx, s.id); } catch {} }
}

export async function cancelSeriesInternal(tx: any, seriesId: string, reason = "CANCELLED") {
  const series = await tx.reservationSeries.findUnique({ where: { id: seriesId } });
  if (!series) return;
  await tx.reservationSeries.update({ where: { id: seriesId }, data: { status: "CANCELLED", currentReservationId: null } });
  // free future: cancel scheduled/current unpaid future occurrences
  await tx.reservation.updateMany({
    where: { reservationSeriesId: seriesId, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "PENDING_CONFIRMATION"] as any }, startAt: { gte: startOfDay(new Date()) } },
    data: { status: "CANCELLED", isSeriesCurrent: false },
  });
  await tx.auditLog.create({ data: { tenantId: (await tx.complex.findUnique({where:{id:series.complexId},select:{tenantId:true}}))?.tenantId || null, action: "RESERVATION_SERIES_CANCELLED", entity: "ReservationSeries", entityId: seriesId, metadata: { reason } as any } }).catch(()=>{});
}
