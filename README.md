# AdCoDe (Administración de Complejos Deportivos)

Monorepo para la plataforma AdCoDe v1.0 (pruebas/desarrollo y despliegue en Docker), alineado con el plan: **Node.js + TypeScript + Fastify + Prisma/PostgreSQL** (API), **React + Vite + TypeScript + Tailwind + React Router + TanStack Query + PWA** (Web), y paquete compartido `@adcode/shared` (enums, permisos, schemas, pricing).

- Dominio: `https://adcode.supernovatel.com` (producción)
- Infra existente: PostgreSQL (`postgres-principal` / `postgres-local`), MinIO, Nginx Proxy Manager

## Estructura
- `apps/api` (`@adcode/api`): API Fastify (`/api/v1`), Prisma schema/migraciones/seed
- `apps/web` (`@adcode/web`): SPA/PWA (Vite), runtime config `window.__APP_CONFIG__` via `public/env.js` + `docker-entrypoint.sh`
- `packages/shared` (`@adcode/shared`): contratos y utilidades compartidas
- `docker-compose.local.yml`: solo `api-adcode` y `web-adcode` (usa servicios existentes)
- `docker-compose.prod.yml`: `api-adcode`, `web-adcode`, `api-migrate`, `api-seed` (red externa)

## Requisitos
- Docker Desktop + red externa `red-desarrollo` y contenedor `postgres-local` (PostgreSQL 15) activos
- Node.js/npm (opcional para scripts locales fuera de contenedores)

## Inicio rápido local
1. Crear/ajustar `.env` desde `.env.example` (DB apunta a `postgres-local` por red Docker: `postgresql://postgres:postgres@postgres-local:5432/adcode?schema=public`).
2. Levantar: `docker compose -f docker-compose.local.yml up -d --build`
3. La API en dev ejecuta `prisma generate`, `migrate deploy` (best-effort) y `seed` (best-effort) al iniciar; para forzar: `docker compose -f docker-compose.local.yml exec api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` y `docker compose -f docker-compose.local.yml exec api npm run db:seed --workspace @adcode/api`
4. URLs: Web `http://localhost:4173`, API `http://localhost:4100/api/v1/health`

## Funcionalidad implementada (pruebas locales)
- **Auth:** email+contraseña (`/auth/login`, `/auth/set-password`, `/auth/change-password`), sesión/refresh/logout, `/auth/me`; Google OAuth pendiente (501 si no configurado). Invitado para vistas públicas/reserva.
- **Departamentos (Bolivia):** `Complex.department` (default `Santa Cruz`), filtro en API/web, modal de selección para cliente con recordatorio (`lastDepartment` en usuario + localStorage) y cambio en cualquier momento.
- **Tenants/Complejos/Escenarios/Usuarios:** CRUD y gestión por permisos/tenant. Complejo incluye `department` y `allowClientPayLater` (habilita reservas sin prepago Habitual/VIP por admin de complejo).
- **Usuarios/membresías:** `COMPLEX_ADMIN`/`SELLER` requieren complejo(s) asignado(s); tipo de cliente solo para rol `CLIENT`; teléfono/WhatsApp soportado.
- **Reservas:** creación con hold/pricing y anti-solape; reservas fijas recurrentes (`seriesId`, `/reservations/recurring`); sin prepago para Habitual/Preferencial si el complejo lo permite. Acciones staff: confirmar/rechazar pago, cancelar, marcar falta (`no-show`) con opción de cancelar futuras de la serie, cancelar serie.
- **Notificaciones in-app:** a cliente y admin/vendedor del complejo al crear reserva y al confirmar pago. Panel/home con grilla y badges de conteo; listado y marcar leídas (`/notifications`). WhatsApp se coordina externamente con teléfonos registrados (sin envío desde el sistema).
- **Otros:** chat/mensajes de reserva, ventas/inventario/reportes básicos, uploads stub (S3 real en prod).

## Cuentas demo (tras seed)
- Platform: `admin@supernovatel.com` / `Admin123!`
- Tenant demo: `admin.demo@adcode.test` / `User123!` (tenant `demo-sports`, complejo `central`)

## Pruebas sugeridas
1. Web `http://localhost:4173`: login, selección/cambio de departamento, ver complejos filtrados.
2. Admin → Complejos: crear/editar con departamento y “Permitir reservas sin prepago a Habitual/VIP”.
3. Admin → Usuarios: crear `COMPLEX_ADMIN`/`SELLER` con complejo obligatorio y teléfono; crear `CLIENT` con tipo Habitual/Preferencial.
4. `/c/:slug`: crear reserva normal y reserva fija semanal; como Habitual/Preferencial con complejo habilitado, probar sin prepago.
5. Admin → Reservas: confirmar/rechazar pago, cancelar, marcar falta (y cancelar serie futura). Ver badges/notificaciones in-app.
6. API: `GET /api/v1/health`, `GET /api/v1/complexes?department=Santa%20Cruz`, `GET /api/v1/notifications` (auth).

## Producción (resumen)
- `docker-compose.prod.yml` en red `${DOCKER_EXTERNAL_NETWORK:-red-interna}` con `postgres-principal`/`minio-principal` y NPM. `.env` en servidor (`~/app-server/proyectos/adcode`).
- Despliegue: `bash deploy.sh` (build/push, scp compose, `prisma migrate deploy`, up, healthcheck; seed opcional con `RUN_SEED_ON_DEPLOY=1`). Configurar SMTP/OAuth/S3 en `.env` de prod para pruebas de esos servicios.

## Documentación
- `API_REFERENCE.md`, `ARCHITECTURE.md`, `bitacora.md`


## Cambios recientes (2026-11-18)
- UI mobile-first con menú hamburguesa por rol, home con grid de gran vistas y sub-pestañas.
- Módulos de ventas/inventario/mantenimiento/historial con modales y carga de comprobantes.
- Roles y permisos refinados; tenant inactivo = solo lectura.
- Codificación UTF-8 corregida.
- Migraciones: `20261116230000_scenario_complex_hours_v3`, `20261118160000_maintenance_types`.
