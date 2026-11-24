-- Tajo · 0005_uso_ia.sql — cuota diaria de «Montar con IA» por empresa (D10, tarea T12).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → este fichero (seed.sql no depende de él).
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010_ia_cache_autor.sql → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. Se ejecuta en una sola
-- transacción: si algo falla, no se aplica nada. Se puede volver a ejecutar: no borra los usos ya contados.
--
-- Qué hace:
--   1. Tabla uso_ia (empresa_id, dia, usos): cuántas propuestas con IA lleva cada empresa cada día (día de Madrid).
--      Tabla uso_ia_reservas: una fila por uso consumido que todavía se puede devolver (ver 3).
--      Ninguna de las dos tiene acceso desde la API: RLS activado, sin políticas y sin permisos para anon ni
--      authenticated.
--   2. consumir_uso_ia(): la llama la Server Action ANTES de pedir nada a la IA. Suma un uso a la empresa del usuario
--      de forma atómica y devuelve los que le quedan hoy y una reserva (uuid aleatorio). Si ya ha gastado los 40 del
--      día, error TJ002 (la app lo traduce) y no se cuenta nada.
--   3. devolver_uso_ia(reserva): devuelve el uso cuando la IA NO ha llegado a responder (límite de peticiones, clave
--      mal configurada, IA caída o sin conexión). Solo con la reserva de ese uso, que la Server Action recibe de
--      consumir_uso_ia() y nunca manda al navegador.
--
-- Por qué una reserva y no un simple «resta 1»: un usuario con sesión puede llamar por RPC a cualquier función que
-- tenga permiso de ejecutar. Con una función que restara 1 sin más, podría pedir una propuesta (la IA responde y se
-- gasta) y después devolver el uso a mano: usos infinitos. Con la reserva:
--   · el uso que gasta la Server Action solo lo puede devolver quien conoce su reserva, que no sale del servidor;
--   · si el usuario llama a consumir_uso_ia() a mano, recibe su propia reserva, pero devolverla solo deshace ese
--     consumo, que no ha llamado a la IA (resultado neto: cero);
--   · cada reserva se devuelve una sola vez, solo por el mismo usuario, solo para su empresa y su día, y solo en los
--     10 minutos siguientes (la Server Action tarda como mucho 60 s). Nunca baja de 0.

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regprocedure('public.auth_empresa_id()') is null or to_regclass('public.invitaciones') is null then
    raise exception 'Falta la 0004: ejecuta antes 0001, 0002, 0003 y 0004.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Tablas
-- ============================================================================

create table if not exists public.uso_ia (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  dia        date not null,
  usos       int  not null default 0,
  primary key (empresa_id, dia),
  constraint uso_ia_usos_chk check (usos between 0 and 40)
);

comment on table public.uso_ia is
  'Propuestas con IA por empresa y día (Europe/Madrid). Solo la escriben consumir_uso_ia() y devolver_uso_ia().';

create table if not exists public.uso_ia_reservas (
  id         uuid        primary key default gen_random_uuid(),
  empresa_id uuid        not null references public.empresas (id) on delete cascade,
  perfil_id  uuid        not null,
  dia        date        not null,
  creado_at  timestamptz not null default now()
);

comment on table public.uso_ia_reservas is
  'Usos de IA consumidos que aún se pueden devolver (10 minutos, una vez, mismo usuario). Sin acceso desde la API.';

-- ============================================================================
-- 2. consumir_uso_ia(): un uso más para la empresa del usuario; devuelve los que quedan hoy y la reserva.
--    security definer porque authenticated no tiene permisos sobre las tablas. La empresa sale siempre de la sesión
--    (auth_empresa_id()), nunca de un parámetro: nadie puede gastar la cuota de otra empresa.
--    El insert … on conflict do update … where es atómico: con dos peticiones a la vez, la segunda espera al bloqueo
--    de la fila y vuelve a evaluar el where con el valor ya sumado. Si el where no se cumple, no devuelve fila.
-- ============================================================================

-- Si existiera con otro tipo de retorno (versión anterior de este fichero), create or replace no podría cambiarlo.
drop function if exists public.consumir_uso_ia();

