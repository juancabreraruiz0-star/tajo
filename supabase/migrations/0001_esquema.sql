-- Tajo · 0001_esquema.sql — tablas, RLS, numeración, funciones públicas y de facturación.
-- Cómo se ejecuta: Supabase → SQL Editor → pegar este fichero entero → Run (una sola vez, antes de crear usuarios).
-- Después, en este orden: migrations/0002_reglas.sql → migrations/0003_guardar_presupuesto.sql → seed.sql.
-- Orden completo: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010_ia_cache_autor.sql → seed.sql.
-- La primera ejecución es la buena. Está escrito con if not exists / create or replace / drop ... if exists, pero
-- re-ejecutarlo puede fallar en el trigger de auth.users (drop/create trigger on_auth_user_created) por los permisos
-- que Supabase da sobre el esquema auth; si hay que cambiar algo, mejor una migración nueva.
-- Si aun así se vuelve a ejecutar 0001 después de 0002, hay que volver a ejecutar 0002 y 0003 a continuación:
-- 0001 deja facturar_presupuesto(), aceptar_presupuesto() y la política presupuesto_lineas_delete como estaban
-- antes de 0002 y 0003.

-- ============================================================================
-- 1. Tablas
-- ============================================================================

create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  cif        text,
  direccion  text,
  telefono   text,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.perfiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre     text not null default '',
  email      text,
  rol        text not null default 'empleado' check (rol in ('admin', 'empleado')),
  created_at timestamptz not null default now()
);

create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  email      text,
  direccion  text,
  notas      text,
  created_at timestamptz not null default now(),
  unique (empresa_id, id)
);

create table if not exists public.materiales (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  nombre       text not null check (length(trim(nombre)) > 0),
  unidad       text not null default 'ud',
  precio_cents integer not null default 0 check (precio_cents >= 0),
  stock        numeric not null default 0,
  stock_minimo numeric not null default 0 check (stock_minimo >= 0),
  created_at   timestamptz not null default now(),
  unique (empresa_id, id)
);

create table if not exists public.presupuestos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  cliente_id   uuid not null,
  numero       text not null, -- lo rellena el trigger presupuestos_numerar si llega nulo
  titulo       text not null check (length(trim(titulo)) > 0),
  estado       text not null default 'borrador'
               check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado', 'facturado')),
  iva_pct      integer not null default 21 check (iva_pct in (0, 4, 10, 21)),
  validez_dias integer not null default 30 check (validez_dias > 0),
  token        uuid not null default gen_random_uuid() unique,
  created_at   timestamptz not null default now(),
  enviado_at   timestamptz,
  aceptado_at  timestamptz,
  unique (empresa_id, numero),
  unique (empresa_id, id),
  -- FK compuesta: el cliente tiene que ser de la misma empresa que el presupuesto.
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id) on delete restrict
);

create table if not exists public.presupuesto_lineas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  presupuesto_id uuid not null,
  orden          integer not null default 0,
  descripcion    text not null check (length(trim(descripcion)) > 0),
  cantidad       numeric not null check (cantidad > 0),
  precio_cents   integer not null check (precio_cents >= 0),
  material_id    uuid,
  foreign key (empresa_id, presupuesto_id)
    references public.presupuestos (empresa_id, id) on delete cascade,
  -- Si se borra el material, la partida se queda sin vínculo (solo se pone a null material_id).
  foreign key (empresa_id, material_id)
    references public.materiales (empresa_id, id) on delete set null (material_id)
);

create table if not exists public.facturas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  presupuesto_id uuid not null unique,
  cliente_id     uuid not null,
  numero         text not null,
  fecha          date not null default current_date,
  base_cents     integer not null check (base_cents >= 0),
  iva_cents      integer not null check (iva_cents >= 0),
  total_cents    integer not null check (total_cents >= 0),
  created_at     timestamptz not null default now(),
  unique (empresa_id, numero),
  check (total_cents = base_cents + iva_cents),
  foreign key (empresa_id, presupuesto_id)
    references public.presupuestos (empresa_id, id) on delete restrict,
  foreign key (empresa_id, cliente_id)
    references public.clientes (empresa_id, id) on delete restrict
);

