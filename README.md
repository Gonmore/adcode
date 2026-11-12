# README - AdCoDe v1.0 (pruebas)

Plataforma monorepo dockerizada para administración de complejos deportivos (multi-tenant, PWA): tenants/complejos, usuarios/roles, escenarios/precios/disponibilidad, reservas con hold y confirmación de pago/chat, ventas/inventario básico y reportes.

## Stack
- **API**: Node.js 20, TypeScript, Fastify, Prisma, PostgreSQL
- **Web**: React + Vite + TypeScript, Tailwind, PWA
- **Shared**: `@adcode/shared` (enums, permisos, schemas zod, pricing)
- **Infra**: Docker Compose, Nginx, S3 compatible (MinIO en prod existente)

## Requisitos (desarrollo local)
- Docker Desktop + Docker Compose
- Red Docker externa `red-desarrollo` disponible
- PostgreSQL existente en contenedor `postgres-local` (postgres:15-alpine, host `5433->5432`) accesible desde `red-desarrollo`
- Node.js/npm opcional si vas a ejecutar comandos fuera de Docker

## Instrucciones paso a paso para iniciar pruebas en desarrollo

### 1) Preparar configuración
1. Copia variables de entorno:
   - `Copy-Item .env.example .env` (PowerShell) o crea `.env` manualmente.
2. Revisa/ajusta en `.env` (valores importantes para local con Docker Compose):
   - `DATABASE_URL=postgresql://postgres:postgres@postgres-local:5432/adcode?schema=public`
     - Usa `postgres-local:5432` cuando `api-adcode` corre dentro de Docker en la red `red-desarrollo`.
     - Si ejecutas API fuera de Docker, usa `localhost:5433`.
   - `DEV_LOGIN_ENABLED=true` (permite login de desarrollo desde la web, sin Google).
   - `PLATFORM_ADMIN_EMAIL=admin@supernovatel.com`
   - S3 vacío en local (uploads deshabilitados): `S3_ENDPOINT=`, `S3_ACCESS_KEY=`, `S3_SECRET_KEY=`.
3. Verifica red Docker:
   - `docker network ls` debe incluir `red-desarrollo`.

### 2) Preparar base de datos `adcode` en PostgreSQL local existente
> Ya existe `postgres-local` en tu entorno; no se levanta postgres desde este compose.

1. Crear base de datos (si no existe):
   - `docker exec -it postgres-local psql -U postgres -c "CREATE DATABASE adcode;"`
   - Si el usuario/contraseña difieren, ajusta `DATABASE_URL` en `.env`.
2. Aplicar migración inicial (si aún no está aplicada):
   - Opción A (recomendada, con Prisma CLI desde host, requiere Node/npm y deps o `npx`):
     - `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/adcode?schema=public"`
     - `npx --yes prisma@5.22.0 migrate deploy --schema apps/api/prisma/schema.prisma`
   - Opción B (SQL directo, ya incluido en repo):
     - `Get-Content apps/api/prisma/migrations/20261112150000_init/migration.sql | docker exec -i postgres-local psql -U postgres -d adcode`
     - (Opcional) marcar migración en `_prisma_migrations` si luego usarás `migrate deploy`.
3. Cargar datos demo (tenant/complejo/escenario/precios/kiosco/producto/stock):
   - Opción rápida (SQL demo, idempotente en la mayoría de inserts con `ON CONFLICT DO NOTHING`):
     - Ejecuta el bloque SQL de seed demo usado en la preparación del repo (ver `bitacora.md`, sección v1.0-test) o usa el que incluya tu entorno.
   - Opción Prisma seed (si hay dependencias instaladas en el entorno donde se ejecute):
     - `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/adcode?schema=public"`
     - `npm run db:seed` (o `npm run db:seed --workspace @adcode/api`)

### 3) Levantar la aplicación (API + Web)
1. Desde la raíz del repo:
   - `docker compose -f docker-compose.local.yml up --build`
2. Espera a que `api-adcode-dev` quede healthy y `web-adcode-dev` inicie.
3. Accesos:
   - API health: `http://localhost:4100/api/v1/health`
   - API raíz v1: `http://localhost:4100/api/v1`
   - Web (PWA dev): `http://localhost:4173`

