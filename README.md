# Tajo

Aplicación web de gestión para una pequeña empresa de reformas: clientes, presupuestos, obras, facturas y almacén de materiales. Los datos de demo son de una empresa ficticia, Reformas Levante S.L. (Valencia).

Qué se puede hacer:

- **Clientes**: listado con búsqueda por nombre, alta, edición y ficha con el historial de presupuestos y facturas. Cada cliente puede tener NIF, NIE o CIF, que se valida con su letra o dígito de control en la aplicación y también en la base de datos.
- **Presupuestos**: partidas con cantidad y precio, totales (base, IVA y total) calculados al momento y numeración automática (`P-2026-0001`). La validez (30 días por defecto) cuenta desde que se envía y no se puede enviar un presupuesto de 0 €. Cada presupuesto enviado tiene un **enlace público** que el cliente abre sin cuenta y desde el que lo acepta escribiendo su nombre y apellidos; queda constancia de quién lo envió, del nombre, la IP y el navegador con los que se aceptó (ver «Aceptación por enlace»). El enlace se copia o se manda con **«Enviar por WhatsApp»**, que abre el chat del cliente (su teléfono pasado a formato internacional, +34 si no lleva prefijo) con un mensaje corto ya escrito: saludo, título del presupuesto, enlace y firma de la empresa. Si el cliente no tiene un teléfono válido, WhatsApp deja elegir el contacto. Con la validez vencida ya no se ofrece. Si el cliente lo confirma por otra vía, gerencia puede darlo por aceptado, y queda constancia de quién lo hizo. Gerencia también puede generar un enlace nuevo; el anterior deja de funcionar.
- **Obras**: cada presupuesto aceptado se convierte solo en una obra. La obra se empieza, se para, se reanuda y se termina; tiene encargado (lo asigna gerencia), fechas de inicio, fin prevista y fin real, y notas. La cuadrilla apunta desde el móvil **partes de trabajo**: fecha, horas («7,5» vale), notas y el material del almacén que ha gastado, buscado por nombre. Cada obra compara **lo presupuestado (base sin IVA) con el coste real** (horas × coste por hora + material a su coste) con un semáforo: verde por debajo del 80 %, ámbar hasta el 100 % y rojo por encima. Gerencia ve los importes, el % consumido y el margen; el encargado ve las horas y solo el semáforo («Va bien», «Ajustada», «En pérdidas»), sin importes ni porcentaje. Un parte lo cambia o lo borra su autor el mismo día, o gerencia; los de una obra terminada ya no se tocan. Como mucho 24 h por persona y día, y con fecha de hace 30 días como mucho. Desde el presupuesto se llega a su obra («Ver la obra» y un hito más en su línea de tiempo) y la ficha del cliente lista sus obras.
- **Facturas**: gerencia convierte un presupuesto aceptado en factura con un clic (`F-2026-0001`). La factura guarda una copia de los datos del cliente, de la empresa y de las partidas en ese momento, y se imprime o se guarda como **PDF**. No se factura a un cliente sin NIF.
- **Materiales**: unidad, precio, stock y stock mínimo, y el coste para la empresa (sin IVA), que solo ve y cambia gerencia y que usan los partes de obra para el margen (si está vacío, se usa el precio). Al facturar se descuenta del stock el material de las partidas, y lo que queda bajo mínimo se marca en rojo y sale en el panel.
- **Panel por rol**: presupuestos pendientes de respuesta, tasa de aceptación, stock bajo y obras en curso (primero las que peor van; gerencia, ordenadas por % consumido) para todos; facturado en el mes, últimas facturas y obras en pérdidas (margen negativo, con su importe) solo para gerencia.
- **Guía de la demo**: en el panel, un bloque «Prueba Tajo en 3 minutos» con los pasos del recorrido y un enlace a donde se hace cada uno. Los pasos se marcan solos con lo que ha pasado hoy en los datos (no con clics): un presupuesto creado, uno enviado, uno aceptado desde el enlace, una factura (solo gerencia) y un parte apuntado por quien mira. Se oculta con «Ya lo conozco» (se recuerda en una cookie de ese navegador, no en la base) y vuelve con «Ver la guía de la demo», junto a la fecha.

