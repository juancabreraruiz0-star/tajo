# Segunda auditoría externa (2026-11-24)

Revisión independiente, con un agente nuevo, de todo el proyecto tras T12–T16 (IA, rediseño y obras). Atacó la base de datos en PGlite con 114 pruebas. Sus hallazgos se corrigen en T17a y T17b (ver `PLAN.md` y la decisión D12).

No he tocado ningún fichero del proyecto ni he hecho commits. No he llamado a Supabase ni a Anthropic, no he iniciado sesión y no he leído `credenciales-demo.txt` ni `.env.local`. El build lo hice en una copia. La unión a `node_modules` que usé ya está quitada.

**Resultado de los comandos:**
- `npm run lint` y `npm run typecheck`: limpios.
- `npm test`: pasan 642 tests en 25 ficheros.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- `next build` (en la copia): pasa, con 22 rutas dinámicas.
- En `.next/static` no aparecen ni la clave ni el prompt ni nada de `ANTHROPIC`/`SUPABASE`.

**Ataques en PGlite** (0001→0006 + `seed.sql`, con un andamio de Supabase que incluye los privilegios por defecto de Supabase): **93 OK, 2 VULN y 19 INFO**. Lo que he usado:
- Script: `ataques.mjs` (copia local del auditor; sus pruebas se incorporan al repo en T17a) (se lanza con `node ataques.mjs`).
- Salida: `salida_ataques.txt` (copia local del auditor; sus pruebas se incorporan al repo en T17a).

---

## 1. Hallazgos por gravedad

**Crítica:** ninguna.

### ALTA

**A1. El repositorio público no contiene la app que describe el README ni la que se ve en la demo**
- **Dónde:** `git status`. `main` está igual que `origin/main` (commit `a7ac013`, T11), pero hay 55 ficheros modificados y 39 sin seguimiento: `0005_uso_ia.sql`, `0006_obras.sql`, `src/lib/ia/`, `src/lib/actions/ia.ts` y `obras.ts`, `src/app/(app)/obras/`, gráficas, la guía, el README nuevo y otros.
- **Qué pasa:** quien clone https://github.com/juancabreraruiz0-star/tajo ve la versión T11, sin IA ni obras y con otro README. Si Vercel despliega desde Git, tampoco incluye nada de esto.
- **Cómo se corrige:** hacer commit de todo en commits con sentido (T12–T16), hacer push y volver a desplegar. Después, comprobar que el `README.md` de GitHub es este.

**A2. «Solo gerencia puede dar por aceptado» se salta abriendo el enlace público, y queda registrado como si lo hubiera aceptado el cliente** (probado en PGlite: VULN)
- **Dónde:**
  - Cualquier empleado puede leer el `token`: `0001_esquema.sql:559-562` y la vista `presupuestos_con_totales` (`0004:572`).
  - `aceptar_presupuesto` está concedida a `anon`: `0004_auditoria.sql:996-999`.
  - `src/lib/actions/publico.ts:16-27`: la Server Action no mira la sesión y usa el cliente anónimo, así que la puede ejecutar cualquiera.
  - `src/app/p/[token]/page.tsx:60-71`: solo esconde el botón a quien tiene sesión.
- **Cómo se reproduce:**
  1. El empleado lee `presupuestos.token`.
  2. Abre `/p/<token>` en incógnito, o llama a la acción con un POST, y pulsa Aceptar.
  3. Resultado en PGlite: `estado=aceptado`, `aceptado_canal='enlace'`, `aceptado_por=null`, y se crea su obra. No se distingue de una aceptación real del cliente.
  - Lo hace también con un presupuesto de la validez vigente. Los vencidos sí se bloquean.
  - **El propio README lo enseña:** el paso 1 es «Entra como obra» y el paso 4 «Abre el enlace en una ventana de incógnito… Aceptar presupuesto».
  - Esto deja sin efecto la corrección del hallazgo 2 de la auditoría anterior.
