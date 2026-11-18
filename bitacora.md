# Bitácora - AdCoDe

Registro de cambios, decisiones y pendientes del proyecto.

## 2026-11-12 - v1.0-test (base funcional para pruebas)

### Cambios
- **Infra local/prod alineada a servicios existentes**:
  - `docker-compose.local.yml`: solo `api-adcode` y `web-adcode` en red `red-desarrollo`; eliminado postgres/minio locales. Usa PostgreSQL existente `postgres-local` (host `5433->5432`).
  - `.env.example`/README: `DATABASE_URL` para `postgres-local`/localhost, S3 opcional en local, `DEV_LOGIN_ENABLED`.
  - `ARCHITECTURE.md` y despliegue actualizados para prod con `postgres-principal`, `minio-principal`, Nginx Proxy Manager.
- **API (v1 base operativa)**:
  - `src/lib/env.ts`, `src/lib/prisma.ts`, `src/lib/session.ts`, `src/lib/auth.ts`, `src/lib/modules.ts`.
  - Auth/sesión: `/auth/config`, `/auth/dev-login`, `/auth/me`, `/auth/refresh`, `/auth/logout` (cookies access/refresh); stubs OAuth Google.
  - Rutas v1 modulares: `/platform` (tenants + suscripciones), `/complexes`, `/scenarios` (listado + disponibilidad básica), `/reservations` (crear/consultar/receipt-sent/confirm/reject con hold y pricing), `/sales` (kioscos/productos/menu/orders), `/inventory` (warehouses/stock), `/reports` (summary + income-vs-expense), `/users`, `/chat`, `/uploads` (status/presign stub).
  - Seed y datos demo: tenant `demo-sports`, complejo `central`, escenario, precios, kiosco/producto/stock, memberships/tiers.
- **Prisma/BD**:
  - Schema ajustado (`ClientTier` único por tenant+tipo).
  - Migración inicial SQL: `apps/api/prisma/migrations/20261112150000_init/migration.sql`.
  - SQL manual recomendado: `apps/api/prisma/manual/001_constraints.sql`.
  - En entorno local existente se creó DB `adcode`, se aplicó migración inicial y se cargó seed demo.
- **Web (PWA base para pruebas)**:
  - Layout responsive con navbar/footer/tema, assets de marca.
  - Login desarrollo (`/auth/dev-login`), sesión `/auth/me`, logout.
  - Home con estado API/auth, Admin con resumen/reportes y creación de tenant (platform admin), vista `/c/:slug` con escenarios/menú y creación de reserva básica.
  - `apiFetch` ajustado para FormData/204.
- **Documentación**:
  - `README.md` reescrito con pasos detallados para pruebas en desarrollo.
  - `API_REFERENCE.md`, `ARCHITECTURE.md`, `bitacora.md` actualizados al estado v1.0-test.

### Estado v1.0-test (listo para pruebas)
- Flujo base demostrable: levantar app en Docker local (usando `postgres-local` existente), login dev, ver admin/resumen, crear tenant (platform admin), crear reserva demo en `/c/central`, consultar disponibilidad/menú/reportes/endpoints API.
- Pendiente para producción/feature-complete: OAuth Google PKCE completo, RBAC/guards estrictos en todos los endpoints, CRUD/UI completos de todos los módulos, chat/SSE y subida de comprobantes S3 end-to-end, anti-solape/capacidad transaccional y jobs de expiración/stock FEFO completos, notificaciones, pruebas automatizadas y hardening.


## 2026-11-12 - Inicialización del monorepo (scaffold)

### Contexto
- Se recibió plan para plataforma monorepo dockerizada (Node.js + React + PostgreSQL + Prisma) para administración de complejos deportivos, PWA, multi-tenancy por módulos y despliegue a `adcode.supernovatel.com`.
- La raíz contenía assets de marca y archivos de referencia de otro monorepo que fueron adaptados.

### Cambios realizados
- **Monorepo**: `package.json` (npm workspaces), `tsconfig.base.json`.
- **`packages/shared` (`@adcode/shared`)**: enums, permisos por rol/dependencias de módulos, esquemas zod base, motor de precios base.
- **`apps/api` (`@adcode/api`)**: Fastify + plugins base, healthcheck, rutas v1 scaffold, esquema Prisma inicial amplio, seed idempotente de platform admin, scripts y Dockerfiles dev/prod.
- **`apps/web` (`@adcode/web`)**: Vite + React + TS + Tailwind + Router + Query + PWA, `env.js` runtime, layout base, rutas iniciales, assets de marca, nginx interno y entrypoint de runtime config.
- **Infra/config/docs**: `docker-compose.local.yml` y `docker-compose.prod.yml` reescritos, `deploy.sh` adaptado, `.env.example`, `.gitignore`, `.dockerignore`, `ARCHITECTURE.md`, `API_REFERENCE.md`.

### Decisiones
- Monorepo npm workspaces con contratos/lógica compartida en `@adcode/shared`.
- Un solo frontend PWA; rutas de complejo por `/c/:slug`.
- Reutilización de servicios existentes (local: `postgres-local`; prod: `postgres-principal`, `minio-principal`, `nginx-proxy-manager`).
- S3 por URLs prefirmadas cuando esté configurado; dinero `Decimal(12,2)` y tiempos UTC (timezone por complejo).

