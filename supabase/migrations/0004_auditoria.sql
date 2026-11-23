-- Tajo · 0004_auditoria.sql — correcciones de la auditoría externa en la base de datos (D9, tarea T11a).
-- Orden de ejecución: 0001_esquema.sql → 0002_reglas.sql → 0003_guardar_presupuesto.sql → este fichero → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. El SQL Editor lo ejecuta en
-- una sola transacción: si algo falla, no se aplica nada y los datos quedan como estaban.
-- Se aplica sobre una base ya migrada y con datos: no borra nada. Después hay que volver a ejecutar seed.sql.
-- No vuelvas a ejecutar 0001–0003 después de este fichero: redefinen funciones y triggers que este fichero cambia.
--
-- Qué cambia:
--   1. Alta solo por invitación: tabla invitaciones y handle_new_user() solo crea perfil a los invitados.
--   2. Aceptación interna solo para admin y con la validez vigente; aceptado_por y aceptado_canal.
--   3. La factura es una copia fija: datos de cliente y empresa, IVA y partidas (factura_lineas). NIF en clientes;
--      no se factura a un cliente sin NIF (error TJ001).
--   4. Importes en bigint, cantidad numeric(13,3) (hasta 1.000.000.000, como el dominio) y CHECK de rangos y longitudes (mismos límites que src/lib/domain).
--   5. Alta de presupuestos: created_at y token los pone siempre la base de datos.
--   6. regenerar_enlace(): solo admin, cambia el token y el enlace viejo deja de funcionar.
--   7. Las marcas de transacción tajo.* solo cuentan si current_user = 'postgres'.
--   8. Vista presupuestos_con_totales (security_invoker) con los totales calculados en SQL.
--
-- Marcas de transacción (set_config(..., true): caducan al acabar la transacción). Solo valen si además
-- current_user = 'postgres', es decir, si quien ejecuta es el SQL Editor (rol postgres) o una función security definer
-- cuyo dueño es postgres (todas las de este proyecto: se crearon desde el SQL Editor; el bloque final lo comprueba).
-- Desde la API (PostgREST) current_user es anon o authenticated: aunque alguien consiguiera poner la marca (por
-- ejemplo con ALTER DATABASE ... SET tajo.seed = 'on'), no tendría efecto.
--   · tajo.seed        → seed.sql y los rellenos de este fichero: los triggers no bloquean.
--   · tajo.facturando  → facturar_presupuesto(): único camino para pasar a facturado.
--   · tajo.aceptando   → aceptar_presupuesto(): aceptación por enlace (aceptado_canal = 'enlace').
--   · tajo.regenerando → regenerar_enlace(): único camino para cambiar el token.
-- Por eso los triggers que miran las marcas son security invoker: dentro de una función security definer
-- current_user sería siempre su dueño y la comprobación no serviría de nada.

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
end;
$$;

-- Datos que no cumplirían los límites nuevos. Si hay alguno, no se aplica nada y se dice qué corregir.
do $$
declare
  v_problemas text[] := '{}';
  v_n         bigint;
begin
  select count(*) into v_n from public.clientes
   where char_length(nombre) > 120 or char_length(telefono) > 40 or char_length(email) > 254
      or char_length(direccion) > 200 or char_length(notas) > 2000;
  if v_n > 0 then v_problemas := v_problemas || format('%s clientes con textos demasiado largos', v_n); end if;

  select count(*) into v_n from public.materiales
   where char_length(nombre) > 120 or char_length(unidad) > 20 or precio_cents > 100000000
      or stock > 1000000000 or stock < -1000000000000 or stock_minimo > 1000000000;
  if v_n > 0 then v_problemas := v_problemas || format('%s materiales con textos, precio o stock fuera de rango', v_n); end if;

  select count(*) into v_n from public.presupuestos
   where char_length(titulo) > 160 or validez_dias > 365;
  if v_n > 0 then v_problemas := v_problemas || format('%s presupuestos con título de más de 160 caracteres o validez de más de 365 días', v_n); end if;

  select count(*) into v_n from public.presupuesto_lineas
   where char_length(descripcion) > 300 or precio_cents > 100000000
      or cantidad > 1000000000 or cantidad <> round(cantidad, 3)
      or round(cantidad * precio_cents) > 10000000000000;
  if v_n > 0 then v_problemas := v_problemas || format('%s partidas con descripción, cantidad (máx. 1.000.000.000 y 3 decimales) o precio fuera de rango', v_n); end if;

  select count(*) into v_n from public.perfiles where char_length(nombre) > 120;
  if v_n > 0 then v_problemas := v_problemas || format('%s perfiles con nombre de más de 120 caracteres', v_n); end if;

  if cardinality(v_problemas) > 0 then
    raise exception 'No se ha aplicado nada. Corrige antes estos datos: %.', array_to_string(v_problemas, '; ');
  end if;
end;
$$;

-- La vista depende de columnas cuyo tipo cambia más abajo: se quita aquí y se vuelve a crear en la sección 6.
drop view if exists public.presupuestos_con_totales;

-- ============================================================================
-- 1. Tablas y columnas nuevas
-- ============================================================================

-- Invitaciones: quién puede tener perfil al darse de alta en Auth. Sin acceso desde la API (RLS sin políticas y sin
-- permisos para anon ni authenticated): se gestionan desde el SQL Editor o el seed.
create table if not exists public.invitaciones (
  email      text primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  rol        text not null default 'empleado' check (rol in ('admin', 'empleado')),
  created_at timestamptz not null default now(),
  constraint invitaciones_email_chk check (email = lower(email) and email = trim(email) and char_length(email) between 3 and 254)
);

