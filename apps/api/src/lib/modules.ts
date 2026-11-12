import type { AppModule } from "@adcode/shared";
import { MODULE_DEPENDENCIES } from "@adcode/shared";
import { prisma } from "./prisma.js";

export async function isModuleActive(tenantId: string, module: AppModule, complexId?: string, at = new Date()): Promise<boolean> {
  if (module === "AUTH" || module === "REPORTS") return true;
  try {
    const subs = await prisma.moduleSubscription.findMany({
      where: {
        tenantId,
        module,
        startsAt: { lte: at },
        endsAt: { gte: at },
        OR: complexId ? [{ complexId: null }, { complexId }] : [{ complexId: null }],
      },
      orderBy: [{ complexId: "desc" }, { endsAt: "desc" }],
    });
    if (!subs.length) return false;
    const deps = MODULE_DEPENDENCIES[module] || [];
    for (const dep of deps) {
      const ok = await isModuleActive(tenantId, dep, complexId, at);
      if (!ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function requireActiveModule(tenantId: string, module: AppModule, complexId?: string) {
  const ok = await isModuleActive(tenantId, module, complexId);
  if (!ok) {
    const err: any = new Error(`Módulo ${module} no activo o vencido`);
    err.statusCode = 403;
    err.code = "MODULE_INACTIVE";
    throw err;
  }
}
