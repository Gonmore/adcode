import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, googleAuthEnabled, devLoginEnabled } from "../../../lib/env.js";
import { prisma } from "../../../lib/prisma.js";
import { clearSession, getAuthUserFromRequest, issueSession, REFRESH_COOKIE, hashToken, verifyRefreshToken } from "../../../lib/session.js";

const devLoginSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.get("/config", async () => ({
    googleAuthEnabled,
    devLoginEnabled,
    platformAdminEmail: env.PLATFORM_ADMIN_EMAIL,
  }));

  app.get("/google/start", async (_req, reply) => {
    if (!googleAuthEnabled) {
      return reply.code(501).send({
        error: "GOOGLE_AUTH_NOT_CONFIGURED",
        message: "Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI",
      });
    }
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Flujo OAuth Google pendiente; usa /auth/dev-login en desarrollo" });
  });

  app.get("/google/callback", async (_req, reply) => {
    if (!googleAuthEnabled) {
      return reply.code(501).send({ error: "GOOGLE_AUTH_NOT_CONFIGURED", message: "Google OAuth no configurado" });
    }
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Callback OAuth Google pendiente" });
  });

  app.post("/dev-login", async (req, reply) => {
    if (!devLoginEnabled) return reply.code(403).send({ error: "FORBIDDEN", message: "Login de desarrollo deshabilitado" });
    const parsed = devLoginSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Datos inválidos" });
    const { email, name } = parsed.data;
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: name || undefined, isActive: true },
      create: { email, name: name || email.split("@")[0], isActive: true },
    });
    await issueSession(reply, user.id, user.email, req);
    const authUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { memberships: { select: { tenantId: true, role: true, complexIds: true } } },
    });
    return { ok: true, user: { id: user.id, email: user.email, name: user.name, memberships: authUser?.memberships || [] } };
  });

  app.get("/me", async (req, reply) => {
    const user = req.authUser || (await getAuthUserFromRequest(req));
    if (!user) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión no iniciada" });
    const isPlatformAdmin =
      user.email.toLowerCase() === env.PLATFORM_ADMIN_EMAIL.toLowerCase() ||
      user.memberships.some((m) => m.role === "PLATFORM_ADMIN");
    return { user: { ...user, isPlatformAdmin } };
  });

  app.post("/refresh", async (req, reply) => {
    const token = (req.cookies as any)?.[REFRESH_COOKIE] as string | undefined;
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Refresh token ausente" });
    const parsed = await verifyRefreshToken(token);
    if (!parsed) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Refresh token inválido" });
    const session = await prisma.refreshSession.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!session) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión expirada o revocada" });
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Usuario no válido" });
    await prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }).catch(() => {});
    await issueSession(reply, user.id, user.email, req);
    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    await clearSession(reply, req);
    return reply.send({ ok: true });
  });
}