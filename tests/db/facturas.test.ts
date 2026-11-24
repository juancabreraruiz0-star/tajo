// Presupuestos y facturas: alta forzada, transiciones de estado (R9), partidas solo en borrador, límites, facturar
// (copia fija, NIF, stock, numeración) y facturas inmutables.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { budgetTotals } from "@/lib/domain/totals";
import { type Base, E1, GER, OBRA, SEED, bloqueado, codigo, crearBase, en, error, probar, ser, unaEn, valor } from "./andamio";

let base: Base;
beforeAll(async () => {
  base = await crearBase();
});
afterAll(() => base?.cerrar());

const partidas = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ orden: i + 1, descripcion: `P${i + 1}`, cantidad: 1, precio_cents: 100, material_id: null })));

describe("alta y transiciones", () => {
  it("al crear se ignoran estado, número, token, fechas y aceptación inventados", async () => {
    const r = await base.filas(
      OBRA,
      `insert into presupuestos (empresa_id, cliente_id, titulo, created_at, token, enviado_at, aceptado_canal, aceptado_por)
       values ($1, $2, 'Forjado', '2099-01-01', gen_random_uuid(), '2099-01-01', 'interno', $3)
       returning estado, numero, created_at > now() - interval '1 minute' as ahora, enviado_at, aceptado_canal, aceptado_por`,
      [E1, SEED.cliente(1), OBRA],
    );
    expect(valor(r)[0]).toMatchObject({ estado: "borrador", ahora: true, enviado_at: null, aceptado_canal: null, aceptado_por: null });
    expect(String(valor(r)[0].numero)).toMatch(/^P-\d{4}-\d{4}$/);
    expect(error(await base.filas(OBRA, "insert into presupuestos (empresa_id, cliente_id, titulo, numero) values ($1, $2, 'x', 'P-1-1')", [E1, SEED.cliente(1)]))).toMatch(/lo asigna el sistema/);
  });

  it("solo se permiten borrador → enviado → aceptado | rechazado y aceptado → facturado (al facturar)", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      const salto = error(await probar(tx, "update presupuestos set estado = 'aceptado' where id = $1", [SEED.presupuestoBorrador]));
      const atras = error(await probar(tx, "update presupuestos set estado = 'borrador' where id = $1", [SEED.presupuestoEnviado]));
      const rechazado = error(await probar(tx, "update presupuestos set estado = 'enviado' where id = $1", [SEED.presupuestoRechazado]));
      const facturado = error(await probar(tx, "update presupuestos set estado = 'facturado' where id = $1", [SEED.presupuestoCocina]));
      const titulo = error(await probar(tx, "update presupuestos set titulo = 'x' where id = $1", [SEED.presupuestoEnviado]));
      return { salto, atras, rechazado, facturado, titulo };
    });
    const x = valor(r);
    expect(x.salto).toMatch(/no permitido: de borrador a aceptado/);
    expect(x.atras).toMatch(/no permitido: de enviado a borrador/);
    expect(x.rechazado).toMatch(/no permitido: de rechazado a enviado/);
    expect(x.facturado).toMatch(/solo pasa a facturado/);
    expect(x.titulo).toMatch(/solo se pueden cambiar .* en borrador/i);
  });

  it("no se envía un presupuesto sin partidas; el empleado envía y rechaza, pero no da por aceptado", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const vacio = (await unaEn(tx, "insert into presupuestos (empresa_id, cliente_id, titulo) values ($1, $2, 'Vacío') returning id", [E1, SEED.cliente(1)])).id;
      const sinPartidas = error(await probar(tx, "update presupuestos set estado = 'enviado' where id = $1", [vacio]));
      const rechaza = await probar(tx, "update presupuestos set estado = 'rechazado' where id = $1 returning estado", [SEED.presupuestoEnviado2]);
      const acepta = error(await probar(tx, "update presupuestos set estado = 'aceptado' where id = $1", [SEED.presupuestoEnviado]));
      return { sinPartidas, rechaza: rechaza.ok, acepta };
    });
    expect(valor(r)).toEqual({
      sinPartidas: "Añade al menos una partida antes de enviar el presupuesto.",
      rechaza: true,
      acepta: "Solo gerencia puede dar por aceptado un presupuesto; el cliente lo acepta desde el enlace público.",
    });
  });

  it("gerencia da por aceptado: canal interno y aceptado_por = gerencia, que nadie cambia después", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      const a = await unaEn(tx, "update presupuestos set estado = 'aceptado', aceptado_por = $2 where id = $1 returning aceptado_canal, aceptado_por", [SEED.presupuestoEnviado, OBRA]);
      const cambiar = error(await probar(tx, "update presupuestos set aceptado_por = null where id = $1", [SEED.presupuestoEnviado]));
      const canal = error(await probar(tx, "update presupuestos set aceptado_canal = 'enlace' where id = $1", [SEED.presupuestoEnviado]));
      return { a, cambiar, canal };
    });
    const x = valor(r);
    expect(x.a).toEqual({ aceptado_canal: "interno", aceptado_por: GER });
    expect(x.cambiar).toMatch(/lo pone el sistema/);
    expect(x.canal).toMatch(/lo pone el sistema/);
  });
});

