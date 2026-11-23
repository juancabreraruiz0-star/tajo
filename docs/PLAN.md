# Plan de trabajo

Gestionado por el orquestador. Cada tarea pasa por develop → testing hasta `APROBADO`.

| # | Tarea | Requisitos | Estado |
|---|---|---|---|
| T1 | Base: scripts, Vitest, clientes de Supabase, middleware de sesión y **lógica de dominio con tests** (dinero, totales, estados, numeración) | R1, R7, R8, R9 | ✅ aprobado (2026-11-23, 2.ª vuelta) |
| T2 | Base de datos: migración con tablas, RLS, funciones públicas y de facturación, trigger de perfiles + `seed.sql` de demo | R2, R3, R8, R11, R12, R13, R20 | ✅ aprobado (2026-11-23) |
| T2b | Migración 0002: transiciones de estado e inmutables en SQL, bloqueo de partidas fuera de borrador, borrado de partidas por empleado en borrador, bypass solo para el seed | R9, R12, R13 | ✅ aprobado (2026-11-23), con mejoras de seguridad de testing también aprobadas |
| T6b | Migración 0003: guardado atómico `guardar_presupuesto()`, no enviar sin partidas y no aceptar con la validez vencida | R6, R9, R11 | ✅ aprobado (2026-11-23) |
| T3 | Acceso y estructura: `/login`, layout privado con menú, cierre de sesión, rol visible | R1, R2, R19 | ✅ aprobado (2026-11-23) |
| T4 | Clientes: listado con búsqueda, alta/edición y ficha con historial | R4, R5 | ✅ aprobado (2026-11-23) |
| T5 | Materiales: listado, alta/edición, alerta de stock bajo | R15, R16 | ✅ aprobado (2026-11-23) |
| T6 | Presupuestos: listado, creación con partidas y totales en vivo, detalle con cambios de estado y enlace público | R6–R10 | ✅ aprobado (2026-11-23, 2.ª vuelta; 1.ª rechazada por envío sin partidas) |
| T7 | Página pública `/p/[token]` con aceptación | R11 | ✅ aprobado (2026-11-23; se revisó junto con T6 y entró en su segunda vuelta, sin fallos propios) |
| T8 | Facturas: facturar desde presupuesto, listado y vista imprimible/PDF | R12–R14 | ✅ aprobado (2026-11-23) |
| T9 | Panel de inicio por rol | R17, R18 | ✅ aprobado (2026-11-23) |
| T10 | Revisión final completa + README | R19–R21 | ✅ aprobado (2026-11-23); R21 pendiente del despliegue |
| T11a | Auditoría externa · base de datos: migración 0004 (invitaciones, aceptación interna solo admin, copia fija de la factura y NIF, checks y bigint, alta forzada, regenerar enlace, marcas con `current_user`, vista de totales), seed y tests `test:db` | R2, R3, R9, R11–R14 · D9 | ✅ aprobado (2026-11-23, 3.ª vuelta: 1.ª rechazada porque la cantidad máxima de la base era menor que la de la app; 2.ª con mejoras de testing). Probado de verdad en PGlite: 124 comprobaciones |
| T11b | Auditoría externa · aplicación: listados paginados con totales en SQL, factura desde la copia, NIF en clientes, aceptar interno solo admin, regenerar enlace, cabeceras, Next actualizado, detalles visuales y README | R2, R4, R9–R14, R19 · D9 | ✅ aprobado (2026-11-23, 1.ª vuelta). La base real pasa `npm run test:db`: 57/57 |
| T12 | Presupuesto con IA (D10): acción, validación de la respuesta en dominio, cuota en 0005, botón en el formulario | R6 · D10 | ⏳ pendiente |
| T13 | Rediseño (D10): página pública, panel con gráficas, login, estados vacíos, móvil | R11, R17–R19 · D10 | ⏳ pendiente |
| T14 | Segunda auditoría externa y correcciones | todos | ⏳ pendiente |

## Sugerencias de testing resueltas en T10a/T10b

Todas aplicadas y verificadas en la revisión final:

- «*» en la búsqueda ya no devuelve todo (`normalizeSearch`).
- Material con stock negativo: se puede guardar sin tocar el stock, con aviso; el negativo cuenta como stock bajo.
- README propio.
- `Select` y `requireAdmin` en uso; código sin usar eliminado (`numbering.ts`, cliente de navegador).
- Panel: «frente a todo <mes>», 0 % sin color (`percentTrend`), icono propio para la tasa de aceptación.
- Factura: `print:overflow-visible`.
- Tests de horario de verano en `monthRange` y caso real en `lineasCuadranConBase`.
- 0003: `jsonb_typeof` antes de `jsonb_array_length`; cabeceras con el orden 0001 → 0002 → 0003 → seed.
- Detalle privado: aviso de presupuesto enviado con la validez vencida.
- Mensaje propio para el error 23503 al guardar un presupuesto.

Queda como límite conocido (README): la búsqueda de clientes distingue acentos.

## Revisión final (T10)

- 2026-11-23 · testing: código, SQL, seguridad y arranque limpios (323 tests). Pendiente solo R21: desplegar en Vercel con Supabase y poner la URL en el README.