### Pendientes / próximos pasos
1. Configurar `.env` contra PostgreSQL existente, crear DB/usuario `adcode` si corresponde y generar/aplicar migraciones Prisma iniciales.
2. Agregar migraciones SQL avanzadas: `btree_gist` + exclusion constraint anti-solape e índices de disponibilidad/hold.
3. Implementar autenticación Google (OAuth2 + PKCE backend), sesiones/refresh, `/auth/me`, RBAC efectivo y guardas de módulo por vigencia/auditoría.
4. CRUDs reales: tenants/suscripciones, complejos/pagos/QR, staff/clientes/niveles, escenarios/precios/mantenimientos.
5. Flujo de reservas completo: disponibilidad, hold 15 min, modal QR, chat SSE, comprobantes S3, confirmación/rechazo, VIP/deuda.
6. Ventas e inventario: kioscos, menú digital, POS, almacenes/lotes FEFO, movimientos/proveedores/alertas y reservas de stock.
7. Reportes desde `FinancialTransaction`, exportes y dashboards; notificaciones.
8. Pruebas (unit/integración/E2E/PWA), endurecimiento de seguridad, iconos PWA finales y validación de despliegue real.
## 2026-11-13 - Departamentos, usuarios, notificaciones in-app y reservas (local)
### Cambios
- **Schema/migraciones (local aplicadas y registradas):** `Complex.department` (default `Santa Cruz`), `User.lastDepartment`, `Complex.allowClientPayLater`, modelo `Notification`. Migraciones: `20261113155000_add_department_fields`, `20261113162000_add_notifications_and_pay_later`. Seed demo actualizado (complejo con departamento Santa Cruz).
- **API:** complejos con `department`/`allowClientPayLater` y filtro `?department=`; `PATCH /auth/me/preferences` (lastDepartment); usuarios/membresías validan complejo obligatorio para `COMPLEX_ADMIN`/`SELLER`, tier solo `CLIENT`, teléfono/WhatsApp; notificaciones `/notifications` (listar/leer); reservas crean notificaciones in-app a cliente y staff al crear y al confirmar pago, `payLater` solo Habitual/Preferencial si el complejo lo habilita; endpoints `POST /reservations/:id/no-show`, `/reservations/:id/cancel`, `/reservations/series/:seriesId/cancel` y mejora de `/reservations/recurring` (notifica serie).
- **Web:** selección de departamento (modal) con recordatorio y cambio (`/auth/me/preferences` + localStorage), listado de complejos/escenarios filtrado por departamento; admin complejo con departamento y flag sin-prepago; formulario usuarios corrige asignación de complejos por rol y visibilidad de tipo cliente; home/panel con grilla y badges de notificaciones in-app.
- **Docs:** `API_REFERENCE.md` actualizado; `deploy.sh` compatible (usa `prisma migrate deploy`).

### Notas
- Migraciones aplicadas en `postgres-local` (localhost:5433, db `adcode`) y registradas en `_prisma_migrations`. Prisma Client regenerado en `api-adcode-dev`.
- WhatsApp no se envía desde el sistema (se usa teléfono registrado para coordinación externa). Notificaciones: in-app. SMTP/OAuth/S3 se probarán/configurarán en producción según indicación.
- Pendiente validar en UI: regla exacta de “falta” (acción staff) y ajustes finos de UX; pruebas E2E y producción vía `deploy.sh`.


## 2026-11-18 - Ajustes de UI/roles, ventas, inventario, mantenimiento, historial

### Cambios principales
- **Roles y permisos**: platform admin crea/edita/desactiva tenants (con cuota de complejos y reinicio de contraseña del admin de tenant); tenant admin gestiona complejos/escenarios/admins; admin de complejo gestiona su complejo (reservas, productos, inventario, ventas, mantenimientos, vendedores); vendedor gestiona reservas/ventas. Tenant inactivo = solo lectura. Endpoints con guards `assertTenantActive` y helpers `isTenantAdmin`, `managedComplexIds`.
- **UI por rol (mobile-first)**: menú hamburguesa con opciones por rol, home con grid de gran vistas (Complejo, Ventas, Reportes, Usuarios, Complejos, Historial, Tenants) con emojis y colores, sub-pestañas horizontales dentro de cada vista.
- **Escenarios**: formulario con campos condicionales por formato (por hora día/noche, por persona adulto/niño con edad, mixto, bloque fijo con tipo y precio), horarios entre semana y fin de semana configurables en el complejo.
- **Reservas**: calendario semanal (horas vertical, días horizontal), reservas pasadas visibles pero sin crear en slots pasados, estados en español, modal de reserva con calendario/+ por slot, estado seleccionable, cliente buscable o nuevo, cantidad de horas.
- **Ventas**: menú digital con QR, grilla de productos (foto, nombre, precio verde) con carrito (+/-), modal de confirmación (efectivo/QR/mixto, cálculo de cambio, carga de comprobante), historial.
- **Inventario**: almacenes/ubicaciones con modales de creación e importación CSV, stock por presentación con −/#/+, bajas (vencimiento/daño/otro), movimientos entre almacenes multi-línea, movimientos recientes con usuario.
- **Mantenimiento**: tipos único/semanal/mensual/trimestral/semestral/anual con generación de ocurrencias.
- **Historial**: lista de ingresos (ventas y reservas) con recibo (WhatsApp/PDF) y anulación (ventas mismo día; reservas antes de finalizar).
- **Perfil de usuario**: modal "Editar perfil" (nombre, foto, contraseña) y reinicio de contraseña por platform admin.
- **Codificación**: corregido mojibake (UTF-8 español latino) en web y API.
- **Modales**: backdrop opaco/desenfocado, indicadores en inputs.

### Pendientes
- Envío de correo/link de activación y cambio obligatorio de contraseña en primer uso.
- Carga de foto por S3 presign en el modal de perfil/producto (hoy URL + upload local).
- Pruebas automatizadas y validación SMTP/Google OAuth/S3 en producción.
