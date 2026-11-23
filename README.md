# Tajo

Aplicación web de gestión para una pequeña empresa de reformas: clientes, presupuestos, facturas y almacén de materiales. Los datos de demo son de una empresa ficticia, Reformas Levante S.L. (Valencia).

Qué se puede hacer:

- **Clientes**: listado con búsqueda por nombre, alta, edición y ficha con el historial de presupuestos y facturas. Cada cliente puede tener NIF, NIE o CIF, que se valida con su letra o dígito de control.
- **Presupuestos**: partidas con cantidad y precio, totales (base, IVA y total) calculados al momento y numeración automática (`P-2026-0001`). Cada presupuesto enviado tiene un **enlace público** que el cliente abre sin cuenta y desde el que lo acepta. Si el cliente lo confirma por otra vía, gerencia puede darlo por aceptado, y queda constancia de quién lo hizo. Gerencia también puede generar un enlace nuevo; el anterior deja de funcionar.
- **Facturas**: gerencia convierte un presupuesto aceptado en factura con un clic (`F-2026-0001`). La factura guarda una copia de los datos del cliente, de la empresa y de las partidas en ese momento, y se imprime o se guarda como **PDF**. No se factura a un cliente sin NIF.
- **Materiales**: unidad, precio, stock y stock mínimo. Al facturar se descuenta del stock el material de las partidas, y lo que queda bajo mínimo se marca en rojo y sale en el panel.
- **Panel por rol**: presupuestos pendientes de respuesta, tasa de aceptación y stock bajo para todos; facturado en el mes y últimas facturas solo para gerencia.

## Demo

App: https://tajo-delta.vercel.app

| Usuario | Rol | Qué ve |
|---|---|---|
| `gerencia@reformaslevante.es` | admin | Todo, incluidas las facturas y las cifras de facturación |
| `obra@reformaslevante.es` | empleado | Clientes, presupuestos y materiales |

La contraseña se entrega junto con la prueba.

Recorrido sugerido (2 minutos):

1. Entra como `obra@reformaslevante.es`.
2. Crea un presupuesto: elige un cliente, añade un par de partidas y vincula alguna a un material del almacén.
3. En el detalle, pulsa «Marcar como enviado» y después «Copiar enlace».
4. Abre el enlace en una ventana de incógnito (sin sesión) y pulsa «Aceptar presupuesto».
5. Cierra sesión y entra como `gerencia@reformaslevante.es`.
6. Abre el presupuesto, ya aceptado, y pulsa «Convertir en factura».
7. En la factura, pulsa «Descargar PDF» y elige «Guardar como PDF» en el diálogo de impresión.
8. Mira en Materiales cómo ha bajado el stock del material vinculado, y en el Panel cómo cambian «Facturado este mes», la tasa de aceptación y las últimas facturas.

## Cómo está hecho: equipo de 3 agentes

La aplicación la ha construido un equipo de tres agentes de Claude Code. Cada uno tiene su papel escrito en un fichero del repositorio:

| Agente | Fichero | Papel |
|---|---|---|
| Orquestador | `CLAUDE.md` | Planifica y reparte el trabajo. No programa. Solo cierra una tarea cuando testing devuelve `APROBADO`. |
| develop | `.claude/agents/develop.md` | Programa una tarea concreta siguiendo sus reglas: lógica de negocio pura y con tests, dinero en céntimos, seguridad en la base de datos, entrada validada. |
| testing | `.claude/agents/testing.md` | No escribe código de la app. Revisa lo que entrega develop contra sus directrices y los criterios de la tarea, y devuelve un veredicto: `APROBADO` o `RECHAZADO` con la lista de fallos. |

El bucle de cada tarea:

1. El orquestador toma la siguiente tarea del plan y se la encarga a develop con un brief cerrado: objetivo, criterios de aceptación numerados (salen de los requisitos) y ficheros que puede tocar.
2. develop programa, ejecuta `lint`, `typecheck` y `test` (y `build` si toca rutas), y devuelve un informe con un criterio por línea.
3. testing vuelve a ejecutar los comandos, comprueba cada criterio y razona un caso real de una empresa de reformas.
4. Si hay fallos, vuelven a develop tal cual y se repite la revisión (máximo 3 vueltas; a la tercera, la tarea se parte en dos). Si no los hay, la tarea se marca como hecha.

El rastro queda en estos documentos:

- `docs/REQUISITOS.md`: qué tiene que hacer la aplicación (R1–R21). Si no está ahí, no se construye.
- `docs/PLAN.md`: las tareas, los requisitos que cubre cada una y su estado, con las vueltas que hizo falta dar.
- `docs/DECISIONES.md`: decisiones que afectan a varias tareas (modelo de datos, seguridad, rutas, PDF, diseño).
- `docs/AUDITORIA.md`: la auditoría externa de seguridad y calidad, y sus hallazgos.

### Lo que testing devolvió a develop

| Tarea | Qué encontró testing | Cómo se corrigió |
|---|---|---|
| T1 · Lógica de dominio | Un importe escrito como `"1.500"` se leía como 1,50 € en vez de 1.500 €. | El punto seguido de grupos de tres cifras se lee como separador de miles, con tests. Aprobada a la segunda vuelta. |
| T6 · Presupuestos | Se podía enviar un presupuesto sin partidas. Si el cliente lo aceptaba, quedaba un presupuesto aceptado de 0 € que ya no se podía editar ni facturar. | Se corrigió en la aplicación y en la base de datos (un trigger no deja pasar a «enviado» un presupuesto sin partidas). Además, el guardado del presupuesto con sus partidas pasó a ser atómico, con una función SQL (`0003_guardar_presupuesto.sql`). |
| Auditoría externa ([`docs/AUDITORIA.md`](docs/AUDITORIA.md)) | Una revisión independiente, hecha después de aprobar T1–T10, encontró lo que el bucle no vio: cualquiera podía registrarse y entrar como empleado, un empleado podía dar por aceptado un presupuesto vencido, la factura cambiaba si se editaba el cliente y los totales de los listados salían mal a partir de 1000 partidas. | Se corrigió en T11a (base de datos, `0004_auditoria.sql`) y T11b (aplicación): alta solo por invitación, aceptación interna solo para gerencia y con constancia, factura con copia fija y NIF, totales en SQL y listados paginados, límites en la base, enlace revocable y cabeceras de seguridad. |
| T11a · Base de datos de la auditoría | La cantidad máxima de una partida era distinta en la app (1.000.000.000) y en la base (`numeric(12,3)`, que no llega). | La base pasó a `numeric(13,3)` con un `CHECK` del mismo máximo que la app. Aprobada a la tercera vuelta. |

## Arquitectura

**Stack**: Next.js 15 (App Router), TypeScript estricto, Tailwind CSS 4, Supabase (Postgres + Auth) y Vercel. Sin librerías de interfaz ni de PDF.

```
src/
  app/
    (app)/            zona privada: panel, clientes, presupuestos, facturas, materiales
    login/            acceso
    p/[token]/        presupuesto público para el cliente (sin sesión)
  components/         componentes de interfaz propios (botones, tablas, formularios, paginación, iconos)
  lib/
    domain/           lógica de negocio pura, con sus tests al lado
    actions/          Server Actions: validan la entrada y escriben en Supabase
    supabase/         clientes de Supabase (servidor, anónimo) y middleware de sesión
supabase/
  migrations/         SQL versionado: tablas, RLS, triggers y funciones
  seed.sql            datos de demo
  config.toml         configuración de la CLI (registro cerrado)
scripts/
  test-db.mjs         tests de la base de datos contra el Supabase real
docs/                 requisitos, plan, decisiones y auditoría
```

Decisiones clave:

