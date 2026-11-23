# Auditoría externa de seguridad y calidad (2026-11-23)

Revisión independiente hecha sobre el código ya aprobado por testing (T1–T10). Sus hallazgos se corrigen en T11a y T11b (ver `PLAN.md` y la decisión D9).

Primero revisé el código. El README lo leí al final, solo para contrastarlo. `docs/`, `CLAUDE.md` y `.claude/` no los abrí. No he modificado ningún fichero.

**Comandos de verificación:** `npm run lint` pasa, `npm run typecheck` pasa, `npm test` pasa (323 tests en 14 ficheros) y `npm run build` pasa, con todas las rutas dinámicas. `npm audit --omit=dev` encuentra 1 alta y 1 moderada, las dos en el postcss que viene dentro de next 15.5.29.

---

## Hallazgos

### 1. CRÍTICA (depende de un ajuste de Supabase que el repo no fija): cualquiera puede registrarse y entra como empleado de la empresa
- **Dónde:** `supabase/migrations/0001_esquema.sql:458-481`, en concreto `:468` (empresa fija) y `:471` (rol `'empleado'`). No hay `supabase/config.toml`. `README.md:131` dice «No hace falta nada más».
- **Qué pasa:** el trigger `handle_new_user` da a todo usuario nuevo de `auth.users` un perfil de empleado en Reformas Levante. En Supabase el registro público está activado por defecto, y la clave anónima es pública: es `NEXT_PUBLIC_*` y va en el bundle.
- **Cómo se explota:**
  1. `POST https://<proyecto>.supabase.co/auth/v1/signup` con `apikey: <anon>` y un email propio.
  2. Se confirma el correo. Que la confirmación esté activada no lo impide, porque el buzón es del atacante.
  3. Se entra en la app o se llama a PostgREST directamente.
- **Qué consigue:** lee todos los clientes con teléfono, email, dirección y notas (en el seed hay notas como «Llaves en portería» o «Persona mayor»). Lee todos los presupuestos con sus tokens públicos y los materiales. Puede crear y editar clientes, cambiar el stock y marcar presupuestos como aceptados o rechazados. Es una fuga de datos personales de clientes (RGPD).
- **Corrección:**
  - Desactivar «Allow new users to sign up» y dejarlo fijado en el repo (`config.toml`, `[auth] enable_signup = false`).
  - Cambiar `handle_new_user` para que no asigne empresa ni rol por defecto: que use una tabla de invitaciones (`email, empresa_id, rol`) o que no cree perfil. La app ya manda a `/login?error=perfil` a quien no tiene perfil, así que eso cerraría el acceso.

### 2. MEDIA: cualquier empleado puede dar por aceptado un presupuesto, aunque haya vencido, y no queda constancia de quién lo aceptó
- **Dónde:**
  - `src/lib/actions/presupuestos.ts:148` (`DESTINOS` incluye `"aceptado"`) y `:155-193`.
  - `src/lib/domain/status.ts:28` (`marcar_aceptado` para cualquier rol).
  - El trigger `0003_guardar_presupuesto.sql:143-147` permite `enviado → aceptado` a cualquier `authenticated`.
  - La regla de validez solo está en `aceptar_presupuesto()`, en `0003:225-231`.
- **Cómo se explota:** un empleado ejecuta `PATCH /rest/v1/presupuestos?id=eq.<id>` con `{"estado":"aceptado"}`, o pulsa el botón de la app, sobre un presupuesto con la validez vencida. El trigger lo deja pasar y pone `aceptado_at = now()`. A partir de ahí no se distingue de una aceptación real del cliente por el enlace, y gerencia lo factura.
- **Corrección:**
  - Si la aceptación interna es una función deseada: restringirla a admin, aplicar la regla de validez en el trigger y guardar `aceptado_por` (`auth.uid()`) y `canal` (`enlace` o `interno`).
  - Si no lo es: permitir `→ aceptado` solo cuando lo haga `aceptar_presupuesto()`, con una marca de transacción como la que ya existe para facturar (`tajo.facturando`).
  - Conviene guardar también la evidencia de la aceptación pública (fecha, IP y user agent).

### 3. MEDIA: la factura emitida cambia después, y le faltan datos fiscales obligatorios
- **Dónde:**
  - `src/app/(app)/facturas/[id]/page.tsx:82-86` y `:192-197`: el cliente se lee en el momento de pintar la factura.
  - `0001:525-529` y `src/lib/actions/clientes.ts:40-45`: cualquier empleado puede editar un cliente.
  - `0001:94-111`: la factura solo guarda importes.
  - `0001:34-44`: los clientes no tienen NIF.
- **Qué pasa:** se emite la factura F-2026-0003 a «Carmen Puig, C/ de Sueca 34». Después un empleado cambia el nombre o la dirección del cliente. Si se vuelve a imprimir, sale otra factura con el mismo número. Además, falta el NIF del destinatario, que la factura completa exige (RD 1619/2012).
- **Corrección:**
  - En `facturar_presupuesto()`, guardar una copia de los datos del cliente (nombre, NIF y dirección), de los datos de la empresa, del `iva_pct` y de las líneas (en una tabla `factura_lineas`).
  - Pintar la factura solo desde esa copia.
  - Añadir el NIF al cliente.

