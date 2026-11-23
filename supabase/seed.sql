-- Tajo · seed.sql — datos de demo de Reformas Levante S.L. y de una segunda empresa para comprobar el aislamiento.
-- Cómo se ejecuta:
--   1) Aplicar, en este orden, en el SQL Editor (rol postgres): migrations/0001_esquema.sql →
--      migrations/0002_reglas.sql → migrations/0003_guardar_presupuesto.sql → migrations/0004_auditoria.sql.
--   2) Crear en Authentication → Add user a gerencia@reformaslevante.es y obra@reformaslevante.es (si no existen).
--   3) SQL Editor → pegar este fichero entero → Run (el SQL Editor lo ejecuta todo en una sola transacción).
-- Es reejecutable: borra antes los datos de demo de las dos empresas y reinicia su numeración.
-- Alta por invitación (D9): este fichero invita a los dos emails de demo. Un usuario que se dé de alta en Auth sin
-- invitación no tiene perfil y no puede entrar.

-- ============================================================================
-- 0. Modo seed: los triggers no bloquean en esta transacción. Hace falta porque el seed borra partidas de
--    presupuestos ya enviados o facturados, inserta presupuestos directamente en su estado final y crea las
--    facturas con su numeración y fecha. La marca solo cuenta si current_user = 'postgres' (0004) y
--    set_config(..., true) solo dura hasta el final de la transacción.
-- ============================================================================

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Ejecuta el seed como postgres (SQL Editor de Supabase). Usuario actual: %.', current_user;
  end if;
  if to_regclass('public.factura_lineas') is null then
    raise exception 'Falta aplicar migrations/0004_auditoria.sql antes del seed.';
  end if;
end;
$$;

select set_config('tajo.seed', 'on', true);

do $$
begin
  if coalesce(current_setting('tajo.seed', true), '') <> 'on' then
    raise exception 'El seed se tiene que ejecutar entero de una vez (pegar todo el fichero y Run), no por partes.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Empresas: CIF de demo con dígito de control correcto. La segunda empresa no tiene usuarios: solo sirve para
--    comprobar que nadie de Reformas Levante ve sus datos (npm run test:db).
-- ============================================================================

update public.empresas
   set cif = 'B12345674'
 where id = '00000000-0000-0000-0000-000000000001';

insert into public.empresas (id, nombre, cif, direccion, telefono, email)
values (
  '00000000-0000-0000-0000-000000000002',
  'Construcciones Ajenas S.L.',
  'B30516249',
  'Gran Vía Escultor Salzillo 9, 30004 Murcia',
  '968 000 111',
  'info@construccionesajenas.es'
)
on conflict (id) do update
   set nombre    = excluded.nombre,
       cif       = excluded.cif,
       direccion = excluded.direccion,
       telefono  = excluded.telefono,
       email     = excluded.email;

-- ============================================================================
-- 2. Invitaciones y usuarios. Los usuarios deben existir en Auth; su perfil sale de la invitación.
-- ============================================================================

