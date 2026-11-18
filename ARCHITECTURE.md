# ARCHITECTURE - AdCoDe

## Resumen
AdCoDe es un monorepo dockerizado para administración de complejos deportivos con acceso móvil y PWA. Incluye gestión multi-tenant, reservas de escenarios, ventas (kioscos), inventario, chat de confirmación de reservas/pagos y reportes financieros.

## Estructura del repositorio
- `apps/api`: API Node.js + TypeScript + Fastify + Prisma (PostgreSQL)
- `apps/web`: Frontend React + Vite + TypeScript (PWA, Tailwind)
- `packages/shared`: esquemas zod, enums, permisos y motor de precios compartidos
- `docker-compose.local.yml`: entorno local (postgres, minio, api, web)
- `docker-compose.prod.yml`: despliegue producción (api, web, tools migrate/seed)
- `deploy.sh`: build/push y despliegue remoto manual
- `.env.example`: variables de entorno (sin secretos reales)

## Stack técnico
- **Backend**: Node 20, Fastify, `@fastify/*` (cors/cookie/jwt/helmet/sensible/multipart/rate-limit/swagger), Prisma, PostgreSQL, zod
- **Frontend**: Vite, React 18, React Router, TanStack Query, Tailwind CSS, `vite-plugin-pwa`
- **Infra**: Docker/Docker Compose, Nginx (contenedor web y proxy externo), S3 compatible (MinIO)
- **Tiempo real**: SSE planificado para chat/notificaciones (proxy con `proxy_buffering off`)

## Multi-tenancy y seguridad
- Modelo multi-tenant por `tenantId` en tablas de negocio.
- Aislamiento previsto mediante filtros obligatorios en capa de acceso (extensión Prisma/servicios) y pruebas de aislamiento.
- RLS en PostgreSQL como endurecimiento posterior.
- Roles: `PLATFORM_ADMIN`, `TENANT_ADMIN`, `COMPLEX_ADMIN`, `SELLER`, `CLIENT`.
- Permisos centralizados en `packages/shared/src/permissions.ts` para reuso en API y UI.
- Auditoría (`AuditLog`) para acciones sensibles (módulos, pagos, stock, QR, etc.).

## Módulos y suscripciones
- Núcleo siempre activo: `AUTH`, `REPORTS`.
- Módulos con vigencia por tenant/complejo: `USERS`, `SCENARIOS`, `SALES`, `INVENTORY`.
- `INVENTORY` depende de `SALES`.
- Al vencer un módulo: solo lectura (histórico visible) y avisos previos de expiración.

## Autenticación (diseño)
- Google OAuth2 Authorization Code + PKCE con callback en backend (`/api/v1/auth/google/callback`).
- Access token corto (JWT, en memoria cliente) + refresh token rotativo (hash en BD, cookie httpOnly/Secure/SameSite=Lax).
- Web y API bajo mismo origen público vía proxy `/api` desde `web-adcode` (Nginx interno).
- Platform admin sembrado por `PLATFORM_ADMIN_EMAIL`.
- Staff pre-registrado por email y vinculado al primer login Google; invitados sin login ven disponibilidad/menú y deben autenticarse para reservar.

## Dominio principal (implementación progresiva)
- **Tenants/Complejos**: cuota de complejos, ajustes de pago, QR de cobro, zona horaria/moneda.
- **Usuarios/Clientes**: membresías por tenant, niveles `NORMAL|HABITUAL|PREFERENCIAL`, beneficios, deuda/ledger.
- **Escenarios**: grupos, formatos de alquiler, precios día/noche, disponibilidad, calendario por rol.
- **Reservas**: estados `PENDING_PAYMENT` → `PENDING_CONFIRMATION` → `CONFIRMED/REJECTED/EXPIRED...`, hold 15 min, VIP con deuda, código de reserva.
- **Pagos**: efectivo/transferencia/QR/QR compartido/crédito, comprobantes en S3, confirmación por staff.
- **Chat**: conversación por reserva con mensajes sistema/adjuntos (SSE planificado).
- **Ventas**: kioscos, productos, menú digital, pedidos, POS.
- **Inventario**: almacenes/ubicaciones, lotes FEFO, vencimientos, movimientos, reservas de stock, proveedores.
- **Reportes**: fuente única `FinancialTransaction` (ingresos/egresos) con cortes por periodo, fuente, escenario/grupo, método de pago.