### 4. MEDIA: los listados calculan los totales en el cliente sin paginar, y se equivocan sin avisar al crecer
- **Dónde:**
  - `src/app/(app)/presupuestos/page.tsx:54-59` y `:66-74`
  - `src/app/(app)/clientes/[id]/page.tsx:92-99`
  - `src/app/(app)/facturas/page.tsx:41-56`
- **Qué pasa:**
  - Se traen todas las partidas de todos los presupuestos para sumar los totales en JS. PostgREST corta a 1000 filas por defecto (`max_rows`) sin dar error. Con unas 5 partidas por presupuesto, a partir de unos 200 presupuestos los totales del listado salen más bajos de lo real.
  - El `.in("presupuesto_id", [todos los ids])` mete unos 37 bytes por id en la URL. Con unos cientos de presupuestos la URL es demasiado larga y la petición falla.
  - El README reconoce que no hay paginación, pero no que los totales salen mal.
- **Corrección:** una vista o RPC que calcule los totales en SQL reutilizando `totales_presupuesto`, más paginación con `.range()`.

### 5. BAJA: los límites de los datos solo se comprueban en el servidor de Next, no en la base de datos
- **Dónde:**
  - `src/lib/domain/presupuestos.ts:20-28` y `:174-178`: límites de longitud, de 100 partidas, de cantidad hasta 1e9 y de total que cabe en `integer`.
  - `guardar_presupuesto` (`0003:25-96`) y los inserts directos no aplican ninguno.
  - `facturas.*_cents` son `integer` (`0001:101-103`).
  - `presupuesto_publico` hace `::bigint` (`0001:283`).
- **Cómo se explota:** un empleado llama directamente al RPC con una partida de `cantidad = 1e12`. La factura falla por desbordamiento (22003) y la página pública falla al convertir a `bigint`. El impacto se queda dentro de su propia empresa.
- **Corrección:**
  - `CHECK` de longitud y de rango en las columnas.
  - `cantidad numeric(12,3)`.
  - Importes en `bigint`.

### 6. BAJA: al crear un presupuesto por la API se pueden elegir `created_at` y `token`
- **Dónde:** `0002_reglas.sql:40-64`. El trigger pone a nulo `enviado_at` y `aceptado_at` (`:59-60`), pero no toca `created_at`, `token` ni `id`.
- **Cómo se explota:** `POST /rest/v1/presupuestos` con `"created_at":"2099-01-01"`. Como `aceptar_presupuesto` calcula la validez desde `created_at` (`0003:226`), el presupuesto no vence nunca. Además, el enlace público y los listados muestran una fecha falsa.
- **Corrección:** en el trigger, forzar `new.created_at := now()` y `new.token := gen_random_uuid()`. Otra opción es dar grants de insert por columnas.

### 7. BAJA: el enlace público no se puede revocar ni caduca
- **Dónde:** `0003:122-124` prohíbe cambiar el token. `presupuesto_publico` sigue mostrando los presupuestos rechazados y facturados para siempre.
- **Qué pasa:** si el enlace se reenvía a quien no debe, no hay forma de cortar el acceso. La única es borrar el presupuesto, y eso tampoco es posible una vez facturado (`on delete restrict`).
- **Corrección:** una función solo para admin que regenere el token, o un campo `token_revocado_at`.

### 8. BAJA / INFORMATIVA: no hay cabeceras de seguridad
- **Dónde:** `next.config.ts:4-7`.
- **Qué pasa:** no hay CSP ni `frame-ancestors`. Hoy el clickjacking queda frenado porque las acciones críticas piden `window.confirm`, y Chrome no muestra esos diálogos dentro de iframes de otro origen. Aun así, falta la defensa de base.
- **Corrección:** `headers()` con CSP, `frame-ancestors 'none'` y `Referrer-Policy`.

### 9. INFORMATIVA: los triggers obedecen a una marca de configuración
- **Dónde:** `0002:46`, `:81` y `:164` (`tajo.seed`).
- **Qué pasa:** hoy no se puede activar desde PostgREST (lo comprobé). Pero un `ALTER DATABASE ... SET tajo.seed='on'`, o cualquier rol con SQL, desactiva todas las reglas sin que se note.
- **Corrección:** comprobar también `current_user` en el bypass.

### 10. INFORMATIVA: migraciones frágiles y sin control de versiones aplicadas
- **Dónde:** `0001:4-9` y `0002:5-6`.
- **Qué pasa:** se aplican pegándolas a mano en el SQL Editor. Si alguien vuelve a ejecutar 0001, deshace sin avisar las reglas de 0002 y 0003: la validez al aceptar, la política de borrado de partidas y la marca de facturación.
- **Corrección:** `supabase db push` con la CLI, y no redefinir funciones en ficheros antiguos.

