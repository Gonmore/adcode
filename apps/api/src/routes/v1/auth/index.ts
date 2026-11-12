import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, googleAuthEnabled } from "../../../lib/env.js";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import { clearSession, getAuthUserFromRequest, issueSession, REFRESH_COOKIE, hashToken, verifyRefreshToken } from "../../../lib/session.js";
import { isPlatformAdmin } from "../../../lib/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const setPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

async function loadUserWithMemberships(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { tenant: { select: { id: true, name: true, slug: true } }, } } },
  });
}

function shapeUser(u: any) {
  const memberships = (u.memberships || []).map((m: any) => ({
    id: m.id,
    tenantId: m.tenantId,
    role: m.role,
    complexIds: m.complexIds || [],
    clientTier: m.clientTier,
    tenant: m.tenant ? { id: m.tenant.id, name: m.tenant.name, slug: m.tenant.slug } : undefined,
  }));
  const platformAdmin = u.email?.toLowerCase() === env.PLATFORM_ADMIN_EMAIL.toLowerCase() || memberships.some((m: any) => m.role === "PLATFORM_ADMIN");
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, memberships, isPlatformAdmin: platformAdmin, hasPassword: Boolean(u.passwordHash) };
}

export default async function authRoutes(app: FastifyInstance) {
  app.get("/config", async () => ({
    googleAuthEnabled,
    passwordAuthEnabled: true,
    guestEnabled: true,
    platformAdminEmail: env.PLATFORM_ADMIN_EMAIL,
  }));

  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Email y contraseña son requeridos" });
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    if (!user || !user.isActive) return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Credenciales inválidas" });
    if (!user.passwordHash) {
      return reply.code(409).send({ error: "PASSWORD_NOT_SET", message: "Debes establecer una contraseña para esta cuenta", requiresPasswordSetup: true, email: user.email });
    }
    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Credenciales inválidas" });
    await issueSession(reply, user.id, user.email, req);
    const full = await loadUserWithMemberships(user.id);
    return { ok: true, user: shapeUser(full || user) };
  });

  app.post("/set-password", async (req, reply) => {
    const parsed = setPasswordSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Email y contraseña (mín. 6 caracteres) son requeridos" });
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return reply.code(404).send({ error: "NOT_FOUND", message: "Usuario no encontrado o inactivo" });
    if (user.passwordHash) return reply.code(409).send({ error: "PASSWORD_ALREADY_SET", message: "La cuenta ya tiene contraseña. Inicia sesión." });
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await issueSession(reply, user.id, user.email, req);
    const full = await loadUserWithMemberships(user.id);
    return { ok: true, user: shapeUser(full || user) };
  });

  app.post("/change-password", async (req, reply) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const auth = req.authUser || await getAuthUserFromRequest(req);
    if (!auth) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión no iniciada" });
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) return reply.code(404).send({ error: "NOT_FOUND", message: "Usuario no encontrado" });
    if (user.passwordHash) {
      const ok = await verifyPassword(body.data.currentPassword, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Contraseña actual incorrecta" });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.data.newPassword) } });
    return { ok: true };
  });

  app.get("/google/start", async (_req, reply) => {
    if (!googleAuthEnabled) return reply.code(501).send({ error: "GOOGLE_AUTH_NOT_CONFIGURED", message: "Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI" });
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Flujo OAuth Google pendiente de implementación completa" });
  });

  app.get("/google/callback", async (_req, reply) => {
    if (!googleAuthEnabled) return reply.code(501).send({ error: "GOOGLE_AUTH_NOT_CONFIGURED", message: "Google OAuth no configurado" });
    return reply.code(501).send({ error: "NOT_IMPLEMENTED", message: "Callback OAuth Google pendiente" });
  });

  app.get("/me", async (req, reply) => {
    const auth = req.authUser || (await getAuthUserFromRequest(req));
    if (!auth) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión no iniciada" });
    const full = await loadUserWithMemberships(auth.id);
    if (!full || !full.isActive) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión no iniciada" });
    return { user: shapeUser(full) };
  });

  app.post("/refresh", async (req, reply) => {
    const token = (req.cookies as any)?.[REFRESH_COOKIE] as string | undefined;
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Refresh token ausente" });
    const parsed = await verifyRefreshToken(token);
    if (!parsed) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Refresh token inválido" });
    const session = await prisma.refreshSession.findFirst({ where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } } });
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
