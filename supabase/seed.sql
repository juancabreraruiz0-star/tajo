-- Tajo · seed.sql — datos de demo de Reformas Levante S.L. y de una segunda empresa para comprobar el aislamiento.
-- Cómo se ejecuta:
--   1) Aplicar, en este orden, en el SQL Editor (rol postgres): migrations/0001_esquema.sql →
--      migrations/0002_reglas.sql → migrations/0003_guardar_presupuesto.sql → migrations/0004_auditoria.sql →
--      migrations/0005_uso_ia.sql → migrations/0006_obras.sql → migrations/0007_auditoria2.sql →
--      migrations/0008_auditoria3.sql → migrations/0009_ia_cache.sql → migrations/0010_ia_cache_autor.sql.
--   2) Crear en Authentication → Add user a gerencia@reformaslevante.es y obra@reformaslevante.es (si no existen).
--   3) SQL Editor → pegar este fichero entero → Run (el SQL Editor lo ejecuta todo en una sola transacción).
-- Es reejecutable: borra antes los datos de demo de las dos empresas (también obras y partes) y reinicia su
-- numeración.
-- Alta por invitación (D9, D12): este fichero invita a los dos emails de demo y deja sus invitaciones marcadas como
-- usadas (ya tienen perfil). Un usuario que se dé de alta en Auth sin invitación no tiene perfil y no puede entrar.

-- ============================================================================
-- 0. Modo seed: los triggers no bloquean en esta transacción. Hace falta porque el seed borra partidas de
--    presupuestos ya enviados o facturados, inserta presupuestos directamente en su estado final, crea las
--    facturas con su numeración y fecha, y crea obras y partes con fechas pasadas. La marca solo cuenta si current_user = 'postgres' (0004) y
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
  if to_regclass('public.obras') is null then
    raise exception 'Falta aplicar migrations/0006_obras.sql antes del seed.';
  end if;
  if to_regprocedure('public.nif_valido(text)') is null then
    raise exception 'Falta aplicar migrations/0007_auditoria2.sql antes del seed.';
  end if;
  if to_regclass('public.presupuesto_aceptaciones') is null then
    raise exception 'Falta aplicar migrations/0008_auditoria3.sql antes del seed.';
  end if;
  if to_regclass('public.ia_propuestas') is null then
    raise exception 'Falta aplicar migrations/0009_ia_cache.sql antes del seed.';
  end if;
  if to_regprocedure('public.ia_propuesta_sustituible(uuid)') is null then
    raise exception 'Falta aplicar migrations/0010_ia_cache_autor.sql antes del seed.';
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
-- 1. Empresas: CIF de demo con dígito de control correcto y coste de una hora de mano de obra (D11: se copia en
--    cada parte). La segunda empresa no tiene usuarios: solo sirve para comprobar que nadie de Reformas Levante ve sus
--    datos (npm run test:db).
-- ============================================================================

update public.empresas
   set cif              = 'B12345674',
       coste_hora_cents = 2600
 where id = '00000000-0000-0000-0000-000000000001';

insert into public.empresas (id, nombre, cif, direccion, telefono, email, coste_hora_cents)
values (
  '00000000-0000-0000-0000-000000000002',
  'Construcciones Ajenas S.L.',
  'B30516249',
  'Gran Vía Escultor Salzillo 9, 30004 Murcia',
  '968 000 111',
  'info@construccionesajenas.es',
  2500
)
on conflict (id) do update
   set nombre           = excluded.nombre,
       cif              = excluded.cif,
       direccion        = excluded.direccion,
       telefono         = excluded.telefono,
       email            = excluded.email,
       coste_hora_cents = excluded.coste_hora_cents;

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

-- Sus invitaciones quedan usadas (0007): ya no darían perfil a otro usuario con el mismo email.
update public.invitaciones i
   set usada_at = coalesce(i.usada_at, now())
 where i.email in ('gerencia@reformaslevante.es', 'obra@reformaslevante.es')
   and exists (select 1 from public.perfiles p where lower(p.email) = i.email);

