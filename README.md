# README - AdCoDe v1.0 (pruebas)

Plataforma monorepo dockerizada para administraciÃ³n de complejos deportivos (multi-tenant, PWA): tenants/complejos, usuarios/roles, escenarios/precios/disponibilidad, reservas con hold y confirmaciÃ³n de pago/chat, ventas/inventario bÃ¡sico y reportes.

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

### 1) Preparar configuraciÃ³n
1. Copia variables de entorno:
   - `Copy-Item .env.example .env` (PowerShell) o crea `.env` manualmente.
2. Revisa/ajusta en `.env` (valores importantes para local con Docker Compose):
   - `DATABASE_URL=postgresql://postgres:postgres@postgres-local:5432/adcode?schema=public`
     - Usa `postgres-local:5432` cuando `api-adcode` corre dentro de Docker en la red `red-desarrollo`.
     - Si ejecutas API fuera de Docker, usa `localhost:5433`.
   - `PLATFORM_ADMIN_EMAIL=admin@supernovatel.com`
   - `DEFAULT_ADMIN_PASSWORD` / `DEFAULT_USER_PASSWORD` (passwords de seed/cuentas de prueba).
   - S3 vacÃ­o en local (uploads deshabilitados): `S3_ENDPOINT=`, `S3_ACCESS_KEY=`, `S3_SECRET_KEY=`.
3. Verifica red Docker:
   - `docker network ls` debe incluir `red-desarrollo`.

### 2) Preparar base de datos `adcode` en PostgreSQL local existente
> Ya existe `postgres-local` en tu entorno; no se levanta postgres desde este compose.

1. Crear base de datos (si no existe):
   - `docker exec -it postgres-local psql -U postgres -c "CREATE DATABASE adcode;"`
   - Si el usuario/contraseÃ±a difieren, ajusta `DATABASE_URL` en `.env`.
2. Aplicar migraciÃ³n inicial (si aÃºn no estÃ¡ aplicada):
   - OpciÃ³n A (recomendada, con Prisma CLI desde host, requiere Node/npm y deps o `npx`):
     - `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/adcode?schema=public"`
     - `npx --yes prisma@5.22.0 migrate deploy --schema apps/api/prisma/schema.prisma`
   - OpciÃ³n B (SQL directo, ya incluido en repo):
     - `Get-Content apps/api/prisma/migrations/20261112150000_init/migration.sql | docker exec -i postgres-local psql -U postgres -d adcode`
     - (Opcional) marcar migraciÃ³n en `_prisma_migrations` si luego usarÃ¡s `migrate deploy`.
3. Cargar datos demo (tenant/complejo/escenario/precios/kiosco/producto/stock):
   - OpciÃ³n rÃ¡pida (SQL demo, idempotente en la mayorÃ­a de inserts con `ON CONFLICT DO NOTHING`):
     - Ejecuta el bloque SQL de seed demo usado en la preparaciÃ³n del repo (ver `bitacora.md`, secciÃ³n v1.0-test) o usa el que incluya tu entorno.
   - OpciÃ³n Prisma seed (si hay dependencias instaladas en el entorno donde se ejecute):
     - `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/adcode?schema=public"`
     - `npm run db:seed` (o `npm run db:seed --workspace @adcode/api`)

### 3) Levantar la aplicaciÃ³n (API + Web)
1. Desde la raÃ­z del repo:
   - `docker compose -f docker-compose.local.yml up --build`
2. Espera a que `api-adcode-dev` quede healthy y `web-adcode-dev` inicie.
3. Accesos:
   - API health: `http://localhost:4100/api/v1/health`
   - API raÃ­z v1: `http://localhost:4100/api/v1`
   - Web (PWA dev): `http://localhost:4173`

> El comando de `api-adcode` intenta `npm install`, `prisma generate`, `migrate deploy` y `seed` al iniciar (con tolerancia a fallos de migrate/seed para no bloquear el arranque si la DB aÃºn no estÃ¡ lista). Si la DB/migraciÃ³n no estÃ¡ lista, prepara la BD primero (paso 2).

