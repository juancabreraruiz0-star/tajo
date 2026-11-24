-- Tajo · 0007_auditoria2.sql — correcciones de la segunda auditoría externa en la base de datos (D12, tarea T17a).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → este fichero → seed.sql (el seed lo necesita).
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008_auditoria3.sql → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. El SQL Editor lo ejecuta en
-- una sola transacción: si algo falla, no se aplica nada y los datos quedan como estaban. Se aplica sobre una base con
-- datos y no borra nada. Se puede volver a ejecutar (create or replace, if not exists, drop … if exists).
-- Si se vuelve a ejecutar 0004, 0005 o 0006 después de este fichero, hay que volver a ejecutar este: aquellos redefinen
-- funciones, triggers y vistas que este fichero cambia.
--
-- Qué cambia (docs/AUDITORIA-2.md entre paréntesis):
--   1. Aceptación por enlace con evidencia (A2). Columnas nuevas en presupuestos:
--        · aceptado_nombre, aceptado_ip y aceptado_user_agent: solo los pone aceptar_presupuesto() (canal 'enlace');
--        · enviado_por: perfil que lo pasó a enviado (auth.uid()), lo pone el trigger.
--      Nadie las puede elegir ni cambiar desde la API (trigger presupuestos_reglas). La vista presupuestos_con_totales
--      las enseña. aceptar_presupuesto(p_token, p_nombre, p_ip, p_user_agent): el nombre es obligatorio (2–120
--      caracteres); la IP (64) y el navegador (400) se recortan. La versión de un argumento desaparece.
--      La IP y el navegador los manda el servidor de la app, pero quien llame a la función con la clave anónima puede
--      inventarlos: es evidencia razonable, no una prueba forense.
--   2. El empleado solo ve el semáforo (M1). obras_resumen añade semaforo (verde, ambar o rojo) para todos, y
--      consumido_pct sale a null para quien no es gerencia, igual que los importes.
--   3. Cuota de IA también por usuario (B1): como mucho 15 propuestas al día por perfil dentro de las 40 de la empresa
--      (tabla uso_ia_perfiles). Si se pasa, error TJ003. Devolver una reserva resta también del contador del usuario.
--   4. NIF validado en la base (B2): nif_valido() con el mismo algoritmo que src/lib/domain/nif.ts y CHECK en clientes.
--   5. Partes (B3): como mucho 24 h por autor y día, la fecha como mucho 30 días hacia atrás, y la fecha de inicio de una
--      obra no se cambia una vez empezada.
--   6. Borrar presupuestos (B4): solo en borrador, enviado o rechazado (política y trigger).
--   7. guardar_presupuesto (B5): rechaza cantidades con más de 3 decimales y un orden ≤ 0 o repetido;
--      unique (presupuesto_id, orden) y orden > 0 en las partidas.
--   8. Invitaciones (B7): usada_at. El perfil solo se crea con el email confirmado (al darse de alta o al confirmar
--      después: trigger on_auth_user_confirmed), y una invitación usada no da perfil a otro usuario. Para volver a usar
--      el email de una invitación usada (p. ej. tras borrar al usuario), se pone usada_at = null en el SQL Editor.
--
-- Marcas de transacción (igual que en 0004): tajo.seed, tajo.facturando, tajo.aceptando y tajo.regenerando solo
-- cuentan si current_user = 'postgres' (SQL Editor o funciones security definer de postgres). Por eso los triggers que
-- las miran son security invoker.

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regclass('public.uso_ia') is null or to_regprocedure('public.consumir_uso_ia()') is null then
    raise exception 'Falta la 0005: ejecuta antes 0005_uso_ia.sql y 0006_obras.sql.';
  end if;
  if to_regclass('public.obras') is null or to_regclass('public.obras_resumen') is null then
    raise exception 'Falta la 0006: ejecuta antes 0006_obras.sql.';
  end if;
end;
$$;

-- ============================================================================
-- 1. nif_valido(): mismo algoritmo que nifError() de src/lib/domain/nif.ts. Recibe el NIF ya normalizado (mayúsculas,
--    sin espacios, puntos ni guiones: lo hace el trigger clientes_normalizar antes del CHECK).
--      · DNI: 8 cifras y letra = TRWAGMYFPDXBNJZSQVHLCKE[número mod 23].
--      · NIE: X, Y o Z (valen 0, 1 y 2) + 7 cifras + letra, calculada como un DNI.
--      · NIF especial: K, L o M + 7 cifras + letra (las 7 cifras mod 23).
--      · CIF: letra de ABCDEFGHJNPQRSUVW + 7 cifras + control. Suma: cifras en posición par (2.ª, 4.ª, 6.ª) tal cual; en
--        impar, el doble con sus cifras sumadas; control = (10 − suma mod 10) mod 10. A, B, E y H terminan en ese número;
--        N, P, Q, R, S y W en la letra JABCDEFGHI[control]; el resto, en cualquiera de los dos.
-- ============================================================================

create or replace function public.nif_valido(p_nif text)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = public
as $$
declare
  c_letras_dni constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  c_letras_cif constant text := 'JABCDEFGHI';
  v_suma  integer := 0;
  v_d     integer;
  v_ctrl  integer;
  v_final text;
