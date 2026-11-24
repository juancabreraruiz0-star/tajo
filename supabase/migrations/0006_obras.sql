-- Tajo · 0006_obras.sql — obras, partes de trabajo y margen real (D11, tarea T16a).
-- Orden de ejecución: 0001 → 0002 → 0003 → 0004 → 0005 → este fichero → seed.sql (el seed lo necesita).
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009_ia_cache.sql → seed.sql.
-- Cómo se ejecuta: Supabase → SQL Editor (rol postgres) → pegar este fichero entero → Run. El SQL Editor lo ejecuta en
-- una sola transacción: si algo falla, no se aplica nada. Se aplica sobre una base con datos y no borra nada. Se puede
-- volver a ejecutar (create … if not exists, create or replace, drop … if exists): conserva obras y partes.
--
-- Qué añade:
--   1. empresas.coste_hora_cents (coste de una hora de mano de obra; 25 € por defecto) y materiales.coste_cents (lo que
--      le cuesta el material a la empresa; si es nulo, se usa el precio de venta).
--   2. obras: una por presupuesto aceptado (presupuesto_id único). Se crea sola al aceptar el presupuesto, por el
--      enlace o por gerencia (trigger presupuestos_crear_obra). Las ya aceptadas o facturadas se rellenan aquí.
--      Estados: pendiente → en_curso ⇄ parada → terminada (final).
--   3. partes (parte de trabajo: fecha, horas, notas) y parte_materiales (material y cantidad). El autor, el coste por
--      hora y el coste unitario de cada material los copia la base de datos al crear; no se pueden elegir ni cambiar.
--   4. guardar_parte(): alta o edición de un parte con sus materiales en una sola transacción.
--   5. Vista obras_resumen (security_invoker): presupuestado frente a coste real, margen y % consumido. Los importes
--      de la vista salen null para quien no es gerencia; el resto de la empresa ve horas, % consumido y semáforo.
--      Ojo: no es un secreto fuerte. Un empleado puede leer la base del presupuesto, el coste/hora y el coste de los
--      materiales copiados en los partes, y reconstruir el margen. Ocultarlo del todo exigiría quitar esas columnas
--      de su select; para una empresa pequeña se considera suficiente que no aparezca en sus pantallas.
--   6. RLS y permisos:
--      · todos los de la empresa ven obras, partes y materiales de los partes;
--      · cualquiera de la empresa añade partes a una obra en curso;
--      · un parte (y sus materiales) lo cambia o borra su autor el día en que lo registró (hora de Madrid) o gerencia;
--      · estado, encargado, fechas y notas de una obra: gerencia o el encargado de esa obra (permisos por columna);
--      · una obra terminada no admite partes nuevos ni cambios en los suyos, y de ella solo se cambian las notas;
--      · materiales.coste_cents solo lo pone o cambia gerencia;
--      · nadie borra obras desde la API. Una obra solo desaparece con su presupuesto, y solo si no tiene partes
--        (gerencia puede seguir borrando un presupuesto aceptado por error mientras no se haya trabajado en él);
--      · anon, nada.
--
-- El stock no se toca en los partes: se sigue descontando al facturar (R13).
--
-- Marca tajo.seed: igual que en 0004, solo cuenta si current_user = 'postgres' (SQL Editor o funciones security
-- definer de postgres). Con ella, los triggers de este fichero no bloquean (seed.sql y el relleno de la sección 8).
--
-- ¿Por qué presupuestos_crear_obra() es security definer? La obra se crea en el mismo update que acepta el
-- presupuesto, y ese update llega por dos caminos: aceptar_presupuesto() (security definer de postgres; current_user
-- ya es postgres) y el update de gerencia desde la API (current_user = authenticated). authenticated no tiene permiso
-- de insert sobre obras, a propósito: así nadie crea obras desde la API. La función del trigger corre como su dueño
-- (postgres) en los dos casos. Es segura porque:
--   · solo inserta la obra del presupuesto que se acaba de aceptar, con datos de esa misma fila (empresa, cliente,
--     título); no recibe nada del usuario;
--   · search_path fijado a public;
--   · es una función de trigger: PostgREST no la publica como RPC (y además se le quita el execute a todos);
--   · el resto de triggers son security invoker, para que la marca tajo.seed dependa de quién ejecuta de verdad.

-- ============================================================================
-- 0. Comprobaciones previas
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta esta migración como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regclass('public.factura_lineas') is null
     or to_regclass('public.presupuestos_con_totales') is null
     or to_regprocedure('public.auth_empresa_id()') is null then
    raise exception 'Falta la 0004: ejecuta antes 0001, 0002, 0003 y 0004 (y 0005 si usas «Montar con IA»).';
  end if;
end;
$$;

-- La vista depende de las tablas de abajo: se quita aquí y se vuelve a crear en la sección 6.
drop view if exists public.obras_resumen;

-- ============================================================================
-- 1. Costes: hora de mano de obra por empresa y coste de cada material
-- ============================================================================

alter table public.empresas   add column if not exists coste_hora_cents bigint not null default 2500;
alter table public.materiales add column if not exists coste_cents      bigint;