-- NIF del cliente (NIF, NIE o CIF). La base de datos comprueba el formato tras normalizarlo (trigger
-- clientes_normalizar); la letra o el dígito de control los valida la app.
alter table public.clientes add column if not exists nif text;

-- Quién y por dónde se aceptó un presupuesto.
alter table public.presupuestos add column if not exists aceptado_por   uuid;
alter table public.presupuestos add column if not exists aceptado_canal text;

-- Copia fija de la factura.
alter table public.facturas add column if not exists cliente_nombre    text;
alter table public.facturas add column if not exists cliente_nif       text;
alter table public.facturas add column if not exists cliente_direccion text;
alter table public.facturas add column if not exists empresa_nombre    text;
alter table public.facturas add column if not exists empresa_cif       text;
alter table public.facturas add column if not exists empresa_direccion text;
alter table public.facturas add column if not exists iva_pct           integer;

-- Claves únicas (empresa_id, id) para las FK compuestas por empresa.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfiles_empresa_id_id_key'
                    and conrelid = 'public.perfiles'::regclass) then
    alter table public.perfiles add constraint perfiles_empresa_id_id_key unique (empresa_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'facturas_empresa_id_id_key'
                    and conrelid = 'public.facturas'::regclass) then
    alter table public.facturas add constraint facturas_empresa_id_id_key unique (empresa_id, id);
  end if;
  -- aceptado_por es un perfil de la misma empresa. Si se borra el usuario, queda a null (el canal 'interno' se
  -- conserva como constancia).
  if not exists (select 1 from pg_constraint where conname = 'presupuestos_aceptado_por_fkey'
                    and conrelid = 'public.presupuestos'::regclass) then
    alter table public.presupuestos
      add constraint presupuestos_aceptado_por_fkey
      foreign key (empresa_id, aceptado_por) references public.perfiles (empresa_id, id)
      on delete set null (aceptado_por);
  end if;
end;
$$;

-- Partidas de la factura: copia de las del presupuesto en el momento de facturar. Solo lectura para admin; se
-- escriben solo desde facturar_presupuesto() (y el seed). unidad es la del material vinculado, si lo había.
create table if not exists public.factura_lineas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  factura_id    uuid not null,
  orden         integer not null check (orden > 0),
  descripcion   text not null,
  unidad        text,
  cantidad      numeric(13,3) not null check (cantidad > 0 and cantidad <= 1000000000),
  precio_cents  bigint not null check (precio_cents >= 0),
  importe_cents bigint not null check (importe_cents >= 0),
  unique (factura_id, orden),
  foreign key (empresa_id, factura_id) references public.facturas (empresa_id, id) on delete cascade
);

create index if not exists factura_lineas_empresa_id_idx on public.factura_lineas (empresa_id);
create index if not exists invitaciones_empresa_id_idx  on public.invitaciones (empresa_id);
create index if not exists presupuestos_aceptado_por_idx on public.presupuestos (aceptado_por) where aceptado_por is not null;

-- ============================================================================
-- 2. Tipos: importes en bigint y cantidad numeric(13,3)
--    Ninguna vista depende de estas columnas (la única se ha quitado arriba) y las funciones SQL/plpgsql no guardan
--    dependencias de columnas, así que el cambio de tipo no choca con nada. La tabla se reescribe sin disparar
--    triggers. numeric(13,3) admite el máximo del dominio (MAX_CANTIDAD = 1.000.000.000 en quantity.ts), que se fija con
--    un CHECK en la sección 3.
-- ============================================================================

alter table public.materiales         alter column precio_cents type bigint;
alter table public.presupuesto_lineas alter column precio_cents type bigint;
alter table public.presupuesto_lineas alter column cantidad     type numeric(13,3);
-- Por si factura_lineas ya existía de una ejecución anterior de este fichero con numeric(12,3).
alter table public.factura_lineas     alter column cantidad     type numeric(13,3);
alter table public.facturas           alter column base_cents   type bigint;
alter table public.facturas           alter column iva_cents    type bigint;
alter table public.facturas           alter column total_cents  type bigint;

-- ============================================================================
-- 3. CHECK de longitud y de rango (mismos límites que src/lib/domain: validation.ts, presupuestos.ts, quantity.ts)
-- ============================================================================

alter table public.clientes
  drop constraint if exists clientes_nombre_largo_chk,
  drop constraint if exists clientes_telefono_largo_chk,
  drop constraint if exists clientes_email_largo_chk,
  drop constraint if exists clientes_direccion_largo_chk,
  drop constraint if exists clientes_notas_largo_chk,
  drop constraint if exists clientes_nif_formato_chk,
  add constraint clientes_nombre_largo_chk    check (char_length(nombre) <= 120),
  add constraint clientes_telefono_largo_chk  check (char_length(telefono) <= 40),
  add constraint clientes_email_largo_chk     check (char_length(email) <= 254),
  add constraint clientes_direccion_largo_chk check (char_length(direccion) <= 200),
  add constraint clientes_notas_largo_chk     check (char_length(notas) <= 2000),
  add constraint clientes_nif_formato_chk     check (nif ~ '^[A-Z0-9]{9}$');