begin
  if p_nif ~ '^[0-9]{8}[A-Z]$' then
    return substr(c_letras_dni, (left(p_nif, 8)::integer % 23) + 1, 1) = right(p_nif, 1);
  end if;

  if p_nif ~ '^[XYZ][0-9]{7}[A-Z]$' then
    return substr(c_letras_dni, ((translate(left(p_nif, 1), 'XYZ', '012') || substr(p_nif, 2, 7))::integer % 23) + 1, 1)
           = right(p_nif, 1);
  end if;

  if p_nif ~ '^[KLM][0-9]{7}[A-Z]$' then
    return substr(c_letras_dni, (substr(p_nif, 2, 7)::integer % 23) + 1, 1) = right(p_nif, 1);
  end if;

  if p_nif ~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' then
    for i in 1..7 loop
      v_d := substr(p_nif, i + 1, 1)::integer;
      if i % 2 = 0 then
        v_suma := v_suma + v_d;
      else
        v_suma := v_suma + (2 * v_d) / 10 + (2 * v_d) % 10;
      end if;
    end loop;
    v_ctrl  := (10 - v_suma % 10) % 10;
    v_final := right(p_nif, 1);
    if left(p_nif, 1) in ('A', 'B', 'E', 'H') then
      return v_final = v_ctrl::text;
    end if;
    if left(p_nif, 1) in ('N', 'P', 'Q', 'R', 'S', 'W') then
      return v_final = substr(c_letras_cif, v_ctrl + 1, 1);
    end if;
    return v_final in (v_ctrl::text, substr(c_letras_cif, v_ctrl + 1, 1));
  end if;

  return false;
end;
$$;

comment on function public.nif_valido(text) is
  'NIF, NIE o CIF ya normalizado con su letra o dígito de control correcto. Mismo algoritmo que src/lib/domain/nif.ts.';

-- ============================================================================
-- 2. Datos que no cumplirían las reglas nuevas. Si hay alguno, no se aplica nada y se dice qué corregir.
-- ============================================================================

do $$
declare
  v_problemas text[] := '{}';
  v_lista     text;
begin
  select string_agg(format('%s (%s)', c.nif, c.nombre), ', ' order by c.nombre)
    into v_lista
    from public.clientes c
   where c.nif is not null
     and not public.nif_valido(c.nif);
  if v_lista is not null then
    v_problemas := v_problemas || format('clientes con un NIF cuya letra o dígito de control no es correcto: %s', v_lista);
  end if;

  select string_agg(distinct p.numero, ', ')
    into v_lista
    from public.presupuesto_lineas l
    join public.presupuestos p on p.empresa_id = l.empresa_id and p.id = l.presupuesto_id
   where l.orden <= 0;
  if v_lista is not null then
    v_problemas := v_problemas || format('presupuestos con partidas de orden 0 o negativo: %s', v_lista);
  end if;

  select string_agg(distinct p.numero, ', ')
    into v_lista
    from (select l.empresa_id, l.presupuesto_id
            from public.presupuesto_lineas l
           group by l.empresa_id, l.presupuesto_id, l.orden
          having count(*) > 1) d
    join public.presupuestos p on p.empresa_id = d.empresa_id and p.id = d.presupuesto_id;
  if v_lista is not null then
    v_problemas := v_problemas || format('presupuestos con dos partidas con el mismo orden: %s', v_lista);
  end if;

  if cardinality(v_problemas) > 0 then
    raise exception 'No se ha aplicado nada. Corrige antes estos datos: %.', array_to_string(v_problemas, '; ');
  end if;
end;
$$;

-- ============================================================================
-- 3. Tablas, columnas y restricciones
-- ============================================================================

-- 3.1 Evidencia de envío y aceptación.
alter table public.presupuestos add column if not exists aceptado_nombre     text;
alter table public.presupuestos add column if not exists aceptado_ip         text;
alter table public.presupuestos add column if not exists aceptado_user_agent text;
alter table public.presupuestos add column if not exists enviado_por         uuid;

comment on column public.presupuestos.aceptado_nombre is
  'Nombre que escribió el cliente al aceptar por el enlace. Solo lo pone aceptar_presupuesto().';
comment on column public.presupuestos.aceptado_ip is
  'IP desde la que se aceptó por el enlace (la manda el servidor de la app; evidencia, no prueba).';
comment on column public.presupuestos.aceptado_user_agent is
  'Navegador desde el que se aceptó por el enlace (la manda el servidor de la app; evidencia, no prueba).';
comment on column public.presupuestos.enviado_por is
  'Perfil que pasó el presupuesto a enviado (auth.uid()). Queda a null si se borra el usuario.';

do $$
begin
  -- enviado_por es un perfil de la misma empresa. Si se borra el usuario, queda a null.
  if not exists (select 1 from pg_constraint where conname = 'presupuestos_enviado_por_fkey'
                    and conrelid = 'public.presupuestos'::regclass) then
    alter table public.presupuestos
      add constraint presupuestos_enviado_por_fkey
      foreign key (empresa_id, enviado_por) references public.perfiles (empresa_id, id)
      on delete set null (enviado_por);
  end if;
end;
$$;

create index if not exists presupuestos_enviado_por_idx on public.presupuestos (enviado_por) where enviado_por is not null;

alter table public.presupuestos
  drop constraint if exists presupuestos_aceptado_nombre_chk,
  drop constraint if exists presupuestos_aceptado_ip_chk,
  drop constraint if exists presupuestos_aceptado_user_agent_chk,
  -- Solo la aceptación por enlace tiene nombre, IP y navegador (las anteriores a 0007 no los tienen).
  add constraint presupuestos_aceptado_nombre_chk
    check (aceptado_nombre is null or (aceptado_canal = 'enlace' and char_length(aceptado_nombre) between 2 and 120)),
  add constraint presupuestos_aceptado_ip_chk
    check (aceptado_ip is null or (aceptado_canal = 'enlace' and char_length(aceptado_ip) <= 64)),
  add constraint presupuestos_aceptado_user_agent_chk
    check (aceptado_user_agent is null or (aceptado_canal = 'enlace' and char_length(aceptado_user_agent) <= 400));