comment on column public.empresas.coste_hora_cents is
  'Coste de una hora de mano de obra en céntimos. Se copia en cada parte al crearlo.';
comment on column public.materiales.coste_cents is
  'Lo que le cuesta el material a la empresa, en céntimos. Si es nulo, los partes usan el precio de venta.';

alter table public.empresas
  drop constraint if exists empresas_coste_hora_rango_chk,
  add constraint empresas_coste_hora_rango_chk check (coste_hora_cents between 0 and 1000000);

alter table public.materiales
  drop constraint if exists materiales_coste_rango_chk,
  add constraint materiales_coste_rango_chk check (coste_cents between 0 and 100000000);

-- El coste de un material es un dato de margen: solo lo pone o cambia gerencia. Un empleado puede seguir creando y
-- editando materiales (nombre, precio, stock…) mientras no toque el coste: al crear, coste_cents tiene que llegar vacío
-- y al editar, igual que estaba. Se rechaza con un mensaje en vez de vaciarlo en silencio, para que nadie crea que ha
-- guardado un coste que no se ha guardado (la pantalla no se lo muestra a un empleado; solo llegaría por la API).
-- current_user = 'postgres' (SQL Editor, seed y funciones de postgres como facturar_presupuesto) no se limita: ninguna
-- de esas funciones toca el coste con datos del usuario.
create or replace function public.materiales_coste_solo_gerencia()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.coste_cents is not null)
     or (tg_op = 'UPDATE' and new.coste_cents is distinct from old.coste_cents) then
    if not public.es_admin() then
      raise exception 'Solo gerencia puede poner o cambiar el coste de un material.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists materiales_coste_solo_gerencia on public.materiales;
create trigger materiales_coste_solo_gerencia
  before insert or update on public.materiales
  for each row execute function public.materiales_coste_solo_gerencia();

-- ============================================================================
-- 2. Tablas
-- ============================================================================

create table if not exists public.obras (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id) on delete cascade,
  presupuesto_id     uuid not null unique,
  cliente_id         uuid not null,
  titulo             text not null,
  encargado_id       uuid,
  estado             text not null default 'pendiente',
  fecha_inicio       date,
  fecha_fin_prevista date,
  fecha_fin          date,
  notas              text,
  created_at         timestamptz not null default now(),
  unique (empresa_id, id),
  -- La obra se va con su presupuesto (solo si no tiene partes: lo impiden la FK de partes y el trigger
  -- presupuestos_borrar_con_obra, con un mensaje claro).
  foreign key (empresa_id, presupuesto_id) references public.presupuestos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, cliente_id)     references public.clientes (empresa_id, id),
  foreign key (empresa_id, encargado_id)   references public.perfiles (empresa_id, id) on delete set null (encargado_id)
);

create table if not exists public.partes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  obra_id          uuid not null,
  fecha            date not null default ((now() at time zone 'Europe/Madrid')::date),
  -- Lo pone la base de datos (auth.uid()). Queda a null si se borra el usuario: el parte se conserva.
  autor_id         uuid,
  -- numeric sin escala (no numeric(4,2)): así 7,125 h se rechaza en vez de redondearse en silencio a 7,13.
  -- El CHECK y el trigger exigen más de 0, como mucho 24 y 2 decimales como mucho.
  horas            numeric not null,
  -- Copia de empresas.coste_hora_cents al crear el parte: cambiar el coste de la empresa no cambia lo ya apuntado.
  coste_hora_cents bigint not null,
  notas            text,
  created_at       timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, obra_id)  references public.obras (empresa_id, id),
  foreign key (empresa_id, autor_id) references public.perfiles (empresa_id, id) on delete set null (autor_id)
);

create table if not exists public.parte_materiales (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  parte_id         uuid not null,
  -- Queda a null si se borra el material del almacén (como en las partidas de presupuesto): la línea conserva su copia
  -- de nombre, unidad y coste, así que el coste de la obra no cambia.
  material_id      uuid,
  -- Copias del material al añadirlo: nombre, unidad y coalesce(materiales.coste_cents, materiales.precio_cents).
  material_nombre  text not null,
  unidad           text not null,
  cantidad         numeric(13,3) not null,
  coste_unit_cents bigint not null,
  unique (parte_id, material_id),
  foreign key (empresa_id, parte_id) references public.partes (empresa_id, id) on delete cascade,
  foreign key (empresa_id, material_id) references public.materiales (empresa_id, id) on delete set null (material_id)
);

comment on table public.obras is
  'Una obra por presupuesto aceptado (la crea el trigger presupuestos_crear_obra). Nadie la borra desde la API.';
comment on table public.partes is
  'Partes de trabajo de una obra. autor_id, coste_hora_cents y created_at los pone la base de datos.';
comment on table public.parte_materiales is
  'Materiales gastados en un parte. material_nombre, unidad y coste_unit_cents los copia la base de datos del material al añadirlo.';

