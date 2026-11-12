import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get("/warehouses", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId, tenantId } = (req.query || {}) as { complexId?: string; tenantId?: string };
    if (tenantId && !canManageTenant(req.authUser, tenantId) && !isPlatformAdmin(req.authUser)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const data = await prisma.warehouse.findMany({ where: { ...(complexId ? { complexId } : {}), ...(tenantId ? { complex: { tenantId } } : {}) }, include: { locations: true, stockLots: { include: { product: true } }, complex: { select: { id: true, tenantId: true, name: true } } } }).catch(() => []);
    return { data };
  });

  app.get("/stock", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId, warehouseId } = (req.query || {}) as { complexId?: string; warehouseId?: string };
    const lots = await prisma.stockLot.findMany({
      where: { ...(warehouseId ? { warehouseId } : {}), ...(complexId ? { warehouse: { complexId } } : {}) },
      include: { product: true, warehouse: { include: { complex: { select: { id: true, tenantId: true } } } }, location: true },
      orderBy: [{ product: { name: "asc" } }, { expiresAt: "asc" }],
    }).catch(() => [] as any[]);
    const grouped = new Map<string, any>();
    for (const l of lots as any[]) {
      const k = `${l.productId}:${l.warehouseId}`;
      if (!grouped.has(k)) grouped.set(k, { productId: l.productId, product: l.product, warehouseId: l.warehouseId, warehouse: l.warehouse, qty: 0, lots: [] });
      const g = grouped.get(k); g.qty += l.qty; g.lots.push({ id: l.id, qty: l.qty, expiresAt: l.expiresAt, location: l.location, unitCost: Number(l.unitCost) });
    }
    return { data: Array.from(grouped.values()) };
  });
}
