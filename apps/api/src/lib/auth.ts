import type { FastifyReply, FastifyRequest } from "fastify";
import { hasPermission, type Permission, type Role } from "@adcode/shared";
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

export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) await attachAuthUser(req);
    const user = req.authUser;
    if (!user) return reply.code(401).send({ error: "UNAUTHORIZED", message: "Autenticación requerida" });
    const ok = user.memberships.some((m) => m.role === "PLATFORM_ADMIN" || hasPermission(m.role, permission));
    if (!ok) return reply.code(403).send({ error: "FORBIDDEN", message: "Permisos insuficientes" });
  };
}

export function isPlatformAdmin(user?: AuthUser | null) {
  if (!user) return false;
  // Platform admin is recognized by configured email in seed; also allow membership-less global admin flag via special tenantless handling later.
  // For v1 scaffold, treat explicit PLATFORM_ADMIN membership or seeded platform admin user presence as admin in route checks where needed.
  return user.memberships.some((m) => m.role === "PLATFORM_ADMIN");
}
