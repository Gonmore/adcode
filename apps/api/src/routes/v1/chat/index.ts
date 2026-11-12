import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth, canManageTenant, isPlatformAdmin } from "../../../lib/auth.js";

export default async function chatRoutes(app: FastifyInstance) {
  app.get("/conversations/:reservationId", async (req, reply) => {
    const { reservationId } = req.params as { reservationId: string };
    const conv = await prisma.conversation.findUnique({ where: { reservationId }, include: { messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, email: true, name: true } } } }, reservation: { select: { id: true, code: true, complexId: true, status: true, complex: { select: { tenantId: true } } } } } });
    if (!conv) return reply.code(404).send({ error: "NOT_FOUND", message: "Conversación no encontrada" });
    return { data: conv };
  });

  app.post("/conversations/:reservationId/messages", async (req, reply) => {
    const { reservationId } = req.params as { reservationId: string };
    const body = z.object({ body: z.string().min(1).optional(), kind: z.enum(["TEXT", "SYSTEM", "ATTACHMENT"]).default("TEXT"), attachmentKey: z.string().optional(), mime: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Mensaje inválido" });
    const conv = await prisma.conversation.findUnique({ where: { reservationId } });
    if (!conv) return reply.code(404).send({ error: "NOT_FOUND", message: "Conversación no encontrada" });
    const msg = await prisma.message.create({ data: { conversationId: conv.id, senderId: req.authUser?.id || null, kind: body.data.kind, body: body.data.body, attachmentKey: body.data.attachmentKey, mime: body.data.mime } });
    return reply.code(201).send({ data: msg });
  });
}
