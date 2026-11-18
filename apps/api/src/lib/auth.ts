import type { FastifyReply, FastifyRequest } from "fastify";
import { hasPermission, type Permission, type Role } from "@adcode/shared";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { getAuthUserFromRequest } from "./session.js";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  memberships: Array<{ tenantId: string; role: Role; complexIds: string[] }>;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser | null;
  }
}

export async function attachAuthUser(req: FastifyRequest) {
  try {
    req.authUser = await getAuthUserFromRequest(req);
  } catch {
    req.authUser = null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.authUser) await attachAuthUser(req);
  if (!req.authUser) {
    return reply.code(401).send({ error: "UNAUTHORIZED", message: "Autenticación requerida" });
  }
}

export function isPlatformAdmin(user?: AuthUser | null) {
  if (!user) return false;
  if (user.email?.toLowerCase() === env.PLATFORM_ADMIN_EMAIL.toLowerCase()) return true;
  return user.memberships.some((m) => m.role === "PLATFORM_ADMIN");
}

export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) await attachAuthUser(req);
    const user = req.authUser;
    if (!user) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Autenticación requerida" });
    if (isPlatformAdmin(user)) return;
    const ok = user.memberships.some((m) => hasPermission(m.role, permission));
    if (!ok) return reply.code(403).send({ error: "FORBIDDEN", message: "Permisos insuficientes" });
  };
}

export function hasTenantRole(user: AuthUser | null | undefined, tenantId: string, roles: Role[]) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return user.memberships.some((m) => m.tenantId === tenantId && roles.includes(m.role));
}

export function isTenantAdmin(user: AuthUser | null | undefined, tenantId: string) {
  return hasTenantRole(user, tenantId, ["TENANT_ADMIN"]);
}

export function canManageTenant(user: AuthUser | null | undefined, tenantId: string) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return user.memberships.some((m) => m.tenantId === tenantId && ["TENANT_ADMIN", "COMPLEX_ADMIN"].includes(m.role));
}

export function canManageComplex(user: AuthUser | null | undefined, tenantId: string, complexId?: string) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return user.memberships.some((m) => {
    if (m.tenantId !== tenantId) return false;
    if (m.role === "TENANT_ADMIN") return true;
    if (m.role === "COMPLEX_ADMIN" || m.role === "SELLER") return !complexId || !m.complexIds?.length || m.complexIds.includes(complexId);
    return false;
  });
}

export function managedComplexIds(user: AuthUser | null | undefined, tenantId: string): string[] | null {
  if (!user) return [];
  if (isPlatformAdmin(user)) return null;
  const ms = user.memberships.filter((m) => m.tenantId === tenantId);
  if (ms.some((m) => m.role === "TENANT_ADMIN")) return null;
  const ids = new Set<string>();
  for (const m of ms) {
    if (m.role === "COMPLEX_ADMIN" || m.role === "SELLER") for (const id of m.complexIds || []) ids.add(id);
  }
  return Array.from(ids);
}

export async function assertTenantActive(tenantId: string, reply?: FastifyReply) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  const active = t?.status === "ACTIVE";
  if (!active && reply) {
    reply.code(403).send({ error: "TENANT_INACTIVE", message: "Tenant inactivo: solo lectura." });
  }
  return active;
}