- **Lógica de negocio pura en `src/lib/domain`**. Importes, totales, estados, validación de formularios (NIF incluido), paginación, stock y cifras del panel son funciones sin dependencias de Next ni de Supabase, cada una con sus tests.
- **Dinero en céntimos enteros** (`bigint` en la base). Nunca se suman euros con decimales. El IVA se calcula una sola vez sobre la base total y se redondea al céntimo; solo se formatea a euros al pintar.
- **La seguridad está en la base de datos**, no en ocultar botones:
  - Alta solo por invitación: el registro público está cerrado y un usuario nuevo solo tiene perfil (empresa y rol) si su email está en la tabla `invitaciones`. Sin perfil no ve nada.
  - RLS en todas las tablas: cada usuario solo ve los datos de su empresa.
  - Los roles se comprueban en SQL: las facturas solo las lee un admin y solo se crean con la función `facturar_presupuesto()`, que numera, guarda la copia fija de la factura, descuenta el stock y cambia el estado en una sola transacción.
  - Las transiciones de estado (borrador → enviado → aceptado → facturado, o rechazado desde enviado) y el bloqueo de las partidas fuera de borrador se imponen con triggers. Dar por aceptado un presupuesto desde la app solo lo puede hacer gerencia y con la validez vigente; se guarda quién lo hizo y por dónde (`aceptado_por`, `aceptado_canal`).
  - Límites de longitud, cantidad e importe también en la base (`CHECK`), con los mismos valores que la app.
  - El rol anónimo no tiene permisos sobre ninguna tabla. El enlace público usa solo dos funciones, `presupuesto_publico()` y `aceptar_presupuesto()`, que reciben el token del enlace. La aceptación por enlace solo la puede ejecutar el rol anónimo.
  - La aplicación usa únicamente la URL del proyecto y la clave anónima; no hay clave de servicio.
- **Totales en SQL**: los listados leen la vista `presupuestos_con_totales` y paginan de 25 en 25; no se traen las partidas.
- **Server Components para leer y Server Actions para escribir**.
- **Cabeceras de seguridad** en `next.config.ts`: CSP con `frame-ancestors 'none'`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` (`no-referrer` en el enlace público), `Permissions-Policy` y `Strict-Transport-Security`.
- **PDF con la vista de impresión del navegador**: la factura tiene estilos de impresión en A4 y el botón «Descargar PDF» abre el diálogo de imprimir.

## Calidad

392 tests en 16 ficheros (Vitest), sobre la lógica de dominio y la regla de rutas públicas del middleware.

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript sin emitir
npm test           # Vitest
npm run build      # build de producción (lo que despliega Vercel)
npm run check      # los cuatro anteriores, en orden
```

**Tests de la base de datos** (`npm run test:db`): entran en el Supabase real como anónimo, como obra (empleado) y como gerencia (admin), y comprueban qué puede y qué no puede hacer cada uno. Por ejemplo: que el anónimo no lee ninguna tabla ni puede registrarse, que nadie ve los datos de otra empresa, que obra no puede dar por aceptado un presupuesto ni regenerar el enlace, que la aceptación por enlace queda con canal `enlace`, que la vista de totales cuadra con las partidas y que regenerar el enlace deja inservible el anterior. No forman parte de `npm test` porque necesitan las contraseñas, que solo se pasan por variable de entorno:

```bash
TAJO_PASS_GERENCIA=... TAJO_PASS_OBRA=... npm run test:db
```

Necesitan la base migrada hasta `0004` y el seed recién ejecutado. Crean datos con el prefijo `[test]` y los borran al final, pero consumen números de presupuesto: no los ejecutes contra una base con datos reales.

Además, antes de aprobar T11a, testing probó de verdad las reglas de la base en PGlite (Postgres en local), con 124 comprobaciones.

## Ponerlo en marcha

Hace falta Node.js 20 o superior y una cuenta de Supabase.

