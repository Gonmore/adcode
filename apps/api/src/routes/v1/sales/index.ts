import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function salesRoutes(app: FastifyInstance) {
  app.get("/kiosks", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.kiosk.findMany({ where: complexId ? { complexId } : undefined, include: { warehouse: true, complex: { select: { tenantId: true } } }, orderBy: { createdAt: "desc" } }).catch(() => []);
    if (!isPlatformAdmin(req.authUser)) {
      const tids = new Set((req.authUser?.memberships||[]).map(m=>m.tenantId));
      return { data: data.filter((k:any)=>tids.has(k.complex?.tenantId)) };
    }
    return { data };
  });

  app.get("/products", async (req) => {
    const { complexId } = (req.query || {}) as { complexId?: string };
    const products = await prisma.product.findMany({ where: { active: true }, include: { category: true, stockLots: complexId ? { where: { warehouse: { complexId } } } : false } as any, orderBy: { name: "asc" } }).catch(() => [] as any[]);
    const data = products.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), cost: Number(p.cost), category: p.category, imageKey: p.imageKey, active: p.active, stock: Array.isArray(p.stockLots) ? p.stockLots.reduce((s: number, l: any) => s + (l.qty || 0), 0) : undefined }));
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

  app.get("/orders", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const { complexId } = (req.query || {}) as { complexId?: string };
    const data = await prisma.order.findMany({ where: complexId ? { complexId } : undefined, include: { lines: { include: { product: true } }, payments: true, complex: { select: { tenantId: true } } }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []);
    if (!isPlatformAdmin(req.authUser)) { const tids = new Set((req.authUser?.memberships||[]).map(m=>m.tenantId)); return { data: data.filter((o:any)=>tids.has(o.complex?.tenantId)) }; }
    return { data };
  });

  app.post("/orders", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({ complexId: z.string(), kioskId: z.string().optional(), reservationId: z.string().optional(), items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const { complexId, kioskId, reservationId, items } = body.data;
    const complex = await prisma.complex.findUnique({ where: { id: complexId } });
    if (!complex) return reply.code(404).send({ error: "NOT_FOUND", message: "Complejo no encontrado" });
    if (!isPlatformAdmin(req.authUser) && !canManageTenant(req.authUser, complex.tenantId)) return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos" });
    const products = await prisma.product.findMany({ where: { id: { in: items.map(i => i.productId) } } });
    let total = 0;
    const lines = items.map((it) => { const p = products.find(pp => pp.id === it.productId); if (!p) throw new Error("Producto no encontrado"); total += Number(p.price) * it.qty; return { productId: p.id, qty: it.qty, unitPrice: p.price as any, unitCost: p.cost as any }; });
    const order = await prisma.order.create({ data: { complexId, kioskId: kioskId || null, reservationId: reservationId || null, status: "PENDING", total: total as any, lines: { create: lines } }, include: { lines: { include: { product: true } } } });
    return reply.code(201).send({ data: order });
  });
}
