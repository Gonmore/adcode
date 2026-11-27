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

export default async function salesRoutes(app: FastifyInstance) {
  app.get("/kiosks", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.kiosk.findMany({ where: complexId ? { complexId } : undefined, include: { warehouse: true, complex: { select: { tenantId: true, name: true } } }, orderBy: { createdAt: "desc" } }).catch(() => []);
    if (!isPlatformAdmin(req.authUser)) {
      const tids = new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId));
      return { data: data.filter((k: any) => tids.has(k.complex?.tenantId)) };
    }
    return { data };
  });

  // Public menu with presentations and stock per complex
  app.get("/menu/:complexSlug", async (req) => {
    const { complexSlug } = req.params as { complexSlug: string };
    const complex = await prisma.complex.findFirst({ where: { OR: [{ slug: complexSlug }, { id: complexSlug }], isActive: true }, select: { id: true, name: true, slug: true, currency: true, openTime: true, closeTime: true, logoKey: true } });
    if (!complex) return { data: { complex: null, categories: [], items: [] } };
    const products = await prisma.product.findMany({
      where: { active: true, OR: [{ complexId: complex.id }, { complexId: null }] },
      include: {
        category: true,
        presentations: { where: { active: true }, orderBy: { name: "asc" } },
        stockLots: { where: { warehouse: { complexId: complex.id }, qty: { gt: 0 } } },
      },
      orderBy: { name: "asc" },
    });
    const items = products.map((p: any) => {
      const pres = p.presentations.map((pr: any) => {
        const stock = p.stockLots.filter((l: any) => l.presentationId === pr.id).reduce((s: number, l: any) => s + l.qty, 0);
        return { id: pr.id, name: pr.name, unitsPerPack: pr.unitsPerPack, price: Number(pr.price) || Number(p.price), cost: Number(pr.cost), stock, available: stock > 0 };
      });
      const stock = pres.reduce((s: number, pr: any) => s + pr.stock, 0);
      return { id: p.id, name: p.name, notes: p.notes, imageKey: p.imageKey, imageUrl: p.imageUrl, category: p.category?.name || null, stock, presentations: pres };
    }).filter((p: any) => p.presentations.length > 0);
    const categories = Array.from(new Set(items.map(i => i.category).filter(Boolean)));
    return { data: { complex, categories, items } };
  });

  app.get("/products", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const products = await prisma.product.findMany({
      where: { active: true, OR: [{ complexId }, { complexId: null }] },
      include: { category: true, presentations: { where: { active: true } }, stockLots: { where: { warehouse: { complexId }, qty: { gt: 0 } } } },
      orderBy: { name: "asc" },
    });
    const data = products.map((p: any) => {
      const pres = p.presentations.map((pr: any) => ({ id: pr.id, name: pr.name, price: Number(pr.price), cost: Number(pr.cost), stock: p.stockLots.filter((l: any) => l.presentationId === pr.id).reduce((s: number, l: any) => s + l.qty, 0) }));
      return { id: p.id, name: p.name, category: p.category, imageKey: p.imageKey, imageUrl: p.imageUrl, presentations: pres, stock: pres.reduce((s: number, x: any) => s + x.stock, 0) };
    });
    return { data };
  });

  app.get("/orders", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.order.findMany({ where: complexId ? { complexId } : undefined, include: { lines: { include: { product: true, presentation: true } }, payments: true, complex: { select: { tenantId: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []);
    if (!isPlatformAdmin(req.authUser)) { const tids = new Set((req.authUser?.memberships || []).map((m: any) => m.tenantId)); return { data: data.filter((o: any) => tids.has(o.complex?.tenantId)) }; }
    return { data };
  });

  // Create order/sale, decrement stock, record income
  app.post("/orders", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      complexId: z.string(), warehouseId: z.string().optional(), locationId: z.string().optional().nullable(),
      kioskId: z.string().optional(), reservationId: z.string().optional(),
      paymentMethod: z.enum(["CASH", "TRANSFER", "QR", "SHARED_QR", "CREDIT"]).optional().default("CASH"),
      items: z.array(z.object({ productId: z.string(), presentationId: z.string(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative().optional() })).min(1),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const { complexId, items } = body.data;
    const complex = await prisma.complex.findUnique({ where: { id: complexId } });
    if (!complex) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!canAccessComplex(req.authUser, complex.tenantId, complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if (!(await assertTenantActive(complex.tenantId, reply))) return;

    // resolve warehouse
    let warehouseId = body.data.warehouseId || null;
    if (!warehouseId) {
      const wh = await prisma.warehouse.findFirst({ where: { complexId }, orderBy: { createdAt: "asc" } });
      warehouseId = wh?.id || null;
    }
    if (!warehouseId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "No hay almacén configurado para el complejo" });

    const presIds = items.map(i => i.presentationId);
    const presRows = await prisma.productPresentation.findMany({ where: { id: { in: presIds } }, include: { product: true } });
    if (presRows.length !== presIds.length) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Presentación inválida" });

    try {
      const order = await prisma.$transaction(async (tx) => {
        let total = 0; let costTotal = 0;
        const lineData: any[] = [];
        for (const it of items) {
          const pres = presRows.find(p => p.id === it.presentationId)!;
          if (pres.productId !== it.productId) throw new Error("Presentación no corresponde al producto");
          const unitPrice = it.unitPrice ?? Number(pres.price) ?? Number(pres.product.price) ?? 0;
          const unitCost = Number(pres.cost) ?? Number(pres.product.cost) ?? 0;
          total += unitPrice * it.qty; costTotal += unitCost * it.qty;
          lineData.push({ productId: it.productId, presentationId: it.presentationId, qty: it.qty, unitPrice: unitPrice as any, unitCost: unitCost as any });
          // decrement stock
          let remaining = it.qty;
          const lots = await tx.stockLot.findMany({ where: { productId: it.productId, presentationId: it.presentationId, warehouseId: warehouseId!, ...(body.data.locationId ? { locationId: body.data.locationId } : {}), qty: { gt: 0 } }, orderBy: { createdAt: "asc" } });
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, lot.qty);
            await tx.stockLot.update({ where: { id: lot.id }, data: { qty: { decrement: take } } });
            remaining -= take;
          }
          if (remaining > 0) throw new Error(`Stock insuficiente para ${pres.product.name} (${pres.name})`);
          await tx.stockMovement.create({ data: { complexId, type: "OUT", productId: it.productId, presentationId: it.presentationId, locationId: body.data.locationId || null, qty: it.qty, unitCost: unitCost as any, unitPrice: unitPrice as any, fromWarehouseId: warehouseId!, refType: "SALE", note: body.data.note || null } });
        }
        const created = await tx.order.create({
          data: { complexId, kioskId: body.data.kioskId || null, reservationId: body.data.reservationId || null, status: "PAID", total: total as any, lines: { create: lineData } },
          include: { lines: { include: { product: true, presentation: true } } },
        });
        // update movement refs
        await tx.stockMovement.updateMany({ where: { complexId, refType: "SALE", refId: null, note: body.data.note || null, createdAt: { gte: new Date(Date.now() - 5000) } }, data: { refId: created.id } }).catch(() => {});
        await tx.financialTransaction.create({ data: { complexId, type: "INCOME", source: "SALE", amount: total as any, method: body.data.paymentMethod as any, refType: "ORDER", refId: created.id, note: body.data.note || "Venta de productos" } });
        if (costTotal > 0) {
          // record COGS-like expense? better keep net via income-expense model; record sale income only, stock value already tracked. skip extra expense to avoid double counting.
        }
        return created;
      });
      return reply.code(201).send({ data: order });
    } catch (e: any) {
      return reply.code(400).send({ error: "SALE_ERROR", message: e.message || "No se pudo registrar la venta" });
    
  app.post("/orders/:id/cancel", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { id } = req.params as { id: string };
    const order = await prisma.order.findUnique({ where: { id }, include: { lines: { include: { presentation: true } }, complex: true } });
    if (!order) return reply.code(404).send({ error: "NOT_FOUND", message: "Venta no encontrada" });
    if (order.status === "CANCELLED") return reply.code(400).send({ error: "INVALID_STATE", message: "Ya cancelada" });
    const cx = order.complex; if (!canAccessComplex(req.authUser, order.complex.tenantId, order.complexId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    if (!(await assertTenantActive(order.complex.tenantId, reply))) return;
    // only same day
    const today = new Date(); today.setHours(0,0,0,0);
    const orderDay = new Date(order.createdAt); orderDay.setHours(0,0,0,0);
    if (orderDay.getTime() !== today.getTime()) return reply.code(400).send({ error: "INVALID_STATE", message: "Solo se puede anular ventas del mismo día" });
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: "CANCELLED" as any } });
      // revert stock
      for (const line of order.lines) {
        const mv = await tx.stockMovement.findFirst({ where: { refType: "SALE", presentationId: line.presentationId, qty: line.qty } });
        // best effort: increment stock lot in any warehouse of the complex
        const lot = await tx.stockLot.findFirst({ where: { presentationId: line.presentationId } });
        if (lot) await tx.stockLot.update({ where: { id: lot.id }, data: { qty: { increment: line.qty } } });
      }
      // reverse financial transaction
      await tx.financialTransaction.create({ data: { complexId: order.complexId, type: "EXPENSE", source: "SALE", amount: order.total as any, refType: "SALE_CANCEL", refId: id, note: "Anulación de venta " + order.id } });
    });
    return { ok: true };
  });
}
  });
}