create index if not exists obras_empresa_id_idx             on public.obras (empresa_id);
create index if not exists obras_encargado_id_idx           on public.obras (encargado_id) where encargado_id is not null;
create index if not exists obras_cliente_id_idx             on public.obras (cliente_id);
create index if not exists partes_empresa_id_idx            on public.partes (empresa_id);
create index if not exists partes_obra_fecha_idx            on public.partes (obra_id, fecha);
create index if not exists partes_autor_id_idx              on public.partes (autor_id) where autor_id is not null;
create index if not exists parte_materiales_empresa_id_idx  on public.parte_materiales (empresa_id);
create index if not exists parte_materiales_material_id_idx on public.parte_materiales (material_id);

-- CHECK (mismos límites que src/lib/domain/obras.ts). Los triggers de la sección 3 dan antes un mensaje en español
-- para lo que puede escribir el usuario; estos CHECK cubren además al SQL Editor.
alter table public.obras
  drop constraint if exists obras_estado_chk,
  drop constraint if exists obras_titulo_largo_chk,
  drop constraint if exists obras_notas_largo_chk,
  drop constraint if exists obras_inicio_si_empezada_chk,
  drop constraint if exists obras_fin_prevista_chk,
  drop constraint if exists obras_fin_solo_terminada_chk,
  drop constraint if exists obras_fin_tras_inicio_chk,
  add constraint obras_estado_chk             check (estado in ('pendiente', 'en_curso', 'parada', 'terminada')),
  add constraint obras_titulo_largo_chk       check (length(trim(titulo)) > 0 and char_length(titulo) <= 160),
  add constraint obras_notas_largo_chk        check (char_length(notas) <= 2000),
  add constraint obras_inicio_si_empezada_chk check (estado = 'pendiente' or fecha_inicio is not null),
  add constraint obras_fin_prevista_chk       check (fecha_fin_prevista >= fecha_inicio),
  -- fecha_fin (real) si y solo si la obra está terminada.
  add constraint obras_fin_solo_terminada_chk check ((fecha_fin is not null) = (estado = 'terminada')),
  add constraint obras_fin_tras_inicio_chk    check (fecha_fin >= fecha_inicio);

alter table public.partes
  drop constraint if exists partes_horas_rango_chk,
  drop constraint if exists partes_coste_hora_rango_chk,
  drop constraint if exists partes_notas_largo_chk,
  add constraint partes_horas_rango_chk      check (horas > 0 and horas <= 24 and horas = round(horas, 2)),
  add constraint partes_coste_hora_rango_chk check (coste_hora_cents between 0 and 1000000),
  add constraint partes_notas_largo_chk      check (char_length(notas) <= 1000);

alter table public.parte_materiales
  drop constraint if exists parte_materiales_cantidad_chk,
  drop constraint if exists parte_materiales_coste_rango_chk,
  drop constraint if exists parte_materiales_importe_max_chk,
  drop constraint if exists parte_materiales_nombre_largo_chk,
  drop constraint if exists parte_materiales_unidad_largo_chk,
  -- Mismos límites que materiales (0004).
  add constraint parte_materiales_nombre_largo_chk check (char_length(material_nombre) <= 120),
  add constraint parte_materiales_unidad_largo_chk check (char_length(unidad) <= 20),
  add constraint parte_materiales_cantidad_chk    check (cantidad > 0 and cantidad <= 1000000000),
  add constraint parte_materiales_coste_rango_chk check (coste_unit_cents between 0 and 100000000),
  -- Mismo tope por línea que las partidas de presupuesto (0004).
  add constraint parte_materiales_importe_max_chk check (round(cantidad * coste_unit_cents) <= 10000000000000);

-- ============================================================================
-- 3. Triggers
-- ============================================================================

-- 3.1 Alta automática: al pasar un presupuesto a aceptado (por el enlace o por gerencia) se crea su obra.
--     security definer: ver la cabecera. Idempotente (on conflict do nothing).
create or replace function public.presupuestos_crear_obra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.obras (empresa_id, presupuesto_id, cliente_id, titulo)
  values (new.empresa_id, new.id, new.cliente_id, new.titulo)
  on conflict (presupuesto_id) do nothing;
  return null;
end;
$$;

drop trigger if exists presupuestos_crear_obra on public.presupuestos;
create trigger presupuestos_crear_obra
  after update on public.presupuestos
  for each row
  when (new.estado = 'aceptado' and old.estado is distinct from 'aceptado')
  execute function public.presupuestos_crear_obra();

-- 3.2 Un presupuesto cuya obra tiene partes no se puede borrar (mensaje claro en vez del error de la FK).
create or replace function public.presupuestos_borrar_con_obra()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return old;
  end if;

  if exists (
    select 1
      from public.obras o
      join public.partes p
        on p.empresa_id = o.empresa_id
       and p.obra_id = o.id
     where o.presupuesto_id = old.id
       and o.empresa_id = old.empresa_id
  ) then
    raise exception 'Este presupuesto tiene una obra con partes de trabajo; no se puede borrar.';
  end if;

  return old;
end;
$$;

drop trigger if exists presupuestos_borrar_con_obra on public.presupuestos;
create trigger presupuestos_borrar_con_obra
  before delete on public.presupuestos
  for each row execute function public.presupuestos_borrar_con_obra();

