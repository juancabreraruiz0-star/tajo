-- Tajo · 0008_auditoria3.sql — correcciones de la tercera auditoría externa en la base de datos (D13, tarea T18).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → este fichero → 0009 → 0010 → seed.sql
-- (el seed necesita este fichero, la 0009 y la 0010).
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. Va entre begin y commit: si
-- algo falla, no se aplica nada y los datos quedan como estaban. Se aplica sobre una base con datos y no pierde
-- ninguno (la IP y el navegador de las aceptaciones se copian a su tabla antes de quitar las columnas). Se puede volver
-- a ejecutar (create or replace, if not exists, drop … if exists).
-- No vuelvas a ejecutar 0001–0007 después de este fichero: redefinen las funciones, el trigger y la vista que este
-- cambia, con las columnas de IP y navegador que este quita (0007 falla al rehacer la vista presupuestos_con_totales).
-- Justo después hay que desplegar la versión de la app de T18: la anterior pide aceptado_ip a la base (y falla la ficha
-- de un presupuesto para gerencia) y la nueva pide enviado_por_nombre (falla sin este fichero).
--
-- Qué cambia (docs/AUDITORIA-3.md entre paréntesis):
--   1. La validez cuenta desde el envío (M1): último día válido = día de coalesce(enviado_at, created_at) en Madrid +
--      validez_dias, igual que validUntil() de src/lib/domain/presupuestos.ts. Lo aplican aceptar_presupuesto() (por el
--      enlace) y el trigger presupuestos_reglas (aceptación interna de gerencia). enviado_at existe desde 0001 y lo pone
--      el trigger al pasar a enviado desde 0002; si algún presupuesto ya enviado no lo tuviera, cuenta desde la creación.
--   2. No se envía un presupuesto de 0 € (menor 7): al pasar de borrador a enviado, si la base (Σ round(cantidad ×
--      precio)) es 0, error TJ004 (la app lo traduce). El total es 0 si y solo si la base es 0.
--   3. Constancia fija (menor 3):
--        · enviado_por_nombre: copia del nombre del perfil que lo envía, la pone el trigger al pasar a enviado y no
--          cambia después (ni aunque el usuario cambie su nombre o se borre). Se rellena para los ya enviados con el
--          nombre actual de su perfil (lo más parecido que hay).
--        · La IP y el navegador de la aceptación por enlace pasan a la tabla presupuesto_aceptaciones, que solo puede
--          leer gerencia (RLS) y solo escribe aceptar_presupuesto(). Se quitan de presupuestos (y de la vista
--          presupuestos_con_totales), que lee toda la empresa: un empleado ya no los puede leer por la API.
--      aceptar_presupuesto(p_token, p_nombre, p_ip, p_user_agent): misma firma, respuesta y permisos que en 0007 (solo
--      anon).
--
-- Marcas de transacción (igual que en 0004 y 0007): tajo.seed y tajo.aceptando solo cuentan si current_user =
-- 'postgres'. Por eso el trigger que las mira es security invoker.

begin;

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regprocedure('public.aceptar_presupuesto(uuid, text, text, text)') is null
     or to_regprocedure('public.nif_valido(text)') is null then
    raise exception 'Falta la 0007: ejecuta antes 0007_auditoria2.sql.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Columnas y tablas
-- ============================================================================

-- 1.1 Quién lo envió, con el nombre de ese momento.
alter table public.presupuestos add column if not exists enviado_por_nombre text;

comment on column public.presupuestos.enviado_por_nombre is
  'Nombre del perfil que pasó el presupuesto a enviado, copiado en ese momento. Solo lo pone el trigger; no cambia.';

alter table public.presupuestos
  drop constraint if exists presupuestos_enviado_por_nombre_chk,
  add constraint presupuestos_enviado_por_nombre_chk check (char_length(enviado_por_nombre) between 1 and 120);

-- 1.2 IP y navegador de la aceptación por enlace: una fila por presupuesto aceptado por el enlace. Solo la lee
--     gerencia (sección 5) y solo la escribe aceptar_presupuesto() (security definer, de postgres).
create table if not exists public.presupuesto_aceptaciones (
  presupuesto_id uuid primary key,
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  foreign key (empresa_id, presupuesto_id) references public.presupuestos (empresa_id, id) on delete cascade,
  constraint presupuesto_aceptaciones_ip_chk         check (char_length(ip) <= 64),
  constraint presupuesto_aceptaciones_user_agent_chk check (char_length(user_agent) <= 400)
);

comment on table public.presupuesto_aceptaciones is
  'IP y navegador desde los que el cliente aceptó por el enlace (los manda el servidor de la app: evidencia, no prueba). Solo los lee gerencia; solo los escribe aceptar_presupuesto().';

