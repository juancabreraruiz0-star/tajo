-- Tajo · seed.sql — datos de demo de Reformas Levante S.L.
-- Cómo se ejecuta: 1) aplicar, en este orden, migrations/0001_esquema.sql → migrations/0002_reglas.sql →
-- migrations/0003_guardar_presupuesto.sql; 2) crear en Authentication → Add user a gerencia@reformaslevante.es y
-- obra@reformaslevante.es; 3) SQL Editor → pegar este fichero entero → Run (el SQL Editor lo ejecuta todo en una
-- sola transacción).
-- Si se vuelve a ejecutar, borra antes los datos de demo de la empresa y reinicia su numeración.

-- ============================================================================
-- 0. Modo seed: los triggers de 0002 no bloquean en esta transacción. Hace falta porque el seed borra partidas
--    de presupuestos ya enviados o facturados, inserta presupuestos directamente en su estado final y crea las
--    facturas a mano. set_config(..., true) solo dura hasta el final de la transacción, y set_config no se puede
--    llamar desde la API (está en pg_catalog, que PostgREST no expone): solo el SQL Editor puede activarlo.
-- ============================================================================

select set_config('tajo.seed', 'on', true);

do $$
begin
  if coalesce(current_setting('tajo.seed', true), '') <> 'on' then
    raise exception 'El seed se tiene que ejecutar entero de una vez (pegar todo el fichero y Run), no por partes.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Usuarios: deben existir en Auth. Gerencia pasa a admin; obra queda como empleado.
-- ============================================================================

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

-- Upsert por si los usuarios se crearon antes de la migración (sin trigger).
insert into public.perfiles (id, empresa_id, nombre, email, rol)
select u.id,
       '00000000-0000-0000-0000-000000000001',
       case lower(u.email)
         when 'gerencia@reformaslevante.es' then 'Laura Martí — Gerencia'
         else 'Toni Ferrer — Encargado'
       end,
       lower(u.email),
       case lower(u.email)
         when 'gerencia@reformaslevante.es' then 'admin'
         else 'empleado'
       end
  from auth.users u
 where lower(u.email) in ('gerencia@reformaslevante.es', 'obra@reformaslevante.es')
on conflict (id) do update
   set empresa_id = excluded.empresa_id,
       nombre     = excluded.nombre,
       email      = excluded.email,
       rol        = excluded.rol;

-- ============================================================================
-- 2. Limpieza de datos de demo anteriores (solo de la empresa de demo)
-- ============================================================================

delete from public.facturas           where empresa_id = '00000000-0000-0000-0000-000000000001';
delete from public.presupuesto_lineas where empresa_id = '00000000-0000-0000-0000-000000000001';
delete from public.presupuestos       where empresa_id = '00000000-0000-0000-0000-000000000001';
delete from public.materiales         where empresa_id = '00000000-0000-0000-0000-000000000001';
delete from public.clientes           where empresa_id = '00000000-0000-0000-0000-000000000001';
delete from public.contadores         where empresa_id = '00000000-0000-0000-0000-000000000001';

-- ============================================================================
-- 3. Clientes
-- ============================================================================

insert into public.clientes (id, empresa_id, nombre, telefono, email, direccion, notas, created_at)
select v.id, '00000000-0000-0000-0000-000000000001', v.nombre, v.telefono, v.email, v.direccion, v.notas,
       now() - make_interval(days => v.dias)
  from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'Carmen Puig Soler', '600 112 233', 'carmen.puig@gmail.com',
     'C/ de Sueca 34, 3º 6ª, 46006 Valencia', 'Piso en Russafa. Mejor llamar por la tarde.', 70),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'Vicent Llorens Martí', '646 221 908', 'vllorens@hotmail.com',
     'C/ del Doctor Sumsi 12, 4º, 46005 Valencia', null, 66),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'Comunidad de Propietarios Blasco Ibáñez 88', '963 600 144', 'admin.blascoibanez88@gmail.com',
     'Av. de Blasco Ibáñez 88, 46021 Valencia', 'Trato con el administrador de fincas. Obras en horario de 9 a 14.', 6),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'Amparo Ferrandis Gil', '655 340 127', 'amparo.ferrandis@gmail.com',
     'C/ Major 21, 46900 Torrent', 'Persona mayor: plato de ducha a ras de suelo.', 48),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'Josep Ribes Navarro', '678 905 412', 'josepribes@yahoo.es',
     'C/ del Progrés 8, 46011 Valencia', 'Casa en el Cabanyal. Tiene perro, avisar antes de entrar.', 3),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'Arrocería El Racó S.L.', '961 203 456', 'arroceriaelraco@gmail.com',
     'C/ de la Reina 73, 46011 Valencia', 'Solo pueden cerrar el local los lunes.', 50),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'María José Sanchis Pons', '699 018 773', 'mjsanchis@gmail.com',
     'C/ de Cuba 17, 2º 3ª, 46006 Valencia', null, 42),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'Pedro Alcañiz Romero', '627 444 190', 'pedro.alcaniz@outlook.es',
     'C/ Camí Real 15, 46470 Catarroja', 'Quiere hacer la obra antes de Navidad.', 28),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'Lucía Esteve Baixauli', '644 778 021', 'lucia.esteve@gmail.com',
     'Av. de França 30, 7º 14ª, 46023 Valencia', 'Piso recién comprado, vacío. Llaves en portería.', 12),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'Clínica Dental Benimaclet S.L.P.', '963 412 980', 'clinicadentalbenimaclet@gmail.com',
     'C/ d’Emili Baró 50, 46020 Valencia', 'Trabajos fuera del horario de consulta (después de las 20 h).', 30)
  ) as v(id, nombre, telefono, email, direccion, notas, dias);