## Demo

App: https://tajo-delta.vercel.app

| Usuario | Rol | Qué ve |
|---|---|---|
| `gerencia@reformaslevante.es` | admin | Todo, incluidas las facturas y las cifras de facturación |
| `obra@reformaslevante.es` | empleado | Clientes, presupuestos, obras (con el semáforo, sin importes, porcentaje ni margen) y materiales |

La contraseña se entrega junto con la prueba.

Recorrido sugerido (3 minutos; el panel trae la misma guía, «Prueba Tajo en 3 minutos», y va marcando los pasos):

1. Entra como `obra@reformaslevante.es`.
2. Crea un presupuesto: elige un cliente, añade un par de partidas y vincula alguna a un material del almacén (o pulsa «Montar con IA» si está activada).
3. En el detalle, pulsa «Marcar como enviado» y después «Copiar enlace» (o «Enviar por WhatsApp»).
4. Ahora haz de cliente: abre el enlace en una ventana de incógnito (sin sesión), escribe un nombre y pulsa «Aceptar presupuesto». Su obra aparece sola en Obras.
5. En Obras, abre «Reforma de cocina» (en curso, de la que eres encargado) y pulsa «Añadir parte»: horas de hoy y algo de material. Como encargado ves cómo va con el semáforo, sin importes ni porcentaje.
6. Cierra sesión y entra como `gerencia@reformaslevante.es`.
7. Abre el presupuesto, ya aceptado: en «Constancia» se ve quién lo envió y el nombre con el que se aceptó (la IP y el navegador, en un desplegable). Pulsa «Convertir en factura».
8. En la factura, pulsa «Descargar PDF» y elige «Guardar como PDF» en el diálogo de impresión.
9. Mira en el Panel «Obras en pérdidas»: la reforma de cocina va en rojo, con su margen negativo en euros. Ábrela para ver el desglose de mano de obra y material.
10. Mira en Materiales cómo ha bajado el stock del material vinculado, y en el Panel cómo cambian «Facturado este mes», la tasa de aceptación y las últimas facturas.

## Presupuesto con IA

En el formulario de presupuesto (alta y edición en borrador) está el panel **«Montar con IA»**. Escribes la obra como se la contarías a un compañero, por ejemplo «reforma de baño de 6 m²: quitar bañera, plato de ducha de 120, alicatado hasta el techo y mampara», y la IA propone las partidas: demoliciones, fontanería, alicatado, mano de obra… con cantidades y unidades. Cuando una partida encaja con un material del almacén, la vincula y usa su precio; la mano de obra y lo que no está en el almacén van sin material, con precio de mercado. A la IA se le pasan como mucho 200 materiales (por orden alfabético): en un almacén más grande, los que queden fuera no se pueden vincular.