alter table public.materiales
  drop constraint if exists materiales_nombre_largo_chk,
  drop constraint if exists materiales_unidad_largo_chk,
  drop constraint if exists materiales_precio_max_chk,
  drop constraint if exists materiales_stock_rango_chk,
  drop constraint if exists materiales_stock_minimo_rango_chk,
  add constraint materiales_nombre_largo_chk check (char_length(nombre) <= 120),
  add constraint materiales_unidad_largo_chk check (char_length(unidad) <= 20),
  add constraint materiales_precio_max_chk   check (precio_cents <= 100000000),
  -- El stock puede quedar negativo al facturar más material del que había (R13); el máximo es el del formulario.
  add constraint materiales_stock_rango_chk  check (stock between -1000000000000 and 1000000000),
  add constraint materiales_stock_minimo_rango_chk check (stock_minimo between 0 and 1000000000);

alter table public.presupuestos
  drop constraint if exists presupuestos_titulo_largo_chk,
  drop constraint if exists presupuestos_validez_rango_chk,
  drop constraint if exists presupuestos_aceptado_canal_chk,
  add constraint presupuestos_titulo_largo_chk   check (char_length(titulo) <= 160),
  add constraint presupuestos_validez_rango_chk  check (validez_dias between 1 and 365),
  add constraint presupuestos_aceptado_canal_chk check (aceptado_canal in ('enlace', 'interno'));

alter table public.presupuesto_lineas
  drop constraint if exists presupuesto_lineas_descripcion_largo_chk,
  drop constraint if exists presupuesto_lineas_precio_max_chk,
  drop constraint if exists presupuesto_lineas_importe_max_chk,
  drop constraint if exists presupuesto_lineas_cantidad_max_chk,
  add constraint presupuesto_lineas_cantidad_max_chk       check (cantidad <= 1000000000),
  add constraint presupuesto_lineas_descripcion_largo_chk check (char_length(descripcion) <= 300),
  add constraint presupuesto_lineas_precio_max_chk        check (precio_cents <= 100000000),
  -- Tope por partida de 10^13 céntimos: con 100 partidas como mucho, el total cabe en bigint y sigue siendo un
  -- entero exacto en JavaScript (< 2^53).
  add constraint presupuesto_lineas_importe_max_chk       check (round(cantidad * precio_cents) <= 10000000000000);

alter table public.perfiles
  drop constraint if exists perfiles_nombre_largo_chk,
  add constraint perfiles_nombre_largo_chk check (char_length(nombre) <= 120);

alter table public.facturas
  drop constraint if exists facturas_iva_pct_chk,
  add constraint facturas_iva_pct_chk check (iva_pct in (0, 4, 10, 21));