insert into public.invitaciones (email, empresa_id, rol)
values
  ('gerencia@reformaslevante.es', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('obra@reformaslevante.es',     '00000000-0000-0000-0000-000000000001', 'empleado')
on conflict (email) do update
   set empresa_id = excluded.empresa_id,
       rol        = excluded.rol;

do $$
declare
  v_faltan text;
begin
  select string_agg(e.email, ', ')
    into v_faltan
    from unnest(array['gerencia@reformaslevante.es', 'obra@reformaslevante.es']) as e(email)
   where not exists (select 1 from auth.users u where lower(u.email) = e.email);

  if v_faltan is not null then
    raise exception 'Faltan usuarios en Supabase Auth: %. Créalos en Authentication → Add user y vuelve a ejecutar el seed.', v_faltan;
  end if;
end;
$$;

-- Upsert por si los usuarios se crearon antes de la invitación (sin perfil) o antes de la migración 0001.
insert into public.perfiles (id, empresa_id, nombre, email, rol)
select u.id,
       i.empresa_id,
       case i.email
         when 'gerencia@reformaslevante.es' then 'Laura Martí — Gerencia'
         else 'Toni Ferrer — Encargado'
       end,
       i.email,
       i.rol
  from auth.users u
  join public.invitaciones i on i.email = lower(u.email)
 where i.email in ('gerencia@reformaslevante.es', 'obra@reformaslevante.es')
on conflict (id) do update
   set empresa_id = excluded.empresa_id,
       nombre     = excluded.nombre,
       email      = excluded.email,
       rol        = excluded.rol;

-- ============================================================================
-- 3. Limpieza de datos de demo anteriores (solo de las dos empresas de demo).
--    Las partidas de las facturas se borran en cascada con su factura.
-- ============================================================================

delete from public.facturas
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.presupuesto_lineas
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.presupuestos
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.materiales
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.clientes
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.contadores
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

-- ============================================================================
-- 4. Clientes (con NIF o CIF de demo, con su letra o dígito de control calculado; se comprueba en la sección 10)
-- ============================================================================

insert into public.clientes (id, empresa_id, nombre, nif, telefono, email, direccion, notas, created_at)
select v.id, '00000000-0000-0000-0000-000000000001', v.nombre, v.nif, v.telefono, v.email, v.direccion, v.notas,
       now() - make_interval(days => v.dias)
  from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'Carmen Puig Soler', '20481537Z', '600 112 233', 'carmen.puig@gmail.com',
     'C/ de Sueca 34, 3º 6ª, 46006 Valencia', 'Piso en Russafa. Mejor llamar por la tarde.', 70),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'Vicent Llorens Martí', '29176054W', '646 221 908', 'vllorens@hotmail.com',
     'C/ del Doctor Sumsi 12, 4º, 46005 Valencia', null, 66),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'Comunidad de Propietarios Blasco Ibáñez 88', 'H96381272', '963 600 144', 'admin.blascoibanez88@gmail.com',
     'Av. de Blasco Ibáñez 88, 46021 Valencia', 'Trato con el administrador de fincas. Obras en horario de 9 a 14.', 6),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'Amparo Ferrandis Gil', '44859213J', '655 340 127', 'amparo.ferrandis@gmail.com',
     'C/ Major 21, 46900 Torrent', 'Persona mayor: plato de ducha a ras de suelo.', 48),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'Josep Ribes Navarro', '73562180S', '678 905 412', 'josepribes@yahoo.es',
     'C/ del Progrés 8, 46011 Valencia', 'Casa en el Cabanyal. Tiene perro, avisar antes de entrar.', 3),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'Arrocería El Racó S.L.', 'B96452131', '961 203 456', 'arroceriaelraco@gmail.com',
     'C/ de la Reina 73, 46011 Valencia', 'Solo pueden cerrar el local los lunes.', 50),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'María José Sanchis Pons', '48291736Q', '699 018 773', 'mjsanchis@gmail.com',
     'C/ de Cuba 17, 2º 3ª, 46006 Valencia', null, 42),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'Pedro Alcañiz Romero', '24670395C', '627 444 190', 'pedro.alcaniz@outlook.es',
     'C/ Camí Real 15, 46470 Catarroja', 'Quiere hacer la obra antes de Navidad.', 28),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'Lucía Esteve Baixauli', '53018947Z', '644 778 021', 'lucia.esteve@gmail.com',
     'Av. de França 30, 7º 14ª, 46023 Valencia', 'Piso recién comprado, vacío. Llaves en portería.', 12),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'Clínica Dental Benimaclet S.L.P.', 'B97183420', '963 412 980', 'clinicadentalbenimaclet@gmail.com',
     'C/ d’Emili Baró 50, 46020 Valencia', 'Trabajos fuera del horario de consulta (después de las 20 h).', 30)
  ) as v(id, nombre, nif, telefono, email, direccion, notas, dias);

-- ============================================================================
-- 5. Materiales (precios en céntimos). Bajo mínimo: azulejo blanco, mampara y cemento cola.
-- ============================================================================

