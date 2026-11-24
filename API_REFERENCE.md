## Usuarios/Membresías (`/users`)
- `GET /users/memberships?tenantId=&role=` - listar (auth + permisos tenant)
- `POST /users/memberships` - crear/asignar usuario+membresía `{ tenantId,email,name?,phone?,role,complexIds,clientTier }` (auth + permisos tenant). `COMPLEX_ADMIN`/`SELLER` requieren `complexIds`; `CLIENT` usa `clientTier` y no `complexIds`.
- `PATCH /users/memberships/:id` - actualizar rol/tier/complexIds/teléfono (auth + permisos tenant)
- `DELETE /users/memberships/:id` - eliminar membresía (auth + permisos tenant)

## Notificaciones in-app (`/notifications`) - auth requerida
- `GET /notifications?unread=1` - listar notificaciones del usuario y `unreadCount`
- `POST /notifications/read` - marcar leídas `{ ids?: string[], all?: boolean }`

## Reservas (`/reservations`)
- `GET /reservations` - listar (auth requerida, scoped por tenant salvo platform) filtros `complexId,scenarioId,status`
- `GET /reservations/:id` - detalle por id o código (incluye chat/pagos)
- `POST /reservations` - crear reserva/hold + pricing `{ scenarioId,startAt,endAt,people?,clientName?,isVip?,note?,payLater? }`. `payLater` permitido solo para clientes `HABITUAL`/`PREFERENCIAL` cuando el complejo tiene `allowClientPayLater=true` (habilitado por admin de complejo). Notifica in-app a cliente y staff del complejo al crear.
- `POST /reservations/recurring` - crear serie fija `{ scenarioId,startAt,endAt,weekday,weeks,clientName?,note?,payLater? }` (retorna `seriesId`, creadas/conflictos).
- `POST /reservations/:id/receipt-sent` - marcar comprobante enviado
- `POST /reservations/:id/confirm-payment` - confirmar pago (auth + gestión). Notifica in-app a cliente y staff.
- `POST /reservations/:id/reject-payment` - rechazar pago/liberar (auth + gestión)
- `POST /reservations/:id/no-show` - marcar falta (auth + gestión). `{ cancelSeries?: boolean, note?: string }` cancela futuras de la serie por defecto.
- `POST /reservations/:id/cancel` - cancelar reserva (cliente dueño o staff)
- `POST /reservations/series/:seriesId/cancel` - cancelar serie futura (cliente dueño o staff)

## Complejos (`/complexes`)
- Campos: `name,slug,department,timezone,currency,nightStart,nightEnd,allowClientPayLater`.
- `GET /complexes?tenantId=&slug=&department=` - públicos (incluye `departments` catálogo Bolivia). `GET /complexes/mine` auth.
- `POST /complexes`, `PATCH /complexes/:id`, `DELETE /complexes/:id` (auth + permisos tenant). `allowClientPayLater` habilita/deshabilita reservas sin prepago para Habitual/VIP.

## Auth (`/auth`)
- `POST /auth/login`, `POST /auth/set-password`, `POST /auth/change-password`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout`.
- `PATCH /auth/me/preferences` - guardar preferencias del usuario `{ lastDepartment }` (recordar/cambiar departamento).

## Notas
- Notificaciones: in-app (panel/home con badges y listado). WhatsApp se coordina externamente usando teléfonos registrados (sin envío desde el sistema).
- Reservas fijas: se mantienen hasta cancelación de serie por cliente o falta (`no-show`) marcada por admin/vendedor.
- Cuentas demo: `admin@supernovatel.com` / `Admin123!`, `admin.demo@adcode.test` / `User123!` (tras seed).


## Actualización 2026-11-18
- Nuevos endpoints: DELETE /inventory/products/:id; POST /platform/tenants/:id/reset-admin-password; PATCH /auth/me; POST /auth/change-password (currentPassword opcional para cuentas sin password); mantenimientos con tipos MONTHLY/QUARTERLY/SEMIANNUAL/ANNUAL y repeatCount; availability incluye clientName/people/note/membership en blocks.
- UI: gran vistas por rol con sub-pestañas, modales de venta/inventario/mantenimiento/reserva/historial.

## Actualización 2026-11-24
- **Nuevo endpoint:** `GET /auth/onboarding` - estado de configuración inicial del tenant (complejo, escenario, almacén, producto, stock). Devuelve `nextStep` para onboarding paso a paso.
- **Aislamiento de datos:** `GET /inventory/products`, `/inventory/categories`, `/inventory/suppliers` ahora filtran estrictamente por `complexId` (sin productos globales).
- **Usuarios OAuth:** `POST /auth/change-password` retorna 403 `OAUTH_ACCOUNT` si el usuario tiene `googleSub`.
- **Escenarios:** `POST /scenarios` y `PATCH /scenarios/:id` ahora aceptan `rentalFormat` y `pricing` en el body. `openTime`/`closeTime` pueden ser `null` para usar horario del complejo.
