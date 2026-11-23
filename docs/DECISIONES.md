# Decisiones de diseño

Registradas por el orquestador antes de encargar tareas que las usan.

## D1 · Modelo de datos (Postgres / Supabase)

| Tabla | Campos clave |
|---|---|
| `empresas` | `id uuid`, `nombre`, `cif`, `direccion`, `telefono`, `email` |
| `perfiles` | `id uuid` (= `auth.users.id`), `empresa_id`, `nombre`, `email`, `rol` (`admin` \| `empleado`) |
| `clientes` | `id`, `empresa_id`, `nombre`, `telefono`, `email`, `direccion`, `notas`, `created_at` |
| `materiales` | `id`, `empresa_id`, `nombre`, `unidad`, `precio_cents int`, `stock numeric`, `stock_minimo numeric` |
| `presupuestos` | `id`, `empresa_id`, `cliente_id`, `numero text`, `titulo`, `estado`, `iva_pct int`, `validez_dias int`, `token uuid unique`, `created_at`, `enviado_at`, `aceptado_at` |
| `presupuesto_lineas` | `id`, `empresa_id`, `presupuesto_id`, `orden`, `descripcion`, `cantidad numeric`, `precio_cents int`, `material_id` nullable |
| `facturas` | `id`, `empresa_id`, `presupuesto_id unique`, `cliente_id`, `numero text`, `fecha date`, `base_cents`, `iva_cents`, `total_cents` |
| `contadores` | `empresa_id`, `prefijo`, `anio`, `ultimo` (numeración; sin acceso desde la API) |

Dinero siempre en **céntimos (`int`)**.

## D2 · Seguridad

- Funciones `auth_empresa_id()` y `es_admin()` (`SECURITY DEFINER`, `search_path = public`), usadas por todas las políticas RLS.
- `facturas`: select solo admin. Sin políticas de escritura: solo se crean con `facturar_presupuesto()` (actualizado tras T2).
- Totales calculados en SQL con `totales_presupuesto()` (interna), misma regla que `src/lib/domain/totals.ts`.
- T2b · Las transiciones de estado (R9) y el bloqueo de partidas de presupuestos facturados se aseguran también en la base de datos con triggers (migración `0002`).
- Borrados: solo admin, salvo las partidas de un presupuesto en borrador, que puede borrarlas cualquier usuario de la empresa (actualizado tras T2b).
- Las partidas solo se pueden crear, editar o borrar mientras el presupuesto está en `borrador`.
- `anon` sin permisos de tabla. Lo público va por:
  - `presupuesto_publico(p_token uuid) returns jsonb`
  - `aceptar_presupuesto(p_token uuid) returns jsonb`
- Facturar con `facturar_presupuesto(p_presupuesto uuid)`: comprueba admin y estado `aceptado`, numera, crea la factura, descuenta stock y cambia el estado en una sola transacción.
- Numeración con `siguiente_numero(p_empresa uuid, p_prefijo text)`, con bloqueo para evitar duplicados.

- T6b · `guardar_presupuesto()` (`security invoker`, migración `0003`): alta y edición de un presupuesto con sus partidas en una sola transacción. La app nunca inserta partidas sueltas.
- Un presupuesto no puede pasar a `enviado` sin partidas, y `aceptar_presupuesto()` rechaza los que tienen la validez vencida (fecha de Madrid). Ambas reglas están en la app y en la base de datos.
- Orden de ejecución: `0001` → `0002` → `0003` → `seed.sql`.

## D3 · Alta de usuarios

Los usuarios se crean desde el panel de Supabase (Authentication → Add user). Un trigger en `auth.users` crea su `perfil` en la empresa de demo con rol `empleado`; `supabase/seed.sql` promociona a admin el email de gerencia y carga los datos de demo.

## D4 · Rutas

`/login` · `/` (panel) · `/clientes` · `/clientes/nuevo` · `/clientes/[id]` · `/clientes/[id]/editar` · `/presupuestos` · `/presupuestos/nuevo` · `/presupuestos/[id]` · `/presupuestos/[id]/editar` · `/facturas` · `/facturas/[id]` (imprimible) · `/materiales` · `/materiales/nuevo` · `/materiales/[id]/editar` · `/p/[token]` (público).

## D5 · PDF

Sin librería: `/facturas/[id]` tiene estilos `@media print` y un botón «Descargar PDF» que llama a `window.print()`.

## D6 · Diseño visual

- Paleta: fondo `stone-50`, texto `stone-900`, acento **ámbar** (`amber-500`/`amber-600`, el color de las obras) y `slate` para la barra lateral. Estados: borrador gris, enviado azul, aceptado verde, rechazado rojo, facturado violeta.
- Tipografía: Inter vía `next/font/google`.
- Layout privado: barra lateral fija en escritorio (logo «Tajo», menú con iconos SVG en línea, usuario y rol abajo) y barra inferior en móvil.
- Componentes propios en `src/components/ui/`: `Button`, `Input`, `Select`, `Card`, `Badge`, `EmptyState`, `PageHeader`, `Table` responsive (en móvil se ve como tarjetas). Sin librerías de UI.
- Cifras con `formatEuros`; fechas en `es-ES`.