describe("partidas", () => {
  it("solo se tocan en borrador (ni moviéndolas a otro presupuesto)", async () => {
    for (const sql of [
      "update presupuesto_lineas set precio_cents = 1 where presupuesto_id = $1 returning id",
      "delete from presupuesto_lineas where presupuesto_id = $1 returning id",
    ]) {
      expect(bloqueado(await base.filas(GER, sql, [SEED.presupuestoEnviado])), sql).toBe(true);
    }
    expect(
      bloqueado(await base.filas(OBRA, "update presupuesto_lineas set presupuesto_id = $2 where presupuesto_id = $1 returning id", [SEED.presupuestoBorrador, SEED.presupuestoEnviado])),
    ).toBe(true);
    expect(valor(await base.filas(OBRA, "delete from presupuesto_lineas where presupuesto_id = $1 returning id", [SEED.presupuestoBorrador])).length).toBe(4);
  });

  it("como mucho 100 por presupuesto, por RPC y por insert directo", async () => {
    expect(error(await base.filas(OBRA, "select guardar_presupuesto(null, $1, 'x', 21, 30, $2::jsonb)", [SEED.cliente(1), partidas(101)]))).toMatch(/100 partidas/);
    const r = await base.como(OBRA, async (tx) => {
      const id = (await unaEn(tx, "select guardar_presupuesto(null, $1, 'x', 21, 30, $2::jsonb) as id", [SEED.cliente(1), partidas(100)])).id;
      return probar(tx, "insert into presupuesto_lineas (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents) values ($1, $2, 101, 'x', 1, 1)", [E1, id]);
    });
    expect(error(valor(r))).toMatch(/100 partidas/);
  });

  it("límites de la base: importe por partida, título, validez y cantidad máxima", async () => {
    const guardar = (titulo: string, validez: number, cantidad: number, precio: number) =>
      base.filas(OBRA, "select guardar_presupuesto(null, $1, $2, 21, $3, $4::jsonb)", [
        SEED.cliente(1),
        titulo,
        validez,
        JSON.stringify([{ orden: 1, descripcion: "x", cantidad, precio_cents: precio, material_id: null }]),
      ]);
    expect((await guardar("x", 30, 1000000000, 100)).ok).toBe(true);
    expect(codigo(await guardar("x", 30, 1000000000, 100000000))).toBe("23514");
    expect(codigo(await guardar("x".repeat(161), 30, 1, 1))).toBe("23514");
    expect(codigo(await guardar("x", 366, 1, 1))).toBe("23514");
  });

  it("la vista presupuestos_con_totales cuadra con budgetTotals() del dominio en todos los presupuestos", async () => {
    const vista = await base.q("select id, iva_pct, base_cents, iva_cents, total_cents, num_partidas from presupuestos_con_totales");
    const lineas = await base.q("select presupuesto_id, cantidad, precio_cents from presupuesto_lineas");
    for (const p of vista) {
      const suyas = lineas.filter((l) => l.presupuesto_id === p.id);
      const t = budgetTotals(suyas.map((l) => ({ cantidad: Number(l.cantidad), precioCents: Number(l.precio_cents) })), Number(p.iva_pct));
      expect([Number(p.base_cents), Number(p.iva_cents), Number(p.total_cents), Number(p.num_partidas)], String(p.id)).toEqual([
        t.baseCents,
        t.ivaCents,
        t.totalCents,
        suyas.length,
      ]);
    }
  });
});