create function public.consumir_uso_ia()
returns table (quedan int, reserva uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_limite  constant int := 40;
  v_empresa uuid := public.auth_empresa_id();
  v_dia     date := (now() at time zone 'Europe/Madrid')::date;
  v_usos    int;
  v_reserva uuid;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;

  insert into public.uso_ia as u (empresa_id, dia, usos)
  values (v_empresa, v_dia, 1)
  on conflict (empresa_id, dia) do update
     set usos = u.usos + 1
   where u.usos < c_limite
  returning u.usos into v_usos;

  if v_usos is null then
    raise exception using
      errcode = 'TJ002',
      message = format('Has llegado al límite de %s propuestas con IA de hoy. Vuelve a intentarlo mañana.', c_limite),
      hint    = 'La cuota se reinicia cada día a medianoche (hora de Madrid).';
  end if;

  -- Limpieza: las reservas de hace más de un día ya no se pueden devolver.
  delete from public.uso_ia_reservas r
   where r.empresa_id = v_empresa
     and r.creado_at < now() - interval '1 day';

  insert into public.uso_ia_reservas (empresa_id, perfil_id, dia)
  values (v_empresa, auth.uid(), v_dia)
  returning id into v_reserva;

  quedan  := c_limite - v_usos;
  reserva := v_reserva;
  return next;
end;
$$;

-- ============================================================================
-- 3. devolver_uso_ia(reserva): devuelve el uso de esa reserva. true si se ha devuelto; false si la reserva no existe,
--    ya se devolvió, es de otro usuario o de otra empresa, o tiene más de 10 minutos. Resta del día de la reserva
--    (no de hoy) y nunca baja de 0.
-- ============================================================================

create or replace function public.devolver_uso_ia(p_reserva uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_dia     date;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;

  delete from public.uso_ia_reservas r
   where r.id = p_reserva
     and r.empresa_id = v_empresa
     and r.perfil_id = auth.uid()
     and r.creado_at > now() - interval '10 minutes'
  returning r.dia into v_dia;

  if v_dia is null then
    return false;
  end if;

  update public.uso_ia
     set usos = greatest(usos - 1, 0)
   where empresa_id = v_empresa
     and dia = v_dia;

  return true;
end;
$$;

-- ============================================================================
-- 4. RLS y permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public:
--    se quitan todos y se da solo lo necesario.
-- ============================================================================

alter table public.uso_ia          enable row level security;
alter table public.uso_ia_reservas enable row level security;
revoke all on public.uso_ia          from public, anon, authenticated;
revoke all on public.uso_ia_reservas from public, anon, authenticated;

revoke execute on function public.consumir_uso_ia() from public, anon;
grant  execute on function public.consumir_uso_ia() to authenticated;

revoke execute on function public.devolver_uso_ia(uuid) from public, anon;
grant  execute on function public.devolver_uso_ia(uuid) to authenticated;

-- ============================================================================
-- 5. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
declare
  v_mal text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_mal
    from pg_proc p
   where p.oid in ('public.consumir_uso_ia()'::regprocedure, 'public.devolver_uso_ia(uuid)'::regprocedure)
     and (p.proowner <> 'postgres'::regrole or not p.prosecdef
          or not coalesce(p.proconfig, '{}') @> array['search_path=public']);
  if v_mal is not null then
    raise exception 'Estas funciones tienen que ser security definer, de postgres y con search_path fijado: %.', v_mal;
  end if;

  if exists (select 1 from pg_class c
              where c.oid in ('public.uso_ia'::regclass, 'public.uso_ia_reservas'::regclass)
                and not c.relrowsecurity) then
    raise exception 'uso_ia y uso_ia_reservas tienen que tener RLS activado.';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('uso_ia', 'uso_ia_reservas')) then
    raise exception 'uso_ia y uso_ia_reservas no deben tener políticas: solo se escriben desde sus funciones.';
  end if;

  if has_table_privilege('anon', 'public.uso_ia', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.uso_ia', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('anon', 'public.uso_ia_reservas', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.uso_ia_reservas', 'select, insert, update, delete, truncate, references, trigger')
     or has_function_privilege('anon', 'public.consumir_uso_ia()', 'execute')
     or has_function_privilege('anon', 'public.devolver_uso_ia(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.consumir_uso_ia()', 'execute')
     or not has_function_privilege('authenticated', 'public.devolver_uso_ia(uuid)', 'execute') then
    raise exception 'Los permisos de las tablas o funciones de la IA no son los esperados; revisa la sección 4.';
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver las funciones nuevas.
notify pgrst, 'reload schema';