- **Las partidas se ponen en el formulario, no se guardan.** Sustituyen a las que hubiera (pedir otra propuesta no las suma: probarla tres veces no triplica el presupuesto); si quieres conservarlas, marca «Añadir detrás de las partidas actuales». Aparecen resaltadas un momento y se editan o se quitan como cualquier otra. Lo que la IA ha tenido que suponer (alturas, calidades…) se muestra en un aviso «La IA ha supuesto:».
- **Misma descripción, mismo presupuesto.** La IA no es determinista, así que la aplicación guarda cada propuesta ya validada con una huella de la empresa, la descripción (sin distinguir mayúsculas, espacios, saltos de línea ni la puntuación del final; los números y las unidades sí cuentan) y el almacén que se le pasa a la IA (materiales, unidades y precios). Si se vuelve a pedir lo mismo, devuelve exactamente las mismas partidas, en el mismo orden y con los mismos supuestos, al momento, sin llamar a la IA y sin gastar cuota; el panel lo indica («Misma descripción que una propuesta anterior: mismas partidas»). Si cambia el almacén (un precio, una unidad, un material nuevo o borrado), se vuelve a pedir. Las propuestas guardadas están en la tabla `ia_propuestas` (migración `0009`): cada empresa lee solo las suyas y solo se escriben gastando un uso de la cuota (ver D14 en `docs/DECISIONES.md`).
- **La respuesta se valida antes de tocar el formulario.** Es un dato no fiable, así que una función del dominio con tests (`src/lib/domain/sugerencias.ts`) la revisa: solo se vinculan materiales del almacén de tu empresa y medidos en su misma unidad (si no, la partida queda sin vincular, con el precio y la unidad de la IA); una partida vinculada lleva siempre el precio del almacén, diga lo que diga la IA; cantidades y precios dentro de los mismos límites que el formulario y redondeados al céntimo; como mucho 30 partidas y textos recortados y sin caracteres de control ni invisibles. Lo que no pasa se descarta y se avisa de cuántas partidas han sido.
- **Es opcional.** Funciona con la API de Anthropic (modelo Claude Opus 5.5, salida estructurada con un esquema JSON). Si no hay `ANTHROPIC_API_KEY` en el servidor, el panel no aparece y el resto de la aplicación funciona igual. La clave solo vive en el servidor: la llamada se hace desde una Server Action y nunca llega al navegador.
- **Cuota de 40 propuestas al día por empresa y 15 por usuario** (día de Madrid), contada en la base de datos antes de llamar a la IA (`consumir_uso_ia()`, migraciones `0005` y `0007`; una descripción repetida no cuenta), para que una clave de demo no se pueda gastar sin control ni un solo usuario deje sin IA al resto. Al pasarla, la aplicación lo dice y vuelve a funcionar al día siguiente. Si la IA no llega a atender la petición (límite de peticiones, clave mal configurada, servicio caído o sin conexión), el uso se devuelve; si responde, aunque sea para rechazarla o con una respuesta que no vale, cuenta, y también si tarda más de 55 segundos, porque puede haber seguido trabajando y cobrándose. La devolución exige una reserva que solo conoce el servidor, así que nadie puede devolverse usos a mano para tenerlos ilimitados.
- **Coste por propuesta** (Claude Opus 5.5: 4 $ por millón de tokens de entrada y 20 $ por millón de salida). Lo normal es bastante menos de lo que sigue: unos pocos miles de tokens de entrada y de salida, del orden de 5 a 15 céntimos de dólar. El peor caso está acotado por la petición: con 200 materiales la entrada se estima en unos 10.000 tokens (no está medido; cada material lleva su identificador), unos 0,04 $, y la salida, contando el razonamiento, tiene un tope de 16.000 tokens (0,32 $). En total, **como mucho unos 0,36 $ por propuesta**, y con la cuota, unos 15 $ al día por empresa en el peor caso. Si la IA rechaza la petición y responde el modelo de respaldo, esa propuesta puede costar algo más.
- Tarda entre 20 y 60 segundos; mientras tanto el panel muestra lo que está haciendo y el tiempo que lleva.

Para activarla:

1. Ten la base migrada entera, hasta la `0009` (la cuota está en la `0005`, la de cada usuario en la `0007` y las propuestas guardadas en la `0009`; ver «Ponerlo en marcha»).
2. Añade `ANTHROPIC_API_KEY` en `.env.local` (y en Vercel, en las variables de entorno del proyecto) y vuelve a arrancar o desplegar.

## Cómo está hecho: equipo de 3 agentes

La aplicación la ha construido un equipo de tres agentes de Claude Code. Cada uno tiene su papel escrito en un fichero del repositorio:

| Agente | Fichero | Papel |
|---|---|---|
| Orquestador | `CLAUDE.md` | Planifica y reparte el trabajo. No programa. Solo cierra una tarea cuando testing devuelve `APROBADO`. |
| develop | `.claude/agents/develop.md` | Programa una tarea concreta siguiendo sus reglas: lógica de negocio pura y con tests, dinero en céntimos, seguridad en la base de datos, entrada validada. |
| testing | `.claude/agents/testing.md` | No escribe código de la app. Revisa lo que entrega develop contra sus directrices y los criterios de la tarea, y devuelve un veredicto: `APROBADO` o `RECHAZADO` con la lista de fallos. |