-- 3.2 NIF con su control correcto (el formato ya lo exige clientes_nif_formato_chk de 0004).
alter table public.clientes
  drop constraint if exists clientes_nif_valido_chk,
  add constraint clientes_nif_valido_chk check (nif is null or public.nif_valido(nif));

-- 3.3 Partidas: orden mayor que 0 y sin repetir dentro del presupuesto.
alter table public.presupuesto_lineas
  drop constraint if exists presupuesto_lineas_orden_chk,
  add constraint presupuesto_lineas_orden_chk check (orden > 0);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'presupuesto_lineas_presupuesto_orden_key'
                    and conrelid = 'public.presupuesto_lineas'::regclass) then
    alter table public.presupuesto_lineas
      add constraint presupuesto_lineas_presupuesto_orden_key unique (presupuesto_id, orden);
  end if;
end;
$$;

-- 3.4 Invitaciones usadas.
alter table public.invitaciones add column if not exists usada_at timestamptz;

comment on column public.invitaciones.usada_at is
  'Cuándo dio perfil a un usuario. Una invitación usada no da perfil a otro; para reutilizarla, usada_at = null.';

-- 3.5 Cuota de IA por usuario: propuestas de cada perfil por día (Europe/Madrid). Sin acceso desde la API: solo la
--     escriben consumir_uso_ia() y devolver_uso_ia().
create table if not exists public.uso_ia_perfiles (
  perfil_id  uuid not null,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  dia        date not null,
  usos       int  not null default 0,
  primary key (perfil_id, dia),
  constraint uso_ia_perfiles_usos_chk check (usos between 0 and 15),
  foreign key (empresa_id, perfil_id) references public.perfiles (empresa_id, id) on delete cascade
);

comment on table public.uso_ia_perfiles is
  'Propuestas con IA por usuario y día (Europe/Madrid), como mucho 15. Solo la escriben consumir_uso_ia() y devolver_uso_ia().';

create index if not exists uso_ia_perfiles_empresa_id_idx on public.uso_ia_perfiles (empresa_id);

-- ============================================================================
-- 4. Triggers
-- ============================================================================

-- 4.1 Presupuestos · alta (sustituye a la de 0004): además, sin evidencia de envío ni de aceptación.
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
  new.created_at          := now();
  new.token               := gen_random_uuid();
  new.enviado_at          := null;
  new.enviado_por         := null;
  new.aceptado_at         := null;
  new.aceptado_por        := null;
  new.aceptado_canal      := null;
  new.aceptado_nombre     := null;
  new.aceptado_ip         := null;
  new.aceptado_user_agent := null;

  return new;
end;
$$;

-- 4.2 Presupuestos · cambios (sustituye a la de 0004): igual y, además,
--     · al pasar a enviado, enviado_por = auth.uid(); después no cambia (salvo el "set null" de la FK al borrar el
--       usuario: trigger anidado y sin tocar nada más de la fila);
--     · aceptado_nombre, aceptado_ip y aceptado_user_agent solo los pone aceptar_presupuesto() (marca tajo.aceptando,
--       en el mismo update que acepta); en la aceptación interna quedan vacíos y fuera de la transición no cambian.
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

    if v_a_enviado
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
        -- aceptado_nombre, aceptado_ip y aceptado_user_agent llegan en este mismo update desde aceptar_presupuesto().
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
        new.aceptado_canal      := 'interno';
        new.aceptado_por        := auth.uid();
        new.aceptado_nombre     := null;
        new.aceptado_ip         := null;
        new.aceptado_user_agent := null;
      end if;
    end if;
  end if;

  -- Quién, por dónde y con qué evidencia se aceptó: solo los pone la transición a aceptado. Única excepción: la FK pone
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
    if (new.aceptado_nombre, new.aceptado_ip, new.aceptado_user_agent)
       is distinct from (old.aceptado_nombre, old.aceptado_ip, old.aceptado_user_agent) then
      raise exception 'El nombre, la IP y el navegador de la aceptación los pone el sistema; no se pueden cambiar.';
    end if;
  end if;

  -- Quién lo envió: lo pone la transición a enviado.
  if v_a_enviado then
    new.enviado_por := auth.uid();
  elsif new.enviado_por is distinct from old.enviado_por
        and not (    pg_trigger_depth() > 1
                 and new.enviado_por is null
                 and (to_jsonb(new) - 'enviado_por') = (to_jsonb(old) - 'enviado_por')) then
    raise exception 'Quién envió el presupuesto lo pone el sistema; no se puede cambiar.';
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

-- 4.3 Presupuestos · borrado: un aceptado o facturado no se borra (tampoco desde el SQL Editor, salvo el seed). Para
--     la API ya lo impide la política presupuestos_delete (sección 7: la fila no se ve para borrar y el delete afecta
--     a 0 filas); esto cubre además a postgres. Se llama «…_aceptado» para dispararse antes que
--     presupuestos_borrar_con_obra (0006): Postgres ejecuta los triggers del mismo evento por orden alfabético.
create or replace function public.presupuestos_borrar_aceptado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return old;
  end if;
  if old.estado in ('aceptado', 'facturado') then
    raise exception 'Un presupuesto aceptado o facturado no se borra.';
  end if;
  return old;