-- ============================================================================
-- 3. Limpieza de datos de demo anteriores (solo de las dos empresas de demo).
--    Las partidas de las facturas se borran en cascada con su factura. Antes, obras y partes (dependen de los
--    presupuestos y de los materiales).
-- ============================================================================

delete from public.parte_materiales
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.partes
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.obras
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.facturas
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
-- Propuestas de IA guardadas (0009): sus claves dependen del almacén, que el seed vuelve a crear.
delete from public.ia_propuestas
 where empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from public.presupuesto_aceptaciones
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
-- 4. Clientes (con NIF o CIF de demo, con su letra o dígito de control calculado; se comprueba en la sección 12).
--    Contacto ficticio (D13): correos en example.com (reservado, RFC 2606) y teléfonos del rango que Ofcom reserva
--    para ficción (+44 7700 900xxx móviles, +44 20 7946 0xxx fijos): no son de nadie, así que «Enviar por WhatsApp»
--    no abre el chat de una persona real.
-- ============================================================================

insert into public.clientes (id, empresa_id, nombre, nif, telefono, email, direccion, notas, created_at)
select v.id, '00000000-0000-0000-0000-000000000001', v.nombre, v.nif, v.telefono, v.email, v.direccion, v.notas,
       now() - make_interval(days => v.dias)
  from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'Carmen Puig Soler', '20481537Z', '+44 7700 900101', 'carmen.puig@example.com',
     'C/ de Sueca 34, 3º 6ª, 46006 Valencia', 'Piso en Russafa. Mejor llamar por la tarde.', 70),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'Vicent Llorens Martí', '29176054W', '+44 7700 900102', 'vllorens@example.com',
     'C/ del Doctor Sumsi 12, 4º, 46005 Valencia', null, 66),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'Comunidad de Propietarios Blasco Ibáñez 88', 'H96381272', '+44 20 7946 0103', 'admin.blascoibanez88@example.com',
     'Av. de Blasco Ibáñez 88, 46021 Valencia', 'Trato con el administrador de fincas. Obras en horario de 9 a 14.', 6),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'Amparo Ferrandis Gil', '44859213J', '+44 7700 900104', 'amparo.ferrandis@example.com',
     'C/ Major 21, 46900 Torrent', 'Persona mayor: plato de ducha a ras de suelo.', 48),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'Josep Ribes Navarro', '73562180S', '+44 7700 900105', 'josepribes@example.com',
     'C/ del Progrés 8, 46011 Valencia', 'Casa en el Cabanyal. Tiene perro, avisar antes de entrar.', 3),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'Arrocería El Racó S.L.', 'B96452131', '+44 20 7946 0106', 'arroceriaelraco@example.com',
     'C/ de la Reina 73, 46011 Valencia', 'Solo pueden cerrar el local los lunes.', 50),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'María José Sanchis Pons', '48291736Q', '+44 7700 900107', 'mjsanchis@example.com',
     'C/ de Cuba 17, 2º 3ª, 46006 Valencia', null, 42),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'Pedro Alcañiz Romero', '24670395C', '+44 7700 900108', 'pedro.alcaniz@example.com',
     'C/ Camí Real 15, 46470 Catarroja', 'Quiere hacer la obra antes de Navidad.', 28),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'Lucía Esteve Baixauli', '53018947Z', '+44 7700 900109', 'lucia.esteve@example.com',
     'Av. de França 30, 7º 14ª, 46023 Valencia', 'Piso recién comprado, vacío. Llaves en portería.', 12),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'Clínica Dental Benimaclet S.L.P.', 'B97183420', '+44 20 7946 0110', 'clinicadentalbenimaclet@example.com',
     'C/ d’Emili Baró 50, 46020 Valencia', 'Trabajos fuera del horario de consulta (después de las 20 h).', 30)
  ) as v(id, nombre, nif, telefono, email, direccion, notas, dias);