-- 3.3 Obras · alta: solo para un presupuesto aceptado o facturado de la misma empresa; empieza pendiente, sin
--     encargado ni fechas, con el cliente y el título del presupuesto y created_at = now().
create or replace function public.obras_alta()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pres public.presupuestos%rowtype;
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return new;
  end if;

  select * into v_pres
    from public.presupuestos p
   where p.id = new.presupuesto_id
     and p.empresa_id = new.empresa_id;

  if not found or v_pres.estado not in ('aceptado', 'facturado') then
    raise exception 'Solo un presupuesto aceptado tiene obra.';
  end if;

  new.cliente_id         := v_pres.cliente_id;
  new.titulo             := v_pres.titulo;
  new.estado             := 'pendiente';
  new.encargado_id       := null;
  new.fecha_inicio       := null;
  new.fecha_fin_prevista := null;
  new.fecha_fin          := null;
  new.notas              := null;
  new.created_at         := now();
  return new;
end;
$$;

drop trigger if exists obras_alta on public.obras;
create trigger obras_alta
  before insert on public.obras
  for each row execute function public.obras_alta();

-- 3.4 Obras · cambios: datos de origen fijos, transiciones de estado y fechas coherentes. Quién puede cambiar qué lo
--     deciden la RLS (gerencia o el encargado) y los permisos por columna (sección 7).
--     Transiciones (igual que src/lib/domain/obras.ts): pendiente → en_curso; en_curso → parada | terminada;
--     parada → en_curso | terminada; terminada es final y congelada: solo se cambian las notas.
--     Mismos mensajes que validateObra() y errorCambioEstadoObra() de src/lib/domain/obras.ts.
--     Al empezar (pendiente → en curso):
--       · si no hay fecha de inicio, o era una fecha prevista futura, empieza hoy;
--       · si la fecha de fin prevista queda antes del inicio (planificación vieja) y no se ha cambiado en este mismo
--         update, se vacía: la pantalla la vuelve a pedir. Si se manda una nueva en el mismo update, se valida.
--     La fecha de inicio no puede ser posterior al parte más antiguo de la obra.
--     Única excepción a todo: al borrar un usuario, la FK pone encargado_id a null (trigger anidado, nada más cambia).
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

drop trigger if exists obras_reglas on public.obras;
create trigger obras_reglas
  before update on public.obras
  for each row execute function public.obras_reglas();

-- 3.5 Obras · borrado: nunca, salvo en cascada al borrar su presupuesto (trigger anidado; si la obra tiene partes, la
--     FK de partes lo impide) o en modo seed. Desde la API, además, authenticated no tiene permiso de delete.
create or replace function public.obras_no_se_borran()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    return old;
  end if;
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Las obras no se borran.';
end;
$$;

drop trigger if exists obras_no_se_borran on public.obras;
create trigger obras_no_se_borran
  before delete on public.obras
  for each row execute function public.obras_no_se_borran();

-- 3.6 Partes: alta solo en obras en curso, con autor = auth.uid(), coste por hora de la empresa y created_at = now();
--     al editar no cambian obra, autor, coste ni fecha de alta; una obra terminada no admite cambios en sus partes.
--     Lee la obra con la RLS del usuario: si no es de su empresa, no la encuentra.
--     La fecha del parte no puede ser posterior a hoy ni anterior al inicio de la obra; horas: más de 0, como mucho 24
--     y 2 decimales como mucho (mismos mensajes que validateParte() de src/lib/domain/obras.ts, a nivel de parte).
--     Única excepción: al borrar un usuario, la FK pone autor_id a null (trigger anidado y sin tocar nada más).
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
  if new.horas is null or new.horas <= 0 or new.horas > 24 then
    raise exception 'Las horas del parte tienen que ser más de 0 y como mucho 24.';
  end if;
  if new.horas <> round(new.horas, 2) then
    raise exception 'Las horas del parte pueden tener como mucho 2 decimales.';
  end if;
  if char_length(new.notas) > 1000 then
    raise exception 'Las notas del parte pueden tener como mucho 1000 caracteres.';
  end if;

  return new;
end;
$$;

drop trigger if exists partes_reglas on public.partes;
create trigger partes_reglas
  before insert or update or delete on public.partes
  for each row execute function public.partes_reglas();

-- 3.7 Materiales de un parte: nombre, unidad y coste unitario copiados del material (de la misma empresa) al
--     añadirlo; luego solo se cambia la cantidad; como mucho 30 por parte y sin repetir material; nada en obras
--     terminadas. Única excepción: al borrar el material del almacén, la FK pone material_id a null (trigger anidado
--     y sin tocar nada más), también en obras terminadas.
create or replace function public.parte_materiales_reglas()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_estado text;
  v_parte  uuid;