end;
$$;

drop trigger if exists presupuestos_borrar_aceptado on public.presupuestos;
create trigger presupuestos_borrar_aceptado
  before delete on public.presupuestos
  for each row execute function public.presupuestos_borrar_aceptado();

-- 4.4 Obras · cambios (sustituye a la de 0006): igual y, además, la fecha de inicio no se cambia una vez empezada la
--     obra (al pasar de pendiente a en curso se fija; después, ni gerencia ni el encargado la mueven).
create or replace function public.obras_reglas()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hoy          constant date := (now() at time zone 'Europe/Madrid')::date;
  v_primer_parte date;
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return new;
  end if;

  if pg_trigger_depth() > 1
     and old.encargado_id is not null
     and new.encargado_id is null
     and (to_jsonb(new) - 'encargado_id') = (to_jsonb(old) - 'encargado_id') then
    return new;
  end if;

  if (new.id, new.empresa_id, new.presupuesto_id, new.cliente_id, new.titulo, new.created_at)
     is distinct from
     (old.id, old.empresa_id, old.presupuesto_id, old.cliente_id, old.titulo, old.created_at) then
    raise exception 'El presupuesto, el cliente, el título y la fecha de alta de una obra no se pueden cambiar.';
  end if;

  if old.estado = 'terminada' then
    if new.estado is distinct from old.estado then
      raise exception 'La obra ya está terminada: no puede cambiar de estado.';
    end if;
    if (to_jsonb(new) - 'notas') is distinct from (to_jsonb(old) - 'notas') then
      raise exception 'La obra está terminada: solo se pueden cambiar las notas.';
    end if;
  end if;

  -- Nuevo en 0007.
  if old.estado <> 'pendiente' and new.fecha_inicio is distinct from old.fecha_inicio then
    raise exception 'La fecha de inicio no se cambia una vez empezada la obra.';
  end if;

  if new.estado is distinct from old.estado then
    if not (   (old.estado = 'pendiente' and new.estado = 'en_curso')
            or (old.estado = 'en_curso'  and new.estado in ('parada', 'terminada'))
            or (old.estado = 'parada'    and new.estado in ('en_curso', 'terminada'))) then
      raise exception 'Una obra no puede pasar de «%» a «%».',
        replace(old.estado, '_', ' '), replace(coalesce(new.estado, 'vacío'), '_', ' ');
    end if;

    if new.estado = 'en_curso' and old.estado = 'pendiente' then
      if new.fecha_inicio is null or new.fecha_inicio > v_hoy then
        new.fecha_inicio := v_hoy;
      end if;
      if new.fecha_fin_prevista < new.fecha_inicio
         and new.fecha_fin_prevista is not distinct from old.fecha_fin_prevista then
        new.fecha_fin_prevista := null;
      end if;
    end if;
    -- Al terminar: si no se indica la fecha de fin real, termina hoy.
    if new.estado = 'terminada' and new.fecha_fin is null then
      new.fecha_fin := v_hoy;
    end if;
  end if;

  if new.estado <> 'pendiente' and new.fecha_inicio is null then
    raise exception 'Una obra empezada tiene que tener fecha de inicio.';
  end if;
  if new.estado <> 'pendiente' and new.fecha_inicio > v_hoy then
    raise exception 'La fecha de inicio de una obra empezada no puede ser posterior a hoy.';
  end if;
  if new.fecha_inicio is distinct from old.fecha_inicio and new.fecha_inicio is not null then
    select min(p.fecha) into v_primer_parte
      from public.partes p
     where p.empresa_id = new.empresa_id
       and p.obra_id = new.id;
    if new.fecha_inicio > v_primer_parte then
      raise exception 'La obra tiene partes desde el %: la fecha de inicio no puede ser posterior.',
        to_char(v_primer_parte, 'DD/MM/YYYY');
    end if;
  end if;
  if char_length(new.notas) > 2000 then
    raise exception 'Las notas de la obra pueden tener como mucho 2000 caracteres.';
  end if;
  if new.fecha_fin is not null and new.estado <> 'terminada' then
    raise exception 'La fecha de fin real solo se pone al terminar la obra.';
  end if;
  if new.estado = 'terminada' and new.fecha_fin is null then
    raise exception 'Una obra terminada tiene que tener fecha de fin.';
  end if;
  if new.fecha_fin > v_hoy then
    raise exception 'La fecha de fin real no puede ser posterior a hoy.';
  end if;
  if new.fecha_fin < new.fecha_inicio then
    raise exception 'La fecha de fin no puede ser anterior a la de inicio.';
  end if;
  if new.fecha_fin_prevista < new.fecha_inicio then
    raise exception 'La fecha de fin prevista no puede ser anterior a la de inicio.';
  end if;

  return new;
end;
$$;

