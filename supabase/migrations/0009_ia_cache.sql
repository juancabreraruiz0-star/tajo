-- Tajo · 0009_ia_cache.sql — «Montar con IA»: misma descripción, mismo presupuesto (D14, tarea T19).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → este fichero → seed.sql (el seed lo
-- necesita: limpia la tabla nueva de las empresas de demo).
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. Va entre begin y commit: si
-- algo falla, no se aplica nada. Solo añade una tabla y una función: no toca datos existentes. Se puede volver a
-- ejecutar (if not exists, create or replace, drop policy if exists) sin perder las propuestas guardadas.
-- Se puede aplicar antes o después de desplegar la app de T19: la app anterior no usa la tabla, y la nueva sin esta
-- migración no encuentra propuestas guardadas y no puede guardarlas (funciona como antes, sin la garantía).
--
-- Por qué: la IA no es determinista. Dos peticiones con la misma descripción daban presupuestos algo distintos
-- (4406,82 € y 4387,46 €). La garantía la da el código: la app calcula una clave (SHA-256 de la empresa, la
-- descripción normalizada, el almacén que se le pasa a la IA y la versión de la petición; src/lib/domain/cache-ia.ts)
-- y, si ya hay una propuesta guardada con esa clave, la devuelve tal cual, sin llamar a la IA ni gastar cuota.
--
-- Qué hace:
--   1. Tabla ia_propuestas (empresa_id, clave, respuesta, perfil_id, reserva, created_at): una propuesta ya validada
--      por clave y empresa. RLS: cada usuario solo LEE las de su empresa. Nadie escribe desde la API (sin políticas ni
--      permisos de insert, update o delete); anon no tiene ningún permiso.
--   2. guardar_propuesta_ia(reserva, clave, respuesta, sustituir): la única forma de escribir. Exige una reserva de
--      consumir_uso_ia() (0005, 0007) del propio usuario, de su empresa, de los últimos 10 minutos y aún no usada. La
--      gasta: la borra de uso_ia_reservas, así que ya no se puede devolver con devolver_uso_ia() ni usar otra vez.
--      Resultado: cada propuesta guardada ha costado un uso de la cuota, igual que una propuesta de verdad, y nadie
--      llena la caché gratis (consumir a mano, guardar y devolver deja el uso gastado). Si ya hay una propuesta con esa
--      clave, se queda la que había (la primera gana: dos peticiones a la vez acaban con la misma) salvo con
--      p_sustituir = true, que la app solo usa cuando la guardada ya no pasa la validación. Devuelve la propuesta que
--      queda guardada.
--   La forma de la respuesta se comprueba también aquí (objeto con 1–30 partidas y como mucho 6 supuestos, 128 KB
--   como mucho) y la app la vuelve a validar al leerla con validarSugerencia() contra el almacén actual: lo que no
--   pase, se ignora y se vuelve a pedir a la IA.

begin;

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regclass('public.presupuesto_aceptaciones') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'presupuestos'
                       and column_name = 'enviado_por_nombre') then
    raise exception 'Falta la 0008: ejecuta antes 0008_auditoria3.sql.';
  end if;
  if to_regclass('public.uso_ia_reservas') is null or to_regprocedure('public.consumir_uso_ia()') is null then
    raise exception 'Falta la 0005: ejecuta antes 0005_uso_ia.sql (y 0006–0008).';
  end if;
end;
$$;

-- ============================================================================
-- 1. Forma de una propuesta guardada (la misma que la respuesta de la IA, ya limpia; ver propuestaParaGuardar() en
--    src/lib/domain/cache-ia.ts). Con case para que jsonb_array_length no se evalúe sobre algo que no es un array.
-- ============================================================================