insert into public.materiales (id, empresa_id, nombre, unidad, precio_cents, stock, stock_minimo)
select v.id, '00000000-0000-0000-0000-000000000001', v.nombre, v.unidad, v.precio_cents, v.stock, v.stock_minimo
  from (values
    ('20000000-0000-4000-8000-000000000001'::uuid, 'Azulejo porcelánico 60x60 gris',              'm²',    2450,  85::numeric, 40::numeric),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'Azulejo cerámico blanco 30x60 (revestimiento)', 'm²',  1290,  18,  30),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'Plato de ducha de resina 140x80 blanco',       'ud',   18900,   4,   2),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'Mampara de ducha fija 120 cm, vidrio 6 mm',    'ud',   24500,   1,   2),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'Grifo termostático de ducha cromado',          'ud',   13900,   6,   3),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'Grifo monomando de lavabo',                    'ud',    5490,   9,   4),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'Pintura plástica blanca mate 15 L',            'cubo',  4850,  22,  10),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'Cemento cola C2TE gris 25 kg',                 'saco',  1150,   7,  15),
    ('20000000-0000-4000-8000-000000000009'::uuid, 'Placa de pladur 13 mm 120x250',                'ud',     890,  60,  25),
    ('20000000-0000-4000-8000-000000000010'::uuid, 'Tubo multicapa 16 mm',                         'm',      185, 240, 100),
    ('20000000-0000-4000-8000-000000000011'::uuid, 'Ventana PVC oscilobatiente 120x120',           'ud',   38500,   3,   1),
    ('20000000-0000-4000-8000-000000000012'::uuid, 'Encimera de cuarzo blanco 2 cm',               'ml',   21000,   6,   2)
  ) as v(id, nombre, unidad, precio_cents, stock, stock_minimo);

-- ============================================================================
-- 6. Presupuestos (últimos 60 días). El número se calcula aquí por año de creación (hora de Madrid) y orden de
--    fecha: así, en enero, un presupuesto creado en diciembre lleva el número del año anterior (P-2026-…) y no el
--    del año en curso. Los contadores se ajustan en la sección 9.
--    Aceptados y facturados: por el enlace del cliente, salvo «Cambio de ventanas», que gerencia dio por aceptado
--    por teléfono (aceptado_canal = 'interno').
-- ============================================================================