> El comando de `api-adcode` intenta `npm install`, `prisma generate`, `migrate deploy` y `seed` al iniciar (con tolerancia a fallos de migrate/seed para no bloquear el arranque si la DB aún no está lista). Si la DB/migración no está lista, prepara la BD primero (paso 2).

### 4) Flujo de prueba recomendado (v1.0-test)
1. **Inicio/Web**
   - Abre `http://localhost:4173`.
   - Verifica estado API/Google/Dev login en la tarjeta principal.
2. **Login desarrollo**
   - Ingresa `admin@supernovatel.com` (platform admin) y pulsa "Login desarrollo".
   - Debe mostrarse sesión iniciada (`/auth/me`).
3. **Admin (resumen y tenants)**
   - Ir a `/admin`.
   - Verifica tarjetas de resumen (tenants, complejos, reservas, transacciones, ingresos/egresos).
   - Como platform admin, crea un tenant de prueba desde el formulario.
4. **Complejo demo público / reserva**
   - Ir a `/c/central` (seed demo).
   - Debe listar escenario "Cancha Fútbol 1" y menú/stock demo.
   - Crear una reserva seleccionando horario; el API devuelve código, estado (`PENDING_PAYMENT`), total y hold.
5. **Pruebas API directas (opcionales, Postman/curl navegador)**
   - `GET /api/v1/complexes`
   - `GET /api/v1/scenarios?slug=central`
   - `GET /api/v1/scenarios/:id/availability?from=...&to=...`
   - `POST /api/v1/reservations` (JSON `scenarioId,startAt,endAt,clientName`)
   - `POST /api/v1/reservations/:id/receipt-sent`
   - `POST /api/v1/reservations/:id/confirm-payment`
   - `GET /api/v1/reports/summary`
   - `GET /api/v1/reports/income-vs-expense?groupBy=day`
   - `GET /api/v1/sales/menu/central`, `GET /api/v1/inventory/stock?complexId=...`

### 5) Notas y limitaciones conocidas (v1.0-test)
- **Google OAuth completo**: pendiente (endpoints `/auth/google/start|callback` devuelven `501` si no está implementado/configurado). Para pruebas locales usar `POST /auth/dev-login` (habilitado por `DEV_LOGIN_ENABLED`).
- **UI avanzada**: la web incluye layout PWA/base y pantallas funcionales mínimas para pruebas (login dev, admin resumen/tenants, complejo demo + creación de reserva, menú). CRUDs completos y flujos visuales avanzados (chat completo, calendario avanzado, POS/inventario UI detallada, RBAC UI fino) quedan para siguientes iteraciones.
- **Dominio API**: implementadas bases operativas y endpoints clave (tenants/complejos/escenarios/reservas/reportes/ventas-inventario básicos/chat/usuarios/uploads stub). Reglas avanzadas completas (anti-solape por constraint DB aplicada, expiración automática por job dedicado, S3 presigned real, pagos parciales/QR compartido completo, FEFO transaccional completo, notificaciones push/email) requieren endurecimiento adicional.
- **Migraciones**: se incluye migración inicial SQL en `apps/api/prisma/migrations/20261112150000_init/migration.sql` y script manual en `apps/api/prisma/manual/001_constraints.sql` (aplicar según necesidad tras validar nombres/estado).
- **Seguridad**: secretos deben ir solo en `.env` (no versionado). Cambiar `JWT_*_SECRET` y credenciales reales antes de producción.

## Scripts útiles
- `npm run dev:api` / `npm run dev:web`
- `npm run build`
- `npm run prisma:generate`
- `npm run prisma:migrate:dev` / `npm run prisma:migrate:prod`
- `npm run db:seed`

## Documentación
- `ARCHITECTURE.md`: arquitectura, módulos, decisiones y despliegue.
- `API_REFERENCE.md`: referencia de endpoints v1 (estado actual).
- `bitacora.md`: cambios y pendientes por fecha.
- `PLAN.md`/documento de plan (si aplica): base funcional y roadmap.

## Producción (resumen)
- Infra existente: `postgres-principal`, `minio-principal`, Nginx Proxy Manager.
- App: `api-adcode` y `web-adcode` en `docker-compose.prod.yml` (red `${DOCKER_EXTERNAL_NETWORK:-red-interna}`), dominio `https://adcode.supernovatel.com`.
- Despliegue manual: `bash deploy.sh` (requiere Docker, acceso SSH/SCP y `.env` en servidor). Ver `ARCHITECTURE.md`.