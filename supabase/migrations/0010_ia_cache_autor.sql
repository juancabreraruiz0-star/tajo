-- Tajo · 0010_ia_cache_autor.sql — caché del asistente: solo el autor o un admin sustituyen una propuesta guardada
-- (D14, cuarta auditoría m1, tarea T21).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → este fichero → seed.sql (el seed
-- lo exige: limpia la tabla ia_propuestas).
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. Va entre begin y commit: si
-- algo falla, no se aplica nada. No toca datos: solo cambia una función y añade otra interna. Se puede volver a
-- ejecutar (create or replace) sin perder las propuestas guardadas.
-- Se puede aplicar antes o después de desplegar la app de T21: la app no cambia su forma de llamar a la función.
--
-- Por qué: con 0009, guardar_propuesta_ia(..., p_sustituir => true) dejaba que cualquier usuario de la empresa
-- cambiara la propuesta guardada por otro compañero con solo gastar un uso propio. D14 dice que una propuesta guardada
-- solo se sustituye cuando ya no pasa la validación, pero eso solo lo comprobaba la app.
--
-- Qué hace:
--   1. ia_propuesta_sustituible(autor): true si el usuario de la sesión es el autor de la fila (perfil_id, que 0009 ya
--      guarda: quién la pidió) o un admin de su empresa. Interna: nadie la ejecuta desde la API.
--   2. guardar_propuesta_ia(): igual que en 0009, pero con p_sustituir = true y una propuesta ya guardada de otro autor,
--      un usuario que no es admin recibe el error TJ006 y no se cambia nada (ni se gasta su reserva). La misma regla va
--      también en el on conflict, por si otra petición guarda la fila justo entre la comprobación y el insert: en ese
--      caso se queda la que había. Una fila sin autor (perfil_id null) solo la sustituye un admin.
--   La app, si no puede guardar, devuelve al usuario su propia propuesta igualmente (src/lib/actions/ia.ts).

begin;

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regclass('public.ia_propuestas') is null
     or to_regprocedure('public.guardar_propuesta_ia(uuid, text, jsonb, boolean)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'ia_propuestas' and column_name = 'perfil_id') then
    raise exception 'Falta la 0009: ejecuta antes 0009_ia_cache.sql.';
  end if;
end;
$$;

comment on column public.ia_propuestas.perfil_id is
  'Autor: quién pidió la propuesta guardada. Solo el autor o un admin de la empresa la pueden sustituir (0010).';

-- ============================================================================
-- 1. ¿Puede el usuario de la sesión sustituir una propuesta de este autor?
-- ============================================================================

create or replace function public.ia_propuesta_sustituible(p_autor uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_autor = auth.uid(), false) or public.es_admin()
$$;

comment on function public.ia_propuesta_sustituible(uuid) is
  'true si el usuario de la sesión es el autor de la propuesta guardada o un admin de su empresa. Interna (la usa guardar_propuesta_ia).';

-- ============================================================================
-- 2. guardar_propuesta_ia(): la de 0009 con la regla del autor.
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
  v_autor    uuid;
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

  -- Sustituir la de otro autor: solo un admin. Antes de gastar la reserva (el error deshace todo igualmente).
  if p_sustituir then
    select g.perfil_id into v_autor
      from public.ia_propuestas g
     where g.empresa_id = v_empresa and g.clave = p_clave;
    if found and not public.ia_propuesta_sustituible(v_autor) then
      raise exception using
        errcode = 'TJ006',
        message = 'Solo quien guardó esta propuesta o un administrador de la empresa puede sustituirla.',
        hint    = 'La propuesta guardada se queda como está.';
    end if;
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
   where p_sustituir and public.ia_propuesta_sustituible(g.perfil_id)
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
-- 3. Permisos (create or replace conserva los de 0009; se vuelven a fijar por si acaso)
-- ============================================================================

revoke execute on function public.guardar_propuesta_ia(uuid, text, jsonb, boolean) from public, anon;
grant  execute on function public.guardar_propuesta_ia(uuid, text, jsonb, boolean) to authenticated;

revoke execute on function public.ia_propuesta_sustituible(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc p
                  where p.oid = 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)'::regprocedure
                    and p.proowner = 'postgres'::regrole and p.prosecdef
                    and coalesce(p.proconfig, '{}') @> array['search_path=public']
                    and p.prosrc like '%ia_propuesta_sustituible%') then
    raise exception 'guardar_propuesta_ia() tiene que ser la de 0010: security definer, de postgres, con search_path fijado y la regla del autor.';
  end if;

  if has_function_privilege('anon', 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.guardar_propuesta_ia(uuid, text, jsonb, boolean)', 'execute')
     or has_function_privilege('anon', 'public.ia_propuesta_sustituible(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ia_propuesta_sustituible(uuid)', 'execute') then
    raise exception 'Los permisos de guardar_propuesta_ia() o de ia_propuesta_sustituible() no son los esperados; revisa la sección 3.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
