import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { env, googleAuthEnabled } from "../../../lib/env.js";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import { clearSession, getAuthUserFromRequest, issueSession, REFRESH_COOKIE, hashToken, verifyRefreshToken } from "../../../lib/session.js";
import { isPlatformAdmin, requireAuth } from "../../../lib/auth.js";

const DEPARTMENTS = ["La Paz","Cochabamba","Santa Cruz","Oruro","Potosí","Chuquisaca","Tarija","Beni","Pando"] as const;

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
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, avatarUrl: u.avatarUrl, lastDepartment: u.lastDepartment || null, memberships, isPlatformAdmin: platformAdmin, hasPassword: Boolean(u.passwordHash), hasGoogle: Boolean(u.googleSub) };
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
    const body = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(6) }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const auth = req.authUser || await getAuthUserFromRequest(req);
    if (!auth) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sesión no iniciada" });
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) return reply.code(404).send({ error: "NOT_FOUND", message: "Usuario no encontrado" });
    if (user.googleSub) {
      return reply.code(403).send({ error: "OAUTH_ACCOUNT", message: "Esta cuenta usa inicio de sesión con Google. El cambio de contraseña no está disponible." });
    }
    if (user.passwordHash) {
      if (!body.data.currentPassword) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Contraseña actual requerida" });
      const ok = await verifyPassword(body.data.currentPassword, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Contraseña actual incorrecta" });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.data.newPassword) } });
    return { ok: true };
  });

  app.patch("/me", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({
      name: z.string().min(1).max(120).optional().nullable(),
      avatarUrl: z.string().max(500).optional().nullable(),
    }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    const data: any = {};
    if (body.data.name !== undefined) data.name = body.data.name || null;
    if (body.data.avatarUrl !== undefined) data.avatarUrl = body.data.avatarUrl || null;
    await prisma.user.update({ where: { id: req.authUser!.id }, data });
    const full = await loadUserWithMemberships(req.authUser!.id);
    return { user: shapeUser(full) };
  });

  app.get("/google/start", async (req, reply) => {
    if (!googleAuthEnabled) return reply.code(501).send({ error: "GOOGLE_AUTH_NOT_CONFIGURED", message: "Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI" });
    const state = crypto.randomUUID();
    reply.setCookie("oauth_state", state, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: 600 });
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: env.GOOGLE_REDIRECT_URI!,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });
    return reply.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  });

  app.get("/google/callback", async (req, reply) => {
    if (!googleAuthEnabled) return reply.code(501).send({ error: "GOOGLE_AUTH_NOT_CONFIGURED", message: "Google OAuth no configurado" });
    const { code, state } = (req.query || {}) as { code?: string; state?: string };
    const cookieState = (req.cookies as any)?.oauth_state;
    if (!code || !state || !cookieState || state !== cookieState) {
      return reply.code(400).send({ error: "INVALID_STATE", message: "Estado OAuth inválido" });
    }
    reply.clearCookie("oauth_state", { path: "/" });
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: env.GOOGLE_REDIRECT_URI!,
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokens: any = await tokenRes.json();
      if (!tokens.id_token) return reply.code(400).send({ error: "TOKEN_ERROR", message: "No se obtuvo id_token" });
      // decode id_token (base64url payload)
      const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
      if (!payload.email || !payload.email_verified) return reply.code(400).send({ error: "EMAIL_NOT_VERIFIED", message: "Email no verificado" });
      const email = String(payload.email).toLowerCase();
      const googleSub = String(payload.sub);
      let user = await prisma.user.findFirst({ where: { OR: [{ googleSub }, { email }] } });
      if (!user) {
        user = await prisma.user.create({ data: { email, name: payload.name || email, isActive: true, googleSub, avatarUrl: payload.picture || null } });
      } else {
        await prisma.user.update({ where: { id: user.id }, data: { googleSub, name: user.name || payload.name || email, avatarUrl: user.avatarUrl || payload.picture || null, isActive: true } });
      }
      await issueSession(reply, user.id, user.email, req);
      const full = await loadUserWithMemberships(user.id);
      const frontendUrl = (env.APP_URL || "http://localhost:4173").replace(/\/$/, "");
      return reply.redirect(frontendUrl + "/?google=ok");
    } catch (e: any) {
      return reply.code(500).send({ error: "OAUTH_ERROR", message: e?.message || "Error en OAuth Google" });
    }
  });

  app.get("/me", async (req) => {
    const auth = req.authUser || (await getAuthUserFromRequest(req));
    if (!auth) return { user: null };
    const full = await loadUserWithMemberships(auth.id);
    if (!full || !full.isActive) return { user: null };
    return { user: shapeUser(full) };
  });

  // Onboarding: estado de configuración inicial del tenant del usuario (complejo, escenario, almacén, producto, stock)
  app.get("/onboarding", async (req, reply) => {
    const auth = req.authUser || (await getAuthUserFromRequest(req));
    if (!auth) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Autenticación requerida" });
    const q = (req.query || {}) as { tenantId?: string };
    let tenantId = q.tenantId || "";
    const adminMembership = auth.memberships.find((m) => m.role === "TENANT_ADMIN");
    if (!tenantId && adminMembership) tenantId = adminMembership.tenantId;
    if (!tenantId) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "tenantId requerido" });
    }
    const membership = auth.memberships.find((m) => m.tenantId === tenantId);
    if (!membership && !isPlatformAdmin(auth)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Sin permisos sobre este tenant" });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, status: true, maxComplexes: true } });
    if (!tenant) return reply.code(404).send({ error: "NOT_FOUND", message: "Tenant no encontrado" });

    const complexes = await prisma.complex.findMany({ where: { tenantId }, select: { id: true, name: true, slug: true } });
    const complexIds = complexes.map((c) => c.id);
    const scenarios = complexIds.length ? await prisma.scenario.findMany({ where: { complexId: { in: complexIds } }, select: { id: true, complexId: true, name: true } }) : [];
    const warehouses = complexIds.length ? await prisma.warehouse.findMany({ where: { complexId: { in: complexIds } }, include: { locations: true } }) : [];
    const products = complexIds.length ? await prisma.product.findMany({ where: { complexId: { in: complexIds } }, select: { id: true, name: true, complexId: true } }) : [];
    const stockLots = complexIds.length ? await prisma.stockLot.findMany({ where: { warehouse: { complexId: { in: complexIds } }, qty: { gt: 0 } }, select: { id: true, qty: true } }) : [];
    const totalStock = stockLots.reduce((s, l) => s + Number(l.qty || 0), 0);

    const items = {
      complex: { ok: complexes.length > 0, count: complexes.length, max: tenant.maxComplexes, hint: "Crea al menos 1 complejo (cancha/instalación)" },
      scenario: { ok: scenarios.length > 0, count: scenarios.length, hint: "Crea al menos 1 escenario para alquilar" },
      warehouse: { ok: warehouses.length > 0, count: warehouses.length, hint: "Crea al menos 1 almacén" },
      location: { ok: warehouses.some((w) => (w as any).locations && (w as any).locations.length > 0) || false, count: 0, hint: "Agrega ubicaciones al almacén" },
      product: { ok: products.length > 0, count: products.length, hint: "Crea al menos 1 producto con su presentación" },
      stock: { ok: totalStock > 0, count: totalStock, hint: "Registra stock de los productos" },
    };

    return {
      data: {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
        complexes,
        completed: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.ok])),
        items,
        nextStep: !items.complex.ok ? "complex" : !items.scenario.ok ? "scenario" : !items.warehouse.ok ? "warehouse" : !items.product.ok ? "product" : !items.stock.ok ? "stock" : "done",
      },
    };
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

  app.patch("/me/preferences", async (req, reply) => {
    await requireAuth(req, reply); if (reply.sent) return;
    const body = z.object({ lastDepartment: z.enum(DEPARTMENTS).nullable().optional() }).safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Datos inválidos" });
    await prisma.user.update({ where: { id: req.authUser!.id }, data: { lastDepartment: body.data.lastDepartment ?? null } });
    const full = await loadUserWithMemberships(req.authUser!.id);
    return { user: shapeUser(full) };
  });

  app.post("/logout", async (req, reply) => {
    await clearSession(reply, req);
    return reply.send({ ok: true });
  });
}