-- Contadores de numeración por empresa, prefijo y año. Sin acceso directo (solo vía siguiente_numero).
create table if not exists public.contadores (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  prefijo    text not null check (prefijo in ('P', 'F')),
  anio       integer not null,
  ultimo     integer not null default 0 check (ultimo >= 0),
  primary key (empresa_id, prefijo, anio)
);

-- Índices
create index if not exists perfiles_empresa_id_idx           on public.perfiles (empresa_id);
create index if not exists clientes_empresa_id_idx           on public.clientes (empresa_id);
create index if not exists materiales_empresa_id_idx         on public.materiales (empresa_id);
create index if not exists presupuestos_empresa_id_idx       on public.presupuestos (empresa_id);
create index if not exists presupuestos_cliente_id_idx       on public.presupuestos (cliente_id);
create index if not exists presupuesto_lineas_empresa_id_idx on public.presupuesto_lineas (empresa_id);
create index if not exists presupuesto_lineas_presupuesto_idx on public.presupuesto_lineas (presupuesto_id, orden);
create index if not exists presupuesto_lineas_material_idx   on public.presupuesto_lineas (material_id);
create index if not exists facturas_empresa_id_idx           on public.facturas (empresa_id);
create index if not exists facturas_cliente_id_idx           on public.facturas (cliente_id);

-- ============================================================================
-- 2. Empresa de demo (la necesita el trigger de alta de usuarios)
-- ============================================================================

insert into public.empresas (id, nombre, cif, direccion, telefono, email)
values (
  '00000000-0000-0000-0000-000000000001',
  'Reformas Levante S.L.',
  'B12345678',
  'Av. del Puerto 120, 46023 Valencia',
  '961 234 567',
  'hola@reformaslevante.es'
)
on conflict (id) do nothing;

-- ============================================================================
-- 3. Funciones de seguridad (usadas por las políticas RLS)
-- ============================================================================

create or replace function public.auth_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.empresa_id from public.perfiles p where p.id = auth.uid()
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.rol = 'admin' from public.perfiles p where p.id = auth.uid()), false)
$$;

-- ============================================================================
-- 4. Numeración (P-2026-0001 / F-2026-0001)
-- ============================================================================