- **Cómo se corrige:**
  - Guardar evidencia de la aceptación (IP, user agent, nombre o DNI que teclea el cliente, quizá un OTP por SMS o email). Además, no dar el token en claro a los empleados: que solo lo vea quien lo envía, o que exista un estado «enviado por X».
  - Como mínimo: registrar en `presupuestos` quién envió el presupuesto, y en la aceptación por enlace la IP y el user agent que reenvía la acción (`headers()`), para que se pueda auditar.
  - Corregir el texto del README y cambiar el recorrido de la demo para que la aceptación la haga «el cliente», no el empleado.

### MEDIA

**M1. Los importes que se ocultan al empleado se pueden reconstruir, en pantalla y por la API** (probado: VULN)
- **Dónde:**
  - `0006_obras.sql:967-976`: `consumido_pct` es visible para todos.
  - `0006:1022-1033` y `0001:622`: el empleado lee todas las columnas de `materiales` (también `coste_cents`), de `empresas` (`coste_hora_cents`), de `partes` (`coste_hora_cents`) y de `parte_materiales` (`coste_unit_cents`).
  - `src/app/(app)/obras/[id]/page.tsx:67-71`: las pantallas solo omiten esas columnas.
- **Cómo se reproduce:**
  - En pantalla: el empleado ve la base del presupuesto (en su detalle) y el % consumido de la obra. Coste ≈ base × %, y margen ≈ base × (1 − %).
  - Por la API: en PGlite reconstruí el margen exacto (−22.930 céntimos, igual al real) con tablas que el empleado puede leer.
  - El SQL lo reconoce (`0006:18-20`), pero el README dice «sin euros» (`README.md:9`) y «sin importes de coste ni margen» (`:22`).
- **Cómo se corrige:**
  - Revocar el `select` por columnas sobre `coste_cents` y `coste_hora_cents`, y no conceder `coste_hora_cents` ni `coste_unit_cents` en `partes` y `parte_materiales`.
  - Que el empleado reciba solo el semáforo (verde/ámbar/rojo), no el %.
  - O bien decir en el README con claridad que no es un secreto.

**M2. No hay límite de peticiones propio en el login ni en las acciones públicas** (no probado contra Supabase)
- **Dónde:** `src/lib/actions/auth.ts:13-30` y `src/lib/actions/publico.ts`.
- **Qué pasa:** `signInWithPassword` se ejecuta en el servidor de Next, así que Supabase ve la IP de Vercel y no la del atacante. Su límite por IP pasa a ser global para toda la app:
  - un atacante puede bloquear el login de todos los usuarios (DoS);
  - la fuerza bruta solo la frena ese mismo límite compartido.
- **Cómo se corrige:** limitar por IP y por email en el propio servidor (por ejemplo con Upstash o Vercel KV), activar CAPTCHA o protección contra fuerza bruta en Supabase, y exigir una política de contraseñas.

**M3. «Montar con IA» puede agotar el tiempo en directo, y aun así cuenta el uso y se cobra**
- **Dónde:** `src/lib/ia/cliente.ts:27` (corte a los 55 s), `:74-82` (petición sin streaming con `max_tokens: 16000`, Opus 5.5 y `effort: "medium"`); `README.md:48` («Tarda entre 20 y 60 segundos»).
- **Qué pasa:** el tiempo normal roza el corte. Cuando se pasa, el uso no se devuelve (`devolver:false`) y el usuario ve un error. En una demo en directo es un riesgo real.
- **Cómo se corrige:** medir la latencia real y elegir según lo medido:
  - probar `effort: "low"` y un `max_tokens` menor;
  - o hacer streaming hacia la UI;
  - o aceptar el riesgo y advertirlo antes de la demo.