El bucle de cada tarea:

1. El orquestador toma la siguiente tarea del plan y se la encarga a develop con un brief cerrado: objetivo, criterios de aceptación numerados (salen de los requisitos) y ficheros que puede tocar.
2. develop programa, ejecuta `lint`, `typecheck`, `test` y `test:pglite` (y `build` si toca rutas), y devuelve un informe con un criterio por línea.
3. testing vuelve a ejecutar los comandos, comprueba cada criterio y razona un caso real de una empresa de reformas.
4. Si hay fallos, vuelven a develop tal cual y se repite la revisión (máximo 3 vueltas; a la tercera, la tarea se parte en dos). Si no los hay, la tarea se marca como hecha.

El rastro queda en estos documentos:

- `docs/REQUISITOS.md`: qué tiene que hacer la aplicación (R1–R21). Si no está ahí, no se construye.
- `docs/PLAN.md`: las tareas, los requisitos que cubre cada una y su estado, con las vueltas que hizo falta dar.
- `docs/DECISIONES.md`: decisiones que afectan a varias tareas (modelo de datos, seguridad, rutas, PDF, diseño).
- `docs/AUDITORIA.md`, `docs/AUDITORIA-2.md` y `docs/AUDITORIA-3.md`: las tres auditorías externas de seguridad y calidad, y sus hallazgos.

### Lo que testing devolvió a develop

| Tarea | Qué encontró testing | Cómo se corrigió |
|---|---|---|
| T1 · Lógica de dominio | Un importe escrito como `"1.500"` se leía como 1,50 € en vez de 1.500 €. | El punto seguido de grupos de tres cifras se lee como separador de miles, con tests. Aprobada a la segunda vuelta. |
| T6 · Presupuestos | Se podía enviar un presupuesto sin partidas. Si el cliente lo aceptaba, quedaba un presupuesto aceptado de 0 € que ya no se podía editar ni facturar. | Se corrigió en la aplicación y en la base de datos (un trigger no deja pasar a «enviado» un presupuesto sin partidas). Además, el guardado del presupuesto con sus partidas pasó a ser atómico, con una función SQL (`0003_guardar_presupuesto.sql`). |
| Auditoría externa ([`docs/AUDITORIA.md`](docs/AUDITORIA.md)) | Una revisión independiente, hecha después de aprobar T1–T10, encontró lo que el bucle no vio: cualquiera podía registrarse y entrar como empleado, un empleado podía dar por aceptado un presupuesto vencido, la factura cambiaba si se editaba el cliente y los totales de los listados salían mal a partir de 1000 partidas. | Se corrigió en T11a (base de datos, `0004_auditoria.sql`) y T11b (aplicación): alta solo por invitación, aceptación interna solo para gerencia y con constancia, factura con copia fija y NIF, totales en SQL y listados paginados, límites en la base, enlace revocable y cabeceras de seguridad. |
| T11a · Base de datos de la auditoría | La cantidad máxima de una partida era distinta en la app (1.000.000.000) y en la base (`numeric(12,3)`, que no llega). | La base pasó a `numeric(13,3)` con un `CHECK` del mismo máximo que la app. Aprobada a la tercera vuelta. |
| Segunda auditoría ([`docs/AUDITORIA-2.md`](docs/AUDITORIA-2.md)) | Tras IA y obras, dio por bueno el aislamiento entre empresas, los roles y la facturación, pero vio que un empleado podía aceptar un presupuesto por el enlace como si fuera el cliente, que con la base y el % consumido se reconstruía el margen que se le ocultaba, y varios límites que solo ponía la app (NIF, horas por día, fechas de los partes, borrado de aceptados). | T17a (`0007_auditoria2.sql`, tests de base de datos en PGlite y CI) y T17b (aplicación): la aceptación pide el nombre y guarda IP, navegador y quién lo envió; el encargado ve solo el semáforo; cuota de IA por usuario; esas reglas pasan a la base y el README dice lo que no se puede evitar. |
| Tercera auditoría ([`docs/AUDITORIA-3.md`](docs/AUDITORIA-3.md)) | Sin bloqueantes ni fallos de seguridad. Vio que la validez se contaba desde la creación y no desde el envío, que el coste de un material no se podía poner desde la app, que un presupuesto de 0 € se podía enviar y facturar, que el empleado podía leer por la API la IP y el navegador de la aceptación, y detalles de documentación, código muerto y datos de demo. | T18 (`0008_auditoria3.sql` y aplicación): validez desde el envío, coste en el formulario de materiales (solo gerencia), sin envíos de 0 €, nombre de quien envió copiado al enviar, IP y navegador en una tabla que solo lee gerencia, pantallas de error en español y contactos de demo ficticios. |

