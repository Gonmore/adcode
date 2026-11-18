import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth } from "../../../lib/auth.js";

export default async function notificationsRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const unread = (req.query as any)?.unread === "1" || (req.query as any)?.unread === "true";
    const data = await prisma.notification.findMany({
      where: { userId: req.authUser!.id, ...(unread ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unreadCount = await prisma.notification.count({ where: { userId: req.authUser!.id, readAt: null } });
    return { data, unreadCount };
  });

  app.post("/read", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    if (body.data.all) {
      await prisma.notification.updateMany({ where: { userId: req.authUser!.id, readAt: null }, data: { readAt: new Date() } });
    } else if (body.data.ids?.length) {
      await prisma.notification.updateMany({ where: { userId: req.authUser!.id, id: { in: body.data.ids } }, data: { readAt: new Date() } });
    }
    const unreadCount = await prisma.notification.count({ where: { userId: req.authUser!.id, readAt: null } });
    return { ok: true, unreadCount };
  });
}