## D7 · Mutaciones de presupuestos

Las Server Actions envían solo las columnas que cambian (p. ej. `{ estado: 'enviado' }`). Nunca `enviado_at`, `aceptado_at`, `numero`, `token` ni `id`: los pone o protege la base de datos (0002).

## D8 · Ampliaciones aceptadas por el orquestador

No estaban en REQUISITOS; se aprobaron porque hacen falta para usar la app y no añaden riesgo:

- Filtros: presupuestos por estado y materiales «solo stock bajo».
- Borrado de materiales (solo admin).
- Tarjeta «Aceptados pendientes de facturar» en el panel del empleado.
- Aviso de validez vencida en la página pública y en el detalle.

## D9 · Correcciones de la auditoría externa (T11)

Una auditoría independiente del código (2026-11-23) encontró fallos que el bucle develop → testing no vio. Se corrigen así:

- **Alta solo por invitación** (sustituye a D3). Tabla `invitaciones (email, empresa_id, rol)` sin acceso desde la API. `handle_new_user` solo crea perfil si el email está invitado; si no, el usuario no tiene perfil y la app no le deja entrar. El registro público queda desactivado en Supabase y fijado en `supabase/config.toml` (`enable_signup = false`). La página de login no muestra los emails de demo.
- **Aceptación interna solo para admin**. Un `enviado → aceptado` fuera de `aceptar_presupuesto()` exige `es_admin()` y la validez vigente, en el trigger. Se guarda `aceptado_por` (perfil, nulo si vino del enlace) y `aceptado_canal` (`enlace` | `interno`), y se muestran en el detalle.
- **La factura es una copia fija**. `facturar_presupuesto()` guarda en `facturas` los datos del cliente (nombre, NIF, dirección), de la empresa (nombre, CIF, dirección) y el `iva_pct`, y las partidas en `factura_lineas` (solo lectura para admin; se escriben solo desde la función). La vista de factura pinta solo desde esa copia. Los clientes tienen `nif` (validado: NIF, NIE o CIF con letra o dígito de control) y no se puede facturar a un cliente sin NIF.
- **Totales en SQL y listados paginados**. Vista `presupuestos_con_totales` (`security_invoker`) que reutiliza la regla de `totales_presupuesto`. Listados de presupuestos y facturas paginados de 25 en 25.
- **Límites también en la base de datos**: `CHECK` de longitud y rango, `cantidad numeric(13,3)` (hasta 1.000.000.000, igual que la app) e importes en `bigint`.
- **Alta de presupuestos**: el trigger fuerza `created_at = now()` y un `token` nuevo; no se pueden elegir desde la API.
- **Enlace revocable**: `regenerar_enlace(p_presupuesto)` (solo admin) cambia el token; el enlace viejo deja de funcionar.
- **Las marcas `tajo.seed` y `tajo.facturando` solo cuentan si `current_user` es `postgres`** (el SQL Editor o una función `security definer` del propietario).
- **Cabeceras de seguridad** en `next.config.ts`: CSP con `frame-ancestors 'none'`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`.
- **Tests contra el Supabase real** (`npm run test:db`): entran como gerencia, obra y anónimo y comprueban qué puede y qué no puede hacer cada uno. No forman parte de `npm test` porque necesitan las contraseñas por variable de entorno.
- Orden de ejecución: `0001` → `0002` → `0003` → `0004` → `seed.sql`. No se vuelven a ejecutar migraciones antiguas sobre una base ya migrada.

## D10 · Tanda final (T12): presupuesto con IA y rediseño

- **«Montar con IA»** en el formulario de presupuesto (alta y edición en borrador). El usuario describe la obra en un texto (máx. 1000 caracteres) y la IA propone partidas usando los materiales del almacén de su empresa y sus precios. Las partidas **se añaden al formulario para revisarlas**; nunca se guardan solas.
  - Server Action con `@anthropic-ai/sdk` (única dependencia nueva), modelo `claude-opus-5-5`, salida estructurada con JSON Schema (`output_config.format`), `effort: "medium"` y fallback de rechazo en servidor (`fallbacks: "default"`).
  - La clave va solo en el servidor (`ANTHROPIC_API_KEY`, nunca `NEXT_PUBLIC_*`). Sin clave, la función no aparece.
  - La respuesta de la IA es **dato no fiable**: la valida una función pura de `src/lib/domain` con tests (material del almacén de la empresa o ninguno, precio del material si va vinculado, cantidades y precios dentro de los límites, máx. 30 partidas, textos recortados).
  - Cuota en la base de datos: `consumir_uso_ia()` (migración 0005), 40 usos al día por empresa, para que una clave pública de demo no se pueda gastar sin control.
- **Rediseño** sin cambiar la identidad de D6 (stone, ámbar y slate; Inter): página pública del presupuesto cuidada (es lo que ve el cliente final), panel con gráfica de facturación de 6 meses y embudo de presupuestos en SVG propio (sin librerías), login con identidad, estados vacíos, mejor móvil y transiciones con CSS que respetan `prefers-reduced-motion`.
- Después, **segunda auditoría externa** con un agente nuevo sobre el conjunto.