## Arquitectura

**Stack**: Next.js 15 (App Router), TypeScript estricto, Tailwind CSS 4, Supabase (Postgres + Auth) y Vercel. Sin librerías de interfaz ni de PDF.

```
src/
  app/
    (app)/            zona privada: panel, clientes, presupuestos, obras, facturas, materiales
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
  config.toml         configuración de la CLI local (no cambia el proyecto en la nube)
scripts/
  test-db.mjs         tests de la base de datos contra el Supabase real
tests/db/             tests de la base de datos en PGlite (Postgres en local, sin Supabase)
.github/workflows/    CI: lint, typecheck, tests, build y tests de la base en PGlite
docs/                 requisitos, plan, decisiones y auditoría
```

Decisiones clave:

- **Lógica de negocio pura en `src/lib/domain`**. Importes, totales, estados, validación de formularios (NIF incluido), paginación, stock y cifras del panel son funciones sin dependencias de Next ni de Supabase, cada una con sus tests.
- **Dinero en céntimos enteros** (`bigint` en la base). Nunca se suman euros con decimales. El IVA se calcula una sola vez sobre la base total y se redondea al céntimo; solo se formatea a euros al pintar.
- **La seguridad está en la base de datos**, no en ocultar botones:
  - Alta solo por invitación: un usuario nuevo solo tiene perfil (empresa y rol) si su email está en la tabla `invitaciones` y lo ha confirmado; la invitación queda usada. Sin perfil no ve nada. Que el registro público esté cerrado depende del interruptor del panel de Supabase (paso 2 de «Ponerlo en marcha»): `config.toml` solo vale para la CLI en local.
  - RLS en todas las tablas: cada usuario solo ve los datos de su empresa.
  - Los roles se comprueban en SQL: las facturas solo las lee un admin y solo se crean con la función `facturar_presupuesto()`, que numera, guarda la copia fija de la factura, descuenta el stock y cambia el estado en una sola transacción.
  - Las transiciones de estado (borrador → enviado → aceptado → facturado, o rechazado desde enviado) y el bloqueo de las partidas fuera de borrador se imponen con triggers. Dar por aceptado un presupuesto desde la app solo lo puede hacer gerencia y con la validez vigente (contada desde el envío); se guarda quién lo hizo y por dónde (`aceptado_por`, `aceptado_canal`). No se envía un presupuesto sin partidas ni de 0 €.
  - Límites de longitud, cantidad e importe también en la base (`CHECK`), con los mismos valores que la app. El NIF se valida con su letra o dígito de control en la app y en la base (`nif_valido()`). Los partes, como mucho 24 h por persona y día y con 30 días de antigüedad como mucho. Un presupuesto aceptado o facturado no se borra.
  - **El encargado ve solo el semáforo de sus obras**: la vista `obras_resumen` le da el `semaforo` y deja a null los importes y el % consumido, que con la base del presupuesto permitiría calcular el margen. Los costes copiados en los partes y el coste de los materiales siguen siendo legibles por la API dentro de la empresa: no es un secreto fuerte (ver «Límites conocidos»). El coste de un material solo lo pone o cambia gerencia (trigger).
  - El rol anónimo no tiene permisos sobre ninguna tabla. El enlace público usa solo dos funciones, `presupuesto_publico()` y `aceptar_presupuesto()`, que reciben el token del enlace.
  - La aplicación usa únicamente la URL del proyecto y la clave anónima; no hay clave de servicio.