create or replace function public.ia_propuesta_valida(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when jsonb_typeof(p -> 'partidas') is distinct from 'array'
      or jsonb_typeof(p -> 'supuestos') is distinct from 'array' then false
    when octet_length(p::text) > 131072 then false
    else jsonb_array_length(p -> 'partidas') between 1 and 30
         and jsonb_array_length(p -> 'supuestos') <= 6
  end
$$;

comment on function public.ia_propuesta_valida(jsonb) is
  'Forma mínima de una propuesta de IA guardada: objeto con 1–30 partidas, como mucho 6 supuestos y 128 KB. La app la valida entera al leerla.';

-- ============================================================================
-- 2. Tabla
-- ============================================================================

create table if not exists public.ia_propuestas (
  empresa_id uuid        not null references public.empresas (id) on delete cascade,
  clave      text        not null,
  respuesta  jsonb       not null,
  -- Quién la pidió (como perfil_id en uso_ia_reservas: sin clave ajena, para que no estorbe al borrar perfiles).
  perfil_id  uuid,
  -- Reserva de consumir_uso_ia() que se gastó al guardarla: una reserva no sirve para dos propuestas.
  reserva    uuid        not null,
  created_at timestamptz not null default now(),
  primary key (empresa_id, clave),
  constraint ia_propuestas_reserva_key unique (reserva),
  constraint ia_propuestas_clave_chk check (clave ~ '^[0-9a-f]{64}$'),
  constraint ia_propuestas_respuesta_chk check (public.ia_propuesta_valida(respuesta))
);

comment on table public.ia_propuestas is
  'Propuestas de «Montar con IA» ya validadas, por empresa y clave (huella de la descripción y del almacén). La misma clave devuelve la misma propuesta sin llamar a la IA. Solo la escribe guardar_propuesta_ia().';

-- ============================================================================
-- 3. guardar_propuesta_ia(): la única forma de escribir en la tabla.
--    security definer porque authenticated no tiene permisos de escritura. La empresa y el usuario salen siempre de la
--    sesión, nunca de un parámetro.
-- ============================================================================

create or replace function public.guardar_propuesta_ia(
  p_reserva   uuid,
  p_clave     text,
  p_respuesta jsonb,
  p_sustituir boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_empresa  uuid := public.auth_empresa_id();
  v_perfil   uuid := auth.uid();
  v_reserva  uuid;
  v_guardada jsonb;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;
  if p_clave is null or p_clave !~ '^[0-9a-f]{64}$' then
    raise exception 'La clave de la propuesta no es válida.';
  end if;
  if not coalesce(public.ia_propuesta_valida(p_respuesta), false) then
    raise exception 'La propuesta no tiene la forma esperada.';
  end if;

  -- La reserva se gasta: ya no se puede devolver (devolver_uso_ia) ni usar para guardar otra propuesta.
  delete from public.uso_ia_reservas r
   where r.id = p_reserva
     and r.empresa_id = v_empresa
     and r.perfil_id = v_perfil
     and r.creado_at > now() - interval '10 minutes'
  returning r.id into v_reserva;

  if v_reserva is null then
    raise exception using
      errcode = 'TJ005',
      message = 'No se puede guardar la propuesta: hace falta un uso de IA reciente y sin usar.',
      hint    = 'Solo la guarda la propia petición a la IA, con la reserva de consumir_uso_ia().';
  end if;

  insert into public.ia_propuestas as g (empresa_id, clave, respuesta, perfil_id, reserva)
  values (v_empresa, p_clave, p_respuesta, v_perfil, v_reserva)
  on conflict (empresa_id, clave) do update
     set respuesta  = excluded.respuesta,
         perfil_id  = excluded.perfil_id,
         reserva    = excluded.reserva,
         created_at = now()
   where p_sustituir
  returning g.respuesta into v_guardada;

  -- Ya había una y no se sustituye: se queda la que había, y es la que se devuelve.
  if v_guardada is null then
    select g.respuesta into v_guardada
      from public.ia_propuestas g
     where g.empresa_id = v_empresa and g.clave = p_clave;
  end if;

  return v_guardada;
end;
$$;

-- ============================================================================
-- 4. RLS y permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public:
--    se quitan todos y se da solo lo necesario.
-- ============================================================================

alter table public.ia_propuestas enable row level security;

drop policy if exists ia_propuestas_select on public.ia_propuestas;
create policy ia_propuestas_select on public.ia_propuestas
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

revoke all on public.ia_propuestas from public, anon, authenticated;
grant select on public.ia_propuestas to authenticated;

revoke execute on function public.guardar_propuesta_ia(uuid, text, jsonb, boolean) from public, anon;
grant  execute on function public.guardar_propuesta_ia(uuid, text, jsonb, boolean) to authenticated;

-- Función interna (la usan el check de la tabla y guardar_propuesta_ia como postgres).
revoke execute on function public.ia_propuesta_valida(jsonb) from public, anon, authenticated;

-- ============================================================================
-- 5. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc p
                  where p.oid = 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)'::regprocedure
                    and p.proowner = 'postgres'::regrole and p.prosecdef
                    and coalesce(p.proconfig, '{}') @> array['search_path=public']) then
    raise exception 'guardar_propuesta_ia() tiene que ser security definer, de postgres y con search_path fijado.';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.ia_propuestas'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ia_propuestas') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_propuestas'
                       and policyname = 'ia_propuestas_select' and cmd = 'SELECT') then
    raise exception 'ia_propuestas tiene que tener RLS activado y solo la política de lectura de la propia empresa.';
  end if;

  if has_table_privilege('anon', 'public.ia_propuestas', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.ia_propuestas', 'insert, update, delete, truncate, references, trigger')
     or not has_table_privilege('authenticated', 'public.ia_propuestas', 'select')
     or has_function_privilege('anon', 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)', 'execute')
     or has_function_privilege('anon', 'public.ia_propuesta_valida(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.ia_propuesta_valida(jsonb)', 'execute') then
    raise exception 'Los permisos de ia_propuestas o de sus funciones no son los esperados; revisa la sección 4.';
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver la tabla y la función nuevas.
notify pgrst, 'reload schema';

commit;