**M4. Lo más importante (RLS, triggers, Server Actions) no tiene tests automáticos que se puedan reproducir**
- Los 642 tests son de dominio puro.
- `npm run test:db` necesita el Supabase real y las contraseñas (`scripts/test-db.mjs:1-24`), y además consume numeración.
- El banco PGlite de «124 comprobaciones» que cita el README no está en el repo.
- No hay CI (no existe `.github/`). Las Server Actions, entre ellas el orden consumir → IA → devolver de `ia.ts`, no tienen tests.
- **Cómo se corrige:** meter en el repo un test de base de datos con PGlite o pgTAP que corra en `npm test` o en CI (mi `ataques.mjs` sirve de base), y añadir un workflow de GitHub Actions con `npm run check`.

### BAJA

**B1. Un empleado deja sin IA a toda la empresa en un día** (probado)
- **Dónde:** `0005_uso_ia.sql:79-124` (la cuota es solo por empresa).
- **Cómo se reproduce:** 40 llamadas RPC a `consumir_uso_ia()` sin llamar a la IA dejan la cuota en 40/40 (TJ002 para todos).
- El coste sigue acotado (unos 14 $ al día por empresa). La reserva y la devolución funcionan bien: una reserva no se devuelve dos veces ni la devuelve otro usuario.
- **Cómo se corrige:** añadir un sublímite por usuario, o no conceder `consumir_uso_ia()` a `authenticated` y llamarla desde una función que haga también la llamada (en este diseño no se puede sin una clave de servicio). Lo más sencillo es la cuota por perfil.

**B2. El NIF solo se valida en la app** (probado)
- **Dónde:** `0004:188` (`nif ~ '^[A-Z0-9]{9}$'`).
- **Qué pasa:** por la API se guarda `12345678A` (la letra correcta es Z), y se copiaría tal cual a la factura.
- **Cómo se corrige:** una función SQL de validación (el seed ya tiene el algoritmo, en `seed.sql` sección 12) dentro de un CHECK o del trigger `clientes_normalizar`.

**B3. Partes de trabajo: sin tope diario y con fechas hacia atrás** (probado)
- Un mismo autor apuntó 121 h en un día (5 partes de 24 h más 1 h), así que puede inflar el coste de una obra.
- El encargado puede retrasar un año `fecha_inicio` en una obra en curso (`0006:1023` concede update sobre esa columna, aunque no hay pantalla para hacerlo). Después cualquiera apunta partes con fecha de hace 300 días (`0006:557-562` solo exige `fecha ≥ inicio`).
- **Cómo se corrige:** tope de 24 h por autor y día (en un trigger o con un índice y una suma), ventana máxima para la fecha del parte (por ejemplo 7 días) y quitar el grant de `fecha_inicio` cuando la obra ya ha empezado.

**B4. Gerencia puede borrar un presupuesto ya aceptado por el cliente si su obra no tiene partes** (probado)
- **Dónde:** `0001:575-578` (la política no mira el estado).
- **Qué pasa:** se pierde la constancia de la aceptación y desaparece la obra.
- **Cómo se corrige:** permitir borrar solo en borrador o rechazado, o hacer un borrado lógico.

**B5. Datos que entran por RPC sin validar en la base** (probado)
- `guardar_presupuesto` redondea en silencio `cantidad 1.0005` a `1.001` (columna `numeric(13,3)` en `0004:900-904`).
- Acepta `orden` negativo o repetido.
- La app lo valida antes, así que el impacto se queda dentro de la propia empresa.
- **Cómo se corrige:** comprobar en la función `cantidad = round(cantidad,3)` y `orden > 0`, y poner `unique(presupuesto_id, orden)`.

**B6. Hay consultas sin paginar que se cortan en silencio a 1000 filas** (el `max_rows` de PostgREST)
- `src/app/(app)/presupuestos/opciones-formulario.ts:12-17`: todos los clientes y materiales del formulario.
- `src/app/(app)/page.tsx:127-131`: materiales del panel.
- `src/app/(app)/materiales/page.tsx:64-67`.
- El README solo reconoce el caso del almacén. Con más de 1000 clientes, el desplegable del formulario pierde clientes sin avisar.
- **Cómo se corrige:** un buscador o combobox con consulta paginada para clientes y materiales, y contar los materiales bajo mínimo en SQL.