begin
  if current_user = 'postgres' and coalesce(current_setting('tajo.seed', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and old.material_id is not null
     and new.material_id is null
     and (to_jsonb(new) - 'material_id') = (to_jsonb(old) - 'material_id') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (new.id, new.empresa_id, new.parte_id, new.material_id, new.material_nombre, new.unidad, new.coste_unit_cents)
         is distinct from
         (old.id, old.empresa_id, old.parte_id, old.material_id, old.material_nombre, old.unidad, old.coste_unit_cents) then
    raise exception 'De un material del parte solo se puede cambiar la cantidad.';
  end if;

  v_parte := case when tg_op = 'DELETE' then old.parte_id else new.parte_id end;

  -- Si el parte ya no está (se está borrando y sus materiales van en cascada), su trigger ya ha comprobado la obra.
  select o.estado into v_estado
    from public.partes p
    join public.obras o
      on o.empresa_id = p.empresa_id
     and o.id = p.obra_id
   where p.id = v_parte
     and p.empresa_id = case when tg_op = 'DELETE' then old.empresa_id else new.empresa_id end;

  if found and v_estado = 'terminada' then
    raise exception 'La obra está terminada: sus partes ya no se pueden cambiar ni borrar.';
  end if;

  if tg_op = 'INSERT' then
    if not found then
      raise exception 'El parte no existe o no es de tu empresa.';
    end if;

    select m.nombre, m.unidad, coalesce(m.coste_cents, m.precio_cents)
      into new.material_nombre, new.unidad, new.coste_unit_cents
      from public.materiales m
     where m.id = new.material_id
       and m.empresa_id = new.empresa_id;
    if not found then
      raise exception 'El material no existe o no es de tu empresa.';
    end if;

    if exists (select 1 from public.parte_materiales pm
                where pm.parte_id = new.parte_id and pm.material_id = new.material_id) then
      raise exception 'Ese material ya está en el parte: cambia su cantidad.';
    end if;
    if (select count(*) from public.parte_materiales pm where pm.parte_id = new.parte_id) >= 30 then
      raise exception 'Un parte puede tener como mucho 30 materiales.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists parte_materiales_reglas on public.parte_materiales;
create trigger parte_materiales_reglas
  before insert or update or delete on public.parte_materiales
  for each row execute function public.parte_materiales_reglas();

-- ============================================================================
-- 4. guardar_parte(): alta (p_id null) o edición de un parte con sus materiales, en una sola transacción.
--    security invoker: la RLS y los triggers se aplican igual que desde la app.
--    p_materiales: array jsonb de { material_id, cantidad } (sin repetir material; [] o null = ninguno).
--    La entrada se valida aquí antes de tocar nada, con los mismos mensajes que validateParte() de
--    src/lib/domain/obras.ts: horas obligatorias y con 2 decimales como mucho; cada material, un objeto con un
--    material_id (uuid) y una cantidad numérica mayor que 0, como mucho 1.000.000.000 y con 3 decimales como mucho.
--    Nada se redondea en silencio.
--    En la edición, los materiales que siguen conservan su coste copiado (solo cambia la cantidad); los nuevos copian
--    el coste actual y los que faltan se quitan (salvo las líneas de materiales ya borrados del almacén, que no se
--    pueden nombrar por material_id y se conservan). Devuelve el id del parte.
-- ============================================================================

create or replace function public.guardar_parte(
  p_id         uuid,
  p_obra       uuid,
  p_fecha      date,
  p_horas      numeric,
  p_notas      text,
  p_materiales jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_empresa    uuid := public.auth_empresa_id();
  v_materiales jsonb := coalesce(p_materiales, '[]'::jsonb);
  v_id         uuid;
  v_item       jsonb;
  v_n          bigint;
  v_cantidad   numeric;
  v_vistos     text[] := '{}';
begin
  if v_empresa is null then
    raise exception 'Tu usuario no tiene una empresa asignada.';
  end if;

  if p_horas is null then
    raise exception 'Escribe las horas del parte.';
  end if;
  if p_horas <> round(p_horas, 2) then
    raise exception 'Las horas del parte pueden tener como mucho 2 decimales.';
  end if;

  if jsonb_typeof(v_materiales) <> 'array' then
    raise exception 'Los materiales del parte no son válidos.';
  end if;
  if jsonb_array_length(v_materiales) > 30 then
    raise exception 'Un parte puede tener como mucho 30 materiales.';
  end if;
  for v_item, v_n in
    select t.e, t.n from jsonb_array_elements(v_materiales) with ordinality as t(e, n)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Material %: no es válido.', v_n;
    end if;
    if jsonb_typeof(v_item -> 'material_id') is distinct from 'string'
       or (v_item ->> 'material_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Material %: elige un material del almacén.', v_n;
    end if;
    if lower(v_item ->> 'material_id') = any (v_vistos) then
      raise exception 'Material %: ya está en el parte; junta las cantidades en una línea.', v_n;
    end if;
    v_vistos := v_vistos || lower(v_item ->> 'material_id');
    if jsonb_typeof(v_item -> 'cantidad') is distinct from 'number' then
      raise exception 'Material %: escribe una cantidad.', v_n;
    end if;
    v_cantidad := (v_item ->> 'cantidad')::numeric;
    if v_cantidad <= 0 then
      raise exception 'Material %: la cantidad tiene que ser mayor que 0.', v_n;
    end if;
    if v_cantidad > 1000000000 then
      raise exception 'Material %: la cantidad es demasiado grande.', v_n;
    end if;
    if v_cantidad <> round(v_cantidad, 3) then
      raise exception 'Material %: como mucho 3 decimales.', v_n;
    end if;
  end loop;

  if p_id is null then
    insert into public.partes (empresa_id, obra_id, fecha, horas, notas)
    values (v_empresa, p_obra, coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date), p_horas,
            nullif(btrim(p_notas), ''))
    returning id into v_id;
  else
    update public.partes
       set fecha = coalesce(p_fecha, fecha),
           horas = p_horas,
           notas = nullif(btrim(p_notas), '')
     where id = p_id
       and obra_id = p_obra
       and empresa_id = v_empresa
    returning id into v_id;

    if v_id is null then
      raise exception 'Este parte no existe o no lo puedes cambiar: solo su autor el mismo día o gerencia.';
    end if;

    -- Las líneas de materiales ya borrados del almacén (material_id null) se conservan.
    delete from public.parte_materiales pm
     where pm.parte_id = v_id
       and pm.empresa_id = v_empresa
       and pm.material_id is not null
       and not exists (
         select 1
           from jsonb_to_recordset(v_materiales) as x(material_id uuid, cantidad numeric)
          where x.material_id = pm.material_id
       );

    update public.parte_materiales pm
       set cantidad = x.cantidad
      from jsonb_to_recordset(v_materiales) as x(material_id uuid, cantidad numeric)
     where pm.parte_id = v_id
       and pm.empresa_id = v_empresa
       and pm.material_id = x.material_id
       and pm.cantidad is distinct from x.cantidad;
  end if;

  insert into public.parte_materiales (empresa_id, parte_id, material_id, cantidad)
  select v_empresa, v_id, x.material_id, x.cantidad
    from jsonb_to_recordset(v_materiales) as x(material_id uuid, cantidad numeric)
   where not exists (
     select 1 from public.parte_materiales pm where pm.parte_id = v_id and pm.material_id = x.material_id
   );

  return v_id;
end;
$$;

-- ============================================================================
-- 5. RLS y políticas
-- ============================================================================

alter table public.obras            enable row level security;
alter table public.partes           enable row level security;
alter table public.parte_materiales enable row level security;

-- obras: las ve toda la empresa; las cambian gerencia o su encargado (qué columnas, por grants). Sin insert ni delete.
drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras
  for update to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and ((select public.es_admin()) or encargado_id = (select auth.uid()))
  )
  -- El encargado puede pasar la obra a otro (la fila nueva ya no es suya): basta con que siga en su empresa.
  with check (empresa_id = (select public.auth_empresa_id()));

-- partes: los ve toda la empresa; cualquiera añade (el trigger exige obra en curso y pone el autor); los cambia o borra
-- su autor el día en que lo registró (hora de Madrid) o gerencia.
drop policy if exists partes_select on public.partes;
create policy partes_select on public.partes
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists partes_insert on public.partes;
create policy partes_insert on public.partes
  for insert to authenticated
  with check (empresa_id = (select public.auth_empresa_id()) and autor_id = (select auth.uid()));

drop policy if exists partes_update on public.partes;
create policy partes_update on public.partes
  for update to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (
      (select public.es_admin())
      or (    autor_id = (select auth.uid())
          and (created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
    )
  )
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists partes_delete on public.partes;
create policy partes_delete on public.partes
  for delete to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (
      (select public.es_admin())
      or (    autor_id = (select auth.uid())
          and (created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
    )
  );

-- parte_materiales: los ve toda la empresa; se añaden, cambian o quitan con las mismas reglas que su parte.
drop policy if exists parte_materiales_select on public.parte_materiales;
create policy parte_materiales_select on public.parte_materiales
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists parte_materiales_insert on public.parte_materiales;
create policy parte_materiales_insert on public.parte_materiales
  for insert to authenticated
  with check (
    empresa_id = (select public.auth_empresa_id())
    and exists (
      select 1
        from public.partes p
       where p.id = parte_materiales.parte_id
         and p.empresa_id = parte_materiales.empresa_id
         and (
           (select public.es_admin())
           or (    p.autor_id = (select auth.uid())
               and (p.created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
         )
    )
  );

drop policy if exists parte_materiales_update on public.parte_materiales;
create policy parte_materiales_update on public.parte_materiales
  for update to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and exists (
      select 1
        from public.partes p
       where p.id = parte_materiales.parte_id
         and p.empresa_id = parte_materiales.empresa_id
         and (
           (select public.es_admin())
           or (    p.autor_id = (select auth.uid())
               and (p.created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
         )
    )
  )
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists parte_materiales_delete on public.parte_materiales;
create policy parte_materiales_delete on public.parte_materiales
  for delete to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and exists (
      select 1
        from public.partes p
       where p.id = parte_materiales.parte_id
         and p.empresa_id = parte_materiales.empresa_id
         and (
           (select public.es_admin())
           or (    p.autor_id = (select auth.uid())
               and (p.created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
         )
    )
  );

-- ============================================================================
-- 6. Vista obras_resumen: presupuestado frente a coste real (misma regla que src/lib/domain/obras.ts)
--    mano de obra de un parte = round(horas × coste_hora); material = round(cantidad × coste_unit);
--    coste real = Σ mano de obra + Σ materiales; presupuestado = base del presupuesto sin IVA (base_cents de
--    presupuestos_con_totales); margen = presupuestado − coste real; consumido = coste real / presupuestado × 100 con
--    1 decimal (null si el presupuestado es 0). round de numeric: medio hacia arriba en positivos.
--    La base se lee con presupuesto_base_cents() y no con un join a presupuestos_con_totales ni a presupuesto_lineas:
--    Postgres no guarda dependencias del cuerpo de una función, así que 0004 se puede seguir re-ejecutando (quita y
--    vuelve a crear esa vista y cambia el tipo de columnas de presupuesto_lineas; con una dependencia directa fallaría).
--    Es lo mismo que hace totales_presupuesto() en 0004.
--    Importes solo para gerencia (D11): presupuestado_cents, coste_mano_obra_cents, coste_material_cents,
--    coste_real_cents y margen_cents salen null si quien consulta no es admin (es_admin()). horas, consumido_pct,
--    num_partes y el resto los ve toda la empresa (el semáforo es para todos). postgres (SQL Editor) lo ve todo, igual
--    que las tablas.
-- ============================================================================

-- security invoker: con la RLS de quien consulta (solo ve presupuestos de su empresa; si no, null). No da nada que
-- presupuestos_con_totales no dé ya.
create or replace function public.presupuesto_base_cents(p_presupuesto uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select v.base_cents from public.presupuestos_con_totales v where v.id = p_presupuesto
$$;

create view public.obras_resumen
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
       case
         when b.base_cents = 0 then null
         else round((h.coste_mano_obra_cents + m.coste_material_cents) * 100.0 / b.base_cents, 1)
       end                                               as consumido_pct,
       h.num_partes,
       h.ultimo_parte
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
 ) m;

comment on view public.obras_resumen is
  'Obras con cliente, número del presupuesto, presupuestado (base), horas, coste real, margen y % consumido. Importes solo para gerencia (null para el resto). security_invoker: aplica la RLS de quien consulta.';

-- ============================================================================
-- 7. Permisos
--    Supabase da por defecto todos los permisos a anon y authenticated sobre lo que crea postgres en public: en lo
--    nuevo se quitan todos y se da solo lo necesario.
-- ============================================================================

revoke all on public.obras            from public, anon, authenticated;
revoke all on public.partes           from public, anon, authenticated;
revoke all on public.parte_materiales from public, anon, authenticated;
revoke all on public.obras_resumen    from public, anon, authenticated;

-- obras: leer y cambiar solo estado, encargado, fechas y notas (como perfiles.nombre en 0001). Sin insert ni delete.
grant select on public.obras to authenticated;
grant update (estado, encargado_id, fecha_inicio, fecha_fin_prevista, fecha_fin, notas) on public.obras to authenticated;

-- partes: alta (el trigger pone autor, coste y created_at) y borrado; al editar, solo fecha, horas y notas.
grant select, insert, delete on public.partes to authenticated;
grant update (fecha, horas, notas) on public.partes to authenticated;

-- parte_materiales: alta (el trigger copia nombre, unidad y coste) y borrado; al editar, solo la cantidad.
grant select, insert, delete on public.parte_materiales to authenticated;
grant update (cantidad) on public.parte_materiales to authenticated;

grant select on public.obras_resumen to authenticated;

-- Funciones de trigger: nadie las llama desde fuera (el permiso de ejecución no se mira al dispararse el trigger).
revoke execute on function public.presupuestos_crear_obra()      from public, anon, authenticated;
revoke execute on function public.presupuestos_borrar_con_obra() from public, anon, authenticated;
revoke execute on function public.obras_alta()                   from public, anon, authenticated;
revoke execute on function public.obras_reglas()                 from public, anon, authenticated;
revoke execute on function public.obras_no_se_borran()           from public, anon, authenticated;
revoke execute on function public.partes_reglas()                from public, anon, authenticated;
revoke execute on function public.parte_materiales_reglas()      from public, anon, authenticated;
revoke execute on function public.materiales_coste_solo_gerencia() from public, anon, authenticated;

-- La usa la vista obras_resumen (security_invoker): quien consulta necesita ejecutarla.
revoke execute on function public.presupuesto_base_cents(uuid) from public, anon;
grant  execute on function public.presupuesto_base_cents(uuid) to authenticated;

revoke execute on function public.guardar_parte(uuid, uuid, date, numeric, text, jsonb) from public, anon;
grant  execute on function public.guardar_parte(uuid, uuid, date, numeric, text, jsonb) to authenticated;

-- ============================================================================
-- 8. Relleno: una obra pendiente por cada presupuesto ya aceptado o facturado (con la marca de seed, para conservar
--    como fecha de alta la de la aceptación). Idempotente.
-- ============================================================================

select set_config('tajo.seed', 'on', true);

insert into public.obras (empresa_id, presupuesto_id, cliente_id, titulo, estado, created_at)
select p.empresa_id, p.id, p.cliente_id, p.titulo, 'pendiente', coalesce(p.aceptado_at, now())
  from public.presupuestos p
 where p.estado in ('aceptado', 'facturado')
on conflict (presupuesto_id) do nothing;

select set_config('tajo.seed', 'off', true);

-- ============================================================================
-- 9. Comprobaciones finales: si algo no está como se espera, no se aplica nada.
-- ============================================================================

do $$
declare
  v_mal text;
begin
  -- La alta automática corre como postgres (ver cabecera), con search_path fijado.
  if (select p.proowner <> 'postgres'::regrole or not p.prosecdef
            or not coalesce(p.proconfig, '{}') @> array['search_path=public']
        from pg_proc p
       where p.oid = 'public.presupuestos_crear_obra()'::regprocedure) then
    raise exception 'presupuestos_crear_obra() tiene que ser security definer, de postgres y con search_path fijado.';
  end if;

  -- Los triggers que miran la marca tajo.seed y guardar_parte() tienen que ser security invoker.
  select string_agg(p.proname, ', ')
    into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('presupuestos_borrar_con_obra', 'obras_alta', 'obras_reglas', 'obras_no_se_borran',
                       'partes_reglas', 'parte_materiales_reglas', 'guardar_parte', 'presupuesto_base_cents',
                       'materiales_coste_solo_gerencia')
     and p.prosecdef;
  if v_mal is not null then
    raise exception 'Estas funciones deberían ser security invoker: %.', v_mal;
  end if;

  select string_agg(c.relname, ', ')
    into v_mal
    from pg_class c
   where c.oid in ('public.obras'::regclass, 'public.partes'::regclass, 'public.parte_materiales'::regclass)
     and not c.relrowsecurity;
  if v_mal is not null then
    raise exception 'Estas tablas tienen que tener RLS activado: %.', v_mal;
  end if;

  if has_table_privilege('anon', 'public.obras', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('anon', 'public.partes', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('anon', 'public.parte_materiales', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('anon', 'public.obras_resumen', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('anon', 'public.obras', 'select, insert, update')
     or has_any_column_privilege('anon', 'public.partes', 'select, insert, update')
     or has_any_column_privilege('anon', 'public.parte_materiales', 'select, insert, update')
     or has_table_privilege('authenticated', 'public.obras', 'insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.partes', 'update, truncate')
     or has_table_privilege('authenticated', 'public.parte_materiales', 'update, truncate')
     or has_table_privilege('authenticated', 'public.obras_resumen', 'insert, update, delete, truncate')
     or not has_table_privilege('authenticated', 'public.obras', 'select')
     or not has_table_privilege('authenticated', 'public.partes', 'select, insert, delete')
     or not has_table_privilege('authenticated', 'public.parte_materiales', 'select, insert, delete')
     or not has_table_privilege('authenticated', 'public.obras_resumen', 'select')
     or has_any_column_privilege('authenticated', 'public.obras', 'insert')
     or has_column_privilege('authenticated', 'public.obras', 'presupuesto_id', 'update')
     or has_column_privilege('authenticated', 'public.obras', 'empresa_id', 'update')
     or has_column_privilege('authenticated', 'public.obras', 'titulo', 'update')
     or has_column_privilege('authenticated', 'public.obras', 'cliente_id', 'update')
     or not has_column_privilege('authenticated', 'public.obras', 'estado', 'update')
     or not has_column_privilege('authenticated', 'public.obras', 'encargado_id', 'update')
     or has_column_privilege('authenticated', 'public.partes', 'autor_id', 'update')
     or has_column_privilege('authenticated', 'public.partes', 'obra_id', 'update')
     or has_column_privilege('authenticated', 'public.partes', 'coste_hora_cents', 'update')
     or has_column_privilege('authenticated', 'public.partes', 'created_at', 'update')
     or not has_column_privilege('authenticated', 'public.partes', 'horas', 'update')
     or has_column_privilege('authenticated', 'public.parte_materiales', 'coste_unit_cents', 'update')
     or has_column_privilege('authenticated', 'public.parte_materiales', 'material_id', 'update')
     or has_column_privilege('authenticated', 'public.parte_materiales', 'material_nombre', 'update')
     or has_column_privilege('authenticated', 'public.parte_materiales', 'unidad', 'update')
     or not has_column_privilege('authenticated', 'public.parte_materiales', 'cantidad', 'update')
     or has_function_privilege('anon', 'public.guardar_parte(uuid, uuid, date, numeric, text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.guardar_parte(uuid, uuid, date, numeric, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.presupuesto_base_cents(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.presupuestos_crear_obra()', 'execute')
     or has_function_privilege('anon', 'public.presupuestos_crear_obra()', 'execute') then
    raise exception 'Los permisos de obras, partes, parte_materiales, obras_resumen o de sus funciones no son los esperados; revisa la sección 7.';
  end if;

  -- Toda obra aceptada o facturada tiene su obra.
  select string_agg(p.numero, ', ')
    into v_mal
    from public.presupuestos p
   where p.estado in ('aceptado', 'facturado')
     and not exists (select 1 from public.obras o where o.presupuesto_id = p.id);
  if v_mal is not null then
    raise exception 'Presupuestos aceptados sin obra: %.', v_mal;
  end if;
end;
$$;

-- PostgREST (la API) vuelve a leer el esquema para ver las tablas, la vista y la función nuevas.
notify pgrst, 'reload schema';