create index if not exists presupuesto_aceptaciones_empresa_id_idx on public.presupuesto_aceptaciones (empresa_id);

-- 1.3 Se copian la IP y el navegador que ya había en presupuestos y se quitan de allí (y de la vista, que se vuelve a
--     crear en la sección 4). En una segunda ejecución las columnas ya no existen y no se hace nada.
drop view if exists public.presupuestos_con_totales;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos' and column_name = 'aceptado_ip') then
    execute $sql$
      insert into public.presupuesto_aceptaciones (presupuesto_id, empresa_id, ip, user_agent, created_at)
      select p.id, p.empresa_id, p.aceptado_ip, p.aceptado_user_agent, coalesce(p.aceptado_at, now())
        from public.presupuestos p
       where p.aceptado_canal = 'enlace'
         and (p.aceptado_ip is not null or p.aceptado_user_agent is not null)
      on conflict (presupuesto_id) do nothing
    $sql$;
  end if;
end;
$$;

alter table public.presupuestos
  drop column if exists aceptado_ip,
  drop column if exists aceptado_user_agent;

-- 1.4 Nombre de quien envió los ya enviados: el de su perfil ahora (no hay otro). En modo seed para que el trigger de
--     presupuestos deje poner la columna; solo toca enviado_por_nombre y solo donde está vacía.
select set_config('tajo.seed', 'on', true);

update public.presupuestos p
   set enviado_por_nombre = left(btrim(pf.nombre), 120)
  from public.perfiles pf
 where pf.empresa_id = p.empresa_id
   and pf.id = p.enviado_por
   and p.enviado_por_nombre is null
   and btrim(pf.nombre) <> '';

select set_config('tajo.seed', 'off', true);

-- ============================================================================
-- 2. Triggers
-- ============================================================================

-- 2.1 Presupuestos · alta (sustituye a la de 0007): igual, sin las columnas de IP y navegador y con
--     enviado_por_nombre vacío.
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
  new.created_at         := now();
  new.token              := gen_random_uuid();
  new.enviado_at         := null;
  new.enviado_por        := null;
  new.enviado_por_nombre := null;
  new.aceptado_at        := null;
  new.aceptado_por       := null;
  new.aceptado_canal     := null;
  new.aceptado_nombre    := null;

  return new;
end;
$$;

-- 2.2 Presupuestos · cambios (sustituye a la de 0007): igual y, además,
--     · al pasar a enviado: no deja enviar un presupuesto de 0 € (TJ004) y copia el nombre de quien lo envía en
--       enviado_por_nombre, que después no cambia;
--     · la aceptación interna mira la validez desde el envío (coalesce(enviado_at, created_at));
--     · la IP y el navegador ya no están en presupuestos (tabla presupuesto_aceptaciones).
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
  v_a_enviado   boolean;
  v_partidas    integer;
  v_base        bigint;
