import type { FastifyInstance } from "fastify";
import { prisma } from "../../../lib/prisma.js";

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get("/warehouses", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.warehouse.findMany({ where: complexId ? { complexId } : undefined, include: { locations: true, stockLots: { include: { product: true } } } }).catch(() => []);
    return { data };
  });

  app.get("/stock", async (req) => {
    const { complexId, warehouseId } = (req.query || {}) as { complexId?: string; warehouseId?: string };
    const lots = await prisma.stockLot.findMany({
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(complexId ? { warehouse: { complexId } } : {}),
      },
      include: { product: true, warehouse: true, location: true },
      orderBy: [{ product: { name: "asc" } }, { expiresAt: "asc" }],
    }).catch(() => []);
    const grouped = new Map<string, any>();
    for (const l of lots as any[]) {
      const k = `${l.productId}:${l.warehouseId}`;
      if (!grouped.has(k)) grouped.set(k, { productId: l.productId, product: l.product, warehouseId: l.warehouseId, warehouse: l.warehouse, qty: 0, lots: [] });
      const g = grouped.get(k);
      g.qty += l.qty;
      g.lots.push({ id: l.id, qty: l.qty, expiresAt: l.expiresAt, location: l.location, unitCost: Number(l.unitCost) });
    }
    return { data: Array.from(grouped.values()) };
  });
}