-- 4.5 Partes (sustituye a la de 0006): igual y, además,
--     · la fecha del parte, como mucho 30 días antes de hoy (Madrid), al crearlo o al cambiarle la fecha (corregir las
--       horas de un parte antiguo de una obra en curso sigue pudiéndose);
--     · como mucho 24 h por autor y día, sumando sus partes de ese día en todas las obras, al crearlo o al cambiarle
--       la fecha o las horas. Un bloqueo consultivo por autor y día pone en cola dos altas simultáneas, así la segunda
--       ya cuenta la primera. Los partes sin autor (usuario borrado) no cuentan.
create or replace function public.partes_reglas()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hoy    constant date := (now() at time zone 'Europe/Madrid')::date;
  v_estado text;
  v_inicio date;
  v_suma   numeric;
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and old.autor_id is not null
     and new.autor_id is null
     and (to_jsonb(new) - 'autor_id') = (to_jsonb(old) - 'autor_id') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select o.estado, o.fecha_inicio into v_estado, v_inicio
      from public.obras o
     where o.id = new.obra_id
       and o.empresa_id = new.empresa_id;

    if not found then
      raise exception 'La obra no existe o no es de tu empresa.';
    end if;
    if v_estado = 'pendiente' then
      raise exception 'La obra todavía no ha empezado: ponla en curso antes de añadir partes.';
    elsif v_estado = 'parada' then
      raise exception 'La obra está parada: vuelve a ponerla en curso para añadir partes.';
    elsif v_estado = 'terminada' then
      raise exception 'La obra está terminada: ya no admite partes nuevos.';
    end if;

    new.autor_id := auth.uid();
    if new.autor_id is null then
      raise exception 'Para añadir un parte hay que entrar con un usuario.';
    end if;
    select e.coste_hora_cents into new.coste_hora_cents
      from public.empresas e
     where e.id = new.empresa_id;
    new.created_at := now();
    new.fecha := coalesce(new.fecha, v_hoy);
  else
    if tg_op = 'UPDATE'
       and (new.id, new.empresa_id, new.obra_id, new.autor_id, new.coste_hora_cents, new.created_at)
           is distinct from
           (old.id, old.empresa_id, old.obra_id, old.autor_id, old.coste_hora_cents, old.created_at) then
      raise exception 'La obra, el autor, el coste por hora y la fecha de alta de un parte no se pueden cambiar.';
    end if;

    select o.estado, o.fecha_inicio into v_estado, v_inicio
      from public.obras o
     where o.id = old.obra_id
       and o.empresa_id = old.empresa_id;

    if found and v_estado = 'terminada' then
      raise exception 'La obra está terminada: sus partes ya no se pueden cambiar ni borrar.';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  if new.fecha is null or new.fecha > v_hoy then
    raise exception 'La fecha del parte no puede ser posterior a hoy.';
  end if;
  if new.fecha < v_inicio then
    raise exception 'La fecha del parte no puede ser anterior al inicio de la obra (%).', to_char(v_inicio, 'DD/MM/YYYY');
  end if;
  if new.fecha < v_hoy - 30 and (tg_op = 'INSERT' or new.fecha is distinct from old.fecha) then
    raise exception 'La fecha del parte no puede ser de hace más de 30 días.';
  end if;
  if new.horas is null or new.horas <= 0 or new.horas > 24 then
    raise exception 'Las horas del parte tienen que ser más de 0 y como mucho 24.';
  end if;
  if new.horas <> round(new.horas, 2) then
    raise exception 'Las horas del parte pueden tener como mucho 2 decimales.';
  end if;
  if char_length(new.notas) > 1000 then
    raise exception 'Las notas del parte pueden tener como mucho 1000 caracteres.';
  end if;

  if new.autor_id is not null
     and (tg_op = 'INSERT' or new.fecha is distinct from old.fecha or new.horas is distinct from old.horas) then
    perform pg_advisory_xact_lock(hashtextextended('tajo.partes:' || new.autor_id::text || ':' || new.fecha::text, 0));
    select coalesce(sum(p.horas), 0) into v_suma
      from public.partes p
     where p.empresa_id = new.empresa_id
       and p.autor_id = new.autor_id
       and p.fecha = new.fecha
       and p.id <> new.id;
    if v_suma + new.horas > 24 then
      raise exception 'Ese día ya tienes % h apuntadas: como mucho 24 h por persona y día.',
        replace(trim_scale(v_suma)::text, '.', ',');
    end if;
  end if;

  return new;
end;
$$;

-- Los triggers obras_reglas y partes_reglas de 0006 siguen apuntando a estas funciones.

-- 4.6 Alta de usuarios (sustituye a la de 0004): solo con el email confirmado y con una invitación sin usar, que queda
--     marcada como usada. Se dispara al crear el usuario (on_auth_user_created, de 0001) y al confirmar el email
--     después (on_auth_user_confirmed, nuevo). La invitación se bloquea con "for update": dos altas a la vez con el
--     mismo email no se quedan las dos con el perfil.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitaciones%rowtype;
begin
  -- Sin email confirmado no hay perfil todavía: se crea cuando lo confirme (trigger on_auth_user_confirmed).
  if new.email_confirmed_at is null then
    return new;
  end if;
  if exists (select 1 from public.perfiles p where p.id = new.id) then
    return new;
  end if;

  select * into v_inv
    from public.invitaciones i
   where i.email = lower(trim(coalesce(new.email, '')))
     and i.usada_at is null
     for update;

  -- Sin invitación (o ya usada) no hay perfil: la app manda a /login?error=perfil y la RLS no le deja ver nada.
  if not found then
    return new;
  end if;

  insert into public.perfiles (id, empresa_id, nombre, email, rol)
  values (
    new.id,
    v_inv.empresa_id,
    left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'), 120),
    lower(new.email),
    v_inv.rol
  )
  on conflict (id) do nothing;

  update public.invitaciones
     set usada_at = now()
   where email = v_inv.email;

  return new;
end;
$$;