-- ============================================================================
-- 5. Materiales: precio de venta y coste para la empresa (65–70 % del precio; es el que copian los partes de obra),
--    en céntimos. Bajo mínimo: azulejo blanco, mampara y cemento cola.
-- ============================================================================

insert into public.materiales (id, empresa_id, nombre, unidad, precio_cents, coste_cents, stock, stock_minimo)
select v.id, '00000000-0000-0000-0000-000000000001', v.nombre, v.unidad, v.precio_cents, v.coste_cents, v.stock, v.stock_minimo
  from (values
    ('20000000-0000-4000-8000-000000000001'::uuid, 'Azulejo porcelánico 60x60 gris',              'm²',    2450,  1590,  85::numeric, 40::numeric),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'Azulejo cerámico blanco 30x60 (revestimiento)', 'm²',  1290,   840,  18,  30),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'Plato de ducha de resina 140x80 blanco',       'ud',   18900, 12900,   4,   2),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'Mampara de ducha fija 120 cm, vidrio 6 mm',    'ud',   24500, 16900,   1,   2),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'Grifo termostático de ducha cromado',          'ud',   13900,  9450,   6,   3),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'Grifo monomando de lavabo',                    'ud',    5490,  3600,   9,   4),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'Pintura plástica blanca mate 15 L',            'cubo',  4850,  3150,  22,  10),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'Cemento cola C2TE gris 25 kg',                 'saco',  1150,   760,   7,  15),
    ('20000000-0000-4000-8000-000000000009'::uuid, 'Placa de pladur 13 mm 120x250',                'ud',     890,   590,  60,  25),
    ('20000000-0000-4000-8000-000000000010'::uuid, 'Tubo multicapa 16 mm',                         'm',      185,   120, 240, 100),
    ('20000000-0000-4000-8000-000000000011'::uuid, 'Ventana PVC oscilobatiente 120x120',           'ud',   38500, 26500,   3,   1),
    ('20000000-0000-4000-8000-000000000012'::uuid, 'Encimera de cuarzo blanco 2 cm',               'ml',   21000, 14500,   6,   2)
  ) as v(id, nombre, unidad, precio_cents, coste_cents, stock, stock_minimo);

-- ============================================================================
-- 6. Presupuestos (últimos 60 días). El número se calcula aquí por año de creación (hora de Madrid) y orden de
--    fecha: así, en enero, un presupuesto creado en diciembre lleva el número del año anterior (P-2026-…) y no el
--    del año en curso. Los contadores se ajustan en la sección 9.
--    Aceptados y facturados: por el enlace del cliente, salvo «Cambio de ventanas», que gerencia dio por aceptado
--    por teléfono (aceptado_canal = 'interno').
--    Evidencia (D12, D13): quién lo envió (enviado_por: gerencia u obra, con la copia de su nombre en
--    enviado_por_nombre) y, en los aceptados por el enlace, el nombre que escribió el cliente (el suyo) y, en
--    presupuesto_aceptaciones, la IP (direcciones reservadas para ejemplos, RFC 5737) y el navegador.
-- ============================================================================

