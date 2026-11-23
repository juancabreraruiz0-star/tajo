# Tajo

Aplicación web de gestión para una pequeña empresa de reformas: clientes, presupuestos, facturas y almacén de materiales. Los datos de demo son de una empresa ficticia, Reformas Levante S.L. (Valencia).

Qué se puede hacer:

- **Clientes**: listado con búsqueda por nombre, alta, edición y ficha con el historial de presupuestos y facturas.
- **Presupuestos**: partidas con cantidad y precio, totales (base, IVA y total) calculados al momento y numeración automática (`P-2026-0001`). Cada presupuesto enviado tiene un **enlace público** que el cliente abre sin cuenta y desde el que lo acepta.
- **Facturas**: gerencia convierte un presupuesto aceptado en factura con un clic (`F-2026-0001`). La factura se imprime o se guarda como **PDF**.
- **Materiales**: unidad, precio, stock y stock mínimo. Al facturar se descuenta del stock el material de las partidas, y lo que queda bajo mínimo se marca en rojo y sale en el panel.
- **Panel por rol**: presupuestos pendientes de respuesta, tasa de aceptación y stock bajo para todos; facturado en el mes y últimas facturas solo para gerencia.

## Demo

App: PENDIENTE_URL_VERCEL

| Usuario | Rol | Qué ve |
|---|---|---|
| `gerencia@reformaslevante.es` | admin | Todo, incluidas las facturas y las cifras de facturación |
| `obra@reformaslevante.es` | empleado | Clientes, presupuestos y materiales |

La contraseña se entrega junto con la prueba.

Recorrido sugerido (2 minutos):

1. Entra como `obra@reformaslevante.es`.
2. Crea un presupuesto: elige un cliente, añade un par de partidas y vincula alguna a un material del almacén.
3. En el detalle, pulsa «Marcar como enviado» y después «Copiar enlace para el cliente».
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

El rastro queda en tres documentos:

- `docs/REQUISITOS.md`: qué tiene que hacer la aplicación (R1–R21). Si no está ahí, no se construye.
- `docs/PLAN.md`: las tareas, los requisitos que cubre cada una y su estado, con las vueltas que hizo falta dar.
- `docs/DECISIONES.md`: decisiones que afectan a varias tareas (modelo de datos, seguridad, rutas, PDF, diseño).

### Lo que testing devolvió a develop

| Tarea | Qué encontró testing | Cómo se corrigió |
|---|---|---|
| T1 · Lógica de dominio | Un importe escrito como `"1.500"` se leía como 1,50 € en vez de 1.500 €. | El punto seguido de grupos de tres cifras se lee como separador de miles, con tests. Aprobada a la segunda vuelta. |
| T6 · Presupuestos | Se podía enviar un presupuesto sin partidas. Si el cliente lo aceptaba, quedaba un presupuesto aceptado de 0 € que ya no se podía editar ni facturar. | Se corrigió en la aplicación y en la base de datos (un trigger no deja pasar a «enviado» un presupuesto sin partidas). Además, el guardado del presupuesto con sus partidas pasó a ser atómico, con una función SQL (`0003_guardar_presupuesto.sql`). |

## Arquitectura

**Stack**: Next.js 15 (App Router), TypeScript estricto, Tailwind CSS 4, Supabase (Postgres + Auth) y Vercel. Sin librerías de interfaz ni de PDF.

```
src/
  app/
    (app)/            zona privada: panel, clientes, presupuestos, facturas, materiales
    login/            acceso
    p/[token]/        presupuesto público para el cliente (sin sesión)
  components/         componentes de interfaz propios (botones, tablas, formularios, iconos)
  lib/
    domain/           lógica de negocio pura, con sus tests al lado
    actions/          Server Actions: validan la entrada y escriben en Supabase
    supabase/         clientes de Supabase (servidor, anónimo) y middleware de sesión
supabase/
  migrations/         SQL versionado: tablas, RLS, triggers y funciones
  seed.sql            datos de demo
docs/                 requisitos, plan y decisiones
```

Decisiones clave:

- **Lógica de negocio pura en `src/lib/domain`**. Importes, totales, estados, validación de formularios, stock y cifras del panel son funciones sin dependencias de Next ni de Supabase, cada una con sus tests.
- **Dinero en céntimos enteros**. Nunca se suman euros con decimales. El IVA se calcula una sola vez sobre la base total y se redondea al céntimo; solo se formatea a euros al pintar.
- **La seguridad está en la base de datos**, no en ocultar botones:
  - RLS en todas las tablas: cada usuario solo ve los datos de su empresa.
  - Los roles se comprueban en SQL: las facturas solo las lee un admin y solo se crean con la función `facturar_presupuesto()`, que numera, crea la factura, descuenta el stock y cambia el estado en una sola transacción.
  - Las transiciones de estado (borrador → enviado → aceptado → facturado, o rechazado desde enviado) y el bloqueo de las partidas fuera de borrador se imponen con triggers.
  - El rol anónimo no puede leer ninguna tabla. El enlace público usa solo dos funciones, `presupuesto_publico()` y `aceptar_presupuesto()`, que reciben el token del enlace.
  - La aplicación usa únicamente la URL del proyecto y la clave anónima; no hay clave de servicio.
- **Server Components para leer y Server Actions para escribir**.
- **PDF con la vista de impresión del navegador**: la factura tiene estilos de impresión en A4 y el botón «Descargar PDF» abre el diálogo de imprimir.

## Calidad

323 tests en 14 ficheros (Vitest), sobre la lógica de dominio y la regla de rutas públicas del middleware.

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript sin emitir
npm test           # Vitest
npm run build      # build de producción (lo que despliega Vercel)
npm run check      # los cuatro anteriores, en orden
```

## Ponerlo en marcha

Hace falta Node.js 20 o superior y una cuenta de Supabase.

1. Crea un proyecto en Supabase.
2. En el SQL Editor, ejecuta en este orden, pegando cada fichero entero:
   1. `supabase/migrations/0001_esquema.sql`
   2. `supabase/migrations/0002_reglas.sql`
   3. `supabase/migrations/0003_guardar_presupuesto.sql`
3. Crea los dos usuarios en Authentication con el email ya confirmado: `gerencia@reformaslevante.es` y `obra@reformaslevante.es`, con la contraseña que quieras.
4. En el SQL Editor, ejecuta `supabase/seed.sql` entero de una vez: pasa a gerencia a admin y carga los datos de demo.
5. Copia `.env.example` a `.env.local` y rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la URL y la clave anónima del proyecto (están en los ajustes de API de Supabase).
6. Instala y arranca:

   ```bash
   npm install && npm run dev
   ```

   La aplicación queda en `http://localhost:3000`.

**En Vercel**: importa el repositorio y define las mismas dos variables de entorno. No hace falta nada más.

## Límites conocidos

- **Una sola empresa de demo.** El modelo de datos y la RLS separan los datos por empresa, pero no hay alta de empresas: todo usuario nuevo entra en Reformas Levante como empleado.
- **Los usuarios se crean en el panel de Supabase.** No hay pantalla de usuarios, de cambio de rol ni de recuperación de contraseña.
- **IVA del 21 % o del 10 %**, uno por presupuesto (no por partida).
- **No se envían correos.** El enlace del presupuesto se copia y se manda a mano (correo, WhatsApp).
- **El cliente solo puede aceptar desde el enlace.** El rechazo lo marca la empresa desde la aplicación.
- **El PDF depende del navegador**: se genera con su diálogo de impresión, así que márgenes y cabeceras pueden variar de uno a otro.
- **Las facturas no se editan ni se anulan** (no hay facturas rectificativas) y la forma de pago es fija: transferencia bancaria.
- **El stock puede quedar en negativo** si se factura más material del que hay. No se bloquea la factura: el material sale como stock bajo y su pantalla de edición lo avisa.
- **Listados sin paginación**, y la búsqueda de clientes es solo por nombre y distingue acentos («garcia» no encuentra «García»).
- **Los tests automáticos cubren la lógica de dominio.** Las reglas de SQL (RLS, triggers, funciones) y las pantallas no tienen tests automáticos.