with ref as (
  select date_trunc('month', now())                                              as mes,
         date_trunc('month', now()) - interval '1 month'                         as mes_ant,
         greatest(date_trunc('month', now()), date_trunc('day', now()) - interval '1 day') as f4
),
gerencia as (
  select u.id from auth.users u where lower(u.email) = 'gerencia@reformaslevante.es'
),
datos as (
  select v.*
    from ref
   cross join lateral (values
      -- facturado · factura el mes anterior
      ('30000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid,
       'Reforma completa de baño', 'facturado', 10, 30,
       ref.mes_ant + interval '2 days 9 hours', ref.mes_ant + interval '3 days 12 hours', ref.mes_ant + interval '6 days 18 hours', 'enlace'),
      -- facturado · factura el mes anterior
      ('30000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000002'::uuid,
       'Pintura de piso de 90 m²', 'facturado', 10, 30,
       ref.mes_ant + interval '8 days 10 hours', ref.mes_ant + interval '9 days 11 hours', ref.mes_ant + interval '12 days 20 hours', 'enlace'),
      -- rechazado
      ('30000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000006'::uuid,
       'Alicatado de la cocina del restaurante', 'rechazado', 21, 15,
       now() - interval '45 days', now() - interval '43 days', null::timestamptz, null::text),
      -- aceptado (listo para facturar)
      ('30000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000007'::uuid,
       'Reforma de cocina', 'aceptado', 10, 30,
       now() - interval '40 days', now() - interval '38 days', now() - interval '10 days', 'enlace'),
      -- facturado · factura este mes (día 1)
      ('30000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
       'Cambio de bañera por plato de ducha', 'facturado', 10, 30,
       ref.mes - interval '14 days' + interval '10 hours', ref.mes - interval '13 days' + interval '12 hours', ref.mes - interval '3 days' + interval '17 hours', 'enlace'),
      -- facturado · factura este mes (ayer o día 1)
      ('30000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
       'Tabique de pladur para nuevo gabinete', 'facturado', 21, 30,
       ref.f4 - interval '20 days' + interval '9 hours', ref.f4 - interval '18 days' + interval '13 hours', ref.f4 - interval '5 days' + interval '19 hours', 'enlace'),
      -- aceptado por gerencia (interno), listo para facturar
      ('30000000-0000-4000-8000-000000000007'::uuid, '10000000-0000-4000-8000-000000000008'::uuid,
       'Cambio de ventanas a PVC', 'aceptado', 10, 30,
       now() - interval '26 days', now() - interval '24 days', now() - interval '3 days', 'interno'),
      -- enviado (pendiente de respuesta)
      ('30000000-0000-4000-8000-000000000008'::uuid, '10000000-0000-4000-8000-000000000009'::uuid,
       'Reforma integral de piso', 'enviado', 10, 30,
       now() - interval '9 days', now() - interval '7 days', null::timestamptz, null::text),
      -- enviado (pendiente de respuesta)
      ('30000000-0000-4000-8000-000000000009'::uuid, '10000000-0000-4000-8000-000000000003'::uuid,
       'Reparación de humedades y pintura del zaguán', 'enviado', 21, 30,
       now() - interval '5 days', now() - interval '4 days', null::timestamptz, null::text),
      -- borrador
      ('30000000-0000-4000-8000-000000000010'::uuid, '10000000-0000-4000-8000-000000000005'::uuid,
       'Baño de cortesía en planta baja', 'borrador', 10, 30,
       now() - interval '2 days', null::timestamptz, null::timestamptz, null::text),
      -- borrador
      ('30000000-0000-4000-8000-000000000011'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
       'Pintura de la sala de espera', 'borrador', 21, 30,
       now() - interval '1 day', null::timestamptz, null::timestamptz, null::text)
    ) as v(id, cliente_id, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at, aceptado_canal)
),
numerados as (
  select d.*,
         extract(year from (d.created_at at time zone 'Europe/Madrid'))::integer as anio,
         row_number() over (
           partition by extract(year from (d.created_at at time zone 'Europe/Madrid'))
           order by d.created_at, d.id
         ) as orden_anio
    from datos d
)
insert into public.presupuestos
  (id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at,
   aceptado_canal, aceptado_por)
select n.id, '00000000-0000-0000-0000-000000000001', n.cliente_id,
       'P-' || n.anio || '-' || lpad(n.orden_anio::text, 4, '0'),
       n.titulo, n.estado, n.iva_pct, n.validez_dias, n.created_at, n.enviado_at, n.aceptado_at,
       n.aceptado_canal,
       case when n.aceptado_canal = 'interno' then (select g.id from gerencia g) end
  from numerados n;

-- ============================================================================
-- 7. Partidas (algunas vinculadas a materiales)
-- ============================================================================

insert into public.presupuesto_lineas
  (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents, material_id)