-- ============================================================================
-- 4. Alta de usuarios: solo con invitación (sustituye a D3)
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_rol     text;
begin
  select i.empresa_id, i.rol
    into v_empresa, v_rol
    from public.invitaciones i
   where i.email = lower(trim(coalesce(new.email, '')));

  -- Sin invitación no hay perfil: la app manda a /login?error=perfil y la RLS no le deja ver nada.
  if not found then
    return new;
  end if;

  insert into public.perfiles (id, empresa_id, nombre, email, rol)
  values (
    new.id,
    v_empresa,
    left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'), 120),
    lower(new.email),
    v_rol
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- El trigger on_auth_user_created de 0001 sigue apuntando a esta función.

-- ============================================================================
-- 5. Triggers
-- ============================================================================

-- 5.1 Clientes: NIF en mayúsculas, sin espacios, puntos ni guiones; vacío = null.
create or replace function public.clientes_normalizar()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.nif := nullif(upper(regexp_replace(coalesce(new.nif, ''), '[[:space:].-]', '', 'g')), '');
  return new;
end;
$$;

drop trigger if exists clientes_normalizar on public.clientes;
create trigger clientes_normalizar
  before insert or update on public.clientes
  for each row execute function public.clientes_normalizar();

-- 5.2 Presupuestos · alta (sustituye a la de 0002): siempre en borrador, sin número y con created_at, token y
--     datos de envío y aceptación puestos por la base de datos.
create or replace function public.presupuestos_alta_validar()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return new;
  end if;

  if new.estado is distinct from 'borrador' then
    raise exception 'Un presupuesto nuevo siempre empieza en borrador (se ha recibido: %).', coalesce(new.estado, 'vacío');
  end if;

  if new.numero is not null then
    raise exception 'El número del presupuesto lo asigna el sistema; no se puede indicar al crearlo.';
  end if;

  -- Lo que llegue de la API en estas columnas se ignora.
  new.created_at     := now();
  new.token          := gen_random_uuid();
  new.enviado_at     := null;
  new.aceptado_at    := null;
  new.aceptado_por   := null;
  new.aceptado_canal := null;

  return new;
end;
$$;

-- 5.3 Presupuestos · cambios (sustituye a la de 0003).
create or replace function public.presupuestos_reglas()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_postgres    constant boolean := current_user = 'postgres';
  v_seed        constant boolean := v_postgres and coalesce(current_setting('tajo.seed', true), '') = 'on';
  v_facturando  constant boolean := v_postgres and coalesce(current_setting('tajo.facturando', true), '') = 'on';
  v_aceptando   constant boolean := v_postgres and coalesce(current_setting('tajo.aceptando', true), '') = 'on';
  v_regenerando constant boolean := v_postgres and coalesce(current_setting('tajo.regenerando', true), '') = 'on';
  v_a_aceptado  boolean;
begin
  if v_seed then
    return new;
  end if;

  v_a_aceptado := new.estado is distinct from old.estado and new.estado = 'aceptado';

  -- Campos que no cambian nunca (el token, solo con regenerar_enlace()).
  if new.id is distinct from old.id then
    raise exception 'No se puede cambiar el identificador de un presupuesto.';
  end if;
  if new.numero is distinct from old.numero then
    raise exception 'No se puede cambiar el número de un presupuesto.';
  end if;
  if new.token is distinct from old.token and not v_regenerando then
    raise exception 'El enlace público solo se cambia con «Regenerar enlace» (solo gerencia).';
  end if;
  if new.empresa_id is distinct from old.empresa_id then
    raise exception 'No se puede cambiar la empresa de un presupuesto.';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede cambiar la fecha de creación de un presupuesto.';
  end if;

  -- Datos del presupuesto: solo en borrador (se mira el estado de antes del cambio).
  if old.estado <> 'borrador'
     and (   new.cliente_id   is distinct from old.cliente_id
          or new.iva_pct      is distinct from old.iva_pct
          or new.titulo       is distinct from old.titulo
          or new.validez_dias is distinct from old.validez_dias) then
    raise exception 'Solo se pueden cambiar el cliente, el título, el IVA y la validez de un presupuesto en borrador (estado actual: %).', old.estado;
  end if;

  -- Transiciones de estado (R9).
  if new.estado is distinct from old.estado then
    if not (   (old.estado = 'borrador' and new.estado = 'enviado')
            or (old.estado = 'enviado'  and new.estado in ('aceptado', 'rechazado'))
            or (old.estado = 'aceptado' and new.estado = 'facturado')) then
      raise exception 'Cambio de estado no permitido: de % a %.', old.estado, coalesce(new.estado, 'vacío');
    end if;

    if new.estado = 'facturado' and not v_facturando then
      raise exception 'Un presupuesto solo pasa a facturado al convertirlo en factura.';
    end if;

    if old.estado = 'borrador' and new.estado = 'enviado'
       and not exists (
         select 1
           from public.presupuesto_lineas l
          where l.presupuesto_id = new.id
            and l.empresa_id = new.empresa_id
       ) then
      raise exception 'Añade al menos una partida antes de enviar el presupuesto.';
    end if;

    -- Aceptación: por enlace (aceptar_presupuesto) o interna (solo gerencia y con la validez vigente).
    if v_a_aceptado then
      if v_aceptando then
        new.aceptado_canal := 'enlace';
        new.aceptado_por   := null;
      else
        if not public.es_admin() then
          raise exception 'Solo gerencia puede dar por aceptado un presupuesto; el cliente lo acepta desde el enlace público.';
        end if;
        -- Misma regla que aceptar_presupuesto(): el último día válido todavía se puede aceptar (fecha de Madrid).
        if ((old.created_at at time zone 'Europe/Madrid')::date + old.validez_dias)
           < (now() at time zone 'Europe/Madrid')::date then
          raise exception 'La validez de este presupuesto ha vencido; no se puede dar por aceptado.';
        end if;
        new.aceptado_canal := 'interno';
        new.aceptado_por   := auth.uid();
      end if;
    end if;
  end if;

  -- Quién y por dónde se aceptó: solo los pone la transición a aceptado. Única excepción: la FK pone aceptado_por a
  -- null cuando se borra el perfil (trigger anidado y sin tocar nada más de la fila).
  if not v_a_aceptado then
    if new.aceptado_canal is distinct from old.aceptado_canal then
      raise exception 'El canal de aceptación lo pone el sistema; no se puede cambiar.';
    end if;
    if new.aceptado_por is distinct from old.aceptado_por
       and not (    pg_trigger_depth() > 1
                and new.aceptado_por is null
                and (to_jsonb(new) - 'aceptado_por') = (to_jsonb(old) - 'aceptado_por')) then
      raise exception 'Quién aceptó el presupuesto lo pone el sistema; no se puede cambiar.';
    end if;
  end if;

  -- Fechas de envío y aceptación: las pone siempre la base de datos al hacer la transición.
  if new.estado is distinct from old.estado and new.estado = 'enviado' then
    new.enviado_at := now();
  elsif new.enviado_at is distinct from old.enviado_at then
    raise exception 'La fecha de envío la pone el sistema al enviar el presupuesto; no se puede cambiar.';
  end if;

  if v_a_aceptado then
    new.aceptado_at := now();
  elsif new.aceptado_at is distinct from old.aceptado_at then
    raise exception 'La fecha de aceptación la pone el sistema al aceptar el presupuesto; no se puede cambiar.';
  end if;

  return new;
end;
$$;

-- Los triggers presupuestos_alta_validar y presupuestos_reglas de 0002 siguen apuntando a estas funciones.

-- 5.4 Partidas · solo en borrador (sustituye a la de 0002). Ahora es security invoker para que la marca tajo.seed
--     dependa de quién ejecuta de verdad. Lee el presupuesto padre con la RLS del usuario: siempre es de su empresa
--     (si no, el insert falla igual por la RLS y por la FK compuesta). En los borrados en cascada y en el
--     "on delete set null" de materiales corre como dueño de la tabla, igual que antes.
--     Nuevo: como mucho 100 partidas por presupuesto, también al insertarlas directamente por la API. El padre se
--     bloquea con "for no key update" (antes "for share"): dos transacciones que añaden partidas al mismo presupuesto
--     a la vez se ponen en cola y la segunda cuenta ya las de la primera. No choca con las FK (key share).
create or replace function public.presupuesto_lineas_solo_borrador()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_estado text;
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Al borrar un material del almacén, la FK pone material_id a null en sus partidas (on delete set null).
    if pg_trigger_depth() > 1
       and old.material_id is not null
       and new.material_id is null
       and (new.id, new.empresa_id, new.presupuesto_id, new.orden, new.descripcion, new.cantidad, new.precio_cents)
           is not distinct from
           (old.id, old.empresa_id, old.presupuesto_id, old.orden, old.descripcion, old.cantidad, old.precio_cents) then
      return new;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select p.estado into v_estado
      from public.presupuestos p
     where p.id = old.presupuesto_id
       and p.empresa_id = old.empresa_id
       for no key update;

    if found and v_estado <> 'borrador' then
      raise exception 'Solo se pueden cambiar las partidas de un presupuesto en borrador (estado actual: %).', v_estado;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select p.estado into v_estado
      from public.presupuestos p
     where p.id = new.presupuesto_id
       and p.empresa_id = new.empresa_id
       for no key update;

    if found and v_estado <> 'borrador' then
      raise exception 'Solo se pueden añadir o cambiar partidas de un presupuesto en borrador (estado actual: %).', v_estado;
    end if;
  end if;

  if tg_op = 'INSERT'
     and (select count(*)
            from public.presupuesto_lineas l
           where l.presupuesto_id = new.presupuesto_id
             and l.empresa_id = new.empresa_id) >= 100 then
    raise exception 'Un presupuesto puede tener como mucho 100 partidas.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- 5.5 Facturas y sus partidas: una vez emitidas no se modifican ni se borran, ni siquiera desde el SQL Editor (salvo
--     el seed, que las borra para volver a crearlas; el borrado en cascada de las partidas también va en modo seed).
--     Desde la API ya no hay permisos de escritura; esto cubre además a postgres.
create or replace function public.facturas_inmutables()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Una factura emitida no se puede borrar.';
  end if;
  raise exception 'Una factura emitida no se puede modificar.';
