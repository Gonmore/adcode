import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";

export default async function salesRoutes(app: FastifyInstance) {
  app.get("/kiosks", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.kiosk.findMany({ where: complexId ? { complexId } : undefined, include: { warehouse: true }, orderBy: { createdAt: "desc" } }).catch(() => []);
    return { data };
  });

  app.get("/products", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    // Products are global in current schema; expose with stock summary if complexId provided
    const products = await prisma.product.findMany({ where: { active: true }, include: { category: true, stockLots: complexId ? { where: { warehouse: { complexId } } } : false } as any, orderBy: { name: "asc" } }).catch(() => [] as any[]);
    const data = products.map((p: any) => {
      const stock = Array.isArray(p.stockLots) ? p.stockLots.reduce((s: number, l: any) => s + (l.qty || 0), 0) : undefined;
      return { id: p.id, name: p.name, price: Number(p.price), cost: Number(p.cost), category: p.category, imageKey: p.imageKey, active: p.active, stock };
    });
    return { data };
  });

  app.get("/menu/:complexSlug", async (req) => {
    const { complexSlug } = req.params as { complexSlug: string };
    const complex = await prisma.complex.findFirst({ where: { OR: [{ slug: complexSlug }, { id: complexSlug }] } });
    if (!complex) return { data: { complex: null, items: [] } };
    const products = await prisma.product.findMany({ where: { active: true }, include: { category: true, stockLots: { where: { warehouse: { complexId: complex.id } } } }, orderBy: { name: "asc" } });
    const items = products.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), category: p.category?.name || null, imageKey: p.imageKey, stock: p.stockLots.reduce((s, l) => s + l.qty, 0) }));
    return { data: { complex: { id: complex.id, name: complex.name, slug: complex.slug }, items } };
  });

  app.get("/orders", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.order.findMany({ where: complexId ? { complexId } : undefined, include: { lines: { include: { product: true } }, payments: true }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []);
    return { data };
  });

  app.post("/orders", async (req, reply) => {
    const body = z.object({ complexId: z.string(), kioskId: z.string().optional(), reservationId: z.string().optional(), items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const { complexId, kioskId, reservationId, items } = body.data;
    const products = await prisma.product.findMany({ where: { id: { in: items.map(i => i.productId) } } });
    let total = 0;
    const lines = items.map((it) => {
      const p = products.find(pp => pp.id === it.productId);
      if (!p) throw new Error("Producto no encontrado");
      total += Number(p.price) * it.qty;
      return { productId: p.id, qty: it.qty, unitPrice: p.price as any, unitCost: p.cost as any };
    });
    const order = await prisma.order.create({ data: { complexId, kioskId: kioskId || null, reservationId: reservationId || null, status: "PENDING", total: total as any, lines: { create: lines } }, include: { lines: { include: { product: true } } } });
    return reply.code(201).send({ data: order });
  });
}