- **Aceptación por enlace**: el enlace es al portador. Quien lo tenga puede aceptar el presupuesto, también un empleado desde una ventana de incógnito, y eso no se puede impedir sin dar cuentas a los clientes. Por eso se deja constancia:
  - el cliente escribe su nombre y apellidos para aceptar (obligatorio, de 2 a 120 caracteres);
  - la Server Action saca la IP (`x-forwarded-for` o `x-real-ip`) y el navegador (`user-agent`) de la petición; el nombre queda en el presupuesto (`aceptado_nombre`) y la IP y el navegador en la tabla `presupuesto_aceptaciones`, que solo puede leer gerencia (un empleado no los ve ni por la API);
  - al marcarlo como enviado se guarda quién lo hizo y una copia de su nombre en ese momento (`enviado_por`, `enviado_por_nombre`): la constancia no cambia aunque luego cambie el nombre de su perfil;
  - el detalle del presupuesto lo enseña: «Aceptado por … desde el enlace el …», y gerencia ve la IP y el navegador en un desplegable.

  La IP y el navegador los manda el servidor de la app, pero quien llame a la función directamente con la clave anónima puede inventarlos: son **evidencia razonable, no una prueba forense**. Si el cliente lo confirma por otra vía, gerencia lo da por aceptado desde la app y se guarda quién lo hizo (`aceptado_por`, canal `interno`).
- **Totales en SQL**: los listados leen la vista `presupuestos_con_totales` y paginan de 25 en 25; no se traen las partidas.
- **Server Components para leer y Server Actions para escribir**.
- **Cabeceras de seguridad** en `next.config.ts`: CSP con `frame-ancestors 'none'`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` (`no-referrer` en el enlace público), `Permissions-Policy` y `Strict-Transport-Security`.
- **PDF con la vista de impresión del navegador**: la factura tiene estilos de impresión en A4 y el botón «Descargar PDF» abre el diálogo de imprimir.

## Calidad

- `npm test`: tests de la lógica de dominio y de la regla de rutas públicas del middleware (Vitest).
- `npm run test:pglite`: tests de la base de datos en PGlite (Postgres en local, sin Supabase ni contraseñas). Aplican `0001` → `0009` y el seed y comprueban RLS, roles, triggers y funciones como anónimo, empleado, gerencia y otra empresa.
- **CI** en GitHub Actions: en cada push y pull request a `main` ejecuta `npm run check`, que ya incluye `test:pglite`.

```bash
npm run lint         # ESLint
npm run typecheck    # TypeScript sin emitir
npm test             # Vitest (dominio)
npm run test:pglite  # base de datos en PGlite
npm run build        # build de producción (lo que despliega Vercel)
npm run check        # lint, typecheck, test, test:pglite y build, en orden
```

Cifras: `npm test`, 710 tests en 28 ficheros; `npm run test:pglite`: 138 tests en 9 ficheros.

**Tests de la base de datos** (`npm run test:db`): entran en el Supabase real como anónimo, como obra (empleado) y como gerencia (admin), y comprueban qué puede y qué no puede hacer cada uno. Por ejemplo: que el anónimo no lee ninguna tabla ni puede registrarse, que nadie ve los datos de otra empresa, que obra no puede dar por aceptado un presupuesto ni regenerar el enlace, que la aceptación por enlace queda con canal `enlace`, que la vista de totales cuadra con las partidas y que regenerar el enlace deja inservible el anterior. No forman parte de `npm test` porque necesitan las contraseñas, que solo se pasan por variable de entorno:

```bash
TAJO_PASS_GERENCIA=... TAJO_PASS_OBRA=... npm run test:db
```

Necesitan la base migrada entera (hasta `0009`) y el seed recién ejecutado. Crean datos con el prefijo `[test]` y los borran al final, pero consumen números de presupuesto: no los ejecutes contra una base con datos reales.

## Ponerlo en marcha

Hace falta Node.js 22.12 o superior (lo pide Vitest 5 para los tests) y una cuenta de Supabase.

1. Crea un proyecto en Supabase.
2. En Authentication → Sign In / Providers, desactiva «Allow new users to sign up». Sin esto, cualquiera con la clave anónima podría crearse una cuenta (no tendría perfil ni vería nada, pero no hace falta dejarle entrar). Este interruptor es el que cierra el registro en la nube: `supabase/config.toml` solo vale para la CLI en local.
3. En el SQL Editor, ejecuta en este orden, pegando cada fichero entero:
   1. `supabase/migrations/0001_esquema.sql`
   2. `supabase/migrations/0002_reglas.sql`
   3. `supabase/migrations/0003_guardar_presupuesto.sql`
   4. `supabase/migrations/0004_auditoria.sql`
   5. `supabase/migrations/0005_uso_ia.sql` (la cuota de «Montar con IA»; ejecútala aunque no vayas a usar la IA, para seguir el mismo orden)
   6. `supabase/migrations/0006_obras.sql` (obras, partes de trabajo y margen; el seed la necesita)
   7. `supabase/migrations/0007_auditoria2.sql` (correcciones de la segunda auditoría: evidencia de la aceptación, semáforo, NIF, partes y cuota por usuario)
   8. `supabase/migrations/0008_auditoria3.sql` (correcciones de la tercera auditoría: validez desde el envío, sin envíos de 0 €, nombre de quien envió fijo, IP y navegador solo para gerencia)
   9. `supabase/migrations/0009_ia_cache.sql` (propuestas de IA guardadas: misma descripción, mismo presupuesto; el seed la necesita)
4. Crea los dos usuarios en Authentication → Add user, marcando *Auto Confirm User* (el perfil solo se crea con el email confirmado): `gerencia@reformaslevante.es` y `obra@reformaslevante.es`, con la contraseña que quieras.
5. En el SQL Editor, ejecuta `supabase/seed.sql` entero de una vez: invita a los dos usuarios, les crea el perfil (gerencia como admin) y carga los datos de demo.
6. Copia `.env.example` a `.env.local` y rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la URL y la clave anónima del proyecto (están en los ajustes de API de Supabase).
7. Instala y arranca:

   ```bash
   npm install && npm run dev
   ```

   La aplicación queda en `http://localhost:3000`.