with ref as (
  select date_trunc('month', now())                                              as mes,
         date_trunc('month', now()) - interval '1 month'                         as mes_ant,
         greatest(date_trunc('month', now()), date_trunc('day', now()) - interval '1 day') as f4
),
gerencia as (
  select u.id from auth.users u where lower(u.email) = 'gerencia@reformaslevante.es'
),
obra as (
  select u.id from auth.users u where lower(u.email) = 'obra@reformaslevante.es'
),
datos as (
  select v.*
    from ref
   cross join lateral (values
      -- facturado · factura el mes anterior
      ('30000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid,
       'Reforma completa de baño', 'facturado', 10, 30,
       ref.mes_ant + interval '2 days 9 hours', ref.mes_ant + interval '3 days 12 hours', ref.mes_ant + interval '6 days 18 hours', 'enlace',
       'gerencia', '203.0.113.24', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
      -- facturado · factura el mes anterior
      ('30000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000002'::uuid,
       'Pintura de piso de 90 m²', 'facturado', 10, 30,
       ref.mes_ant + interval '8 days 10 hours', ref.mes_ant + interval '9 days 11 hours', ref.mes_ant + interval '12 days 20 hours', 'enlace',
       'gerencia', '198.51.100.7', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'),
      -- rechazado
      ('30000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000006'::uuid,
       'Alicatado de la cocina del restaurante', 'rechazado', 21, 15,
       now() - interval '45 days', now() - interval '43 days', null::timestamptz, null::text,
       'obra', null::text, null::text),
      -- aceptado (listo para facturar)
      ('30000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000007'::uuid,
       'Reforma de cocina', 'aceptado', 10, 30,
       now() - interval '40 days', now() - interval '38 days', now() - interval '10 days', 'enlace',
       'obra', '203.0.113.81', 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'),
      -- facturado · factura este mes (día 1)
      ('30000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
       'Cambio de bañera por plato de ducha', 'facturado', 10, 30,
       ref.mes - interval '14 days' + interval '10 hours', ref.mes - interval '13 days' + interval '12 hours', ref.mes - interval '3 days' + interval '17 hours', 'enlace',
       'gerencia', '198.51.100.140', 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'),
      -- facturado · factura este mes (ayer o día 1)
      ('30000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
       'Tabique de pladur para nuevo gabinete', 'facturado', 21, 30,
       ref.f4 - interval '20 days' + interval '9 hours', ref.f4 - interval '18 days' + interval '13 hours', ref.f4 - interval '5 days' + interval '19 hours', 'enlace',
       'gerencia', '192.0.2.55', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'),
      -- aceptado por gerencia (interno), listo para facturar
      ('30000000-0000-4000-8000-000000000007'::uuid, '10000000-0000-4000-8000-000000000008'::uuid,
       'Cambio de ventanas a PVC', 'aceptado', 10, 30,
       now() - interval '26 days', now() - interval '24 days', now() - interval '3 days', 'interno',
       'gerencia', null::text, null::text),
      -- enviado (pendiente de respuesta)
      ('30000000-0000-4000-8000-000000000008'::uuid, '10000000-0000-4000-8000-000000000009'::uuid,
       'Reforma integral de piso', 'enviado', 10, 30,
       now() - interval '9 days', now() - interval '7 days', null::timestamptz, null::text,
       'gerencia', null::text, null::text),
      -- enviado (pendiente de respuesta)
      ('30000000-0000-4000-8000-000000000009'::uuid, '10000000-0000-4000-8000-000000000003'::uuid,
       'Reparación de humedades y pintura del zaguán', 'enviado', 21, 30,
       now() - interval '5 days', now() - interval '4 days', null::timestamptz, null::text,
       'obra', null::text, null::text),
      -- borrador
      ('30000000-0000-4000-8000-000000000010'::uuid, '10000000-0000-4000-8000-000000000005'::uuid,
       'Baño de cortesía en planta baja', 'borrador', 10, 30,
       now() - interval '2 days', null::timestamptz, null::timestamptz, null::text,
       null::text, null::text, null::text),
      -- borrador
      ('30000000-0000-4000-8000-000000000011'::uuid, '10000000-0000-4000-8000-000000000010'::uuid,
       'Pintura de la sala de espera', 'borrador', 21, 30,
       now() - interval '1 day', null::timestamptz, null::timestamptz, null::text,
       null::text, null::text, null::text)
    ) as v(id, cliente_id, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at, aceptado_canal,
           enviado_por, aceptado_ip, aceptado_user_agent)
),
numerados as (
  select d.*,
         extract(year from (d.created_at at time zone 'Europe/Madrid'))::integer as anio,
         row_number() over (
           partition by extract(year from (d.created_at at time zone 'Europe/Madrid'))
           order by d.created_at, d.id
         ) as orden_anio
    from datos d
),
insertados as (
  insert into public.presupuestos
    (id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at,
     aceptado_canal, aceptado_por, enviado_por, enviado_por_nombre, aceptado_nombre)
  select n.id, '00000000-0000-0000-0000-000000000001', n.cliente_id,
         'P-' || n.anio || '-' || lpad(n.orden_anio::text, 4, '0'),
         n.titulo, n.estado, n.iva_pct, n.validez_dias, n.created_at, n.enviado_at, n.aceptado_at,
         n.aceptado_canal,
         case when n.aceptado_canal = 'interno' then (select g.id from gerencia g) end,
         e.id,
         pf.nombre,
         case when n.aceptado_canal = 'enlace' then c.nombre end
    from numerados n
    join public.clientes c on c.id = n.cliente_id
    cross join lateral (
      select case n.enviado_por
               when 'gerencia' then (select g.id from gerencia g)
               when 'obra'     then (select o.id from obra o)
             end as id
    ) e
    left join public.perfiles pf on pf.id = e.id
  returning id
)
insert into public.presupuesto_aceptaciones (presupuesto_id, empresa_id, ip, user_agent, created_at)
select n.id, '00000000-0000-0000-0000-000000000001', n.aceptado_ip, n.aceptado_user_agent, n.aceptado_at
  from numerados n
  join insertados i on i.id = n.id
 where n.aceptado_canal = 'enlace';

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
-- 9. Segunda empresa (Construcciones Ajenas S.L.): un cliente, un presupuesto enviado y otro aceptado (con su obra en
--    la sección 10, para comprobar el aislamiento de obras y partes), sin usuarios.
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

-- Aceptado por el enlace (con el nombre del cliente, IP y navegador). Número: el siguiente del año de su creación (el
-- 0001 si el anterior es del año pasado).
insert into public.presupuestos
  (id, empresa_id, cliente_id, numero, titulo, estado, iva_pct, validez_dias, created_at, enviado_at, aceptado_at,
   aceptado_canal, aceptado_nombre)
select '30000000-0000-4000-8000-000000000102',
       '00000000-0000-0000-0000-000000000002',
       '10000000-0000-4000-8000-000000000101',
       'P-' || a.anio || '-' || case when a.anio = b.anio then '0002' else '0001' end,
       'Impermeabilización de cubierta',
       'aceptado',
       21,
       30,
       now() - interval '2 days',
       now() - interval '2 days' + interval '1 hour',
       now() - interval '1 day',
       'enlace',
       'Promociones del Segura S.A.'
  from (select extract(year from ((now() - interval '2 days') at time zone 'Europe/Madrid'))::integer as anio) a,
       (select extract(year from ((now() - interval '3 days') at time zone 'Europe/Madrid'))::integer as anio) b;

insert into public.presupuesto_aceptaciones (presupuesto_id, empresa_id, ip, user_agent, created_at)
values (
  '30000000-0000-4000-8000-000000000102',
  '00000000-0000-0000-0000-000000000002',
  '198.51.100.201',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  now() - interval '1 day'
);

insert into public.presupuesto_lineas
  (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents, material_id)
values
  ('00000000-0000-0000-0000-000000000002', '30000000-0000-4000-8000-000000000102', 1,
   'Impermeabilización con lámina asfáltica (m²)', 120, 2800, null);

-- ============================================================================
-- 10. Obras (D11): una por presupuesto aceptado o facturado, con Toni (obra@) de encargado, y sus partes de trabajo
--     con horas y materiales. Coste por hora y de cada material copiados como lo hace la base de datos al crear un
--     parte (26 €/h en Reformas Levante; coste del material de la sección 5).
--     Semáforo (consumido = coste real / base del presupuesto):
--       · Reforma completa de baño (76,2 %), pintura del piso (67,2 %) y tabique de pladur (71,4 %): terminadas, verde.
--       · Cambio de bañera por plato de ducha (93,7 %): terminada, ámbar; apareció una fuga en la bajante.
--       · Reforma de cocina (112,4 %): en curso y en rojo, en pérdidas; la instalación de agua estaba peor de lo previsto
--         y lleva bastantes más horas de las presupuestadas.
--       · Cambio de ventanas: pendiente, a la espera de las ventanas a medida (sin partes).
--     Segunda empresa: solo la obra de su presupuesto aceptado, en curso y con un parte sin autor (no tiene usuarios).
--     Fechas en hora de Madrid: las terminadas, a partir del día de aceptación de su presupuesto; las vivas, a partir
--     de hoy. Ningún parte queda en el futuro ni registrado hoy (created_at a las 18:30 de su fecha).
-- ============================================================================

with hoy as (
  select (now() at time zone 'Europe/Madrid')::date as d
),
toni as (
  select p.id from public.perfiles p
   where p.email = 'obra@reformaslevante.es'
     and p.empresa_id = '00000000-0000-0000-0000-000000000001'
),
datos as (
  select v.*
    from (values
      -- id, presupuesto, estado, base de las fechas, inicio, fin prevista, fin real (días desde la base), notas
      ('40000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 'terminada',
       'aceptado', 1, 4, 3::integer, 'Entregada sin incidencias. La clienta quedó contenta con la mampara.'),
      ('40000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 'terminada',
       'aceptado', 1, 4, 3, null::text),
      ('40000000-0000-4000-8000-000000000005'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 'terminada',
       'aceptado', 1, 2, 2, 'Al quitar la bañera apareció una fuga en la bajante: hubo que cambiar el tramo. Margen muy justo.'),
      ('40000000-0000-4000-8000-000000000006'::uuid, '30000000-0000-4000-8000-000000000006'::uuid, 'terminada',
       'aceptado', 1, 3, 3, 'Trabajos por la tarde, fuera del horario de consulta.'),
      ('40000000-0000-4000-8000-000000000004'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, 'en_curso',
       'hoy', -9, 4, null, 'La instalación de agua estaba en peor estado de lo previsto y se ha cambiado entera. Vigilar las horas: ya vamos por encima de lo presupuestado.'),
      ('40000000-0000-4000-8000-000000000007'::uuid, '30000000-0000-4000-8000-000000000007'::uuid, 'pendiente',
       'hoy', 3, 5, null, 'Pendiente de que el proveedor sirva las ventanas a medida.'),
      ('40000000-0000-4000-8000-000000000102'::uuid, '30000000-0000-4000-8000-000000000102'::uuid, 'en_curso',
       'hoy', -1, 10, null, 'Dato de otra empresa: Reformas Levante no debe verlo nunca.')
    ) as v(id, presupuesto_id, estado, base, inicio, fin_prevista, fin, notas)
)
insert into public.obras
  (id, empresa_id, presupuesto_id, cliente_id, titulo, encargado_id, estado, fecha_inicio, fecha_fin_prevista, fecha_fin,
   notas, created_at)
select d.id, p.empresa_id, p.id, p.cliente_id, p.titulo,
       case when p.empresa_id = '00000000-0000-0000-0000-000000000001' then (select t.id from toni t) end,
       d.estado,
       b.base + d.inicio,
       b.base + d.fin_prevista,
       b.base + d.fin,
       d.notas,
       p.aceptado_at
  from datos d
  join public.presupuestos p on p.id = d.presupuesto_id
 cross join hoy
 cross join lateral (
   select case d.base when 'hoy' then hoy.d else (p.aceptado_at at time zone 'Europe/Madrid')::date end as base
 ) b;

with hoy as (
  select (now() at time zone 'Europe/Madrid')::date as d
),
toni as (
  select p.id from public.perfiles p
   where p.email = 'obra@reformaslevante.es'
     and p.empresa_id = '00000000-0000-0000-0000-000000000001'
),
datos as (
  select v.*
    from (values
      -- id, presupuesto, día (desde la aceptación o desde hoy, según la obra), horas de la cuadrilla, notas
      -- Reforma completa de baño · 44 h
      ('50000000-0000-4000-8000-000000000101'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 1, 16::numeric,
       'Demolición del alicatado y retirada de sanitarios (2 operarios).'),
      ('50000000-0000-4000-8000-000000000102'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 2, 16,
       'Alicatado de paredes.'),
      ('50000000-0000-4000-8000-000000000103'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 3, 12,
       'Solado, plato de ducha y mampara.'),
      -- Pintura de piso · 48 h
      ('50000000-0000-4000-8000-000000000201'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 1, 16,
       'Protección de suelos y muebles; reparación de grietas.'),
      ('50000000-0000-4000-8000-000000000202'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 2, 16,
       'Primera mano en paredes y techos.'),
      ('50000000-0000-4000-8000-000000000203'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 3, 16,
       'Segunda mano y limpieza final.'),
      -- Cambio de bañera por plato de ducha · 32 h
      ('50000000-0000-4000-8000-000000000501'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 1, 16,
       'Retirada de la bañera. Fuga en la bajante: cambio del tramo, no estaba previsto.'),
      ('50000000-0000-4000-8000-000000000502'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 2, 16,
       'Plato de ducha, grifo termostático y reposición del alicatado.'),
      -- Tabique de pladur · 24 h
      ('50000000-0000-4000-8000-000000000601'::uuid, '30000000-0000-4000-8000-000000000006'::uuid, 1, 6,
       'Replanteo y perfilería.'),
      ('50000000-0000-4000-8000-000000000602'::uuid, '30000000-0000-4000-8000-000000000006'::uuid, 2, 12,
       'Placas de pladur, aislamiento y tratamiento de juntas.'),
      ('50000000-0000-4000-8000-000000000603'::uuid, '30000000-0000-4000-8000-000000000006'::uuid, 3, 6,
       'Pintura del tabique a dos caras.'),
      -- Reforma de cocina (en curso) · 58 h hasta ayer
      ('50000000-0000-4000-8000-000000000401'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -9, 12,
       'Desmontaje de la cocina antigua y retirada de escombros.'),
      ('50000000-0000-4000-8000-000000000402'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -8, 10,
       'Rozas para la nueva toma de agua: la instalación antigua estaba podrida.'),
      ('50000000-0000-4000-8000-000000000403'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -7, 10,
       'Cambio del tramo de tubería hasta el contador. No estaba en el presupuesto.'),
      ('50000000-0000-4000-8000-000000000404'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -6, 6,
       'Remates de albañilería tras la fontanería.'),
      ('50000000-0000-4000-8000-000000000405'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -3, 8,
       'Alicatado del frontal.'),
      ('50000000-0000-4000-8000-000000000406'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -2, 6,
       'Montaje de los muebles bajos.'),
      ('50000000-0000-4000-8000-000000000407'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, -1, 6,
       'Colocación de la encimera y ajustes.'),
      -- Segunda empresa · sin autor (no tiene usuarios)
      ('50000000-0000-4000-8000-000000010201'::uuid, '30000000-0000-4000-8000-000000000102'::uuid, -1, 8,
       'Dato de otra empresa: Reformas Levante no debe verlo nunca.')
    ) as v(id, presupuesto_id, dia, horas, notas)
)
insert into public.partes (id, empresa_id, obra_id, fecha, autor_id, horas, coste_hora_cents, notas, created_at)
select d.id, o.empresa_id, o.id, f.fecha,
       case when o.empresa_id = '00000000-0000-0000-0000-000000000001' then (select t.id from toni t) end,
       d.horas, e.coste_hora_cents, d.notas,
       least((f.fecha + time '18:30') at time zone 'Europe/Madrid', now() - interval '1 day')
  from datos d
  join public.obras o        on o.presupuesto_id = d.presupuesto_id
  join public.presupuestos p on p.id = o.presupuesto_id
  join public.empresas e     on e.id = o.empresa_id
 cross join hoy
 cross join lateral (
   select least(
            case when o.estado = 'terminada' then (p.aceptado_at at time zone 'Europe/Madrid')::date else hoy.d end + d.dia,
            hoy.d
          ) as fecha
 ) f;

insert into public.parte_materiales
  (empresa_id, parte_id, material_id, material_nombre, unidad, cantidad, coste_unit_cents)
select pa.empresa_id, v.parte_id, v.material_id, m.nombre, m.unidad, v.cantidad, coalesce(m.coste_cents, m.precio_cents)
  from (values
    -- Reforma completa de baño
    ('50000000-0000-4000-8000-000000000102'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 26::numeric),
    ('50000000-0000-4000-8000-000000000102'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 5),
    ('50000000-0000-4000-8000-000000000103'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 6),
    ('50000000-0000-4000-8000-000000000103'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 1),
    ('50000000-0000-4000-8000-000000000103'::uuid, '20000000-0000-4000-8000-000000000004'::uuid, 1),
    -- Pintura de piso
    ('50000000-0000-4000-8000-000000000202'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 5),
    ('50000000-0000-4000-8000-000000000203'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 4),
    -- Cambio de bañera por plato de ducha
    ('50000000-0000-4000-8000-000000000501'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 3),
    ('50000000-0000-4000-8000-000000000502'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 1),
    ('50000000-0000-4000-8000-000000000502'::uuid, '20000000-0000-4000-8000-000000000005'::uuid, 1),
    -- Tabique de pladur
    ('50000000-0000-4000-8000-000000000602'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 15),
    ('50000000-0000-4000-8000-000000000603'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 2),
    -- Reforma de cocina
    ('50000000-0000-4000-8000-000000000402'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 18),
    ('50000000-0000-4000-8000-000000000403'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 12),
    ('50000000-0000-4000-8000-000000000404'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 2),
    ('50000000-0000-4000-8000-000000000405'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 7),
    ('50000000-0000-4000-8000-000000000407'::uuid, '20000000-0000-4000-8000-000000000012'::uuid, 3.2)
  ) as v(parte_id, material_id, cantidad)
  join public.partes pa     on pa.id = v.parte_id
  join public.materiales m  on m.empresa_id = pa.empresa_id and m.id = v.material_id;

-- ============================================================================
-- 11. Contadores de numeración: el último número usado por empresa, prefijo y año.
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
-- 12. Comprobaciones: NIF/CIF de demo con control correcto y avisos.
-- ============================================================================

do $$
declare
  v_mal text;
begin
  -- Mismo algoritmo que la app: nif_valido() de 0007 (a los clientes ya los ha comprobado su CHECK al insertarlos).
  select string_agg(format('%s (%s)', coalesce(x.nif, 'sin NIF'), x.nombre), ', ')
    into v_mal
    from (
      select c.nombre, c.nif from public.clientes c
       where c.empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
      union all
      select e.nombre, e.cif from public.empresas e
       where e.id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
    ) x
   where x.nif is null or not public.nif_valido(x.nif);
  if v_mal is not null then
    raise exception 'NIF/CIF de demo no válido: %.', v_mal;
  end if;
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

-- Obras: una por presupuesto aceptado o facturado y, en Reformas Levante, un caso de cada color del semáforo de
-- obras_resumen (verde < 80 %, ámbar 80–100 %, rojo > 100 %), como en src/lib/domain/obras.ts.
do $$
declare
  v_sin_obra text;
  v_colores  text;
begin
  select string_agg(p.numero, ', ')
    into v_sin_obra
    from public.presupuestos p
   where p.empresa_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
     and p.estado in ('aceptado', 'facturado')
     and not exists (select 1 from public.obras o where o.presupuesto_id = p.id);
  if v_sin_obra is not null then
    raise exception 'Presupuestos aceptados sin obra: %.', v_sin_obra;
  end if;

  select string_agg(s.color, ',' order by s.color)
    into v_colores
    from (
      select distinct r.semaforo as color
        from public.obras_resumen r
       where r.empresa_id = '00000000-0000-0000-0000-000000000001'
    ) s;
  if v_colores is distinct from 'ambar,rojo,verde' then
    raise exception 'Las obras de demo no tienen un caso de cada color del semáforo (hay: %).', coalesce(v_colores, 'ninguno');
  end if;
end;
$$;

-- Fin del modo seed (caducaría igual al acabar la transacción).
select set_config('tajo.seed', 'off', true);
