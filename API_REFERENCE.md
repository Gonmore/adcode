# API_REFERENCE - AdCoDe (v1)

Base URL: `/api/v1` (mismo origen detrás de Nginx/proxy web en despliegue)

> Estado: scaffold funcional inicial. Endpoints de dominio están parcialmente implementados como placeholders y evolucionarán por fases.

## Convenciones
- Formato: JSON (`application/json`) salvo uploads/SSE.
- Autenticación (plan): Access JWT Bearer + refresh token en cookie httpOnly (rotación).
- Multi-tenancy: operaciones de negocio scoped por tenant/complejo según rol y membresía.
- Errores: `{ "error": "CODE", "message": "..." }` (puede incluir `warning`/`note` en placeholders).
- Fechas: ISO-8601 en UTC; cálculos de disponibilidad según timezone del complejo.

## Salud y metadata
### `GET /health`
Estado del servicio.

### `GET /`
Metadata básica de API.

## Autenticación (`/auth`)
- `GET /auth/config` - estado de configuración auth (`googleAuthEnabled`, `platformAdminEmail`)
- `GET /auth/google/start` - inicia OAuth2 (PKCE) *(501 si no configurado / pendiente)*
- `GET /auth/google/callback` - callback OAuth *(pendiente)*
- `GET /auth/me` - usuario autenticado, membresías, permisos *(pendiente, 401 actual)*
- `POST /auth/refresh` - rotación de refresh token *(pendiente)*
- `POST /auth/logout` - cierre de sesión *(stub OK)*

## Plataforma (`/platform`) - PLATFORM_ADMIN
- `GET /platform/tenants` - listar tenants (intenta leer BD; retorna warning si no migrada)
- `POST /platform/tenants` - crear tenant *(501 pendiente, validación/RBAC/auditoría)*
- `GET /tenants` - redirección compatibilidad a `/platform/tenants`

## Complejos (`/complexes`)
- `GET /complexes?tenantId=&slug=` - listar complejos
- `GET /complexes/:id` - detalle de complejo
- Endpoints previstos: CRUD, payment settings/QRs, etc.

## Escenarios (`/scenarios`)
- `GET /scenarios?complexId=` - listar escenarios
- `GET /scenarios/:id/availability` - disponibilidad *(501 pendiente)*

## Reservas (`/reservations`)
- `GET /reservations?complexId=&scenarioId=&status=` - listar reservas
- `POST /reservations` - crear reserva/hold *(501 pendiente)*
- Endpoints previstos: confirmación, VIP, comprobantes, chat, pagos

## Ventas (`/sales`)
- `GET /sales/kiosks?complexId=` - listar kioscos
- `GET /sales/products` *(placeholder)*
- `GET /sales/orders` *(placeholder)*

## Inventario (`/inventory`)
- `GET /inventory/warehouses?complexId=` - listar almacenes
- `GET /inventory/stock` *(placeholder)*

## Reportes (`/reports`) - núcleo
- `GET /reports/summary` - contadores básicos (tenants/complejos/reservas/transacciones) si BD disponible
- `GET /reports/income-vs-expense` *(501 pendiente)*

## Uploads / S3 (previsto)
- `POST /uploads/presign` - URL firmada PUT (requiere S3 configurado; en local puede estar deshabilitado)
- `GET /uploads/presign-get?key=` - URL firmada de lectura
- En desarrollo local actual no se levanta MinIO por docker-compose; usar S3 existente o dejar deshabilitado.

## Notas de implementación
- El backend debe ser la autoridad de precios, disponibilidad, permisos y stock.
- Toda acción sensible debe registrar `AuditLog`.
- Validaciones de entrada con zod (compartido en `@adcode/shared` cuando aplique).
- Rutas pueden responder `warning: "Database not ready or not migrated"` mientras no existan migraciones/BD accesible.