-- El insert ... on conflict do update bloquea la fila del contador hasta el fin de la transacción,
-- así que dos llamadas simultáneas nunca obtienen el mismo número.
create or replace function public.siguiente_numero(p_empresa uuid, p_prefijo text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_anio   integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer;
  v_ultimo integer;
begin
  if p_empresa is null then
    raise exception 'Falta la empresa para numerar.';
  end if;
  if p_prefijo is null or p_prefijo not in ('P', 'F') then
    raise exception 'Prefijo de numeración no válido: %', p_prefijo;
  end if;

  insert into public.contadores as c (empresa_id, prefijo, anio, ultimo)
  values (p_empresa, p_prefijo, v_anio, 1)
  on conflict (empresa_id, prefijo, anio) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_ultimo;

  return p_prefijo || '-' || v_anio::text || '-'
    || case when v_ultimo < 10000 then lpad(v_ultimo::text, 4, '0') else v_ultimo::text end;
end;
$$;

-- Trigger: numera el presupuesto al crearlo si no trae número.
create or replace function public.presupuestos_numerar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null then
    new.numero := public.siguiente_numero(new.empresa_id, 'P');
  end if;
  return new;
end;
$$;

drop trigger if exists presupuestos_numerar on public.presupuestos;
create trigger presupuestos_numerar
  before insert on public.presupuestos
  for each row execute function public.presupuestos_numerar();

-- ============================================================================
-- 5. Totales (misma regla que src/lib/domain/totals.ts)
--    importe partida = round(cantidad × precio); base = suma de importes;
--    IVA = round(base × iva_pct / 100) una sola vez sobre la base total.
-- ============================================================================

create or replace function public.totales_presupuesto(p_presupuesto uuid)
returns table (base_cents bigint, iva_cents bigint, total_cents bigint)
language sql
stable
set search_path = public
as $$
  with b as (
    select coalesce(sum(round(l.cantidad * l.precio_cents)), 0)::bigint as base_c
    from public.presupuesto_lineas l
    where l.presupuesto_id = p_presupuesto
  ),
  i as (
    select b.base_c, round(b.base_c * p.iva_pct / 100.0)::bigint as iva_c
    from b
    cross join public.presupuestos p
    where p.id = p_presupuesto
  )
  select i.base_c, i.iva_c, i.base_c + i.iva_c from i
$$;

-- ============================================================================
-- 6. Acceso público por enlace (/p/<token>)
-- ============================================================================

create or replace function public.presupuesto_publico(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pres    public.presupuestos%rowtype;
  v_lineas  jsonb;
  v_base    bigint;
  v_iva     bigint;
  v_total   bigint;
begin
  select * into v_pres from public.presupuestos where token = p_token;
  if not found or v_pres.estado = 'borrador' then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'orden',         l.orden,
               'descripcion',   l.descripcion,
               'cantidad',      l.cantidad,
               'precio_cents',  l.precio_cents,
               'importe_cents', round(l.cantidad * l.precio_cents)::bigint
             )
             order by l.orden, l.id
           ),
           '[]'::jsonb
         )
    into v_lineas
    from public.presupuesto_lineas l
   where l.presupuesto_id = v_pres.id;

  select t.base_cents, t.iva_cents, t.total_cents
    into v_base, v_iva, v_total
    from public.totales_presupuesto(v_pres.id) t;

  return jsonb_build_object(
    'empresa', (
      select jsonb_build_object(
               'nombre',    e.nombre,
               'cif',       e.cif,
               'direccion', e.direccion,
               'telefono',  e.telefono,
               'email',     e.email)
        from public.empresas e
       where e.id = v_pres.empresa_id
    ),
    'cliente', (
      select jsonb_build_object('nombre', c.nombre)
        from public.clientes c
       where c.id = v_pres.cliente_id
    ),
    'presupuesto', jsonb_build_object(
      'numero',       v_pres.numero,
      'titulo',       v_pres.titulo,
      'estado',       v_pres.estado,
      'iva_pct',      v_pres.iva_pct,
      'validez_dias', v_pres.validez_dias,
      'created_at',   v_pres.created_at,
      'enviado_at',   v_pres.enviado_at,
      'aceptado_at',  v_pres.aceptado_at
    ),
    'lineas',      v_lineas,
    'base_cents',  v_base,
    'iva_cents',   v_iva,
    'total_cents', v_total
  );
end;
$$;

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
  v_aceptado timestamptz;
begin
  select id, estado into v_id, v_estado
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

  update public.presupuestos
     set estado = 'aceptado', aceptado_at = now()
   where id = v_id
  returning aceptado_at into v_aceptado;

  return jsonb_build_object('ok', true, 'estado', 'aceptado', 'aceptado_at', v_aceptado);
end;
$$;

-- ============================================================================
-- 7. Facturación (solo admin): numera, crea la factura, descuenta stock y marca facturado
--    en una sola transacción (la de la llamada a la función).
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

  update public.presupuestos
     set estado = 'facturado'
   where id = v_pres.id;

  return v_factura;
end;
$$;

