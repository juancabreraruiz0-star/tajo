// Obras y partes (0006 y 0007): alta automática al aceptar, quién cambia qué, partes con autor y costes copiados, obra
// terminada congelada y la vista obras_resumen frente a costesObra() del dominio. Lo nuevo de 0007 (24 h por día, 30
// días atrás, inicio fijo y semáforo para el empleado) está en auditoria2.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { costesObra } from "@/lib/domain/obras";
import {
  type Base,
  E1,
  E2,
  GER,
  OBRA,
  OBRA2,
  SEED,
  bloqueado,
  codigo,
  crearBase,
  en,
  error,
  hoyMadrid,
  probar,
  ser,
  unaEn,
  valor,
} from "./andamio";

let base: Base;
let hoy: string;
beforeAll(async () => {
  base = await crearBase();
  hoy = await hoyMadrid(base);
});
afterAll(() => base?.cerrar());

describe("alta y borrado de obras", () => {
  it("aceptar por el enlace o por gerencia crea una obra pendiente; rechazar no", async () => {
    const r = await base.como("postgres", async (tx) => {
      const t = (await unaEn(tx, "select token from presupuestos where id = $1", [SEED.presupuestoEnviado])).token;
      await ser(tx, "anon");
      await en(tx, "select aceptar_presupuesto($1, 'Lucía', null, null)", [t]);
      await ser(tx, GER);
      await en(tx, "update presupuestos set estado = 'aceptado' where id = $1", [SEED.presupuestoEnviado2]);
      await ser(tx, "postgres");
      return en(tx, "select presupuesto_id, estado, encargado_id from obras where presupuesto_id in ($1, $2) order by presupuesto_id", [
        SEED.presupuestoEnviado,
        SEED.presupuestoEnviado2,
      ]);
    });
    expect(valor(r)).toEqual([
      { presupuesto_id: SEED.presupuestoEnviado, estado: "pendiente", encargado_id: null },
      { presupuesto_id: SEED.presupuestoEnviado2, estado: "pendiente", encargado_id: null },
    ]);
    expect(await base.one("select count(*)::int as n from obras where presupuesto_id = $1", [SEED.presupuestoRechazado])).toEqual({ n: 0 });
  });

  it("nadie crea ni borra obras desde la API; el SQL Editor tampoco las borra", async () => {
    for (const quien of [OBRA, GER]) {
      expect(codigo(await base.filas(quien, "insert into obras (empresa_id, presupuesto_id, cliente_id, titulo) values ($1, $2, $3, 'x')", [E1, SEED.presupuestoBorrador, SEED.cliente(5)]))).toBe("42501");
      expect(codigo(await base.filas(quien, "delete from obras where id = $1", [SEED.obraCocina]))).toBe("42501");
    }
    expect(error(await base.filas("postgres", "delete from obras where id = $1", [SEED.obraVentanas]))).toMatch(/no se borran/);
    expect(error(await base.filas("postgres", "insert into obras (empresa_id, presupuesto_id, cliente_id, titulo) values ($1, $2, $3, 'x')", [E1, SEED.presupuestoBorrador, SEED.cliente(5)]))).toMatch(/Solo un presupuesto aceptado/);
  });
});

describe("quién cambia una obra", () => {
  it("un empleado que no es el encargado no cambia nada (0 filas); el encargado sí", async () => {
    expect(valor(await base.filas(OBRA2, "update obras set estado = 'parada' where id = $1 returning id", [SEED.obraCocina]))).toEqual([]);
    expect(valor(await base.filas(OBRA2, "update obras set encargado_id = $2 where id = $1 returning id", [SEED.obraCocina, OBRA2]))).toEqual([]);
    expect(valor(await base.filas(OBRA, "update obras set estado = 'parada' where id = $1 returning estado", [SEED.obraCocina]))).toEqual([{ estado: "parada" }]);
  });

  it("las columnas de origen no se cambian (permiso por columna) y el encargado es de la misma empresa (FK)", async () => {
    for (const col of ["titulo = 'x'", `presupuesto_id = '${SEED.presupuestoBorrador}'`, `cliente_id = '${SEED.cliente(1)}'`, `empresa_id = '${E2}'`]) {
      expect(codigo(await base.filas(GER, `update obras set ${col} where id = $1`, [SEED.obraCocina])), col).toBe("42501");
    }
    expect(codigo(await base.filas(GER, "update obras set encargado_id = $2 where id = $1", [SEED.obraCocina, "aaaaaaaa-0000-4000-8000-000000000004"]))).toBe("23503");
  });

  it("transiciones: pendiente → en curso → parada ⇄ en curso → terminada (final, solo notas)", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      const salto = error(await probar(tx, "update obras set estado = 'terminada' where id = $1", [SEED.obraVentanas]));
      await en(tx, "update obras set estado = 'en_curso' where id = $1", [SEED.obraVentanas]);
      const atras = error(await probar(tx, "update obras set estado = 'pendiente' where id = $1", [SEED.obraVentanas]));
      const fin = await unaEn(tx, "update obras set estado = 'terminada' where id = $1 returning fecha_fin::text as f", [SEED.obraVentanas]);
      const reabrir = error(await probar(tx, "update obras set estado = 'en_curso' where id = $1", [SEED.obraVentanas]));
      const prevista = error(await probar(tx, "update obras set fecha_fin_prevista = fecha_fin where id = $1", [SEED.obraVentanas]));
      const notas = await probar(tx, "update obras set notas = 'Entregada' where id = $1 returning id", [SEED.obraVentanas]);
      return { salto, atras, fin: fin.f, reabrir, prevista, notas: notas.ok };
    });
    const x = valor(r);
    expect(x.salto).toBe("Una obra no puede pasar de «pendiente» a «terminada».");
    expect(x.atras).toBe("Una obra no puede pasar de «en curso» a «pendiente».");
    expect(x.fin).toBe(hoy);
    expect(x.reabrir).toMatch(/ya está terminada/);
    expect(x.prevista).toBe("La obra está terminada: solo se pueden cambiar las notas.");
    expect(x.notas).toBe(true);
  });
});