end;
$$;

drop trigger if exists facturas_inmutables on public.facturas;
create trigger facturas_inmutables
  before update or delete on public.facturas
  for each row execute function public.facturas_inmutables();

drop trigger if exists factura_lineas_inmutables on public.factura_lineas;
create trigger factura_lineas_inmutables
  before update or delete on public.factura_lineas
  for each row execute function public.facturas_inmutables();

-- ============================================================================
-- 6. Totales en SQL: vista para los listados y totales_presupuesto() encima de ella (una sola regla)
--    importe partida = round(cantidad × precio); base = suma de importes;
--    IVA = round(base × iva_pct / 100) una sola vez sobre la base (round de numeric: medio hacia arriba en positivos).
--    Misma regla que src/lib/domain/totals.ts.
-- ============================================================================

create view public.presupuestos_con_totales
with (security_invoker = true)
as
select p.id,
       p.empresa_id,
       p.cliente_id,
       p.numero,
       p.titulo,
       p.estado,
       p.iva_pct,
       p.validez_dias,
       p.token,
       p.created_at,
       p.enviado_at,
       p.aceptado_at,
       p.aceptado_por,
       p.aceptado_canal,
       c.nombre                    as cliente_nombre,
       t.base_cents,
       t.iva_cents,
       t.base_cents + t.iva_cents  as total_cents,
       t.num_partidas
  from public.presupuestos p
  join public.clientes c
    on c.empresa_id = p.empresa_id
   and c.id = p.cliente_id
 cross join lateral (
   select b.base_cents,
          round(b.base_cents * p.iva_pct / 100.0)::bigint as iva_cents,
          b.num_partidas
     from (
       select coalesce(sum(round(l.cantidad * l.precio_cents)), 0)::bigint as base_cents,
              count(*)::integer                                           as num_partidas
         from public.presupuesto_lineas l
        where l.presupuesto_id = p.id
          and l.empresa_id = p.empresa_id
     ) b
 ) t;

comment on view public.presupuestos_con_totales is
  'Presupuestos con nombre del cliente y totales (base, IVA, total, nº de partidas). security_invoker: aplica la RLS de quien consulta.';

-- Misma firma que en 0001. La usan facturar_presupuesto(), presupuesto_publico() y el seed (como postgres, dueño de
-- las tablas: la RLS no le afecta). Sigue sin permiso de ejecución para anon y authenticated.
create or replace function public.totales_presupuesto(p_presupuesto uuid)
returns table (base_cents bigint, iva_cents bigint, total_cents bigint)
language sql
stable
set search_path = public
as $$
  select v.base_cents, v.iva_cents, v.total_cents
    from public.presupuestos_con_totales v
   where v.id = p_presupuesto
$$;

-- ============================================================================
-- 7. Funciones
-- ============================================================================

