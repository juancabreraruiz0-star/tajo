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
| T12 | Presupuesto con IA (D10): acción, validación de la respuesta en dominio, cuota en 0005, botón en el formulario | R6 · D10 | ✅ aprobado (2026-11-23), más una vuelta de mejoras de testing también aprobada: devolución de usos con reserva (una función que solo restara 1 permitía usos infinitos), unidad del material, accesibilidad y tests del cliente de la API |
| T13 | Rediseño (D10): página pública, panel con gráficas, login, estados vacíos, móvil | R11, R17–R19 · D10 | ✅ aprobado (2026-11-23, 1.ª vuelta). La página pública ya no deja aceptar a un empleado con sesión |
| T14 | Segunda auditoría externa | todos | ✅ hecha (2026-11-24): `docs/AUDITORIA-2.md`. 93 ataques en PGlite que no pasan; 2 vulnerables y hallazgos medios y bajos que se corrigen en T17 |
| T15 | Guía de la demo dentro de la app («Prueba esto en 2 minutos», pasos que se marcan solos, se puede cerrar) y botón «Enviar por WhatsApp» del presupuesto enviado | R10, R20 | ✅ aprobado (2026-11-24, hecho y revisado junto con T16b) |
| T16a | Obras · base de datos y dominio (D11): 0006, vista de resumen, márgenes puros con tests, seed con obras y partes, comprobaciones en PGlite y test:db | R2, R3 · D11 | ✅ aprobado (2026-11-24), más una vuelta de endurecimiento de testing también aprobada (coste de materiales solo gerencia, obra terminada congelada, fechas de partes, mensajes en español). PGlite: 178 + 64 de testing |
| T16b | Obras · pantallas (D11) junto con T15 | R19 · D11 | ✅ aprobado (2026-11-24, 1.ª vuelta). Testing ejecutó en PGlite las mismas consultas de las pantallas como encargado y gerencia (35/35) |
| T17a | Segunda auditoría · base de datos (D12): 0007, tests PGlite en el repo y CI | todos · D12 | ✅ aprobado (2026-11-24, 2.ª vuelta: la 1.ª dejaba pasar cantidades como texto). PGlite en el repo: 106 tests; CI en GitHub Actions |
| T17b | Segunda auditoría · aplicación (D12): aceptación con nombre y evidencia, semáforo para el empleado, detalles de testing, README | todos · D12 | ✅ aprobado (2026-11-24), con un retoque final del README y del nombre al aceptar comprobado por el orquestador |
| T18 | Tercera auditoría (`docs/AUDITORIA-3.md`, D13): 0008 (validez desde el envío, sin envíos de 0 €, nombre de quien envió fijo, IP y navegador solo para gerencia), coste del material en el formulario, pantallas de error en español, factura sin IBAN, seed con contactos ficticios, código muerto, vitest 5 y documentación | R6, R9–R11, R13, R15 · D13 | ✅ aprobado (2026-11-24, 1.ª vuelta). Testing probó la 0008 en PGlite sobre 0001–0007 + el seed de 69935c1 con actividad (sin pérdida de datos, repetible, seed nuevo después) y cambió en la 0008 los caracteres invisibles literales de las expresiones regulares por los mismos escapes que en la 0007 |
| T19 | «Montar con IA» determinista (D14): misma descripción y mismo almacén → mismo presupuesto con una caché por huella (clave en el dominio con tests, 0009 con `ia_propuestas` y `guardar_propuesta_ia()` que gasta una reserva de la cuota, relectura validada), aviso en el panel sin gastar cuota y la propuesta sustituye por defecto a las partidas («Añadir detrás» es opcional) | R6 · D10, D14 | ✅ aprobado (2026-11-24, 1.ª vuelta). npm test: 710 en 28 ficheros (testing añadió el caso «sin 0009 en la base»); PGlite: 138 en 9 ficheros. Testing probó la 0009 en PGlite sobre 0001–0008 + el seed de 91844fb con actividad (sin pérdida de datos, repetible, seed nuevo después), 2000 respuestas aleatorias de ida y vuelta por la caché (idénticas) y ataques de envenenamiento, reservas ajenas o repetidas, otra empresa, anon y search_path (todos bloqueados); cambió los caracteres invisibles literales de `cache-ia.ts` por escapes y dos textos del panel. La 0009 está sin aplicar en la base real |
| T20 | Marca: colores y logo (naranja #EC931C y azul marino #071B2C en las escalas `amber`, `stone` y `slate` de `globals.css`, colores fijos sustituidos, `MarcaTajo` e `icon.svg` con la casa del logo, pie público) | — | ✅ aprobado (2026-11-24). Testing comprobó en el CSS del build las variables y clases nuevas, que no queda ningún color cálido viejo y el contraste AA; oscureció `stone-500` a #5d6c80 (con #617084 daba 4,49:1 sobre `stone-100`, el fondo de la página pública) |

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