select '00000000-0000-0000-0000-000000000001', v.presupuesto_id, v.orden, v.descripcion, v.cantidad, v.precio_cents, v.material_id
  from (values
    -- P1 · Reforma completa de baño
    ('30000000-0000-4000-8000-000000000001'::uuid, 1, 'Demolición de alicatado, retirada de sanitarios y escombros a vertedero', 1::numeric, 65000, null::uuid),
    ('30000000-0000-4000-8000-000000000001'::uuid, 2, 'Azulejo cerámico blanco 30x60 en paredes', 24, 1290, '20000000-0000-4000-8000-000000000002'::uuid),
    ('30000000-0000-4000-8000-000000000001'::uuid, 3, 'Pavimento porcelánico 60x60 gris', 5.5, 2450, '20000000-0000-4000-8000-000000000001'::uuid),
    ('30000000-0000-4000-8000-000000000001'::uuid, 4, 'Plato de ducha de resina 140x80', 1, 18900, '20000000-0000-4000-8000-000000000003'::uuid),
    ('30000000-0000-4000-8000-000000000001'::uuid, 5, 'Mampara de ducha fija 120 cm', 1, 24500, '20000000-0000-4000-8000-000000000004'::uuid),
    ('30000000-0000-4000-8000-000000000001'::uuid, 6, 'Mano de obra de alicatado y solado (m²)', 29.5, 2800, null::uuid),

    -- P2 · Pintura de piso
    ('30000000-0000-4000-8000-000000000002'::uuid, 1, 'Protección de suelos y muebles', 1, 12000, null::uuid),
    ('30000000-0000-4000-8000-000000000002'::uuid, 2, 'Reparación de grietas y alisado de paredes', 1, 18000, null::uuid),
    ('30000000-0000-4000-8000-000000000002'::uuid, 3, 'Pintura plástica blanca mate 15 L', 8, 4850, '20000000-0000-4000-8000-000000000007'::uuid),
    ('30000000-0000-4000-8000-000000000002'::uuid, 4, 'Pintado de paredes y techos a dos manos (m²)', 245, 650, null::uuid),

    -- P3 · Alicatado cocina restaurante (rechazado)
    ('30000000-0000-4000-8000-000000000003'::uuid, 1, 'Picado de alicatado existente (m²)', 32, 1400, null::uuid),
    ('30000000-0000-4000-8000-000000000003'::uuid, 2, 'Azulejo porcelánico 60x60 gris', 32, 2450, '20000000-0000-4000-8000-000000000001'::uuid),
    ('30000000-0000-4000-8000-000000000003'::uuid, 3, 'Cemento cola C2TE 25 kg', 10, 1150, '20000000-0000-4000-8000-000000000008'::uuid),
    ('30000000-0000-4000-8000-000000000003'::uuid, 4, 'Colocación de alicatado (m²)', 32, 2600, null::uuid),

    -- P4 · Reforma de cocina (aceptado)
    ('30000000-0000-4000-8000-000000000004'::uuid, 1, 'Desmontaje de cocina antigua y retirada de escombros', 1, 45000, null::uuid),
    ('30000000-0000-4000-8000-000000000004'::uuid, 2, 'Tubo multicapa 16 mm para nueva toma de agua', 18, 185, '20000000-0000-4000-8000-000000000010'::uuid),
    ('30000000-0000-4000-8000-000000000004'::uuid, 3, 'Encimera de cuarzo blanco 2 cm', 3.2, 21000, '20000000-0000-4000-8000-000000000012'::uuid),
    ('30000000-0000-4000-8000-000000000004'::uuid, 4, 'Azulejo cerámico blanco 30x60 en frontal', 6, 1290, '20000000-0000-4000-8000-000000000002'::uuid),
    ('30000000-0000-4000-8000-000000000004'::uuid, 5, 'Mano de obra de fontanería, alicatado y montaje', 1, 62000, null::uuid),

    -- P5 · Cambio de bañera por plato de ducha
    ('30000000-0000-4000-8000-000000000005'::uuid, 1, 'Retirada de bañera y escombros', 1, 28000, null::uuid),
    ('30000000-0000-4000-8000-000000000005'::uuid, 2, 'Plato de ducha de resina 140x80', 1, 18900, '20000000-0000-4000-8000-000000000003'::uuid),
    ('30000000-0000-4000-8000-000000000005'::uuid, 3, 'Grifo termostático de ducha', 1, 13900, '20000000-0000-4000-8000-000000000005'::uuid),
    ('30000000-0000-4000-8000-000000000005'::uuid, 4, 'Cemento cola C2TE 25 kg', 2, 1150, '20000000-0000-4000-8000-000000000008'::uuid),
    ('30000000-0000-4000-8000-000000000005'::uuid, 5, 'Reposición de alicatado y mano de obra', 1, 52000, null::uuid),

    -- P6 · Tabique de pladur
    ('30000000-0000-4000-8000-000000000006'::uuid, 1, 'Placa de pladur 13 mm 120x250', 14, 890, '20000000-0000-4000-8000-000000000009'::uuid),
    ('30000000-0000-4000-8000-000000000006'::uuid, 2, 'Perfilería y aislamiento de lana mineral (m²)', 18, 1100, null::uuid),
    ('30000000-0000-4000-8000-000000000006'::uuid, 3, 'Montaje de tabique y tratamiento de juntas (m²)', 18, 2400, null::uuid),
    ('30000000-0000-4000-8000-000000000006'::uuid, 4, 'Pintura plástica blanca mate 15 L', 2, 4850, '20000000-0000-4000-8000-000000000007'::uuid),
    ('30000000-0000-4000-8000-000000000006'::uuid, 5, 'Pintado del tabique a dos caras (m²)', 36, 650, null::uuid),

    -- P7 · Cambio de ventanas (aceptado)
    ('30000000-0000-4000-8000-000000000007'::uuid, 1, 'Ventana PVC oscilobatiente 120x120', 3, 38500, '20000000-0000-4000-8000-000000000011'::uuid),
    ('30000000-0000-4000-8000-000000000007'::uuid, 2, 'Desmontaje de ventanas de aluminio antiguas', 3, 4500, null::uuid),
    ('30000000-0000-4000-8000-000000000007'::uuid, 3, 'Instalación, nivelado y sellado', 3, 9000, null::uuid),
    ('30000000-0000-4000-8000-000000000007'::uuid, 4, 'Remates de albañilería y limpieza', 1, 15000, null::uuid),

    -- P8 · Reforma integral de piso (enviado)
    ('30000000-0000-4000-8000-000000000008'::uuid, 1, 'Demolición de tabiques y retirada de escombros', 1, 180000, null::uuid),
    ('30000000-0000-4000-8000-000000000008'::uuid, 2, 'Placa de pladur 13 mm 120x250', 30, 890, '20000000-0000-4000-8000-000000000009'::uuid),
    ('30000000-0000-4000-8000-000000000008'::uuid, 3, 'Montaje de tabiquería nueva (m²)', 42, 2400, null::uuid),
    ('30000000-0000-4000-8000-000000000008'::uuid, 4, 'Pavimento porcelánico 60x60 gris', 68, 2450, '20000000-0000-4000-8000-000000000001'::uuid),
    ('30000000-0000-4000-8000-000000000008'::uuid, 5, 'Tubo multicapa 16 mm para fontanería', 45, 185, '20000000-0000-4000-8000-000000000010'::uuid),
    ('30000000-0000-4000-8000-000000000008'::uuid, 6, 'Renovación completa de la instalación eléctrica', 1, 420000, null::uuid),

    -- P9 · Humedades y pintura del zaguán (enviado)
    ('30000000-0000-4000-8000-000000000009'::uuid, 1, 'Picado y saneado de zonas con humedad (m²)', 14, 2200, null::uuid),
    ('30000000-0000-4000-8000-000000000009'::uuid, 2, 'Tratamiento antihumedad por capilaridad (m²)', 14, 1800, null::uuid),
    ('30000000-0000-4000-8000-000000000009'::uuid, 3, 'Pintura plástica blanca mate 15 L', 4, 4850, '20000000-0000-4000-8000-000000000007'::uuid),
    ('30000000-0000-4000-8000-000000000009'::uuid, 4, 'Pintado de zaguán y escalera (m²)', 120, 700, null::uuid),

    -- P10 · Baño de cortesía (borrador)
    ('30000000-0000-4000-8000-000000000010'::uuid, 1, 'Grifo monomando de lavabo', 1, 5490, '20000000-0000-4000-8000-000000000006'::uuid),
    ('30000000-0000-4000-8000-000000000010'::uuid, 2, 'Lavabo suspendido con mueble', 1, 21000, null::uuid),
    ('30000000-0000-4000-8000-000000000010'::uuid, 3, 'Inodoro compacto', 1, 19500, null::uuid),
    ('30000000-0000-4000-8000-000000000010'::uuid, 4, 'Mano de obra de instalación', 1, 32000, null::uuid),

    -- P11 · Pintura sala de espera (borrador)
    ('30000000-0000-4000-8000-000000000011'::uuid, 1, 'Pintura plástica blanca mate 15 L', 3, 4850, '20000000-0000-4000-8000-000000000007'::uuid),
    ('30000000-0000-4000-8000-000000000011'::uuid, 2, 'Pintado de paredes y techo (m²)', 85, 650, null::uuid),
    ('30000000-0000-4000-8000-000000000011'::uuid, 3, 'Protección del mobiliario y limpieza final', 1, 9000, null::uuid)
  ) as v(presupuesto_id, orden, descripcion, cantidad, precio_cents, material_id);