-- 7.1 Copia fija de la factura (interna). Crea la factura con los datos de cliente y empresa de ese momento, el IVA
--     y las partidas. p_numero / p_fecha / p_created_at nulos = siguiente número, hoy (Madrid) y now(); el seed los
--     pasa para fechar y numerar facturas pasadas. No comprueba permisos ni estado: eso lo hace quien la llama.
--     Error TJ001 si el cliente no tiene NIF (la app lo traduce).
create or replace function public.crear_factura_copia(
  p_presupuesto uuid,
  p_numero      text,
  p_fecha       date,
  p_created_at  timestamptz
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_pres    public.presupuestos%rowtype;
  v_cliente public.clientes%rowtype;
  v_empresa public.empresas%rowtype;
  v_base    bigint;
  v_iva     bigint;
  v_total   bigint;
  v_factura uuid;
begin
  select * into v_pres from public.presupuestos where id = p_presupuesto;
  if not found then
    raise exception 'El presupuesto no existe.';
  end if;

  select * into v_cliente
    from public.clientes
   where empresa_id = v_pres.empresa_id
     and id = v_pres.cliente_id;

  if v_cliente.nif is null then
    raise exception using
      errcode = 'TJ001',
      message = format('El cliente «%s» no tiene NIF. Añádelo en su ficha antes de facturar.', v_cliente.nombre),
      hint    = 'La factura completa exige el NIF del destinatario.';
  end if;

  select * into v_empresa from public.empresas where id = v_pres.empresa_id;

  select t.base_cents, t.iva_cents, t.total_cents
    into v_base, v_iva, v_total
    from public.totales_presupuesto(v_pres.id) t;

  insert into public.facturas
    (empresa_id, presupuesto_id, cliente_id, numero, fecha, base_cents, iva_cents, total_cents, created_at,
     cliente_nombre, cliente_nif, cliente_direccion, empresa_nombre, empresa_cif, empresa_direccion, iva_pct)
  values (
    v_pres.empresa_id,
    v_pres.id,
    v_pres.cliente_id,
    coalesce(p_numero, public.siguiente_numero(v_pres.empresa_id, 'F')),
    coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date),
    v_base,
    v_iva,
    v_total,
    coalesce(p_created_at, now()),
    v_cliente.nombre,
    v_cliente.nif,
    v_cliente.direccion,
    v_empresa.nombre,
    v_empresa.cif,
    v_empresa.direccion,
    v_pres.iva_pct
  )
  returning id into v_factura;

  insert into public.factura_lineas
    (empresa_id, factura_id, orden, descripcion, unidad, cantidad, precio_cents, importe_cents)
  select v_pres.empresa_id,
         v_factura,
         row_number() over (order by l.orden, l.id),
         l.descripcion,
         m.unidad,
         l.cantidad,
         l.precio_cents,
         round(l.cantidad * l.precio_cents)::bigint
    from public.presupuesto_lineas l
    left join public.materiales m
      on m.empresa_id = l.empresa_id
     and m.id = l.material_id
   where l.presupuesto_id = v_pres.id
     and l.empresa_id = v_pres.empresa_id;

  return v_factura;
end;
$$;