begin
  if v_seed then
    return new;
  end if;

  v_a_aceptado := new.estado is distinct from old.estado and new.estado = 'aceptado';
  v_a_enviado  := new.estado is distinct from old.estado and new.estado = 'enviado';

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

    -- Enviar: con al menos una partida y un total mayor que 0 € (mismo cálculo que presupuestos_con_totales).
    if v_a_enviado then
      select count(*)::integer, coalesce(sum(round(l.cantidad * l.precio_cents)), 0)::bigint
        into v_partidas, v_base
        from public.presupuesto_lineas l
       where l.presupuesto_id = new.id
         and l.empresa_id = new.empresa_id;
      if v_partidas = 0 then
        raise exception 'Añade al menos una partida antes de enviar el presupuesto.';
      end if;
      if v_base = 0 then
        raise exception using
          errcode = 'TJ004',
          message = 'El total es 0 €: pon precio a las partidas antes de enviarlo.';
      end if;
    end if;

    -- Aceptación: por enlace (aceptar_presupuesto) o interna (solo gerencia y con la validez vigente).
    if v_a_aceptado then
      if v_aceptando then
        -- aceptado_nombre llega en este mismo update desde aceptar_presupuesto().
        new.aceptado_canal := 'enlace';
        new.aceptado_por   := null;
      else
        if not public.es_admin() then
          raise exception 'Solo gerencia puede dar por aceptado un presupuesto; el cliente lo acepta desde el enlace público.';
        end if;
        -- Misma regla que aceptar_presupuesto(): cuenta desde el envío y el último día todavía vale (fecha de Madrid).
        if ((coalesce(old.enviado_at, old.created_at) at time zone 'Europe/Madrid')::date + old.validez_dias)
           < (now() at time zone 'Europe/Madrid')::date then
          raise exception 'La validez de este presupuesto ha vencido; no se puede dar por aceptado.';
        end if;
        new.aceptado_canal  := 'interno';
        new.aceptado_por    := auth.uid();
        new.aceptado_nombre := null;
      end if;
    end if;
  end if;

  -- Quién, por dónde y con qué nombre se aceptó: solo los pone la transición a aceptado. Única excepción: la FK pone
  -- aceptado_por a null cuando se borra el perfil (trigger anidado y sin tocar nada más de la fila).
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
    if new.aceptado_nombre is distinct from old.aceptado_nombre then
      raise exception 'El nombre de quien acepta lo pone el sistema; no se puede cambiar.';
    end if;
  end if;

  -- Quién lo envió y con qué nombre: lo pone la transición a enviado. El nombre es una copia del perfil en ese momento.
  if v_a_enviado then
    new.enviado_por := auth.uid();
    select left(btrim(pf.nombre), 120)
      into new.enviado_por_nombre
      from public.perfiles pf
     where pf.id = new.enviado_por
       and pf.empresa_id = new.empresa_id
       and btrim(pf.nombre) <> '';
  else
    if new.enviado_por is distinct from old.enviado_por
       and not (    pg_trigger_depth() > 1
                and new.enviado_por is null
                and (to_jsonb(new) - 'enviado_por') = (to_jsonb(old) - 'enviado_por')) then
      raise exception 'Quién envió el presupuesto lo pone el sistema; no se puede cambiar.';
    end if;
    if new.enviado_por_nombre is distinct from old.enviado_por_nombre then
      raise exception 'El nombre de quien envió el presupuesto lo pone el sistema; no se puede cambiar.';
    end if;
  end if;

  -- Fechas de envío y aceptación: las pone siempre la base de datos al hacer la transición.
  if v_a_enviado then
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

-- ============================================================================
-- 3. Aceptar por enlace (sustituye a la de 0007): misma firma, limpieza del nombre, IP y navegador, y mismas
--    respuestas. Cambia que la validez cuenta desde el envío y que la IP y el navegador se guardan en
--    presupuesto_aceptaciones.
-- ============================================================================

create or replace function public.aceptar_presupuesto(
  p_token      uuid,
  p_nombre     text,
  p_ip         text,
  p_user_agent text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  -- Nombre: sin caracteres de ancho cero; controles y espacios Unicode (NBSP, U+2000–U+200A…) pasan a espacio; se
  -- juntan los repetidos y se recortan los extremos.
  v_nombre   constant text := btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_nombre, ''),
                                 '[\u200B-\u200D\u2060\uFEFF]', '', 'g'),
                                 '[[:cntrl:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]', ' ', 'g'),
                                 '\s+', ' ', 'g'));
  v_ip       constant text := nullif(left(btrim(regexp_replace(coalesce(p_ip, ''), '[[:cntrl:]]', '', 'g')), 64), '');
  v_ua       constant text := nullif(left(btrim(regexp_replace(coalesce(p_user_agent, ''), '[[:cntrl:]]', '', 'g')), 400), '');
  v_id       uuid;
  v_empresa  uuid;
  v_estado   text;
  v_desde    timestamptz;
  v_validez  integer;
  v_aceptado timestamptz;
begin
  select id, empresa_id, estado, coalesce(enviado_at, created_at), validez_dias
    into v_id, v_empresa, v_estado, v_desde, v_validez
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

  -- La validez cuenta desde el envío; el último día todavía vale (fecha de Madrid).
  if ((v_desde at time zone 'Europe/Madrid')::date + v_validez) < (now() at time zone 'Europe/Madrid')::date then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'La validez de este presupuesto ha vencido; contacta con la empresa para actualizarlo.'
    );
  end if;

  -- Al menos una letra: «..» o solo espacios invisibles no son un nombre. [[:alpha:]] depende del locale de la base;
  -- las letras latinas con tilde se aceptan también aparte, por si el locale es C.
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 120
     or not (v_nombre ~ '[[:alpha:]]' or v_nombre ~ '[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]') then
    return jsonb_build_object(
      'ok', false,
      'campo', 'nombre',
      'motivo', 'Escribe tu nombre y apellidos para aceptar el presupuesto (entre 2 y 120 caracteres).'
    );
  end if;

  perform set_config('tajo.aceptando', 'on', true);

  update public.presupuestos
     set estado          = 'aceptado',
         aceptado_nombre = v_nombre
   where id = v_id
  returning aceptado_at into v_aceptado;

  perform set_config('tajo.aceptando', 'off', true);

  insert into public.presupuesto_aceptaciones (presupuesto_id, empresa_id, ip, user_agent, created_at)
  values (v_id, v_empresa, v_ip, v_ua, v_aceptado)
  on conflict (presupuesto_id) do nothing;

  return jsonb_build_object('ok', true, 'estado', 'aceptado', 'aceptado_at', v_aceptado);