### 11. INFORMATIVA: el seed numera mal las facturas en enero
- **Dónde:** `seed.sql:286-293` junto con `0001:187`.
- **Qué pasa:** en enero, las facturas «del mes anterior» llevan fecha de diciembre pero numeración del año nuevo (F-2027-0001 con fecha 2026-12). Solo afecta a la demo.

### 12. INFORMATIVA: la base de datos no tiene ningún test
- Los 323 tests prueban funciones puras de dominio. Las RLS, los triggers y las funciones `security definer` no tienen ninguno, y son justo el sitio donde el README dice que está la seguridad.
- **Corrección:** tests con pgTAP o `supabase test db` que comprueben, para cada rol, qué puede y qué no puede hacer.

### 13. INFORMATIVA: credenciales y dependencias
- `credenciales-demo.txt` tiene en claro la misma contraseña para admin y para empleado. Está en `.gitignore` y no aparece en el historial (lo comprobé con `git log -p`), pero si el proyecto se entrega como zip, se va dentro.
- La página de login muestra públicamente los dos emails de demo (`login/page.tsx:14-17`).
- El postcss vulnerable que trae next 15.5.29 solo actúa al compilar y no se puede explotar en producción con CSS propio. Basta con actualizar.

---

## Lo que está bien (comprobado)
- **Aislamiento entre empresas:** todas las políticas usan `auth_empresa_id()`. Las claves ajenas son compuestas con `empresa_id`. `guardar_presupuesto` y `facturar_presupuesto` filtran por empresa. Un insert con el `empresa_id` de otra empresa falla en el `WITH CHECK` y se deshace entero, contador incluido.
- **Rol `anon`:** no tiene ningún acceso a tablas, solo a `presupuesto_publico` y `aceptar_presupuesto`. Los helpers internos tienen revocado el `execute`. Las funciones `security definer` llevan `search_path` fijado y nombres cualificados.
- **Empleado sin facturas:** no puede leerlas ni crearlas. Lo impiden tres cosas a la vez: no hay política, se revocó el permiso y la función comprueba `es_admin()`.
- **Escalada de rol:** imposible, porque el empleado solo tiene permiso de update sobre la columna `nombre` de su perfil. Solo admin puede borrar.
- **Estados:** las transiciones se imponen en la base de datos. A `facturado` solo se llega desde la función de facturar, y las partidas quedan bloqueadas fuera de borrador.
- **Numeración:** sin duplicados ni huecos, porque el contador se actualiza en la misma transacción y con bloqueo de fila. La facturación es atómica: factura, stock y estado juntos.
- **Aceptación:** el `FOR UPDATE` evita condiciones de carrera. Los tokens son UUID v4, así que no se pueden enumerar.
- **Enlace público:** solo devuelve los datos de la empresa, el nombre del cliente y las partidas. Lleva `noindex` y `no-referrer`.
- **Importes:** todo en céntimos enteros. El redondeo del IVA es el mismo en JS y en SQL: medio hacia arriba, una sola vez sobre la base.
- **Next y sesión:** sin redirecciones abiertas. La protección CSRF de las Server Actions es la nativa de Next. En el servidor se usa `getUser`, y en el middleware `getClaims`. La caché de React es por petición, así que no se mezclan datos entre usuarios.
- **Secretos:** no hay clave de servicio, `.env.local` no está versionado y el historial de git está limpio.
- **Código:** TypeScript estricto, y lint, typecheck, tests y build pasan.

## Afirmaciones del README que no se corresponden con el código
- **`README.md:139`, «El cliente solo puede aceptar desde el enlace»:** es falso. La app tiene el botón «Marcar como aceptado» para cualquier empleado, y la API también lo permite (hallazgo 2).
- **`README.md:131`, «En Vercel… No hace falta nada más»:** es falso y peligroso. Si no se desactiva el registro en Supabase, cualquiera entra como empleado (hallazgo 1). El punto 135 lo presenta como un «límite» y no como un fallo de seguridad.
- **`README.md:141`, «Las facturas no se editan»:** los importes no cambian, pero los datos del cliente que salen en la factura sí (hallazgo 3).
- **`README.md:94`, «El rol anónimo no puede leer ninguna tabla»:** es cierto para PostgREST, pero el anónimo puede registrarse y pasar a `authenticated`.
- **`README.md:91`, «cada usuario solo ve los datos de su empresa»:** es cierto, pero con una sola empresa fija y registro abierto, «su empresa» es la de cualquiera.
- **`README.md:143`, «Listados sin paginación»:** lo reconoce, pero no dice que los totales salen mal sin avisar a partir de 1000 partidas.

## Veredicto
Todavía no es apto para enseñar: la base de datos está bien diseñada, pero un auditor marcaría de inmediato el registro abierto que da acceso como empleado, la aceptación interna sin control y la factura que cambia después de emitida. Con uno o dos días de correcciones (hallazgos 1 a 4 y tests de RLS) sí lo sería.
