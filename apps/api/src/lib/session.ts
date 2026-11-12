import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { env, cookieSecure } from "./env.js";
import { prisma } from "./prisma.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

function parseTtlMs(ttl: string, fallbackMs: number) {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mult;
}

export const ACCESS_TTL_MS = parseTtlMs(env.JWT_ACCESS_TTL, 15 * 60 * 1000);
export const REFRESH_TTL_MS = env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
export const ACCESS_COOKIE = "adcode_access";
export const REFRESH_COOKIE = "adcode_refresh";

export type AccessPayload = { sub: string; email: string; sid?: string };

export async function signAccessToken(payload: AccessPayload) {
  const exp = Math.floor((Date.now() + ACCESS_TTL_MS) / 1000);
  return await new SignJWT({ email: payload.email, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(accessSecret);
}

export async function signRefreshToken(payload: { sub: string; jti: string }) {
  const exp = Math.floor((Date.now() + REFRESH_TTL_MS) / 1000);
  return await new SignJWT({ jti: payload.jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret);
    if (!payload.sub) return null;
    return { sub: String(payload.sub), email: String(payload.email || ""), sid: payload.sid ? String(payload.sid) : undefined };
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<{ sub: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret);
    if (!payload.sub || !payload.jti) return null;
    return { sub: String(payload.sub), jti: String(payload.jti) };
  } catch {
    return null;
  }
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function cookieOptions(maxAgeMs: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function issueSession(reply: FastifyReply, userId: string, email: string, req?: FastifyRequest) {
  const jti = crypto.randomUUID();
  const refreshToken = await signRefreshToken({ sub: userId, jti });
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: req?.headers["user-agent"]?.toString(),
      ip: req?.ip,
    },
  });
  const accessToken = await signAccessToken({ sub: userId, email, sid: jti });
  reply.setCookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_MS));
  reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TTL_MS));
  return { accessToken };
}

export async function clearSession(reply: FastifyReply, req: FastifyRequest) {
  const refresh = (req.cookies as any)?.[REFRESH_COOKIE] as string | undefined;
  if (refresh) {
    const parsed = await verifyRefreshToken(refresh);
    if (parsed) {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: hashToken(refresh), revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {});
    }
  }
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
}

export async function getAuthUserFromRequest(req: FastifyRequest) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
  const token = bearer || ((req.cookies as any)?.[ACCESS_COOKIE] as string | undefined);
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  if (!payload?.sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { memberships: { select: { tenantId: true, role: true, complexIds: true } } },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    memberships: user.memberships,
  };
}