-- El trigger del alta (on_auth_user_created, 0001) sigue apuntando a esta función. El de la confirmación se crea solo si
-- no existe: así el fichero se puede volver a ejecutar sin "drop trigger" sobre auth.users, que en Supabase puede
-- fallar por los permisos del esquema auth (ver la cabecera de 0001).
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'on_auth_user_confirmed'
                    and tgrelid = 'auth.users'::regclass) then
    create trigger on_auth_user_confirmed
      after update of email_confirmed_at on auth.users
      for each row
      when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
      execute function public.handle_new_user();
  end if;
end;
$$;

-- ============================================================================
-- 5. Funciones
-- ============================================================================

-- 5.1 Aceptar por enlace (sustituye a la de 0004, que tenía un solo argumento y se elimina): igual y, además, guarda el
--     nombre que escribe el cliente (obligatorio, 2–120 caracteres y al menos una letra, tras quitar los caracteres de
--     ancho cero, pasar a espacio los espacios Unicode, recortar los extremos y juntar los repetidos), la IP (como mucho 64) y el navegador (como mucho 400) que reenvía el servidor de la app. A los tres se
--     les quitan los caracteres de control. Mismo formato de respuesta: {ok, estado, aceptado_at} o {ok: false, motivo};
--     si falta el nombre, además campo = 'nombre' para que la pantalla lo pinte junto al campo.
drop function if exists public.aceptar_presupuesto(uuid);

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
     set estado              = 'aceptado',
         aceptado_nombre     = v_nombre,
         aceptado_ip         = v_ip,
         aceptado_user_agent = v_ua
   where id = v_id
  returning aceptado_at into v_aceptado;

  perform set_config('tajo.aceptando', 'off', true);

  return jsonb_build_object('ok', true, 'estado', 'aceptado', 'aceptado_at', v_aceptado);
end;
$$;

-- 5.2 Guardar presupuesto (sustituye a la de 0004): igual y, además, antes de tocar nada comprueba cada partida
--     (N = su posición en la lista, desde 1): un objeto, con un orden entero mayor que 0 y sin repetir, y una cantidad
--     numérica (número JSON, no texto) con 3 decimales como mucho (antes se redondeaba en silencio al guardarla en
--     numeric(13,3)).
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
  v_empresa  uuid := public.auth_empresa_id();
  v_id       uuid;
  v_estado   text;
  v_item     jsonb;
  v_n        bigint;
  v_orden    numeric;
  v_ordenes  numeric[] := '{}';
  v_cantidad numeric;
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

  for v_item, v_n in
    select t.e, t.n from jsonb_array_elements(p_partidas) with ordinality as t(e, n)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'La partida % no es válida.', v_n;
    end if;
    v_orden := case when jsonb_typeof(v_item -> 'orden') = 'number' then (v_item ->> 'orden')::numeric end;
    if v_orden is null or v_orden <= 0 or v_orden <> trunc(v_orden) then
      raise exception 'El orden de la partida % tiene que ser un número entero mayor que 0.', v_n;
    end if;
    if v_orden = any (v_ordenes) then
      raise exception 'La partida % repite el orden % de otra partida: cada una tiene que tener el suyo.', v_n, v_orden;
    end if;
    v_ordenes := v_ordenes || v_orden;
    -- Solo números JSON: un texto («"1.00049"») se convertiría y redondearía en silencio al guardarlo.
    if jsonb_typeof(v_item -> 'cantidad') is distinct from 'number' then
      raise exception 'La cantidad de la partida % no es válida.', v_n;
    end if;
    v_cantidad := (v_item ->> 'cantidad')::numeric;
    if v_cantidad <> round(v_cantidad, 3) then
      raise exception 'La cantidad de la partida % puede tener como mucho 3 decimales.', v_n;
    end if;
  end loop;

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