## Base de datos
- Prisma schema en `apps/api/prisma/schema.prisma` con entidades base de plataforma, reservas, pagos, ventas e inventario.
- Dinero en `Decimal(12,2)`; fechas en UTC y cálculo de franjas según timezone del complejo.
- Reglas críticas a materializar en migraciones/servicios:
  - anti-solape de reservas exclusivas (`btree_gist` + exclusion constraint)
  - validación transaccional de capacidad para escenarios no exclusivos
  - expiración de hold (job + chequeo perezoso)
  - stock FEFO y reservas de stock asociadas al hold

## Archivos y almacenamiento (S3/MinIO)
- Bucket privado `adcode`.
- Subidas mediante URL prefirmada (PUT) y lecturas por URL prefirmada temporal.
- Validación de MIME/tamaño en backend (`UPLOAD_ALLOWED_MIME`, `UPLOAD_MAX_MB`).
- En producción: `S3_ENDPOINT` interno y `S3_PUBLIC_ENDPOINT=https://s3.supernovatel.com`; configurar CORS del bucket para `https://adcode.supernovatel.com`.

## Frontend, marca y PWA
- Layout común: navbar (hamburguesa izquierda, logo centro/home, avatar derecha con tema/perfil/cerrar sesión), footer "POWERED by" con logo Supernovatel según tema.
- Assets en `apps/web/public/brand` y `apps/web/public/icons`.
- `env.js` generado en runtime (contenedor) desde variables `PUBLIC_*` para evitar hardcode/rebuild por entorno.
- PWA con manifest y service worker (`vite-plugin-pwa`); estrategia de caché diferenciada para shell/catálogos vs datos sensibles.

## Docker y despliegue

### Local (`docker-compose.local.yml`)
- Servicios incluidos: solo `api-adcode` y `web-adcode` (no se levanta PostgreSQL ni MinIO en local).
- **PostgreSQL local existente**: usar el contenedor ya disponible `postgres-local` (postgres:15-alpine, expuesto en host `5433->5432`) dentro de la red Docker externa `red-desarrollo`.
  - Recomendado cuando API corre en contenedor: `DATABASE_URL=postgresql://<user>:<pass>@postgres-local:5432/<db>?schema=public`
  - Si se ejecuta fuera de Docker contra el host: `postgresql://<user>:<pass>@localhost:5433/<db>?schema=public`
- **MinIO local**: no requerido por ahora; subir archivos puede quedar deshabilitado hasta configurar un S3 disponible (`uploadsEnabled` depende de vars S3).
- API: instala deps, `prisma generate`, `prisma migrate deploy`, seed y levanta dev server en `4100`.
- Web: Vite dev server en `4173` con proxy `/api` a `api-adcode:4100`.
- Red externa: `red-desarrollo`.

### Producción (`docker-compose.prod.yml`)
- Servicios de app: `api-adcode` (4100), `web-adcode` (4173→80) y tools `api-migrate`, `api-seed` (profile `tools`).
- **Servicios ya existentes en producción (no se despliegan aquí)**: Nginx Proxy Manager (`nginx-proxy-manager`), PostgreSQL (`postgres-principal`), MinIO (`minio-principal`).
- Imágenes: `gonmore14/api-adcode:${APP_VERSION}` y `gonmore14/web-adcode:${APP_VERSION}`.
- Red externa: `${DOCKER_EXTERNAL_NETWORK:-red-interna}` (debe existir y permitir comunicación con DB/S3 según configuración).