### 4) Flujo de prueba recomendado (v1.0-test)
1. **Inicio/Web**: http://localhost:4173. Estado API/auth (email+contraseña habilitado, Google pendiente si no configurado). Navegación invitado disponible.
2. **Login (email + contraseña)**: dmin@supernovatel.com / Admin123! (platform) · dmin.demo@adcode.test / User123! (tenant demo). Si una cuenta no tiene contraseña, usar "Primera vez / establecer contraseña" (/auth/set-password).
3. **Panel /admin (según rol)**: resumen y tenants según permisos. Platform admin crea tenants. Tenant/complex admin gestiona complejos, escenarios y usuarios/membresías de su tenant (crear/editar/eliminar) con iconos lineales de color (agregar verde, editar azul, eliminar rojo).
4. **Complejo demo /c/central**: ver escenarios/menú y crear reserva (guest); devuelve código, estado PENDING_PAYMENT, total y hold.
5. **API (opcional)**: POST /auth/login, GET /auth/me, GET /platform/my-tenants, GET /complexes/mine, CRUD complejos/escenarios/membresías, GET /reports/summary.

### 5) Notas y limitaciones conocidas (v1.0-test)
- **Autenticación**: email+contraseña operativa (/auth/login, /auth/set-password, /auth/change-password); /auth/dev-login removido. **Google OAuth** pendiente (/auth/google/* 501 si no configurado). Acceso invitado permitido para vistas públicas/reserva.
- **UI avanzada**: la web incluye layout PWA/base y pantallas funcionales mÃ­nimas para pruebas (login dev, admin resumen/tenants, complejo demo + creaciÃ³n de reserva, menÃº). CRUDs completos y flujos visuales avanzados (chat completo, calendario avanzado, POS/inventario UI detallada, RBAC UI fino) quedan para siguientes iteraciones.
- **Dominio API**: implementadas bases operativas y endpoints clave (tenants/complejos/escenarios/reservas/reportes/ventas-inventario bÃ¡sicos/chat/usuarios/uploads stub). Reglas avanzadas completas (anti-solape por constraint DB aplicada, expiraciÃ³n automÃ¡tica por job dedicado, S3 presigned real, pagos parciales/QR compartido completo, FEFO transaccional completo, notificaciones push/email) requieren endurecimiento adicional.
- **Migraciones**: se incluye migraciÃ³n inicial SQL en `apps/api/prisma/migrations/20261112150000_init/migration.sql` y script manual en `apps/api/prisma/manual/001_constraints.sql` (aplicar segÃºn necesidad tras validar nombres/estado).
- **Seguridad**: secretos deben ir solo en `.env` (no versionado). Cambiar `JWT_*_SECRET` y credenciales reales antes de producciÃ³n.

## Scripts Ãºtiles
- `npm run dev:api` / `npm run dev:web`
- `npm run build`
- `npm run prisma:generate`
- `npm run prisma:migrate:dev` / `npm run prisma:migrate:prod`
- `npm run db:seed`

## DocumentaciÃ³n
- `ARCHITECTURE.md`: arquitectura, mÃ³dulos, decisiones y despliegue.
- `API_REFERENCE.md`: referencia de endpoints v1 (estado actual).
- `bitacora.md`: cambios y pendientes por fecha.
- `PLAN.md`/documento de plan (si aplica): base funcional y roadmap.

## ProducciÃ³n (resumen)
- Infra existente: `postgres-principal`, `minio-principal`, Nginx Proxy Manager.
- App: `api-adcode` y `web-adcode` en `docker-compose.prod.yml` (red `${DOCKER_EXTERNAL_NETWORK:-red-interna}`), dominio `https://adcode.supernovatel.com`.
- Despliegue manual: `bash deploy.sh` (requiere Docker, acceso SSH/SCP y `.env` en servidor). Ver `ARCHITECTURE.md`.