-- 5.3 Cuota de IA (sustituye a la de 0005): además del límite de 40 al día de la empresa, 15 al día por usuario. Los
--     dos contadores suben en la misma llamada: si uno de los dos está lleno, el error deshace también el otro (la
--     llamada RPC es una transacción), así que no se cuenta nada. Primero se mira el del usuario (TJ003) y después el
--     de la empresa (TJ002). quedan = lo que le queda a este usuario hoy: el menor de los dos restos.
create or replace function public.consumir_uso_ia()
returns table (quedan int, reserva uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_limite         constant int := 40;
  c_limite_usuario constant int := 15;
  v_empresa        uuid := public.auth_empresa_id();
  v_perfil         uuid := auth.uid();
  v_dia            date := (now() at time zone 'Europe/Madrid')::date;
  v_usos           int;
  v_usos_perfil    int;
  v_reserva        uuid;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;

  insert into public.uso_ia_perfiles as u (perfil_id, empresa_id, dia, usos)
  values (v_perfil, v_empresa, v_dia, 1)
  on conflict (perfil_id, dia) do update
     set usos = u.usos + 1
   where u.usos < c_limite_usuario
  returning u.usos into v_usos_perfil;

  if v_usos_perfil is null then
    raise exception using
      errcode = 'TJ003',
      message = format('Has llegado a tu límite de %s propuestas con IA de hoy. Vuelve a intentarlo mañana.', c_limite_usuario),
      hint    = 'La cuota se reinicia cada día a medianoche (hora de Madrid).';
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
  values (v_empresa, v_perfil, v_dia)
  returning id into v_reserva;

  quedan  := least(c_limite - v_usos, c_limite_usuario - v_usos_perfil);
  reserva := v_reserva;
  return next;
end;
$$;

-- 5.4 Devolver un uso (sustituye a la de 0005): igual y, además, resta del contador del usuario de ese día.
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

  update public.uso_ia_perfiles
     set usos = greatest(usos - 1, 0)
   where perfil_id = auth.uid()
     and dia = v_dia;

  return true;
end;
$$;

-- ============================================================================
-- 6. Vistas (create or replace: mismas columnas en el mismo orden y las nuevas al final; conserva los permisos)
-- ============================================================================

-- 6.1 presupuestos_con_totales (de 0004) + evidencia de envío y aceptación.
create or replace view public.presupuestos_con_totales
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
       p.aceptado_ip,
       p.aceptado_user_agent,
       p.enviado_por
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
  'Presupuestos con nombre del cliente, totales (base, IVA, total, nº de partidas) y evidencia de envío y aceptación. security_invoker: aplica la RLS de quien consulta.';

-- 6.2 obras_resumen (de 0006): consumido_pct pasa a ser solo de gerencia (null para el resto, como los importes) y se
--     añade semaforo para todos, con la misma regla que semaforoObra() de src/lib/domain/obras.ts aplicada al % real
--     (el consumido_pct que ve gerencia, con 1 decimal): pendiente o sin presupuestado → verde; > 100 → rojo;
--     ≥ 80 → ámbar; el resto, verde.
create or replace view public.obras_resumen
with (security_invoker = true)
as
select o.id,
       o.empresa_id,
       o.presupuesto_id,
       o.cliente_id,
       o.titulo,
       o.encargado_id,
       o.estado,
       o.fecha_inicio,
       o.fecha_fin_prevista,
       o.fecha_fin,
       o.notas,
       o.created_at,
       c.nombre                                          as cliente_nombre,
       p.numero                                          as presupuesto_numero,
       case when g.ve then b.base_cents end              as presupuestado_cents,
       h.horas,
       case when g.ve then h.coste_mano_obra_cents end   as coste_mano_obra_cents,
       case when g.ve then m.coste_material_cents end    as coste_material_cents,
       case when g.ve then h.coste_mano_obra_cents + m.coste_material_cents end as coste_real_cents,
       case when g.ve then b.base_cents - (h.coste_mano_obra_cents + m.coste_material_cents) end as margen_cents,
       case when g.ve then k.pct end                     as consumido_pct,
       h.num_partes,
       h.ultimo_parte,
       case
         when o.estado = 'pendiente' or k.pct is null then 'verde'
         when k.pct > 100 then 'rojo'
         when k.pct >= 80 then 'ambar'
         else 'verde'
       end                                               as semaforo
  from public.obras o
  join public.clientes c
    on c.empresa_id = o.empresa_id
   and c.id = o.cliente_id
  join public.presupuestos p
    on p.empresa_id = o.empresa_id
   and p.id = o.presupuesto_id
 cross join lateral (select public.presupuesto_base_cents(p.id) as base_cents) b
 cross join lateral (select current_user = 'postgres' or public.es_admin() as ve) g
 cross join lateral (
   select coalesce(sum(pa.horas), 0)                                   as horas,
          coalesce(sum(round(pa.horas * pa.coste_hora_cents)), 0)::bigint as coste_mano_obra_cents,
          count(*)::integer                                            as num_partes,
          max(pa.fecha)                                                as ultimo_parte
     from public.partes pa
    where pa.empresa_id = o.empresa_id
      and pa.obra_id = o.id
 ) h
 cross join lateral (
   select coalesce(sum(round(pm.cantidad * pm.coste_unit_cents)), 0)::bigint as coste_material_cents
     from public.parte_materiales pm
     join public.partes pa
       on pa.empresa_id = pm.empresa_id
      and pa.id = pm.parte_id
    where pa.empresa_id = o.empresa_id
      and pa.obra_id = o.id
 ) m
 cross join lateral (
   select case
            when b.base_cents is null or b.base_cents = 0 then null
            else round((h.coste_mano_obra_cents + m.coste_material_cents) * 100.0 / b.base_cents, 1)
          end as pct
 ) k;

comment on view public.obras_resumen is
  'Obras con cliente, número del presupuesto, horas y semáforo para toda la empresa; presupuestado, coste real, margen y % consumido solo para gerencia (null para el resto). security_invoker: aplica la RLS de quien consulta.';

-- ============================================================================
-- 7. RLS: borrar presupuestos solo en borrador, enviado o rechazado (y solo gerencia, como antes).
-- ============================================================================

drop policy if exists presupuestos_delete on public.presupuestos;
create policy presupuestos_delete on public.presupuestos
  for delete to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (select public.es_admin())
    and estado in ('borrador', 'enviado', 'rechazado')
  );

-- ============================================================================
-- 8. Permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public: en lo
--    nuevo se quitan todos y se da solo lo necesario.
-- ============================================================================

alter table public.uso_ia_perfiles enable row level security;
revoke all on public.uso_ia_perfiles from public, anon, authenticated;

-- La usa el CHECK de clientes: quien inserta o cambia un cliente necesita ejecutarla.
revoke execute on function public.nif_valido(text) from public, anon;
grant  execute on function public.nif_valido(text) to authenticated;

-- Aceptar por enlace: solo anon (como en 0004). La app lo llama con el cliente anónimo.
revoke execute on function public.aceptar_presupuesto(uuid, text, text, text) from public, authenticated;
grant  execute on function public.aceptar_presupuesto(uuid, text, text, text) to anon;