### `deploy.sh`
- Construye y publica imágenes (API/Web), copia `docker-compose.prod.yml` al servidor, valida `.env`, red externa y compose.
- En servidor: `pull` → `api-migrate` → `up -d` → seed opcional (`RUN_SEED_ON_DEPLOY`) → prune → verificación de healthcheck.

### Nginx externo (producción)
- Dominio: `https://adcode.supernovatel.com` (TLS en Nginx Proxy Manager existente).
- Proxy hacia `http://192.168.10.57:4173` (contenedor `web-adcode`).
- Nginx interno del contenedor web sirve SPA y proxyea `/api/` a `api-adcode:4100` (SSE con buffering deshabilitado).
- Ajustar `client_max_body_size` según `UPLOAD_MAX_MB`. MinIO público existente: `https://s3.supernovatel.com` (configurar `S3_PUBLIC_ENDPOINT` y CORS del bucket).

## Variables de entorno
Ver `.env.example`. No hardcodear secretos; configurar credenciales Google, JWT, S3, SMTP/VAPID y DB por entorno.

## Estado de implementación (scaffold inicial)
Incluido en esta base:
- monorepo npm workspaces, paquetes `shared/api/web`
- configuración Docker local/prod, Dockerfiles, nginx web, deploy adaptado
- esquema Prisma inicial amplio y seed de usuario platform admin
- API Fastify con healthcheck y rutas placeholder v1
- Web React con layout base (navbar/footer/tema), rutas iniciales y configuración runtime `env.js`
- documentación inicial y bitácora

Pendiente (fases siguientes): implementación completa de auth Google, RBAC/módulos en runtime, CRUDs de dominio, motor de reservas/chat/pagos, inventario/ventas, reportes reales, notificaciones, tests y migraciones SQL avanzadas (exclusion constraints, etc.).

## Actualización 2026-11-13 (departamentos, notificaciones y reservas)
- **Departamentos:** `Complex.department` (catálogo Bolivia, default `Santa Cruz`) y `User.lastDepartment` (preferencia recordada/cambiable). API filtra por `?department=`; web muestra modal de selección y filtra complejos/escenarios.
- **Usuarios/membresías:** `COMPLEX_ADMIN`/`SELLER` requieren `complexIds`; `CLIENT` usa `clientTier` (Habitual/Preferencial/Normal). Teléfono/WhatsApp en `User.phone` (coordinación externa, sin envío desde sistema).
- **Reservas sin prepago:** `Complex.allowClientPayLater` (habilitado por admin de complejo). Clientes Habitual/Preferencial pueden reservar sin prepago cuando está habilitado; backend valida y registra transacción/crédito según flujo.
- **Reservas fijas (series):** `Reservation.seriesId`, creación recurrente semanal, cancelación de serie por cliente/staff y marcado de falta (`no-show`) por staff con opción de cancelar ocurrencias futuras.
- **Notificaciones in-app:** modelo `Notification`, endpoints `/notifications` (listar/contar no leídas, marcar leídas). Se generan al crear reserva y al confirmar pago para cliente y staff del complejo; UI con badges/listado en grilla.
- **Migraciones Prisma:** `20261113155000_add_department_fields`, `20261113162000_add_notifications_and_pay_later` (incluyen además `User.phone` y `Reservation.seriesId` si no existían en entorno). `deploy.sh` aplica `migrate deploy` en producción.


## Actualización 2026-11-18
- Nuevos endpoints: DELETE /inventory/products/:id; POST /platform/tenants/:id/reset-admin-password; PATCH /auth/me; POST /auth/change-password (currentPassword opcional para cuentas sin password); mantenimientos con tipos MONTHLY/QUARTERLY/SEMIANNUAL/ANNUAL y repeatCount; availability incluye clientName/people/note/membership en blocks.
- UI: gran vistas por rol con sub-pestañas, modales de venta/inventario/mantenimiento/reserva/historial.