-- ============================================================================
-- 4. Materiales (precios en céntimos). Bajo mínimo: azulejo blanco, mampara y cemento cola.
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
-- 5. Presupuestos (últimos 60 días). Se insertan por fecha para que el trigger
--    los numere en orden con siguiente_numero(): P-AAAA-0001, 0002...
--    Los facturados se fechan respecto al mes actual y al anterior.
-- ============================================================================

with ref as (
  select date_trunc('month', now())                                              as mes,
         date_trunc('month', now()) - interval '1 month'                         as mes_ant,
         greatest(date_trunc('month', now()), date_trunc('day', now()) - interval '1 day') as f4
)
insert into public.presupuestos
  (id, empresa_id, cliente_id, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at)
select v.id, '00000000-0000-0000-0000-000000000001', v.cliente_id, v.titulo, v.estado, v.iva_pct, v.validez_dias,
       v.created_at, v.enviado_at, v.aceptado_at
  from ref
 cross join lateral (values
    -- facturado · factura el mes anterior
    ('30000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid,
     'Reforma completa de baño', 'facturado', 10, 30,
     ref.mes_ant + interval '2 days 9 hours', ref.mes_ant + interval '3 days 12 hours', ref.mes_ant + interval '6 days 18 hours'),
    -- facturado · factura el mes anterior
    ('30000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000002'::uuid,
     'Pintura de piso de 90 m²', 'facturado', 10, 30,
     ref.mes_ant + interval '8 days 10 hours', ref.mes_ant + interval '9 days 11 hours', ref.mes_ant + interval '12 days 20 hours'),
    -- rechazado
    ('30000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000006'::uuid,
     'Alicatado de la cocina del restaurante', 'rechazado', 21, 15,
     now() - interval '45 days', now() - interval '43 days', null::timestamptz),
    -- aceptado (listo para facturar)
    ('30000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000007'::uuid,
     'Reforma de cocina', 'aceptado', 10, 30,
     now() - interval '40 days', now() - interval '38 days', now() - interval '10 days'),
    -- facturado · factura este mes (día 1)
    ('30000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
     'Cambio de bañera por plato de ducha', 'facturado', 10, 30,
     ref.mes - interval '14 days' + interval '10 hours', ref.mes - interval '13 days' + interval '12 hours', ref.mes - interval '3 days' + interval '17 hours'),
    -- facturado · factura este mes (ayer o día 1)
    ('30000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
     'Tabique de pladur para nuevo gabinete', 'facturado', 21, 30,
     ref.f4 - interval '20 days' + interval '9 hours', ref.f4 - interval '18 days' + interval '13 hours', ref.f4 - interval '5 days' + interval '19 hours'),
    -- aceptado (listo para facturar)
    ('30000000-0000-4000-8000-000000000007'::uuid, '10000000-0000-4000-8000-000000000008'::uuid,
     'Cambio de ventanas a PVC', 'aceptado', 10, 30,
     now() - interval '26 days', now() - interval '24 days', now() - interval '3 days'),
    -- enviado (pendiente de respuesta)
    ('30000000-0000-4000-8000-000000000008'::uuid, '10000000-0000-4000-8000-000000000009'::uuid,
     'Reforma integral de piso', 'enviado', 10, 30,
     now() - interval '9 days', now() - interval '7 days', null::timestamptz),
    -- enviado (pendiente de respuesta)
    ('30000000-0000-4000-8000-000000000009'::uuid, '10000000-0000-4000-8000-000000000003'::uuid,
     'Reparación de humedades y pintura del zaguán', 'enviado', 21, 30,
     now() - interval '5 days', now() - interval '4 days', null::timestamptz),
    -- borrador
    ('30000000-0000-4000-8000-000000000010'::uuid, '10000000-0000-4000-8000-000000000005'::uuid,
     'Baño de cortesía en planta baja', 'borrador', 10, 30,
     now() - interval '2 days', null::timestamptz, null::timestamptz),
    -- borrador
    ('30000000-0000-4000-8000-000000000011'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
     'Pintura de la sala de espera', 'borrador', 21, 30,
     now() - interval '1 day', null::timestamptz, null::timestamptz)
  ) as v(id, cliente_id, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at)
 order by v.created_at;

-- ============================================================================
-- 6. Partidas (algunas vinculadas a materiales)
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
-- 7. Facturas de los 4 presupuestos facturados (2 el mes anterior, 2 este mes).
--    No se usa facturar_presupuesto() porque en el SQL Editor no hay sesión: se insertan
--    directamente con los mismos totales (totales_presupuesto) y numeradas por fecha
--    con siguiente_numero(): F-AAAA-0001...
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select p.id, p.empresa_id, p.cliente_id, f.fecha
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
      join public.presupuestos p on p.id = f.presupuesto_id
     order by f.fecha, p.created_at
  loop
    insert into public.facturas
      (empresa_id, presupuesto_id, cliente_id, numero, fecha, base_cents, iva_cents, total_cents, created_at)
    select r.empresa_id,
           r.id,
           r.cliente_id,
           public.siguiente_numero(r.empresa_id, 'F'),
           r.fecha,
           t.base_cents,
           t.iva_cents,
           t.total_cents,
           least((r.fecha + interval '10 hours')::timestamptz, now())
      from public.totales_presupuesto(r.id) t;
  end loop;
end;
$$;

-- Fin del modo seed (caducaría igual al acabar la transacción).
select set_config('tajo.seed', 'off', true);
