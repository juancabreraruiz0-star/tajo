# Tajo · Requisitos

App web para una pequeña empresa de reformas: llevar clientes, hacer presupuestos, que el cliente los acepte desde un enlace, convertirlos en facturas y controlar el material del almacén.

Empresa de demo: **Reformas Levante S.L.** (Valencia).

## Usuarios y roles

- **R1.** Acceso con email y contraseña (Supabase Auth). Sin sesión solo se ve `/login` y los enlaces públicos de presupuesto.
- **R2.** Dos roles: **admin** (gerencia) y **empleado** (encargado de obra).
  - Ambos: clientes, presupuestos, materiales.
  - Solo admin: convertir presupuestos en factura, ver facturas y ver las cifras de facturación del panel.
- **R3.** Cada usuario pertenece a una empresa y **solo ve los datos de su empresa** (RLS en todas las tablas).

## Clientes

- **R4.** Listado con búsqueda por nombre, alta y edición (nombre, teléfono, email, dirección, notas).
- **R5.** Ficha del cliente con su historial de presupuestos y facturas.

## Presupuestos

- **R6.** Crear un presupuesto para un cliente: título, IVA (21 % por defecto, editable a 10 % para reformas de vivienda), validez en días y **partidas** (descripción, cantidad, precio unitario). Una partida puede vincularse a un material del almacén.
- **R7.** Totales calculados al momento: base, IVA y total. El IVA se calcula sobre la base total y se redondea al céntimo.
- **R8.** Numeración automática por empresa y año: `P-2026-0001`.
- **R9.** Estados: `borrador → enviado → aceptado → facturado`, y `rechazado` desde enviado. No se puede saltar estados (p. ej. facturar un borrador).
- **R10.** Desde un presupuesto enviado se copia un **enlace público** (`/p/<token>`).
- **R11.** El cliente abre el enlace **sin cuenta**, ve el presupuesto con el nombre de la empresa, las partidas y los totales, y puede pulsar **Aceptar**. El presupuesto pasa a `aceptado` y se guarda la fecha. Si ya no está en `enviado`, la página lo indica y no deja aceptar.

## Facturas

- **R12.** Un admin convierte un presupuesto `aceptado` en factura con un clic. Numeración `F-2026-0001`. El presupuesto pasa a `facturado`.
- **R13.** Al facturar, se **descuenta del stock** la cantidad de las partidas vinculadas a materiales.
- **R14.** Vista de factura lista para imprimir o guardar como **PDF** desde el navegador (datos de empresa, cliente, partidas, base, IVA y total).

## Materiales

- **R15.** Listado de materiales con unidad, precio, stock y stock mínimo. Alta y edición.
- **R16.** Los materiales con stock por debajo del mínimo se marcan en rojo y aparecen en el panel.

## Panel de inicio

- **R17.** Tarjetas: presupuestos pendientes de respuesta (enviados), tasa de aceptación (aceptados + facturados / enviados + aceptados + facturados + rechazados) y materiales bajo mínimo.
- **R18.** Solo admin: facturado este mes y últimas facturas.

## Calidad

- **R19.** Funciona en móvil.
- **R20.** Datos de demo realistas para que la app se pueda enseñar nada más entrar.
- **R21.** Desplegada en Vercel con dirección pública; sin claves en el repositorio.
