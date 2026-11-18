import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, isPlatformAdmin, assertTenantActive } from "../../../lib/auth.js";

function canManageComplexUser(user: any, tenantId: string, complexId?: string) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return (user.memberships || []).some((m: any) => {
    if (m.tenantId !== tenantId) return false;
    if (m.role === "TENANT_ADMIN") return true;
    if (["COMPLEX_ADMIN", "SELLER"].includes(m.role)) return !complexId || !m.complexIds?.length || m.complexIds.includes(complexId);
    return false;
  });
}

async function ensureComplexAccess(req: any, reply: any, complexId: string, allowSeller = true) {
  await requireAuth(req, reply); if (reply.sent) return null;
  const complex = await prisma.complex.findUnique({ where: { id: complexId }, select: { id: true, tenantId: true, currency: true } });
  if (!complex) { reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" }); return null; }
  const ok = isPlatformAdmin(req.authUser) || (req.authUser?.memberships || []).some((m: any) => {
    if (m.tenantId !== complex.tenantId) return false;
    if (m.role === "TENANT_ADMIN") return true;
    if ((allowSeller ? ["COMPLEX_ADMIN", "SELLER"] : ["COMPLEX_ADMIN"]).includes(m.role)) return !m.complexIds?.length || m.complexIds.includes(complex.id);
    return false;
  });
  if (!ok) { reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" }); return null; }
  return complex;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cur = ""; let inQ = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ""; }
      else if (ch === '\n') { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
      else if (ch === '\r') { /* ignore */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(c => String(c||"").trim() !== ""));
}

function normName(s: string) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function toNum(v: any, def = 0) { const n = Number(String(v ?? "").replace(/,/g, ".")); return Number.isFinite(n) ? n : def; }

export default async function inventoryRoutes(app: FastifyInstance) {
  // ---- Warehouses & locations ----
  app.get("/warehouses", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "complexId requerido" });
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.warehouse.findMany({ where: { complexId }, include: { locations: true, _count: { select: { stockLots: true } } }, orderBy: { createdAt: "asc" } });
    return { data };
  });

  app.post("/warehouses", async (req, reply) => {
    const body = z.object({ complexId: z.string(), name: z.string().min(1), locations: z.array(z.string().min(1)).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const wh = await prisma.warehouse.create({ data: { complexId: body.data.complexId, name: body.data.name, locations: body.data.locations?.length ? { create: body.data.locations.map(n => ({ name: n })) } : undefined }, include: { locations: true } });
    return reply.code(201).send({ data: wh });
  });

  app.post("/warehouses/:id/locations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Nombre requerido" });
    const wh = await prisma.warehouse.findUnique({ where: { id }, include: { complex: true } });
    if (!wh) return reply.code(404).send({ error: "NOT_FOUND", message: "Almacén no encontrado" });
    const cx = await ensureComplexAccess(req, reply, wh.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const loc = await prisma.warehouseLocation.create({ data: { warehouseId: id, name: body.data.name } });
    return reply.code(201).send({ data: loc });
  });

  // ---- Categories & suppliers ----
  app.get("/categories", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.productCategory.findMany({ where: { OR: [{ complexId }, { complexId: null }] }, orderBy: { name: "asc" } });
    return { data };
  });
  app.post("/categories", async (req, reply) => {
    const body = z.object({ complexId: z.string(), name: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.productCategory.create({ data: { complexId: body.data.complexId, name: body.data.name } });
    return reply.code(201).send({ data });
  });

  app.get("/suppliers", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.supplier.findMany({ where: { OR: [{ complexId }, { complexId: null }] }, orderBy: { name: "asc" } });
    return { data };
  });
  app.post("/suppliers", async (req, reply) => {
    const body = z.object({ complexId: z.string(), name: z.string().min(1), contact: z.string().optional(), email: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.supplier.create({ data: { complexId: body.data.complexId, name: body.data.name, contact: body.data.contact || null, email: body.data.email || null } });
    return reply.code(201).send({ data });
  });

  // ---- Products & presentations ----
  app.get("/products", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.product.findMany({
      where: { OR: [{ complexId }, { complexId: null }] },
      include: {
        category: true, supplier: true,
        presentations: { orderBy: { name: "asc" } },
        stockLots: { where: { warehouse: { complexId } }, include: { location: true, warehouse: true, presentation: true } },
      },
      orderBy: { name: "asc" },
    });
    const mapped = data.map((p: any) => {
      const totalStock = p.stockLots.reduce((s: number, l: any) => s + (l.qty || 0), 0);
      const pres = p.presentations.map((pr: any) => ({ ...pr, cost: Number(pr.cost), price: Number(pr.price), stock: p.stockLots.filter((l: any) => l.presentationId === pr.id).reduce((s: number, l: any) => s + (l.qty || 0), 0) }));
      return { ...p, cost: Number(p.cost), price: Number(p.price), totalStock, presentations: pres };
    });
    return { data: mapped };
  });

  app.post("/products", async (req, reply) => {
    const presSchema = z.object({ name: z.string().min(1), unitsPerPack: z.number().int().positive().default(1), barcode: z.string().optional(), cost: z.number().nonnegative().default(0), price: z.number().nonnegative().default(0) });
    const body = z.object({ complexId: z.string(), name: z.string().min(1), categoryId: z.string().optional().nullable(), supplierId: z.string().optional().nullable(), notes: z.string().optional().nullable(), imageKey: z.string().optional().nullable(), cost: z.number().nonnegative().optional(), price: z.number().nonnegative().optional(), presentations: z.array(presSchema).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const baseCost = body.data.cost ?? body.data.presentations[0].cost ?? 0;
    const basePrice = body.data.price ?? body.data.presentations[0].price ?? 0;
    const product = await prisma.product.create({
      data: {
        complexId: body.data.complexId, name: body.data.name, notes: body.data.notes || null, imageKey: body.data.imageKey || null,
        categoryId: body.data.categoryId || null, supplierId: body.data.supplierId || null,
        cost: baseCost as any, price: basePrice as any, active: true,
        presentations: { create: body.data.presentations.map(p => ({ name: p.name, unitsPerPack: p.unitsPerPack || 1, barcode: p.barcode || null, cost: p.cost as any, price: p.price as any, active: true })) },
      },
      include: { category: true, supplier: true, presentations: true },
    });
    return reply.code(201).send({ data: product });
  });

  app.patch("/products/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).optional(), categoryId: z.string().nullable().optional(), supplierId: z.string().nullable().optional(), notes: z.string().nullable().optional(), imageKey: z.string().nullable().optional(), active: z.boolean().optional(), cost: z.number().nonnegative().optional(), price: z.number().nonnegative().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const existing = await prisma.product.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Producto no encontrado" });
    if (existing.complexId) { const cx = await ensureComplexAccess(req, reply, existing.complexId, false); if (!cx) return; } else { await requireAuth(req, reply); if (!isPlatformAdmin(req.authUser)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" }); }
    const updated = await prisma.product.update({ where: { id }, data: { ...(body.data as any) }, include: { category: true, supplier: true, presentations: true } });
    return { data: updated };
  });

  app.delete("/products/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id }, include: { complex: true } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "Producto no encontrado" });
    if (existing.complexId) { const cx = await ensureComplexAccess(req, reply, existing.complexId, false); if (!cx) return; } else { await requireAuth(req, reply); if (!isPlatformAdmin(req.authUser)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" }); }
    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { presentation: { productId: id } } });
      await tx.stockLot.deleteMany({ where: { presentation: { productId: id } } });
      await tx.productPresentation.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });
    return reply.code(204).send();
  });

  app.post("/products/:id/presentations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1), unitsPerPack: z.number().int().positive().default(1), barcode: z.string().optional(), cost: z.number().nonnegative().default(0), price: z.number().nonnegative().default(0) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return reply.code(404).send({ error: "NOT_FOUND", message: "Producto no encontrado" });
    if (product.complexId) { const cx = await ensureComplexAccess(req, reply, product.complexId, false); if (!cx) return; }
    const data = await prisma.productPresentation.create({ data: { productId: id, name: body.data.name, unitsPerPack: body.data.unitsPerPack || 1, barcode: body.data.barcode || null, cost: body.data.cost as any, price: body.data.price as any, active: true } });
    return reply.code(201).send({ data });
  });

  app.patch("/presentations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).optional(), unitsPerPack: z.number().int().positive().optional(), barcode: z.string().nullable().optional(), cost: z.number().nonnegative().optional(), price: z.number().nonnegative().optional(), active: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const pres = await prisma.productPresentation.findUnique({ where: { id }, include: { product: true } });
    if (!pres) return reply.code(404).send({ error: "NOT_FOUND", message: "Presentación no encontrada" });
    if (pres.product.complexId) { const cx = await ensureComplexAccess(req, reply, pres.product.complexId, false); if (!cx) return; }
    const updated = await prisma.productPresentation.update({ where: { id }, data: body.data as any });
    return { data: updated };
  });

  // ---- Stock view ----
  app.get("/stock", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId, warehouseId } = (req.query || {}) as { complexId?: string; warehouseId?: string };
    if (!complexId) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "complexId requerido" });
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const lots = await prisma.stockLot.findMany({
      where: { warehouse: { complexId, ...(warehouseId ? { id: warehouseId } : {}) }, qty: { gt: 0 } },
      include: { product: { include: { category: true } }, presentation: true, warehouse: true, location: true },
      orderBy: [{ product: { name: "asc" } }],
    });
    return { data: lots.map((l: any) => ({ ...l, unitCost: Number(l.unitCost), product: { ...l.product, cost: Number(l.product.cost), price: Number(l.product.price) }, presentation: l.presentation ? { ...l.presentation, cost: Number(l.presentation.cost), price: Number(l.presentation.price) } : null })) };
  });

  // ---- Stock in (add/increase) ----
  app.post("/stock/in", async (req, reply) => {
    const body = z.object({
      complexId: z.string(), warehouseId: z.string(), locationId: z.string().optional().nullable(),
      supplierId: z.string().optional().nullable(), paymentMethod: z.enum(["CASH","TRANSFER","QR","SHARED_QR","CREDIT"]).optional().nullable(),
      registerExpense: z.boolean().optional().default(false), notes: z.string().optional().nullable(),
      items: z.array(z.object({ productId: z.string(), presentationId: z.string(), qty: z.number().int().positive(), unitCost: z.number().nonnegative().optional() })).min(1),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const wh = await prisma.warehouse.findFirst({ where: { id: body.data.warehouseId, complexId: body.data.complexId } });
    if (!wh) return reply.code(404).send({ error: "NOT_FOUND", message: "Almacén no encontrado" });
    if (body.data.locationId) { const loc = await prisma.warehouseLocation.findFirst({ where: { id: body.data.locationId, warehouseId: body.data.warehouseId } }); if (!loc) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Ubicación inválida" }); }
    const presIds = body.data.items.map(i => i.presentationId);
    const presRows = await prisma.productPresentation.findMany({ where: { id: { in: presIds } }, include: { product: true } });
    if (presRows.length !== presIds.length) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Presentación inválida" });

    const result = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const it of body.data.items) {
        const pres = presRows.find(p => p.id === it.presentationId)!;
        if (pres.productId !== it.productId) throw new Error("Presentación no corresponde al producto");
        const unitCost = it.unitCost ?? Number(pres.cost) ?? Number(pres.product.cost) ?? 0;
        total += unitCost * it.qty;
        const lotWhere: any = { productId: it.productId, presentationId: it.presentationId, warehouseId: body.data.warehouseId, locationId: body.data.locationId || null };
        const existingLot = await tx.stockLot.findFirst({ where: lotWhere });
        if (existingLot) await tx.stockLot.update({ where: { id: existingLot.id }, data: { qty: { increment: it.qty }, unitCost: unitCost as any } });
        else await tx.stockLot.create({ data: { ...lotWhere, qty: it.qty, unitCost: unitCost as any } });
        await tx.stockMovement.create({ data: { complexId: body.data.complexId, type: "IN", productId: it.productId, presentationId: it.presentationId, locationId: body.data.locationId || null, qty: it.qty, unitCost: unitCost as any, toWarehouseId: body.data.warehouseId, refType: "STOCK_ENTRY", note: body.data.notes || null } });
      }
      const entry = await tx.stockEntry.create({ data: { complexId: body.data.complexId, supplierId: body.data.supplierId || null, warehouseId: body.data.warehouseId, locationId: body.data.locationId || null, total: total as any, paymentMethod: (body.data.paymentMethod as any) || null, notes: body.data.notes || null } });
      if (body.data.registerExpense && total > 0) {
        await tx.financialTransaction.create({ data: { complexId: body.data.complexId, type: "EXPENSE", source: "SUPPLIER_PAYMENT", amount: total as any, method: (body.data.paymentMethod as any) || null, refType: "STOCK_ENTRY", refId: entry.id, note: body.data.notes || "Ingreso de inventario" } });
      }
      return entry;
    });
    return reply.code(201).send({ data: result });
  });

  // ---- Stock out (sale/waste/adjust out) ----
  app.post("/stock/out", async (req, reply) => {
    const body = z.object({
      complexId: z.string(), warehouseId: z.string(), locationId: z.string().optional().nullable(),
      reason: z.enum(["SALE", "WASTE", "ADJUST"]).default("SALE"),
      paymentMethod: z.enum(["CASH","TRANSFER","QR","SHARED_QR","CREDIT"]).optional().nullable(),
      notes: z.string().optional().nullable(),
      items: z.array(z.object({ productId: z.string(), presentationId: z.string(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative().optional() })).min(1),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const presIds = body.data.items.map(i => i.presentationId);
    const presRows = await prisma.productPresentation.findMany({ where: { id: { in: presIds } }, include: { product: true } });
    if (presRows.length !== presIds.length) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Presentación inválida" });

    try {
      const result = await prisma.$transaction(async (tx) => {
        let income = 0; let costTotal = 0;
        const moveType = body.data.reason === "WASTE" ? "WASTE" : body.data.reason === "ADJUST" ? "ADJUST" : "OUT";
        for (const it of body.data.items) {
          const pres = presRows.find(p => p.id === it.presentationId)!;
          const unitPrice = it.unitPrice ?? Number(pres.price) ?? Number(pres.product.price) ?? 0;
          const unitCost = Number(pres.cost) ?? Number(pres.product.cost) ?? 0;
          // decrement lots FIFO by createdAt
          let remaining = it.qty;
          const lots = await tx.stockLot.findMany({ where: { productId: it.productId, presentationId: it.presentationId, warehouseId: body.data.warehouseId, ...(body.data.locationId ? { locationId: body.data.locationId } : {}), qty: { gt: 0 } }, orderBy: { createdAt: "asc" } });
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, lot.qty);
            await tx.stockLot.update({ where: { id: lot.id }, data: { qty: { decrement: take } } });
            remaining -= take;
          }
          if (remaining > 0) throw new Error(`Stock insuficiente para ${pres.product.name} (${pres.name})`);
          income += unitPrice * it.qty;
          costTotal += unitCost * it.qty;
          await tx.stockMovement.create({ data: { complexId: body.data.complexId, type: moveType as any, productId: it.productId, presentationId: it.presentationId, locationId: body.data.locationId || null, qty: it.qty, unitCost: unitCost as any, unitPrice: unitPrice as any, fromWarehouseId: body.data.warehouseId, refType: body.data.reason, note: body.data.notes || null } });
        }
        if (body.data.reason === "SALE" && income > 0) {
          await tx.financialTransaction.create({ data: { complexId: body.data.complexId, type: "INCOME", source: "SALE", amount: income as any, method: (body.data.paymentMethod as any) || null, refType: "SALE", note: body.data.notes || "Venta de productos" } });
        }
        if ((body.data.reason === "WASTE" || body.data.reason === "ADJUST") && costTotal > 0) {
          await tx.financialTransaction.create({ data: { complexId: body.data.complexId, type: "EXPENSE", source: "OTHER", amount: costTotal as any, refType: body.data.reason, note: body.data.notes || (body.data.reason === "WASTE" ? "Merma/baja de inventario" : "Ajuste de inventario") } });
        }
        return { income, costTotal, movements: body.data.items.length };
      });
      return reply.code(201).send({ data: result });
    } catch (e: any) {
      return reply.code(400).send({ error: "STOCK_ERROR", message: e.message || "No se pudo registrar la salida" });
    }
  });

  // ---- CSV import ----
  app.post("/import-csv", async (req, reply) => {
    const body = z.object({
      complexId: z.string(), warehouseId: z.string(), locationId: z.string().optional().nullable(),
      csv: z.string().min(1), createCategories: z.boolean().optional().default(true), registerExpense: z.boolean().optional().default(false),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message || "Datos inválidos" });
    const cx = await ensureComplexAccess(req, reply, body.data.complexId, false); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const wh = await prisma.warehouse.findFirst({ where: { id: body.data.warehouseId, complexId: body.data.complexId } });
    if (!wh) return reply.code(404).send({ error: "NOT_FOUND", message: "Almacén no encontrado" });
    if (body.data.locationId) { const loc = await prisma.warehouseLocation.findFirst({ where: { id: body.data.locationId, warehouseId: body.data.warehouseId } }); if (!loc) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Ubicación inválida" }); }

    const rows = parseCsv(body.data.csv);
    if (rows.length < 2) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "CSV vacío o sin datos" });
    const header = rows[0].map(h => normName(h));
    const idx = (names: string[]) => header.findIndex(h => names.includes(h));
    const iName = idx(["nombre", "name", "producto"]);
    const iCat = idx(["categoría", "categoria", "category"]);
    const iNotes = idx(["notas", "nota", "notes"]);
    const iQty = idx(["cant.", "cant", "cantidad", "qty", "stock", "existencias"]);
    const iCost = idx(["costo unitario", "costo", "cost", "unit cost"]);
    const iPrice = idx(["precio unitario", "precio", "price", "unit price"]);
    if (iName < 0) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "No se encontró columna Nombre" });

    const cats = await prisma.productCategory.findMany({ where: { OR: [{ complexId: body.data.complexId }, { complexId: null }] } });
    const prods = await prisma.product.findMany({ where: { OR: [{ complexId: body.data.complexId }, { complexId: null }] }, include: { presentations: true } });

    let created = 0, updated = 0, stockAdded = 0, skipped = 0;
    const errors: string[] = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = String(row[iName] || "").trim();
      if (!name) { skipped++; continue; }
      const catName = iCat >= 0 ? String(row[iCat] || "").trim() : "";
      const notes = iNotes >= 0 ? String(row[iNotes] || "").trim() : "";
      const qty = iQty >= 0 ? Math.max(0, Math.round(toNum(row[iQty], 0))) : 0;
      const cost = iCost >= 0 ? Math.max(0, toNum(row[iCost], 0)) : 0;
      const price = iPrice >= 0 ? Math.max(0, toNum(row[iPrice], 0)) : 0;

      try {
        let categoryId: string | null = null;
        if (catName) {
          let cat = cats.find(c => normName(c.name) === normName(catName) && (c.complexId === body.data.complexId || c.complexId == null));
          if (!cat && body.data.createCategories) {
            cat = await prisma.productCategory.create({ data: { complexId: body.data.complexId, name: catName } });
            cats.push(cat as any);
          }
          categoryId = cat?.id || null;
        }

        let product = prods.find(p => normName(p.name) === normName(name) && (p.complexId === body.data.complexId || p.complexId == null));
        let presentation: any = null;
        if (!product) {
          product = await prisma.product.create({
            data: {
              complexId: body.data.complexId, name, notes: notes || null, categoryId, cost: cost as any, price: price as any, active: true,
              presentations: { create: [{ name: "Unidad", unitsPerPack: 1, cost: cost as any, price: price as any, active: true }] },
            },
            include: { presentations: true },
          }) as any;
          prods.push(product as any);
          presentation = (product as any).presentations[0];
          created++;
        } else {
          presentation = (product as any).presentations?.[0];
          if (!presentation) {
            presentation = await prisma.productPresentation.create({ data: { productId: product.id, name: "Unidad", unitsPerPack: 1, cost: cost as any, price: price as any, active: true } });
          } else {
            // update costs/prices/notes/category if provided
            await prisma.product.update({ where: { id: product.id }, data: { ...(categoryId ? { categoryId } : {}), ...(notes ? { notes } : {}), cost: cost as any, price: price as any } }).catch(() => {});
            await prisma.productPresentation.update({ where: { id: presentation.id }, data: { cost: cost as any, price: price as any } }).catch(() => {});
          }
          updated++;
        }

        if (qty > 0 && presentation) {
          await prisma.$transaction(async (tx) => {
            const lotWhere: any = { productId: (product as any).id, presentationId: presentation.id, warehouseId: body.data.warehouseId, locationId: body.data.locationId || null };
            const existingLot = await tx.stockLot.findFirst({ where: lotWhere });
            if (existingLot) await tx.stockLot.update({ where: { id: existingLot.id }, data: { qty: { increment: qty }, unitCost: cost as any } });
            else await tx.stockLot.create({ data: { ...lotWhere, qty, unitCost: cost as any } });
            await tx.stockMovement.create({ data: { complexId: body.data.complexId, type: "IN", productId: (product as any).id, presentationId: presentation.id, locationId: body.data.locationId || null, qty, unitCost: cost as any, toWarehouseId: body.data.warehouseId, refType: "CSV_IMPORT", note: `Importación CSV: ${name}` } });
          });
          stockAdded += qty;
        }
      } catch (e: any) {
        errors.push(`${name}: ${e.message || "error"}`);
      }
    }

    // optional total expense record for imported stock value (best-effort, no cost aggregation here to keep simple)
    return { data: { created, updated, stockAdded, skipped, errors: errors.slice(0, 20), rows: rows.length - 1 } };
  });

  // ---- Movements ----
  app.get("/movements", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    if (!complexId) return { data: [] };
    const cx = await ensureComplexAccess(req, reply, complexId, true); if (!cx) return;
    if (!(await assertTenantActive(cx.tenantId, reply))) return;
    const data = await prisma.stockMovement.findMany({ where: { complexId }, include: { product: true, presentation: true, location: true, fromWarehouse: true, toWarehouse: true }, orderBy: { createdAt: "desc" }, take: 200 });
    return { data };
  });
}