-- 7.2 Facturar (sustituye a la de 0002): igual, pero la factura se crea con su copia fija y sus partidas, y se
--     rechaza si el cliente no tiene NIF (TJ001). Todo en la transacción de la llamada.
create or replace function public.facturar_presupuesto(p_presupuesto uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_pres    public.presupuestos%rowtype;
  v_factura uuid;
begin
  if v_empresa is null or not public.es_admin() then
    raise exception 'Solo un administrador puede convertir presupuestos en factura.';
  end if;

  select * into v_pres
    from public.presupuestos
   where id = p_presupuesto
     and empresa_id = v_empresa
     for update;

  if not found then
    raise exception 'El presupuesto no existe o no pertenece a tu empresa.';
  end if;

  if v_pres.estado <> 'aceptado' then
    raise exception 'Solo se pueden facturar presupuestos aceptados (estado actual: %).', v_pres.estado;
  end if;

  if not exists (select 1 from public.presupuesto_lineas where presupuesto_id = v_pres.id) then
    raise exception 'El presupuesto no tiene partidas; no se puede facturar.';
  end if;

  v_factura := public.crear_factura_copia(v_pres.id, null, null, null);

  -- Descuento de stock de las partidas vinculadas a materiales (puede quedar negativo si faltaba material).
  update public.materiales m
     set stock = m.stock - x.cantidad
    from (
      select l.material_id, sum(l.cantidad) as cantidad
        from public.presupuesto_lineas l
       where l.presupuesto_id = v_pres.id
         and l.material_id is not null
       group by l.material_id
    ) x
   where m.id = x.material_id
     and m.empresa_id = v_empresa;

  -- Marca local a la transacción: solo este update puede pasar el presupuesto a facturado.
  perform set_config('tajo.facturando', 'on', true);

  update public.presupuestos
     set estado = 'facturado'
   where id = v_pres.id;

  perform set_config('tajo.facturando', 'off', true);

  return v_factura;
end;
$$;

-- 7.3 Aceptar por enlace (sustituye a la de 0003): igual y, además, activa tajo.aceptando para que el trigger
--     guarde aceptado_canal = 'enlace' y aceptado_por = null.
create or replace function public.aceptar_presupuesto(p_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_estado   text;
  v_creado   timestamptz;
  v_validez  integer;
  v_aceptado timestamptz;
begin
  select id, estado, created_at, validez_dias into v_id, v_estado, v_creado, v_validez
    from public.presupuestos
   where token = p_token
     for update;

  if not found or v_estado = 'borrador' then
    return jsonb_build_object('ok', false, 'motivo', 'Este presupuesto no existe o ya no está disponible.');
  end if;

  if v_estado <> 'enviado' then
    return jsonb_build_object(
      'ok', false,
      'motivo', case v_estado
        when 'aceptado'  then 'Este presupuesto ya estaba aceptado.'
        when 'facturado' then 'Este presupuesto ya está aceptado y facturado.'
        when 'rechazado' then 'Este presupuesto fue rechazado y ya no se puede aceptar.'
        else 'Este presupuesto no se puede aceptar en su estado actual.'
      end
    );
  end if;

  if ((v_creado at time zone 'Europe/Madrid')::date + v_validez) < (now() at time zone 'Europe/Madrid')::date then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'La validez de este presupuesto ha vencido; contacta con la empresa para actualizarlo.'
    );
  end if;

  perform set_config('tajo.aceptando', 'on', true);

  update public.presupuestos
     set estado = 'aceptado'
   where id = v_id
  returning aceptado_at into v_aceptado;

  perform set_config('tajo.aceptando', 'off', true);

  return jsonb_build_object('ok', true, 'estado', 'aceptado', 'aceptado_at', v_aceptado);
end;
$$;

-- 7.4 Guardar presupuesto (sustituye a la de 0003): igual, con importes en bigint y como mucho 100 partidas.
create or replace function public.guardar_presupuesto(
  p_id       uuid,
  p_cliente  uuid,
  p_titulo   text,
  p_iva      int,
  p_validez  int,
  p_partidas jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_id      uuid;
  v_estado  text;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;

  if p_partidas is null or jsonb_typeof(p_partidas) <> 'array' then
    raise exception 'Añade al menos una partida.';
  end if;
  -- jsonb_array_length() falla si no recibe un array: solo se evalúa una vez comprobado el tipo.
  if jsonb_array_length(p_partidas) = 0 then
    raise exception 'Añade al menos una partida.';
  end if;
  if jsonb_array_length(p_partidas) > 100 then
    raise exception 'Un presupuesto puede tener como mucho 100 partidas.';
  end if;

  if p_id is null then
    insert into public.presupuestos (empresa_id, cliente_id, titulo, iva_pct, validez_dias)
    values (v_empresa, p_cliente, p_titulo, p_iva, p_validez)
    returning id into v_id;
  else
    select p.estado into v_estado
      from public.presupuestos p
     where p.id = p_id
       and p.empresa_id = v_empresa
       for update;

    if not found then
      raise exception 'El presupuesto no existe o no tienes acceso a él.';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'Solo se puede editar un presupuesto en borrador (estado actual: %).', v_estado;
    end if;

    update public.presupuestos
       set cliente_id   = p_cliente,
           titulo       = p_titulo,
           iva_pct      = p_iva,
           validez_dias = p_validez
     where id = p_id;

    v_id := p_id;

    delete from public.presupuesto_lineas
     where presupuesto_id = v_id
       and empresa_id = v_empresa;
  end if;

  insert into public.presupuesto_lineas
    (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents, material_id)
  select v_empresa, v_id, x.orden, x.descripcion, x.cantidad, x.precio_cents, x.material_id
    from jsonb_to_recordset(p_partidas)
      as x(orden integer, descripcion text, cantidad numeric, precio_cents bigint, material_id uuid);

  return v_id;
end;
$$;

-- 7.5 Regenerar el enlace público: solo admin, de su empresa y si el presupuesto ya no está en borrador.
--     Devuelve el token nuevo; el viejo deja de funcionar en presupuesto_publico() y aceptar_presupuesto().
create or replace function public.regenerar_enlace(p_presupuesto uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_estado  text;
  v_token   uuid;
begin
  if v_empresa is null or not public.es_admin() then
    raise exception 'Solo gerencia puede regenerar el enlace público.';
  end if;

  select p.estado into v_estado
    from public.presupuestos p
   where p.id = p_presupuesto
     and p.empresa_id = v_empresa
     for update;

  if not found then
    raise exception 'El presupuesto no existe o no pertenece a tu empresa.';
  end if;

  if v_estado = 'borrador' then
    raise exception 'Un presupuesto en borrador todavía no tiene enlace público.';
  end if;

  perform set_config('tajo.regenerando', 'on', true);

  update public.presupuestos
     set token = gen_random_uuid()
   where id = p_presupuesto
  returning token into v_token;

  perform set_config('tajo.regenerando', 'off', true);

  return v_token;
end;
$$;

-- presupuesto_publico() (de 0001) no cambia: devuelve importes bigint y lee los totales de totales_presupuesto().

-- ============================================================================
-- 8. RLS y permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public:
--    en lo nuevo se quitan todos y se da solo lo necesario.
-- ============================================================================

alter table public.invitaciones   enable row level security;
alter table public.factura_lineas enable row level security;

revoke all on public.invitaciones from anon, authenticated;

revoke all on public.factura_lineas from anon, authenticated;
grant select on public.factura_lineas to authenticated;

drop policy if exists factura_lineas_select_admin on public.factura_lineas;
create policy factura_lineas_select_admin on public.factura_lineas
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

revoke all on public.presupuestos_con_totales from anon, authenticated;
grant select on public.presupuestos_con_totales to authenticated;

-- Facturas: siguen siendo solo lectura (0001); se repite por si acaso tras añadir columnas.
revoke insert, update, delete, truncate on public.facturas from anon, authenticated;

-- Funciones internas: nadie las llama desde la API.
revoke execute on function public.crear_factura_copia(uuid, text, date, timestamptz) from public, anon, authenticated;
revoke execute on function public.totales_presupuesto(uuid) from public, anon, authenticated;

-- Funciones de la app (create or replace conserva los permisos; se repiten para que este fichero se explique solo).
revoke execute on function public.regenerar_enlace(uuid) from public, anon;
grant  execute on function public.regenerar_enlace(uuid) to authenticated;

revoke execute on function public.facturar_presupuesto(uuid) from public, anon;
grant  execute on function public.facturar_presupuesto(uuid) to authenticated;

revoke execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) from public, anon;
grant  execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) to authenticated;

-- Aceptar por enlace: solo anon. La app lo llama con el cliente anónimo (src/lib/actions/publico.ts); así un
-- empleado con sesión no puede aceptar por RPC haciéndose pasar por el cliente (canal 'enlace').
revoke execute on function public.aceptar_presupuesto(uuid) from public, authenticated;
grant  execute on function public.aceptar_presupuesto(uuid) to anon;

-- ============================================================================
-- 9. Rellenos de los datos que ya existen (con la marca de seed: los triggers no bloquean)
-- ============================================================================

select set_config('tajo.seed', 'on', true);

-- Presupuestos ya aceptados o facturados: no se sabe por dónde se aceptaron. Se marcan como 'enlace', que era la
-- única vía prevista (README de T10); aceptado_por queda a null.
update public.presupuestos
   set aceptado_canal = 'enlace'
 where estado in ('aceptado', 'facturado')
   and aceptado_canal is null;

-- Facturas ya emitidas: copia con los datos actuales de cliente, empresa e IVA (los clientes aún no tienen NIF:
-- cliente_nif queda a null en esas facturas).
update public.facturas f
   set cliente_nombre    = c.nombre,
       cliente_nif       = c.nif,
       cliente_direccion = c.direccion,
       empresa_nombre    = e.nombre,
       empresa_cif       = e.cif,
       empresa_direccion = e.direccion,
       iva_pct           = p.iva_pct
  from public.clientes c, public.empresas e, public.presupuestos p
 where c.empresa_id = f.empresa_id
   and c.id = f.cliente_id
   and e.id = f.empresa_id
   and p.empresa_id = f.empresa_id
   and p.id = f.presupuesto_id
   and f.cliente_nombre is null;

-- Partidas de esas facturas: las del presupuesto, que están bloqueadas desde que se facturó.
insert into public.factura_lineas
  (empresa_id, factura_id, orden, descripcion, unidad, cantidad, precio_cents, importe_cents)
select f.empresa_id,
       f.id,
       row_number() over (partition by f.id order by l.orden, l.id),
       l.descripcion,
       m.unidad,
       l.cantidad,
       l.precio_cents,
       round(l.cantidad * l.precio_cents)::bigint
  from public.facturas f
  join public.presupuesto_lineas l
    on l.empresa_id = f.empresa_id
   and l.presupuesto_id = f.presupuesto_id
  left join public.materiales m
    on m.empresa_id = l.empresa_id
   and m.id = l.material_id
 where not exists (select 1 from public.factura_lineas fl where fl.factura_id = f.id);

select set_config('tajo.seed', 'off', true);

-- Reglas que dependen de los rellenos.
alter table public.facturas alter column cliente_nombre set not null;
alter table public.facturas alter column empresa_nombre set not null;
alter table public.facturas alter column iva_pct        set not null;

alter table public.presupuestos
  drop constraint if exists presupuestos_aceptacion_coherente_chk,
  drop constraint if exists presupuestos_aceptado_por_interno_chk,
  -- Aceptado o facturado ⇔ se sabe por dónde se aceptó.
  add constraint presupuestos_aceptacion_coherente_chk
    check ((estado in ('aceptado', 'facturado')) = (aceptado_canal is not null)),
  -- Solo la aceptación interna tiene autor.
  add constraint presupuestos_aceptado_por_interno_chk
    check (aceptado_por is null or aceptado_canal = 'interno');

-- ============================================================================
-- 10. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
declare
  v_mal text;
begin
  -- Las marcas solo funcionan si las funciones security definer que las ponen son de postgres.
  select string_agg(p.proname || ' (' || pg_get_userbyid(p.proowner) || ')', ', ')
    into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('facturar_presupuesto', 'aceptar_presupuesto', 'regenerar_enlace')
     and p.proowner <> 'postgres'::regrole;
  if v_mal is not null then
    raise exception 'Estas funciones no son de postgres y las marcas tajo.* no funcionarían: %.', v_mal;
  end if;

  -- Y los triggers que las miran tienen que ser security invoker.
  select string_agg(p.proname, ', ')
    into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('presupuestos_alta_validar', 'presupuestos_reglas', 'presupuesto_lineas_solo_borrador',
                       'facturas_inmutables', 'clientes_normalizar', 'crear_factura_copia')
     and p.prosecdef;
  if v_mal is not null then
    raise exception 'Estas funciones deberían ser security invoker: %.', v_mal;
  end if;

  if has_table_privilege('anon', 'public.invitaciones', 'select')
     or has_table_privilege('anon', 'public.factura_lineas', 'select')
     or has_table_privilege('anon', 'public.facturas', 'select')
     or has_table_privilege('anon', 'public.presupuestos_con_totales', 'select')
     or has_table_privilege('authenticated', 'public.invitaciones', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.factura_lineas', 'insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.facturas', 'insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.presupuestos_con_totales', 'insert, update, delete, truncate')
     or has_function_privilege('anon', 'public.regenerar_enlace(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.aceptar_presupuesto(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.crear_factura_copia(uuid, text, date, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.totales_presupuesto(uuid)', 'execute') then
    raise exception 'Los permisos de las tablas o funciones nuevas no son los esperados; revisa la sección 8.';
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver la vista, la tabla y la función nuevas.
notify pgrst, 'reload schema';