-- ============================================================================
-- 8. Facturas de los 4 presupuestos facturados (2 el mes anterior, 2 este mes), con su copia fija y sus partidas
--    (crear_factura_copia() de 0004, la misma que usa facturar_presupuesto()). No se usa facturar_presupuesto()
--    porque en el SQL Editor no hay sesión y porque el stock de la sección 5 ya es el final.
--    Numeración por el año de la fecha de la factura (corrige el fallo de enero: una factura de diciembre lleva el
--    número de su año).
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    with fechas as (
      select f.presupuesto_id, f.fecha
        from (values
          ('30000000-0000-4000-8000-000000000001'::uuid,
           (date_trunc('month', now()) - interval '1 month' + interval '9 days')::date),
          ('30000000-0000-4000-8000-000000000002'::uuid,
           (date_trunc('month', now()) - interval '1 month' + interval '18 days')::date),
          ('30000000-0000-4000-8000-000000000005'::uuid,
           date_trunc('month', now())::date),
          ('30000000-0000-4000-8000-000000000006'::uuid,
           greatest(date_trunc('month', now()), date_trunc('day', now()) - interval '1 day')::date)
        ) as f(presupuesto_id, fecha)
    )
    select p.id,
           x.fecha,
           'F-' || extract(year from x.fecha)::integer || '-'
             || lpad((row_number() over (partition by extract(year from x.fecha) order by x.fecha, p.created_at))::text, 4, '0')
             as numero
      from fechas x
      join public.presupuestos p on p.id = x.presupuesto_id
     order by x.fecha, p.created_at
  loop
    perform public.crear_factura_copia(r.id, r.numero, r.fecha, least((r.fecha + interval '10 hours')::timestamptz, now()));
  end loop;