No vuelvas a ejecutar `0001`–`0003` sobre una base que ya tiene la `0004`: redefinen funciones que la `0004` cambia. El orden completo es `0001` → `0002` → `0003` → `0004` → `0005` → `0006` → `0007` → `0008` → `0009` → `seed.sql`. Sobre una base que ya tenía hasta la `0007`, basta con ejecutar la `0008` y la `0009`, desplegar justo después la versión de la aplicación que la usa y volver a ejecutar `seed.sql` (cambia los contactos de demo por los ficticios de D13). Sobre una base que ya tiene hasta la `0008` (como la de la demo), basta con ejecutar la `0009`: solo añade una tabla y una función, no toca datos y se puede aplicar antes o después de desplegar (sin ella, la aplicación nueva funciona como antes, sin guardar propuestas). No hace falta volver a ejecutar el seed.

**Dar de alta a alguien más**: primero la invitación en el SQL Editor y después el usuario en Authentication → Add user, con *Auto Confirm User* marcado. Al crearse el usuario, su perfil sale de la invitación.

```sql
insert into public.invitaciones (email, empresa_id, rol)
values ('nombre@reformaslevante.es', '00000000-0000-0000-0000-000000000001', 'empleado');
```

**En Vercel**: importa el repositorio y define las mismas dos variables de entorno. Antes, comprueba en Supabase los pasos 2 a 5: registro desactivado, las ocho migraciones y el seed. Las cabeceras de seguridad van en `next.config.ts`; en Vercel no hay que configurarlas. `vercel.json` ejecuta las funciones en Dublín (`dub1`), junto a la base de Supabase (eu-west-1): cada página hace varias consultas y en la región por defecto (Washington) cada una cruzaba el Atlántico. Si tu proyecto de Supabase está en otra región, cambia `regions` por la más cercana.

## Límites conocidos

