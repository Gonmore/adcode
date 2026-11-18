import type { AppModule, Role } from "./enums.js";

export type Permission =
  | "platform:tenants:manage"
  | "tenant:modules:manage"
  | "tenant:complexes:manage"
  | "tenant:staff:manage"
  | "tenant:clients:manage"
  | "complex:scenarios:manage"
  | "complex:reservations:manage"
  | "complex:reservations:create"
  | "complex:sales:manage"
  | "complex:inventory:manage"
  | "complex:reports:view"
  | "chat:participate";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PLATFORM_ADMIN: [
    "platform:tenants:manage",
    "tenant:modules:manage",
    "tenant:complexes:manage",
    "tenant:staff:manage",
    "tenant:clients:manage",
    "complex:scenarios:manage",
    "complex:reservations:manage",
    "complex:reservations:create",
    "complex:sales:manage",
    "complex:inventory:manage",
    "complex:reports:view",
    "chat:participate",
  ],
  TENANT_ADMIN: [
    "tenant:modules:manage",
    "tenant:complexes:manage",
    "tenant:staff:manage",
    "tenant:clients:manage",
    "complex:scenarios:manage",
    "complex:reservations:manage",
    "complex:reservations:create",
    "complex:sales:manage",
    "complex:inventory:manage",
    "complex:reports:view",
    "chat:participate",
  ],
  COMPLEX_ADMIN: [
    "tenant:staff:manage",
    "tenant:clients:manage",
    "complex:reservations:manage",
    "complex:reservations:create",
    "complex:sales:manage",
    "complex:inventory:manage",
    "complex:reports:view",
    "chat:participate",
  ],
  SELLER: [
    "complex:reservations:manage",
    "complex:reservations:create",
    "complex:sales:manage",
    "complex:reports:view",
    "chat:participate",
  ],
  CLIENT: ["complex:reservations:create", "chat:participate"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const MODULE_DEPENDENCIES: Partial<Record<AppModule, AppModule[]>> = {
  INVENTORY: ["SALES"],
};