1. Crea un proyecto en Supabase.
2. En Authentication → Sign In / Providers, desactiva «Allow new users to sign up». Sin esto, cualquiera con la clave anónima podría crearse una cuenta (no tendría perfil ni vería nada, pero no hace falta dejarle entrar).
3. En el SQL Editor, ejecuta en este orden, pegando cada fichero entero:
   1. `supabase/migrations/0001_esquema.sql`
   2. `supabase/migrations/0002_reglas.sql`
   3. `supabase/migrations/0003_guardar_presupuesto.sql`
   4. `supabase/migrations/0004_auditoria.sql`
4. Crea los dos usuarios en Authentication → Add user con el email ya confirmado: `gerencia@reformaslevante.es` y `obra@reformaslevante.es`, con la contraseña que quieras.
5. En el SQL Editor, ejecuta `supabase/seed.sql` entero de una vez: invita a los dos usuarios, les crea el perfil (gerencia como admin) y carga los datos de demo.
6. Copia `.env.example` a `.env.local` y rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la URL y la clave anónima del proyecto (están en los ajustes de API de Supabase).
7. Instala y arranca:

   ```bash
   npm install && npm run dev
   ```

   La aplicación queda en `http://localhost:3000`.

No vuelvas a ejecutar `0001`–`0003` sobre una base que ya tiene la `0004`: redefinen funciones que la `0004` cambia.

**Dar de alta a alguien más**: primero la invitación en el SQL Editor y después el usuario en Authentication → Add user. Al crearse el usuario, su perfil sale de la invitación.

```sql
insert into public.invitaciones (email, empresa_id, rol)
values ('nombre@reformaslevante.es', '00000000-0000-0000-0000-000000000001', 'empleado');
```

**En Vercel**: importa el repositorio y define las mismas dos variables de entorno. Antes, comprueba en Supabase los pasos 2 a 5: registro desactivado, las cuatro migraciones y el seed. Las cabeceras de seguridad van en `next.config.ts`; en Vercel no hay que configurarlas.

## Límites conocidos

- **Una sola empresa de demo.** El modelo de datos y la RLS separan los datos por empresa, pero no hay alta de empresas ni pantalla de invitaciones: los usuarios nuevos se invitan desde el SQL Editor.
- **Los usuarios se crean en el panel de Supabase.** No hay pantalla de usuarios, de cambio de rol ni de recuperación de contraseña.
- **IVA del 21 % o del 10 %**, uno por presupuesto (no por partida).
- **No se envían correos.** El enlace del presupuesto se copia y se manda a mano (correo, WhatsApp).
- **El cliente acepta desde el enlace; gerencia puede darlo por aceptado** si se lo confirma por otra vía (queda registrado quién lo hizo). El rechazo lo marca la empresa desde la aplicación. De la aceptación por enlace se guarda la fecha, pero no la IP ni el navegador.
- **El PDF depende del navegador**: se genera con su diálogo de impresión, así que márgenes y cabeceras pueden variar de uno a otro.
- **Las facturas no se editan ni se anulan** (no hay facturas rectificativas) y la forma de pago es fija: transferencia bancaria. Las facturas emitidas antes de la `0004` se copiaron con los datos que tenía el cliente al aplicarla y sin NIF.
- **El stock puede quedar en negativo** si se factura más material del que hay. No se bloquea la factura: el material sale como stock bajo y su pantalla de edición lo avisa.
- **Paginación** en clientes, presupuestos y facturas (25 por página). El almacén de materiales no está paginado.
- **La búsqueda de clientes** es solo por nombre y distingue acentos («garcia» no encuentra «García»).
- **La CSP no limita los scripts** (`script-src`): Next 15 usa scripts en línea y restringirlos exige un nonce por petición. Sí impide meter la app en un iframe, los formularios hacia otras webs y los plugins.
- **Las pantallas no tienen tests automáticos.** La lógica de dominio sí (`npm test`) y las reglas de la base también, contra el Supabase real (`npm run test:db`).