-- create or replace conserva los permisos; se repiten para que este fichero se explique solo.
revoke execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) from public, anon;
grant  execute on function public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb) to authenticated;
revoke execute on function public.consumir_uso_ia() from public, anon;
grant  execute on function public.consumir_uso_ia() to authenticated;
revoke execute on function public.devolver_uso_ia(uuid) from public, anon;
grant  execute on function public.devolver_uso_ia(uuid) to authenticated;

-- Funciones de trigger: nadie las llama desde fuera (el permiso de ejecución no se mira al dispararse el trigger).
revoke execute on function public.presupuestos_alta_validar()    from public, anon, authenticated;
revoke execute on function public.presupuestos_reglas()          from public, anon, authenticated;
revoke execute on function public.presupuestos_borrar_aceptado() from public, anon, authenticated;
revoke execute on function public.obras_reglas()                 from public, anon, authenticated;
revoke execute on function public.partes_reglas()                from public, anon, authenticated;
revoke execute on function public.handle_new_user()              from public, anon, authenticated;

-- ============================================================================
-- 9. Relleno: las invitaciones de usuarios que ya tienen perfil quedan usadas (desde que se creó su perfil).
-- ============================================================================

update public.invitaciones i
   set usada_at = p.created_at
  from public.perfiles p
 where lower(p.email) = i.email
   and i.usada_at is null;

-- ============================================================================
-- 10. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
declare
  v_mal text;
begin
  if to_regprocedure('public.aceptar_presupuesto(uuid)') is not null then
    raise exception 'Sigue existiendo aceptar_presupuesto(uuid): tiene que quedar solo la versión con nombre, IP y navegador.';
  end if;

  -- Las funciones que ponen marcas o escriben tablas sin permisos para la API son security definer, de postgres y con
  -- search_path fijado.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_mal
    from pg_proc p
   where p.oid in ('public.aceptar_presupuesto(uuid, text, text, text)'::regprocedure,
                   'public.consumir_uso_ia()'::regprocedure,
                   'public.devolver_uso_ia(uuid)'::regprocedure,
                   'public.handle_new_user()'::regprocedure)
     and (p.proowner <> 'postgres'::regrole or not p.prosecdef
          or not coalesce(p.proconfig, '{}') @> array['search_path=public']);
  if v_mal is not null then
    raise exception 'Estas funciones tienen que ser security definer, de postgres y con search_path fijado: %.', v_mal;
  end if;

  -- Los triggers que miran las marcas tajo.* y las funciones que aplican la RLS de quien llama son security invoker.
  select string_agg(p.proname, ', ')
    into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('presupuestos_alta_validar', 'presupuestos_reglas', 'presupuestos_borrar_aceptado',
                       'obras_reglas', 'partes_reglas', 'guardar_presupuesto', 'nif_valido')
     and p.prosecdef;
  if v_mal is not null then
    raise exception 'Estas funciones deberían ser security invoker: %.', v_mal;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_confirmed' and tgrelid = 'auth.users'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'presupuestos_borrar_aceptado'
                       and tgrelid = 'public.presupuestos'::regclass) then
    raise exception 'Faltan los triggers on_auth_user_created, on_auth_user_confirmed o presupuestos_borrar_aceptado.';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.uso_ia_perfiles'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'uso_ia_perfiles') then
    raise exception 'uso_ia_perfiles tiene que tener RLS activado y ninguna política.';
  end if;

  if has_table_privilege('anon', 'public.uso_ia_perfiles', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.uso_ia_perfiles', 'select, insert, update, delete, truncate, references, trigger')
     or not has_function_privilege('anon', 'public.aceptar_presupuesto(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.aceptar_presupuesto(uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.consumir_uso_ia()', 'execute')
     or has_function_privilege('anon', 'public.devolver_uso_ia(uuid)', 'execute')
     or has_function_privilege('anon', 'public.guardar_presupuesto(uuid, uuid, text, int, int, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.consumir_uso_ia()', 'execute')
     or not has_function_privilege('authenticated', 'public.nif_valido(text)', 'execute')
     or has_table_privilege('anon', 'public.presupuestos_con_totales', 'select')
     or has_table_privilege('anon', 'public.obras_resumen', 'select')
     or not has_table_privilege('authenticated', 'public.presupuestos_con_totales', 'select')
     or not has_table_privilege('authenticated', 'public.obras_resumen', 'select')
     or has_table_privilege('authenticated', 'public.presupuestos_con_totales', 'insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.obras_resumen', 'insert, update, delete, truncate') then
    raise exception 'Los permisos de las tablas, vistas o funciones de 0007 no son los esperados; revisa la sección 8.';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clientes_nif_valido_chk'
                    and conrelid = 'public.clientes'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'presupuesto_lineas_presupuesto_orden_key'
                       and conrelid = 'public.presupuesto_lineas'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'presupuestos_enviado_por_fkey'
                       and conrelid = 'public.presupuestos'::regclass) then
    raise exception 'Faltan restricciones de 0007 (NIF, orden de las partidas o enviado_por).';
  end if;

  -- Invitaciones: ningún perfil con su invitación sin marcar como usada.
  select string_agg(i.email, ', ')
    into v_mal
    from public.invitaciones i
   where i.usada_at is null
     and exists (select 1 from public.perfiles p where lower(p.email) = i.email);
  if v_mal is not null then
    raise exception 'Invitaciones con perfil y sin marcar como usadas: %.', v_mal;
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver la función, las columnas y la tabla nuevas.
notify pgrst, 'reload schema';