**B7. Las invitaciones no se consumen ni caducan, y el perfil se crea al insertar en `auth.users`, antes de confirmar el email**
- **Dónde:** `0004:235-266`.
- **Qué pasa:** si el registro se abriera y la confirmación de email estuviera desactivada, quien se registrara primero con un email invitado se quedaría con su rol. Además, al dar de baja a alguien queda su invitación viva.
- Hoy el riesgo está cerrado por el paso manual 2 del README, que `test:db` comprueba.
- **Cómo se corrige:** borrar la invitación al usarla (o guardar `usada_at`), ponerle caducidad, y crear el perfil solo si `email_confirmed_at` no es nulo (con un trigger en el UPDATE de `auth.users`).

**B8. Carreras sin bloqueo entre «terminar obra» y «añadir parte»**
- **Dónde:** `0006:509-524`. `partes_reglas` y `parte_materiales_reglas` leen el estado de la obra sin `for share`.
- **Qué pasa:** pueden entrar partes en una obra que se está terminando a la vez. No lo he probado porque PGlite tiene una sola conexión.
- **Cómo se corrige:** leer la obra con `for share` en el trigger.

**B9. La CSP no limita los scripts**
- **Dónde:** `next.config.ts:16-22`. No hay `script-src` ni `default-src`, así que si hubiera una XSS la CSP no la frenaría.
- React escapa todo, no hay `dangerouslySetInnerHTML` y el README lo reconoce (`:200`).
- **Cómo se corrige:** CSP con nonce desde el middleware (`'strict-dynamic'`).

### INFORMATIVA

- **I1.** Los costes (`materiales.coste_cents` y `empresas.coste_hora_cents`) no se pueden editar desde la app, solo por SQL. Un material nuevo sin coste usa el precio de venta, así que el margen sale pesimista.
- **I2.** Las funciones `security definer` fijan `search_path=public` (en vez de `''` o `pg_catalog, public, pg_temp`). Todas las referencias van cualificadas y PostgREST no permite crear objetos temporales, así que no es explotable. Es una mejora de estilo.
- **I3.** `src/lib/ia/cliente.ts` y `src/lib/supabase/server.ts` no importan `server-only`. Que no lleguen al navegador depende de una convención; hoy no llegan, lo he comprobado en el bundle.
- **I4.** Las funciones de trigger tienen EXECUTE para `anon` por los privilegios por defecto de Supabase. No se pueden invocar por RPC (Postgres no deja llamar a una función de trigger fuera de un trigger), así que es inocuo.
- **I5.** `originFromHeaders` (`src/lib/domain/presupuestos.ts:254-265`) se fía de `X-Forwarded-Host`. En Vercel no es un problema. Detrás de otro proxy, el enlace de WhatsApp podría salir con otro host, pero solo para quien manda esa cabecera.
- **I6.** Las migraciones se siguen aplicando pegándolas a mano. Existe `config.toml`, pero no se usan `supabase db push` ni `migration up`, y no se pueden volver a ejecutar 0001–0003 (`README:175`).
- **I7.** No hay prompt caching. El system prompt es corto y probablemente no llega al mínimo cacheable, así que no hay ahorro que sacar.

---

