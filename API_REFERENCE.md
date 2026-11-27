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

## Reportes (`/reports`) - auth requerida
- `GET /reports/summary?complexId=` - KPIs: tenants, complejos, reservas, transacciones, ingresos, egresos, neto.
- `GET /reports/income-vs-expense?complexId=&from=&to=&groupBy=day|week|month|year` - serie agregada por periodo.
- `GET /reports/by-source?complexId=&from=&to=` - totales por origen/tipo.
- `GET /reports/details?complexId=&from=&to=&limit=` - detalle para UI: `incomes` (fecha, origen, cliente, detalle, método, fecha reserva), `expenses` (fecha, origen, proveedor, detalle, monto), `suppliers` (agregado desde StockEntry).

## Inventario/Productos (`/inventory`)
- `POST/PATCH /inventory/products` y `/inventory/products/:id` aceptan `imageUrl` (además de `imageKey`) para foto por URL; la API de menú/ventas la expone en respuestas.

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
- **Escenarios:** `POST /scenarios` y `PATCH /scenarios/:id` ahora aceptan `rentalFormat` y `pricing` en el body. `openTime`/`closeTime` pueden ser `null` para usar horario del complejo. `weeklySchedule` acepta horario por día.

## Actualización 2026-11-25
- **Calendario timezone:** `GET /scenarios/:id/availability` ahora calcula bloques CLOSED en timezone del complejo (no UTC). `tzOffset()` convierte horarios locales a UTC correctamente.
- **Platform admin:** No auto-selecciona tenant. UI requiere selección explícita de Tenant en complejos/escenarios/reservas.
- **Complejos:** `allowClientPayLater` ya no se edita desde complejo (es por cliente).

## Actualización 2026-11-27
- **Reportes:** nuevo `GET /reports/details` con ingresos/egresos detallados y proveedores; UI con gráficas CSS/SVG y tablas (cliente, fecha reserva, proveedor, detalle).
- **Productos:** `imageUrl` en Producto (además de `imageKey`), expuesto en inventario/menú/ventas; UI muestra imagen en menú digital, ventas, productos e inventario.
- **Inventario:** ingreso de stock multi-producto con borrador, footer sticky “Confirmar ingresos”, egreso estimado por costo y nota.
- **Ventas:** confirmar venta abre modal de pago efectivo/QR/mixto; efectivo con cortes rápidos BOB 10/20/50/100/200 + Exacto.
- **Menú digital/QR por rol:** admin/vendedor complejo abre su complejo; tenant admin elige complejo; platform admin elige tenant+complejo.