- **La demo es compartida.** Todos los evaluadores entran con los mismos dos usuarios: la cuota de «Montar con IA» (15 propuestas por usuario y día, 40 por empresa) y la guía de la demo, que se marca con lo que ha pasado hoy en los datos, son comunes. Si alguien termina la obra «Reforma de cocina», factura los aceptados o cambia los datos, el recorrido sugerido deja de cuadrar. Se restaura volviendo a ejecutar `supabase/seed.sql` en el SQL Editor: borra y vuelve a crear los datos de demo de las dos empresas (no borra los usuarios ni la cuenta de usos de IA del día).
- **Una sola empresa de demo.** El modelo de datos y la RLS separan los datos por empresa, pero no hay alta de empresas ni pantalla de invitaciones: los usuarios nuevos se invitan desde el SQL Editor.
- **Los usuarios se crean en el panel de Supabase.** No hay pantalla de usuarios, de cambio de rol ni de recuperación de contraseña. Al crearlos con «Add user» hay que marcar *Auto Confirm User*: el perfil solo se crea con el email confirmado. Un usuario que se registró y confirmó su email antes de ser invitado no recibe perfil al invitarlo: hay que borrarlo y volver a crearlo después de la invitación.
- **IVA del 21 % o del 10 %**, uno por presupuesto (no por partida).
- **No se envían correos.** El enlace del presupuesto se copia y se manda a mano, o con «Enviar por WhatsApp», que solo abre WhatsApp con el mensaje escrito: lo envía la persona.
- **El coste por hora de la empresa** (26 € en la demo) no se cambia desde la aplicación: no hay pantalla de configuración. Cada parte guarda el coste por hora que había al apuntarlo.
- **El stock no se descuenta con los partes de obra**, solo al facturar, para no contarlo dos veces.
- **El enlace del presupuesto es al portador.** Quien lo tenga puede aceptarlo, también alguien de la empresa. Se guarda el nombre que escribe, la IP y el navegador (estos dos, solo para gerencia), que son evidencia razonable pero no una prueba forense (se pueden inventar llamando a la base directamente). No hay firma electrónica ni código por SMS o correo. Gerencia puede darlo por aceptado si el cliente se lo confirma por otra vía (queda registrado quién lo hizo). El rechazo lo marca la empresa desde la aplicación.
- **El margen no es un secreto fuerte para el encargado.** En pantalla y en `obras_resumen` solo ve el semáforo, pero los costes copiados en los partes, el coste por hora y el coste de los materiales siguen siendo legibles por la API para cualquiera de la empresa.
- **El PDF depende del navegador**: se genera con su diálogo de impresión, así que márgenes y cabeceras pueden variar de uno a otro.
- **Las facturas no se editan ni se anulan** (no hay facturas rectificativas). La forma de pago no se configura: la factura dice «Según lo acordado con la empresa», porque no hay dónde guardar un IBAN. Las facturas emitidas antes de la `0004` se copiaron con los datos que tenía el cliente al aplicarla y sin NIF.
- **El stock puede quedar en negativo** si se factura más material del que hay. No se bloquea la factura: el material sale como stock bajo y su pantalla de edición lo avisa.
- **Paginación** en clientes, presupuestos, obras, partes de una obra y facturas (25 por página). No están paginados el almacén de materiales, los desplegables de clientes y materiales del formulario de presupuesto ni los materiales del panel: a partir de 1000 filas (el máximo de la API de Supabase) se cortan sin avisar.
- **Cuota de «Montar con IA»**: 40 propuestas al día por empresa y 15 por usuario.
- **La búsqueda de clientes** es solo por nombre y distingue acentos («garcia» no encuentra «García»).
- **La CSP no limita los scripts** (no hay `script-src`): Next 15 usa scripts en línea y restringirlos exige un nonce por petición. Sí impide meter la app en un iframe, los formularios hacia otras webs y los plugins.
- **Las pantallas y las Server Actions no tienen tests automáticos.** La lógica de dominio sí (`npm test`) y las reglas de la base también, en PGlite (`npm run test:pglite`, también en la CI) y contra el Supabase real (`npm run test:db`).