describe("facturar", () => {
  const contador = () => base.q("select anio, ultimo from contadores where empresa_id = $1 and prefijo = 'F' order by anio", [E1]);

  it("solo gerencia; un cliente sin NIF da TJ001 sin gastar número ni cambiar el estado", async () => {
    expect(error(await base.filas(OBRA, "select facturar_presupuesto($1)", [SEED.presupuestoCocina]))).toMatch(/administrador/);
    const antes = await contador();
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      await en(tx, "update clientes set nif = null where id = (select cliente_id from presupuestos where id = $1)", [SEED.presupuestoCocina]);
      await ser(tx, GER);
      const f = await probar(tx, "select facturar_presupuesto($1)", [SEED.presupuestoCocina]);
      return { codigo: codigo(f), estado: (await unaEn(tx, "select estado from presupuestos where id = $1", [SEED.presupuestoCocina])).estado };
    });
    expect(valor(r)).toEqual({ codigo: "TJ001", estado: "aceptado" });
    expect(await contador()).toEqual(antes);
  });

  it("crea la copia fija con el siguiente número, descuenta stock y no se repite", async () => {
    const r = await base.como("postgres", async (tx) => {
      const stockAntes = await en(tx, "select id, stock::float as s from materiales where id in ($1, $2) order by id", [SEED.material(10), SEED.material(12)]);
      const ultimas = await en(tx, "select numero from facturas where empresa_id = $1 order by numero desc limit 1", [E1]);
      await ser(tx, GER);
      const id = (await unaEn(tx, "select facturar_presupuesto($1) as id", [SEED.presupuestoCocina])).id;
      const f = await unaEn(tx, "select numero, cliente_nif, empresa_cif, iva_pct, base_cents, total_cents from facturas where id = $1", [id]);
      const v = await unaEn(tx, "select base_cents, total_cents from presupuestos_con_totales where id = $1", [SEED.presupuestoCocina]);
      const lineas = await unaEn(tx, "select count(*)::int as n, sum(importe_cents)::bigint as s from factura_lineas where factura_id = $1", [id]);
      const otra = error(await probar(tx, "select facturar_presupuesto($1)", [SEED.presupuestoCocina]));
      await ser(tx, OBRA);
      await en(tx, "update clientes set nombre = 'Renombrada', nif = '12345678Z' where id = (select cliente_id from presupuestos where id = $1)", [SEED.presupuestoCocina]);
      await ser(tx, "postgres");
      const copia = await unaEn(tx, "select cliente_nombre, cliente_nif from facturas where id = $1", [id]);
      const stock = await en(tx, "select id, stock::float as s from materiales where id in ($1, $2) order by id", [SEED.material(10), SEED.material(12)]);
      return { stockAntes, ultimas, f, v, lineas, otra, copia, stock };
    });
    const x = valor(r);
    const [, anio, n] = String(x.ultimas[0].numero).split("-");
    expect(x.f.numero).toBe(`F-${anio}-${String(Number(n) + 1).padStart(4, "0")}`);
    expect(x.f).toMatchObject({ cliente_nif: "48291736Q", empresa_cif: "B12345674", iva_pct: 10 });
    expect(Number(x.f.total_cents)).toBe(Number(x.v.total_cents));
    expect(x.lineas.n).toBe(5);
    expect(Number(x.lineas.s)).toBe(Number(x.f.base_cents));
    expect(x.otra).toMatch(/Solo se pueden facturar presupuestos aceptados/);
    expect(x.copia).toEqual({ cliente_nombre: "María José Sanchis Pons", cliente_nif: "48291736Q" });
    expect(x.stock.map((m) => m.s)).toEqual([Number(x.stockAntes[0].s) - 18, Number(x.stockAntes[1].s) - 3.2]);
  });

  it("las facturas y sus partidas no se cambian ni se borran: ni gerencia ni el SQL Editor", async () => {
    for (const sql of [
      "update facturas set total_cents = 0 returning id",
      "delete from facturas returning id",
      "update factura_lineas set importe_cents = 0 returning id",
      "insert into factura_lineas (empresa_id, factura_id, orden, descripcion, cantidad, precio_cents, importe_cents) select empresa_id, id, 99, 'x', 1, 1, 1 from facturas limit 1 returning id",
    ]) {
      expect(bloqueado(await base.filas(GER, sql)), sql).toBe(true);
    }
    expect(error(await base.filas("postgres", "update facturas set total_cents = 0"))).toMatch(/no se puede modificar/);
    expect(error(await base.filas("postgres", "delete from facturas"))).toMatch(/no se puede borrar|restrict|violates/);
    expect(error(await base.filas("postgres", "update factura_lineas set importe_cents = 0"))).toMatch(/no se puede modificar/);
  });

  it("gerencia lee facturas con su copia y partidas que cuadran; el empleado, nada", async () => {
    const f = valor(await base.filas(GER, "select f.base_cents, f.cliente_nif, (select sum(importe_cents) from factura_lineas l where l.factura_id = f.id) as s from facturas f"));
    expect(f.length).toBe(4);
    expect(f.every((x) => x.cliente_nif && Number(x.s) === Number(x.base_cents))).toBe(true);
    expect(valor(await base.filas(OBRA, "select * from facturas"))).toEqual([]);
  });
});
