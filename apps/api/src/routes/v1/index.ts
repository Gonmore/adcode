import type { FastifyInstance } from "fastify";
import authRoutes from "./auth/index.js";
import platformRoutes from "./platform/index.js";
import complexesRoutes from "./complexes/index.js";
import scenariosRoutes from "./scenarios/index.js";
import reservationsRoutes from "./reservations/index.js";
import salesRoutes from "./sales/index.js";
import inventoryRoutes from "./inventory/index.js";
import reportsRoutes from "./reports/index.js";
import uploadsRoutes from "./uploads/index.js";
import usersRoutes from "./users/index.js";
import chatRoutes from "./chat/index.js";
import notificationsRoutes from "./notifications/index.js";
import maintenancesRoutes from "./maintenances/index.js";

export default async function v1Routes(app: FastifyInstance) {
  app.get("/", async () => {
    return {
      name: "AdCoDe API",
      version: process.env.APP_VERSION || "dev",
      docs: "/api/v1/docs",
    };
  });

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(platformRoutes, { prefix: "/platform" });
  await app.register(complexesRoutes, { prefix: "/complexes" });
  await app.register(scenariosRoutes, { prefix: "/scenarios" });
  await app.register(reservationsRoutes, { prefix: "/reservations" });
  await app.register(salesRoutes, { prefix: "/sales" });
  await app.register(inventoryRoutes, { prefix: "/inventory" });
  await app.register(reportsRoutes, { prefix: "/reports" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(chatRoutes, { prefix: "/chat" });
  await app.register(notificationsRoutes, { prefix: "/notifications" });
  await app.register(maintenancesRoutes, { prefix: "/maintenances" });

  app.get("/tenants", async (_req, reply) => reply.redirect("/api/v1/platform/tenants"));
}