describe("partes", () => {
  it("autor, coste por hora y fecha de alta los pone la base aunque lleguen inventados", async () => {
    const r = valor(
      await base.filas(
        OBRA,
        "insert into partes (empresa_id, obra_id, horas, autor_id, coste_hora_cents, created_at) values ($1, $2, 2, $3, 1, '2020-01-01') returning autor_id, coste_hora_cents, created_at > now() - interval '1 minute' as ahora, fecha::text",
        [E1, SEED.obraCocina, GER],
      ),
    );
    expect(r[0]).toEqual({ autor_id: OBRA, coste_hora_cents: 2600, ahora: true, fecha: hoy });
  });

  it("solo en obras en curso de tu empresa", async () => {
    const casos: [string, RegExp][] = [
      [SEED.obraVentanas, /todavía no ha empezado/],
      [SEED.obraTerminada, /terminada/],
      [SEED.obraE2, /no existe o no es de tu empresa/],
    ];
    for (const [obra, msg] of casos) {
      expect(error(await base.filas(OBRA, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 1)", [E1, obra])), obra).toMatch(msg);
    }
    expect(error(await base.filas(OBRA, "insert into partes (empresa_id, obra_id, fecha, horas) values ($1, $2, current_date + 5, 1)", [E1, SEED.obraCocina]))).toMatch(/posterior a hoy/);
    expect(error(await base.filas(OBRA, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 7.125)", [E1, SEED.obraCocina]))).toMatch(/2 decimales/);
    expect(error(await base.filas(OBRA, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 25)", [E1, SEED.obraCocina]))).toMatch(/como mucho 24/);
  });

  it("su autor lo cambia el mismo día; otro empleado no; gerencia siempre (salvo en obras terminadas)", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const id = (await unaEn(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 2) returning id", [E1, SEED.obraCocina])).id;
      const autor = (await en(tx, "update partes set horas = 3 where id = $1 returning id", [id])).length;
      const ayer = (await en(tx, "update partes set horas = 6 where id = '50000000-0000-4000-8000-000000000407' returning id")).length;
      const autorAjeno = error(await probar(tx, "update partes set autor_id = $2 where id = $1", [id, OBRA2]));
      await ser(tx, OBRA2);
      const otro = (await en(tx, "update partes set horas = 1 where id = $1 returning id", [id])).length;
      const borrarOtro = (await en(tx, "delete from partes where id = $1 returning id", [id])).length;
      await ser(tx, GER);
      const gerencia = (await en(tx, "update partes set horas = 5 where id = '50000000-0000-4000-8000-000000000407' returning id")).length;
      const terminada = error(await probar(tx, "update partes set horas = 1 where obra_id = $1", [SEED.obraTerminada]));
      return { autor, ayer, autorAjeno, otro, borrarOtro, gerencia, terminada };
    });
    const x = valor(r);
    expect(x).toMatchObject({ autor: 1, ayer: 0, otro: 0, borrarOtro: 0, gerencia: 1 });
    expect(x.autorAjeno).toMatch(/permission denied|no se pueden cambiar/);
    expect(x.terminada).toMatch(/terminada/);
  });

  it("los materiales del parte copian coste, nombre y unidad; no se repiten ni vienen de otra empresa", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const parte = (await unaEn(
        tx,
        "select guardar_parte(null, $1, null, 1, null, $2::jsonb) as id",
        [SEED.obraCocina, JSON.stringify([{ material_id: SEED.material(1), cantidad: 2.5 }])],
      )).id;
      const linea = await unaEn(tx, "select material_nombre, unidad, coste_unit_cents, cantidad::text from parte_materiales where parte_id = $1", [parte]);
      const repetido = error(await probar(tx, "insert into parte_materiales (empresa_id, parte_id, material_id, cantidad) values ($1, $2, $3, 1)", [E1, parte, SEED.material(1)]));
      const coste = codigo(await probar(tx, "update parte_materiales set coste_unit_cents = 0 where parte_id = $1", [parte]));
      const muchos = error(
        await probar(tx, "select guardar_parte(null, $1, null, 1, null, $2::jsonb)", [
          SEED.obraCocina,
          JSON.stringify(Array.from({ length: 31 }, () => ({ material_id: SEED.material(1), cantidad: 1 }))),
        ]),
      );
      return { linea, repetido, coste, muchos };
    });
    const x = valor(r);
    expect(x.linea).toEqual({ material_nombre: "Azulejo porcelánico 60x60 gris", unidad: "m²", coste_unit_cents: 1590, cantidad: "2.500" });
    expect(x.repetido).toMatch(/ya está en el parte/);
    expect(x.coste).toBe("42501");
    expect(x.muchos).toMatch(/30 materiales/);
  });

  it("el coste de un material solo lo pone o cambia gerencia", async () => {
    expect(error(await base.filas(OBRA, "update materiales set coste_cents = 1 where id = $1", [SEED.material(1)]))).toMatch(/Solo gerencia/);
    expect(error(await base.filas(OBRA, "insert into materiales (empresa_id, nombre, precio_cents, coste_cents) values ($1, 'x', 100, 50)", [E1]))).toMatch(/Solo gerencia/);
    expect(valor(await base.filas(OBRA, "update materiales set stock = stock where id = $1 returning id", [SEED.material(1)]))).toHaveLength(1);
    expect(valor(await base.filas(GER, "update materiales set coste_cents = 1600 where id = $1 returning coste_cents", [SEED.material(1)]))).toEqual([{ coste_cents: 1600 }]);
  });

  it("borrar un presupuesto con obra y partes no se puede (aunque estuviera enviado y aceptado después)", async () => {
    expect(bloqueado(await base.filas(GER, "delete from presupuestos where id = $1 returning id", [SEED.presupuestoCocina]))).toBe(true);
  });
});

describe("obras_resumen", () => {
  it("cuadra con costesObra() del dominio en todas las obras (como gerencia)", async () => {
    const vista = valor(await base.filas(GER, "select id, presupuestado_cents, horas, coste_mano_obra_cents, coste_material_cents, coste_real_cents, margen_cents, consumido_pct, num_partes from obras_resumen"));
    const partes = await base.q("select id, obra_id, horas, coste_hora_cents from partes where empresa_id = $1", [E1]);
    const materiales = await base.q("select parte_id, cantidad, coste_unit_cents from parte_materiales where empresa_id = $1", [E1]);
    expect(vista.length).toBe(6);
    for (const o of vista) {
      const suyos = partes
        .filter((p) => p.obra_id === o.id)
        .map((p) => ({
          horas: Number(p.horas),
          costeHoraCents: Number(p.coste_hora_cents),
          materiales: materiales
            .filter((m) => m.parte_id === p.id)
            .map((m) => ({ cantidad: Number(m.cantidad), costeUnitCents: Number(m.coste_unit_cents) })),
        }));
      const d = costesObra(Number(o.presupuestado_cents), suyos);
      expect(
        [Number(o.horas), Number(o.coste_mano_obra_cents), Number(o.coste_material_cents), Number(o.coste_real_cents), Number(o.margen_cents), o.consumido_pct === null ? null : Number(o.consumido_pct), Number(o.num_partes)],
        String(o.id),
      ).toEqual([d.horas, d.costeManoObraCents, d.costeMaterialCents, d.costeRealCents, d.margenCents, d.consumidoPct, d.numPartes]);
    }
  });

  it("el seed tiene la cocina en pérdidas (rojo) y la segunda empresa solo ve su obra", async () => {
    const cocina = valor(await base.filas(GER, "select semaforo, margen_cents from obras_resumen where id = $1", [SEED.obraCocina]))[0];
    expect(cocina.semaforo).toBe("rojo");
    expect(Number(cocina.margen_cents)).toBeLessThan(0);
    expect(valor(await base.filas("aaaaaaaa-0000-4000-8000-000000000004", "select id from obras_resumen"))).toEqual([{ id: SEED.obraE2 }]);
  });
});