end;
$$;

-- ============================================================================
-- 4. Vista presupuestos_con_totales (de 0007): sin aceptado_ip ni aceptado_user_agent (se quitó en 1.3 para poder
--    borrar las columnas) y con enviado_por_nombre al final.
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
       t.num_partidas,
       p.aceptado_nombre,
       p.enviado_por,
       p.enviado_por_nombre
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
  'Presupuestos con nombre del cliente, totales (base, IVA, total, nº de partidas) y constancia de envío y aceptación (sin IP ni navegador: están en presupuesto_aceptaciones, solo para gerencia). security_invoker: aplica la RLS de quien consulta.';

-- ============================================================================
-- 5. RLS y permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public: en lo
--    nuevo se quitan todos y se da solo lo necesario.
-- ============================================================================

alter table public.presupuesto_aceptaciones enable row level security;

-- Solo gerencia de la misma empresa lee. Nadie escribe desde la API (sin políticas ni permisos de insert, update o
-- delete): la fila la crea aceptar_presupuesto() y se borra en cascada con su presupuesto.
drop policy if exists presupuesto_aceptaciones_select on public.presupuesto_aceptaciones;
create policy presupuesto_aceptaciones_select on public.presupuesto_aceptaciones
  for select to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (select public.es_admin())
  );

revoke all on public.presupuesto_aceptaciones from public, anon, authenticated;
grant select on public.presupuesto_aceptaciones to authenticated;

-- La vista se ha vuelto a crear: mismos permisos que en 0004.
revoke all on public.presupuestos_con_totales from public, anon, authenticated;
grant select on public.presupuestos_con_totales to authenticated;

-- Aceptar por enlace: solo anon (como en 0007). create or replace conserva los permisos; se repiten para que este
-- fichero se explique solo.
revoke execute on function public.aceptar_presupuesto(uuid, text, text, text) from public, authenticated;
grant  execute on function public.aceptar_presupuesto(uuid, text, text, text) to anon;

-- Funciones de trigger: nadie las llama desde fuera.
revoke execute on function public.presupuestos_alta_validar() from public, anon, authenticated;
revoke execute on function public.presupuestos_reglas()       from public, anon, authenticated;

-- ============================================================================
-- 6. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos'
                and column_name in ('aceptado_ip', 'aceptado_user_agent')) then
    raise exception 'presupuestos todavía tiene aceptado_ip o aceptado_user_agent.';
  end if;

  if not exists (select 1 from pg_proc p
                  where p.oid = 'public.aceptar_presupuesto(uuid, text, text, text)'::regprocedure
                    and p.proowner = 'postgres'::regrole and p.prosecdef
                    and coalesce(p.proconfig, '{}') @> array['search_path=public']) then
    raise exception 'aceptar_presupuesto() tiene que ser security definer, de postgres y con search_path fijado.';
  end if;

  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('presupuestos_alta_validar', 'presupuestos_reglas')
                and p.prosecdef) then
    raise exception 'Los triggers de presupuestos tienen que ser security invoker.';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.presupuesto_aceptaciones'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'presupuesto_aceptaciones') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'presupuesto_aceptaciones'
                       and policyname = 'presupuesto_aceptaciones_select' and cmd = 'SELECT') then
    raise exception 'presupuesto_aceptaciones tiene que tener RLS activado y solo la política de lectura de gerencia.';
  end if;

  if has_table_privilege('anon', 'public.presupuesto_aceptaciones', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.presupuesto_aceptaciones', 'insert, update, delete, truncate, references, trigger')
     or not has_table_privilege('authenticated', 'public.presupuesto_aceptaciones', 'select')
     or not has_function_privilege('anon', 'public.aceptar_presupuesto(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.aceptar_presupuesto(uuid, text, text, text)', 'execute')
     or has_table_privilege('anon', 'public.presupuestos_con_totales', 'select')
     or not has_table_privilege('authenticated', 'public.presupuestos_con_totales', 'select')
     or has_table_privilege('authenticated', 'public.presupuestos_con_totales', 'insert, update, delete, truncate') then
    raise exception 'Los permisos de presupuesto_aceptaciones, presupuestos_con_totales o aceptar_presupuesto() no son los esperados; revisa la sección 5.';
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver la tabla y la columna nuevas y olvidar las quitadas.
notify pgrst, 'reload schema';

commit;