end;
$$;

-- ============================================================================
-- 9. Segunda empresa (Construcciones Ajenas S.L.): un cliente y un presupuesto enviado, sin usuarios.
-- ============================================================================

insert into public.clientes (id, empresa_id, nombre, nif, telefono, email, direccion, notas, created_at)
values (
  '10000000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000002',
  'Promociones del Segura S.A.',
  'A30872154',
  '968 222 333',
  'obras@promocionesdelsegura.es',
  'Av. de la Libertad 5, 30009 Murcia',
  'Dato de otra empresa: Reformas Levante no debe verlo nunca.',
  now() - interval '20 days'
);

insert into public.presupuestos
  (id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, created_at, enviado_at)
values (
  '30000000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000002',
  '10000000-0000-4000-8000-000000000101',
  'P-' || extract(year from ((now() - interval '3 days') at time zone 'Europe/Madrid'))::integer || '-0001',
  'Rehabilitación de fachada',
  'enviado',
  21,
  30,
  now() - interval '3 days',
  now() - interval '2 days'
);

insert into public.presupuesto_lineas
  (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents, material_id)
values
  ('00000000-0000-0000-0000-000000000002', '30000000-0000-4000-8000-000000000101', 1,
   'Andamio y saneado de fachada (m²)', 180, 3500, null),
  ('00000000-0000-0000-0000-000000000002', '30000000-0000-4000-8000-000000000101', 2,
   'Pintura de silicato a dos manos (m²)', 180, 1800, null);