## 2. Estado de los hallazgos de `docs/AUDITORIA.md`

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Registro abierto → empleado | **Corregido en la base de datos.** `handle_new_user` solo crea perfil a los invitados (probado: un usuario sin invitación no tiene perfil ni ve nada; el email se compara con lower y trim). Que el registro esté cerrado depende del panel de Supabase: `config.toml` solo afecta a la CLI local, y el README lo pide en el paso 2. Queda lo de B7. |
| 2 | Aceptación interna de cualquier empleado | **Parcial.** El trigger exige admin y validez vigente y guarda `aceptado_por` y `aceptado_canal` (probado). Pero el empleado acepta por el enlace como si fuera el cliente (A2), y no se guarda IP ni user agent. |
| 3 | La factura cambia después de emitirse; falta el NIF | **Corregido.** Copia fija y `factura_lineas`; la pantalla pinta desde la copia. Inmutable incluso para `postgres` (probado). Facturar sin NIF da TJ001 y no consume número (probado). Queda B2: el NIF no se valida en la base. |
| 4 | Totales en JS y sin paginar | **Corregido** en presupuestos, facturas, clientes y obras (vista SQL y `.range()`). Quedan B6 (formulario, panel y materiales). |
| 5 | Límites solo en Next | **Corregido en lo principal:** CHECK, `bigint`, `numeric(13,3)`, 100 partidas (probado). Queda B5 (redondeo silencioso y `orden`). |
| 6 | `created_at` y `token` elegibles al crear | **Corregido** (lo fuerza el trigger de alta). |
| 7 | Enlace no revocable | **Corregido en parte.** Existe `regenerar_enlace` (solo admin, probado). Los enlaces siguen sin caducar: rechazados y facturados se ven para siempre si no se regenera. |
| 8 | Sin cabeceras | **Corregido en parte.** CSP sin `script-src` (B9); el resto de cabeceras está bien. |
| 9 | Marca `tajo.seed` | **Corregido** (exige `current_user='postgres'`). Probado: un empleado no salta triggers con `tajo.seed`, y gerencia no pasa a facturado con `tajo.facturando`. |
| 10 | Migraciones frágiles | **No corregido** (I6). Solo está mejor documentado. |
| 11 | Seed de enero | **Corregido** (numera por el año de la fecha). |
| 12 | Base de datos sin tests | **Parcial.** Existe `test:db` contra el Supabase real, pero no es reproducible sin credenciales ni está en CI (M4). |
| 13 | Credenciales y dependencias | **Corregido.** El login ya no muestra los emails; `overrides` de postcss y audit a 0. `credenciales-demo.txt` sigue en local (ignorado por git): no lo metas en un zip. |

---

## 3. Lo que está bien (comprobado)

- **Aislamiento entre empresas** (probado con un admin de otra empresa):
  - no ve ninguna tabla ni vista de E1;
  - no factura ni regenera presupuestos ajenos;
  - no inserta clientes, partidas ni partes en E1;
  - no asigna como encargado a un perfil de otra empresa (lo para la FK compuesta);
  - un presupuesto con el `empresa_id` de otra empresa no mueve su contador.
- **Escalada de rol:** imposible. Solo hay permiso de update sobre `perfiles.nombre`; las invitaciones no se pueden leer ni escribir desde la API.
- **`anon`:**
  - sin permisos en ninguna tabla ni vista;
  - solo ejecuta `presupuesto_publico` y `aceptar_presupuesto`;
  - todas las tablas tienen RLS;
  - el enlace público solo expone los datos de la empresa, el nombre del cliente y las partidas.
- **Funciones `security definer`:** todas fijan `search_path`, comprueban empresa y rol dentro, y las internas (`siguiente_numero`, `crear_factura_copia`, `totales_presupuesto`) no se pueden ejecutar desde fuera.
- **Triggers:**
  - transiciones de estado (R9) y token y número inmutables;
  - partidas bloqueadas fuera de borrador, incluso moviéndolas a otro presupuesto;
  - autor, coste y `created_at` de los partes los pone la base de datos aunque lleguen falsos;
  - en `parte_materiales` solo se puede cambiar la cantidad (grants por columna).
- **Facturación:** atómica, numeración consecutiva (F-2026-0001…0005), no se factura dos veces, facturas inmutables y vencidos no aceptables (ni por gerencia ni por el cliente).
- **IA:**
  - la clave solo está en el servidor;
  - la descripción va dentro de JSON y el system prompt pide tratar las instrucciones que contenga como texto;
  - salida estructurada y validación estricta en `sugerencias.ts`: solo materiales de la empresa, siempre el precio del almacén y límites aplicados;
  - cuota atómica con una reserva que no se puede devolver a mano;
  - mapeo de errores del SDK sin mensajes crudos.
