-- Tajo · 0002_reglas.sql — reglas de negocio de presupuestos y partidas también en la base de datos (R9, R12, R13).
-- Orden de ejecución: 1) migrations/0001_esquema.sql; 2) este fichero; 3) migrations/0003_guardar_presupuesto.sql;
-- 4) seed.sql.
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008_auditoria3.sql → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor → pegar este fichero entero → Run.
-- Es idempotente: solo usa create or replace / drop ... if exists, así que se puede volver a ejecutar; si ya estaba
-- aplicado 0003, hay que volver a ejecutarlo después (este fichero deja presupuestos_reglas() como antes de 0003).
--
-- Qué añade:
--   · presupuestos (before insert): un presupuesto nuevo empieza en borrador y sin número (lo pone presupuestos_numerar).
--   · presupuestos (before update): id, numero, token, empresa_id y created_at no cambian; transiciones de estado
--     de R9; enviado_at / aceptado_at = now() siempre al pasar a enviado / aceptado y fijas el resto del tiempo;
--     facturado solo desde facturar_presupuesto(); cliente, título, IVA y validez solo se editan en borrador.
--   · presupuesto_lineas (before insert/update/delete): solo se tocan partidas de presupuestos en borrador (el padre
--     se busca por id y empresa_id, para no revelar el estado de presupuestos de otra empresa).
--   · Política de borrado de partidas: cualquier usuario de la empresa en borrador; admin siempre (el trigger manda).
--
-- Marcas de transacción (variables de configuración propias, se ponen con set_config(..., true) y caducan al
-- terminar la transacción):
--   · tajo.facturando = 'on' → la pone facturar_presupuesto() justo antes de pasar el presupuesto a facturado.
--   · tajo.seed       = 'on' → la pone seed.sql al principio; los triggers de este fichero no bloquean nada.
-- ¿Puede un usuario ponerlas él mismo desde la app? No:
--   · set_config() vive en el esquema pg_catalog. PostgREST (la API /rest/v1 de Supabase) solo expone como RPC las
--     funciones de los esquemas configurados (public y graphql_public), así que /rest/v1/rpc/set_config responde
--     404 (PGRST202). pg_graphql tampoco publica funciones de pg_catalog.
--   · PostgREST solo fija por su cuenta variables con prefijo request.* (cabeceras, claims del JWT, método, ruta),
--     nunca tajo.*.
--   · Ninguna función de public llama a set_config() con datos del usuario. Si algún día se crea una, que no
--     acepte el nombre ni el valor de la variable desde fuera.
--   · Cada petición a la API es su propia transacción, así que una marca puesta con is_local = true no pasa de
--     una petición a otra.
--
-- Orden de los triggers: Postgres ejecuta los triggers del mismo momento y evento por orden alfabético del nombre.
-- presupuestos_alta_validar ('a...') va antes que presupuestos_numerar ('n...') de 0001: primero se comprueba que
-- numero llega nulo y después se numera.

-- ============================================================================
-- 1. Presupuestos · alta
-- ============================================================================

create or replace function public.presupuestos_alta_validar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return new;
  end if;

  if new.estado is distinct from 'borrador' then
    raise exception 'Un presupuesto nuevo siempre empieza en borrador (se ha recibido: %).', coalesce(new.estado, 'vacío');
  end if;

  if new.numero is not null then
    raise exception 'El número del presupuesto lo asigna el sistema; no se puede indicar al crearlo.';
  end if;

  -- Un borrador aún no se ha enviado ni aceptado.
  new.enviado_at  := null;
  new.aceptado_at := null;

  return new;
end;
$$;

drop trigger if exists presupuestos_alta_validar on public.presupuestos;
create trigger presupuestos_alta_validar
  before insert on public.presupuestos
  for each row execute function public.presupuestos_alta_validar();

-- ============================================================================
-- 2. Presupuestos · cambios
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

drop trigger if exists presupuestos_reglas on public.presupuestos;
create trigger presupuestos_reglas
  before update on public.presupuestos
  for each row execute function public.presupuestos_reglas();

-- ============================================================================
-- 3. Partidas · solo en borrador
-- ============================================================================

-- security definer para leer el presupuesto padre sin depender de RLS.
-- Si el padre no existe (borrado en cascada de un presupuesto, o un insert que fallará por la FK), no se bloquea.
-- El padre se lee con "for share" para que no cambie de estado mientras se tocan sus partidas.
create or replace function public.presupuesto_lineas_solo_borrador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if coalesce(current_setting('tajo.seed', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Al borrar un material del almacén, la FK pone material_id a null en sus partidas (on delete set null).
    -- Eso se permite en cualquier estado si es lo único que cambia y lo hace la propia FK (trigger anidado).
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
       for share;

    if found and v_estado <> 'borrador' then
      raise exception 'Solo se pueden cambiar las partidas de un presupuesto en borrador (estado actual: %).', v_estado;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select p.estado into v_estado
      from public.presupuestos p
     where p.id = new.presupuesto_id
       and p.empresa_id = new.empresa_id
       for share;

    if found and v_estado <> 'borrador' then
      raise exception 'Solo se pueden añadir o cambiar partidas de un presupuesto en borrador (estado actual: %).', v_estado;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists presupuesto_lineas_solo_borrador on public.presupuesto_lineas;
create trigger presupuesto_lineas_solo_borrador
  before insert or update or delete on public.presupuesto_lineas
  for each row execute function public.presupuesto_lineas_solo_borrador();

-- ============================================================================
-- 4. Partidas · política de borrado
--    Cualquier usuario de la empresa borra partidas de un borrador; admin siempre a nivel de política
--    (el trigger de arriba sigue impidiendo tocar partidas fuera de borrador a todos).
-- ============================================================================

drop policy if exists presupuesto_lineas_delete on public.presupuesto_lineas;
create policy presupuesto_lineas_delete on public.presupuesto_lineas
  for delete to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (
      (select public.es_admin())
      or exists (
        select 1
          from public.presupuestos p
         where p.id         = presupuesto_lineas.presupuesto_id
           and p.empresa_id = presupuesto_lineas.empresa_id
           and p.estado     = 'borrador'
      )
    )
  );

-- ============================================================================
-- 5. Facturación: igual que en 0001, pero activa la marca tajo.facturando justo antes de pasar a facturado
--    (es la única vía por la que el trigger presupuestos_reglas deja llegar a ese estado).
-- ============================================================================

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
  v_base    bigint;
  v_iva     bigint;
  v_total   bigint;
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

  select t.base_cents, t.iva_cents, t.total_cents
    into v_base, v_iva, v_total
    from public.totales_presupuesto(v_pres.id) t;

  insert into public.facturas
    (empresa_id, presupuesto_id, cliente_id, numero, fecha, base_cents, iva_cents, total_cents)
  values (
    v_empresa,
    v_pres.id,
    v_pres.cliente_id,
    public.siguiente_numero(v_empresa, 'F'),
    (now() at time zone 'Europe/Madrid')::date,
    v_base,
    v_iva,
    v_total
  )
  returning id into v_factura;

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

-- create or replace conserva los permisos de 0001; se repiten para que este fichero se explique solo.
revoke execute on function public.facturar_presupuesto(uuid) from public, anon;
grant  execute on function public.facturar_presupuesto(uuid) to authenticated;

-- aceptar_presupuesto() de 0001 no cambia: hace enviado → aceptado (transición válida); su aceptado_at = now() es el
-- mismo valor que fuerza el trigger (now() es la hora de inicio de la transacción) y su "returning" lo devuelve.