-- ============================================================================
-- 10. Contadores de numeración: el último número usado por empresa, prefijo y año.
-- ============================================================================

insert into public.contadores (empresa_id, prefijo, anio, ultimo)
select d.empresa_id, d.prefijo, d.anio, max(d.n)
  from (
    select p.empresa_id, 'P' as prefijo,
           split_part(p.numero, '-', 2)::integer as anio,
           split_part(p.numero, '-', 3)::integer as n
      from public.presupuestos p
     where p.empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
    union all
    select f.empresa_id, 'F',
           split_part(f.numero, '-', 2)::integer,
           split_part(f.numero, '-', 3)::integer
      from public.facturas f
     where f.empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  ) d
 group by d.empresa_id, d.prefijo, d.anio
on conflict (empresa_id, prefijo, anio) do update
   set ultimo = excluded.ultimo;

-- ============================================================================
-- 11. Comprobaciones: NIF/CIF de demo con control correcto y avisos.
-- ============================================================================

do $$
declare
  r        record;
  v_num    text;
  v_suma   integer;
  v_d      integer;
  v_ctrl   integer;
  v_ok     boolean;
  c_letras constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
begin
  for r in
    select c.nombre, c.nif from public.clientes c
     where c.empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
    union all
    select e.nombre, e.cif from public.empresas e
     where e.id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  loop
    if r.nif ~ '^[0-9]{8}[A-Z]$' then
      -- DNI: letra = TRWAGMYFPDXBNJZSQVHLCKE[número mod 23].
      v_ok := substr(c_letras, (left(r.nif, 8)::integer % 23) + 1, 1) = right(r.nif, 1);
    elsif r.nif ~ '^[XYZ][0-9]{7}[A-Z]$' then
      -- NIE: X/Y/Z valen 0/1/2 y se calcula como un DNI.
      v_num := translate(left(r.nif, 1), 'XYZ', '012') || substr(r.nif, 2, 7);
      v_ok := substr(c_letras, (v_num::integer % 23) + 1, 1) = right(r.nif, 1);
    elsif r.nif ~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' then
      -- CIF: posiciones pares se suman; impares se doblan y se suman sus cifras; control = (10 - suma mod 10) mod 10.
      v_suma := 0;
      for i in 1..7 loop
        v_d := substr(r.nif, i + 1, 1)::integer;
        if i % 2 = 0 then
          v_suma := v_suma + v_d;
        else
          v_suma := v_suma + (2 * v_d) / 10 + (2 * v_d) % 10;
        end if;
      end loop;
      v_ctrl := (10 - v_suma % 10) % 10;
      v_ok := case
        when left(r.nif, 1) in ('A', 'B', 'E', 'H') then right(r.nif, 1) = v_ctrl::text
        when left(r.nif, 1) in ('N', 'P', 'Q', 'R', 'S', 'W') then right(r.nif, 1) = substr('JABCDEFGHI', v_ctrl + 1, 1)
        else right(r.nif, 1) in (v_ctrl::text, substr('JABCDEFGHI', v_ctrl + 1, 1))
      end;
    else
      v_ok := false;
    end if;

    if not v_ok then
      raise exception 'NIF/CIF de demo no válido: % (%).', coalesce(r.nif, 'sin NIF'), r.nombre;
    end if;
  end loop;
end;
$$;

-- Perfiles sin invitación (por ejemplo, alguien que se registró cuando el alta estaba abierta): se avisa para que
-- gerencia los revise y, si no los conoce, los borre en Authentication → Users.
do $$
declare
  v_sin_invitacion text;
begin
  select string_agg(coalesce(p.email, p.id::text), ', ')
    into v_sin_invitacion
    from public.perfiles p
   where not exists (select 1 from public.invitaciones i where i.email = lower(p.email));

  if v_sin_invitacion is not null then
    raise notice 'Perfiles sin invitación (revísalos): %', v_sin_invitacion;
  end if;
end;
$$;

-- Fin del modo seed (caducaría igual al acabar la transacción).
select set_config('tajo.seed', 'off', true);