-- ============================================================================
-- 8. Alta de usuarios: cada usuario nuevo de Auth tiene perfil en la empresa de demo como empleado
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, empresa_id, nombre, email, rol)
  values (
    new.id,
    '00000000-0000-0000-0000-000000000001',
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'),
    new.email,
    'empleado'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 9. RLS y políticas
-- ============================================================================

alter table public.empresas           enable row level security;
alter table public.perfiles           enable row level security;
alter table public.clientes           enable row level security;
alter table public.materiales         enable row level security;
alter table public.presupuestos       enable row level security;
alter table public.presupuesto_lineas enable row level security;
alter table public.facturas           enable row level security;
alter table public.contadores         enable row level security;

-- empresas: solo se ve la propia.
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated
  using (id = (select public.auth_empresa_id()));

-- perfiles: se ven los de mi empresa; cada uno edita solo su propio nombre (el rol, por grants, no).
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists perfiles_update_propio on public.perfiles;
create policy perfiles_update_propio on public.perfiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- clientes
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
  for insert to authenticated
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes
  for update to authenticated
  using (empresa_id = (select public.auth_empresa_id()))
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes
  for delete to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

-- materiales
drop policy if exists materiales_select on public.materiales;
create policy materiales_select on public.materiales
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists materiales_insert on public.materiales;
create policy materiales_insert on public.materiales
  for insert to authenticated
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists materiales_update on public.materiales;
create policy materiales_update on public.materiales
  for update to authenticated
  using (empresa_id = (select public.auth_empresa_id()))
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists materiales_delete on public.materiales;
create policy materiales_delete on public.materiales
  for delete to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

-- presupuestos
drop policy if exists presupuestos_select on public.presupuestos;
create policy presupuestos_select on public.presupuestos
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuestos_insert on public.presupuestos;
create policy presupuestos_insert on public.presupuestos
  for insert to authenticated
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuestos_update on public.presupuestos;
create policy presupuestos_update on public.presupuestos
  for update to authenticated
  using (empresa_id = (select public.auth_empresa_id()))
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuestos_delete on public.presupuestos;
create policy presupuestos_delete on public.presupuestos
  for delete to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

-- presupuesto_lineas
drop policy if exists presupuesto_lineas_select on public.presupuesto_lineas;
create policy presupuesto_lineas_select on public.presupuesto_lineas
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuesto_lineas_insert on public.presupuesto_lineas;
create policy presupuesto_lineas_insert on public.presupuesto_lineas
  for insert to authenticated
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuesto_lineas_update on public.presupuesto_lineas;
create policy presupuesto_lineas_update on public.presupuesto_lineas
  for update to authenticated
  using (empresa_id = (select public.auth_empresa_id()))
  with check (empresa_id = (select public.auth_empresa_id()));

drop policy if exists presupuesto_lineas_delete on public.presupuesto_lineas;
create policy presupuesto_lineas_delete on public.presupuesto_lineas
  for delete to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

-- facturas: solo lectura y solo admin. Sin insert/update/delete: se crean con facturar_presupuesto().
drop policy if exists facturas_select_admin on public.facturas;
create policy facturas_select_admin on public.facturas
  for select to authenticated
  using (empresa_id = (select public.auth_empresa_id()) and (select public.es_admin()));

-- contadores: RLS activado y sin políticas → sin acceso directo.

-- ============================================================================
-- 10. Permisos
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- anon no toca ninguna tabla; lo público va por funciones security definer.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- authenticated: permisos normales de tabla; RLS decide qué filas.
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- perfiles: el usuario solo puede cambiar la columna nombre (no rol, empresa ni email).
revoke insert, update, delete on public.perfiles from authenticated;
grant update (nombre) on public.perfiles to authenticated;

-- facturas: solo lectura (además de no tener políticas de escritura).
revoke insert, update, delete on public.facturas from authenticated;

-- contadores: nada.
revoke all on public.contadores from authenticated;

-- Funciones internas: nadie las llama desde fuera (las usan otras funciones security definer).
-- Las funciones de trigger no se pueden invocar por RPC, así que no hace falta revocarlas.
revoke execute on function public.siguiente_numero(uuid, text) from public, anon, authenticated;
revoke execute on function public.totales_presupuesto(uuid)    from public, anon, authenticated;

-- Funciones que usan las políticas RLS.
revoke execute on function public.auth_empresa_id() from public, anon;
revoke execute on function public.es_admin()        from public, anon;
grant  execute on function public.auth_empresa_id() to authenticated;
grant  execute on function public.es_admin()        to authenticated;

-- Funciones públicas por token.
revoke execute on function public.presupuesto_publico(uuid) from public;
revoke execute on function public.aceptar_presupuesto(uuid) from public;
grant  execute on function public.presupuesto_publico(uuid) to anon, authenticated;
grant  execute on function public.aceptar_presupuesto(uuid) to anon, authenticated;

-- Facturar: solo usuarios con sesión (y dentro, solo admin).
revoke execute on function public.facturar_presupuesto(uuid) from public, anon;
grant  execute on function public.facturar_presupuesto(uuid) to authenticated;