- **Server Actions:**
  - comprueban `isUuid` y los destinos permitidos;
  - repiten la comprobación de rol además de la RLS;
  - `dbErrorMessage` no filtra mensajes internos (solo los propios P0001 y TJ00x);
  - sin redirecciones abiertas;
  - la búsqueda `ilike` escapa `%` y `_`.
- **Accesibilidad y móvil** (por lectura de código):
  - `lang="es"`, enlace «Saltar al contenido», `label` y `aria-describedby` en los campos, `aria-live` en 11 sitios;
  - en móvil, tarjetas en vez de tablas y navegación inferior con `safe-area`;
  - no hay `div` con `onClick` ni `img` sin `alt`.
- **Calidad:** TypeScript estricto; lint, typecheck, tests, build y audit pasan; los SQL vienen con comprobaciones finales de permisos.

---

## 4. Afirmaciones del README que no se corresponden con el código

1. **`README.md:8`, `:120` y `:194`, «gerencia puede darlo por aceptado… queda constancia de quién lo hizo»:** un empleado acepta por el enlace y queda como canal `enlace` (A2). El recorrido de la demo (`:28` y `:31`) hace justo eso.
   - **`:122`, «La aceptación por enlace solo la puede ejecutar el rol anónimo»:** es cierto, pero engaña, porque «anónimo» es cualquiera, empleados incluidos.
2. **`:9` y `:22`, «el encargado ve… sin euros» y «sin importes de coste ni margen»:** se reconstruyen en pantalla (base × %) y por la API (M1).
3. **`:7`, «NIF… se valida con su letra o dígito de control»:** solo en la app; la base acepta letras incorrectas (B2).
4. **`:192`, «coste por hora (25 € en la demo)»:** el seed pone 26 €/h (`seed.sql:52`). `DECISIONES.md:102` repite el 25.
5. **`:47`, «con 200 materiales la entrada ronda los 8.000 tokens»:** no está medido. Cada material lleva un UUID, así que probablemente sean más tokens; el orden de magnitud del coste sí vale. No lo he medido porque no podía llamar a la API.
6. **`:149`, «testing probó… en PGlite, con 124 comprobaciones»:** no se puede reproducir con el repo; el script no está.
7. **`:117`, «el registro público está cerrado»:** depende de un paso manual en el panel (`:156`). `config.toml` solo vale para la CLI local.
8. **`:198`, «El almacén de materiales no está paginado»:** es cierto, pero tampoco lo están el desplegable de clientes y materiales del formulario ni el panel (B6).
9. **En GitHub el README es otro** (A1).

---

## 5. Veredicto

**Todavía no**, por dos motivos que un revisor exigente vería en minutos, aunque la base es sólida: RLS, triggers, facturación inmutable y aislamiento probados con 93 ataques que no pasan.

**Lo que arreglaría sí o sí antes de enseñarlo:**
1. **A1:** commit y push de todo (IA, obras, 0005, 0006, README) y desplegar desde ese commit.
2. **A2:** registrar evidencia de la aceptación por enlace (IP, user agent y algo que identifique al cliente). Cambiar el recorrido de la demo para que no sea el empleado quien acepta, y corregir el README.
3. **M1:** quitar al empleado el acceso a las columnas de coste y mostrarle solo el semáforo, o decir con claridad en el README que el margen no es secreto.
4. **M3:** medir «Montar con IA». Si roza los 55 s, bajar `effort` o `max_tokens`, o avisar antes de la demo.
5. **M4:** meter en el repo un test de base de datos en PGlite que corra en `npm test`, con un workflow de CI mínimo.
6. Corregir las inconsistencias del README (25 € frente a 26 €, el NIF y las comprobaciones en PGlite).

Con eso, y dejando B1–B9 como «límites conocidos» documentados, está para enseñarse.
