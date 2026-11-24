-- Tajo · 0003_guardar_presupuesto.sql — guardado atómico de presupuestos y dos reglas más en la base de datos.
-- Orden de ejecución: 1) migrations/0001_esquema.sql; 2) migrations/0002_reglas.sql; 3) este fichero; 4) seed.sql
-- (el seed no depende de este fichero: si ya estaba cargado, basta con ejecutar este).
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008_auditoria3.sql → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor → pegar este fichero entero → Run.
-- Es idempotente: solo usa create or replace, así que se puede volver a ejecutar. Si se vuelve a ejecutar 0002
-- después de este fichero, hay que volver a ejecutar este (0002 deja presupuestos_reglas() sin la comprobación
-- de partidas al enviar).
--
-- Qué añade:
--   · guardar_presupuesto(): alta o edición de un presupuesto en borrador con sus partidas en una sola transacción
--     (la de la llamada RPC). security invoker: la RLS y los triggers de 0002 se aplican igual que desde la app.
--   · presupuestos_reglas() (trigger de 0002): misma lógica y, además, no deja pasar de borrador a enviado un
--     presupuesto sin partidas.
--   · aceptar_presupuesto() (de 0001): misma lógica y, además, no deja aceptar un presupuesto con la validez vencida.
--     Último día válido = fecha de creación (hora de Madrid) + validez_dias, igual que validUntil() en
--     src/lib/domain/presupuestos.ts.

-- ============================================================================
-- 1. Guardar presupuesto (alta o edición del borrador) con sus partidas
--    p_id null → alta; si no, edición. p_partidas: array jsonb de
--    { orden, descripcion, cantidad, precio_cents, material_id }.
--    Nunca toca estado, numero, token ni fechas: los pone o protege la base de datos (D7).
-- ============================================================================

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
      as x(orden integer, descripcion text, cantidad numeric, precio_cents integer, material_id uuid);

  return v_id;
end;
$$;

revoke execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) from public, anon;
grant  execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) to authenticated;

-- ============================================================================
-- 2. Presupuestos · cambios (trigger de 0002): igual que en 0002 y, al enviar, al menos una partida.
-- ============================================================================

create or replace function public.presupuestos_reglas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return new;
  end if;

  -- Campos que no cambian nunca.
  if new.id is distinct from old.id then
    raise exception 'No se puede cambiar el identificador de un presupuesto.';
  end if;
  if new.numero is distinct from old.numero then
    raise exception 'No se puede cambiar el número de un presupuesto.';
  end if;
  if new.token is distinct from old.token then
    raise exception 'No se puede cambiar el enlace público (token) de un presupuesto.';
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

    if new.estado = 'facturado'
       and coalesce(current_setting('tajo.facturando', true), '') <> 'on' then
      raise exception 'Un presupuesto solo pasa a facturado al convertirlo en factura.';
    end if;

    -- Nuevo en 0003: no se envía un presupuesto vacío.
    if old.estado = 'borrador' and new.estado = 'enviado'
       and not exists (
         select 1
           from public.presupuesto_lineas l
          where l.presupuesto_id = new.id
            and l.empresa_id = new.empresa_id
       ) then
      raise exception 'Añade al menos una partida antes de enviar el presupuesto.';
    end if;
  end if;

  -- Fechas de envío y aceptación: las pone siempre la base de datos al hacer la transición (se ignora lo que
  -- llegue del cliente) y fuera de esa transición no se pueden cambiar.
  if new.estado is distinct from old.estado and new.estado = 'enviado' then
    new.enviado_at := now();
  elsif new.enviado_at is distinct from old.enviado_at then
    raise exception 'La fecha de envío la pone el sistema al enviar el presupuesto; no se puede cambiar.';
  end if;

  if new.estado is distinct from old.estado and new.estado = 'aceptado' then
    new.aceptado_at := now();
  elsif new.aceptado_at is distinct from old.aceptado_at then
    raise exception 'La fecha de aceptación la pone el sistema al aceptar el presupuesto; no se puede cambiar.';
  end if;

  return new;
end;
$$;

-- El trigger presupuestos_reglas de 0002 sigue apuntando a esta función (create or replace no lo toca).

-- ============================================================================
-- 3. Aceptar por enlace (de 0001): igual y, además, no se acepta con la validez vencida.
-- ============================================================================

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

  -- Nuevo en 0003: validez vencida (el último día válido todavía se puede aceptar).
  if ((v_creado at time zone 'Europe/Madrid')::date + v_validez) < (now() at time zone 'Europe/Madrid')::date then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'La validez de este presupuesto ha vencido; contacta con la empresa para actualizarlo.'
    );
  end if;

  update public.presupuestos
     set estado = 'aceptado', aceptado_at = now()
   where id = v_id
  returning aceptado_at into v_aceptado;

  return jsonb_build_object('ok', true, 'estado', 'aceptado', 'aceptado_at', v_aceptado);
end;
$$;

-- create or replace conserva los permisos de 0001; se repiten para que este fichero se explique solo.
revoke execute on function public.aceptar_presupuesto(uuid) from public;
grant  execute on function public.aceptar_presupuesto(uuid) to anon, authenticated;
