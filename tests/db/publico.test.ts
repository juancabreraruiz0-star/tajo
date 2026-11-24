// Enlace público (/p/[token]): lo que ve el cliente sin sesión, la aceptación por enlace, la validez y regenerar el
// enlace. La evidencia de la aceptación (nombre, IP y navegador) está en auditoria2.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { budgetTotals } from "@/lib/domain/totals";
import { type Base, GER, OBRA, SEED, codigo, crearBase, en, error, probar, ser, unaEn, valor } from "./andamio";

let base: Base;
beforeAll(async () => {
  base = await crearBase();
});
afterAll(() => base?.cerrar());

const ACEPTAR = "select aceptar_presupuesto($1, 'Cliente de prueba', '203.0.113.5', 'Mozilla/5.0') as r";

async function token(id: string): Promise<string> {
  return String((await base.one("select token from presupuestos where id = $1", [id]))?.token);
}

describe("presupuesto_publico", () => {
  it("devuelve el enviado con los totales de la vista y solo lo necesario del cliente", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const pub = valor(await base.filas("anon", "select presupuesto_publico($1) as j", [t]))[0].j as Record<string, unknown>;
    const vista = await base.one("select base_cents, iva_cents, total_cents from presupuestos_con_totales where id = $1", [SEED.presupuestoEnviado]);
    expect(Object.keys(pub).sort()).toEqual(["base_cents", "cliente", "empresa", "iva_cents", "lineas", "presupuesto", "total_cents"]);
    expect(pub.cliente).toEqual({ nombre: "Lucía Esteve Baixauli" });
    expect(Number(pub.total_cents)).toBe(Number(vista?.total_cents));
    expect(Object.keys(pub.presupuesto as object)).not.toContain("aceptado_ip");
    // Los totales cuadran con la regla del dominio.
    const lineas = pub.lineas as { cantidad: number; precio_cents: number }[];
    const dominio = budgetTotals(
      lineas.map((l) => ({ cantidad: Number(l.cantidad), precioCents: Number(l.precio_cents) })),
      Number((pub.presupuesto as { iva_pct: number }).iva_pct),
    );
    expect([Number(pub.base_cents), Number(pub.iva_cents), Number(pub.total_cents)]).toEqual([
      dominio.baseCents,
      dominio.ivaCents,
      dominio.totalCents,
    ]);
  });

  it("un borrador o un token inventado no devuelven nada", async () => {
    const t = await token(SEED.presupuestoBorrador);
    expect(valor(await base.filas("anon", "select presupuesto_publico($1) as j", [t]))[0].j).toBeNull();
    expect(valor(await base.filas("anon", "select presupuesto_publico(gen_random_uuid()) as j"))[0].j).toBeNull();
  });
});

describe("aceptar_presupuesto (solo anon)", () => {
  it("acepta un enviado una sola vez y crea su obra pendiente sin encargado", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, "anon");
      const primera = (await unaEn(tx, ACEPTAR, [t])).r;
      const segunda = (await unaEn(tx, ACEPTAR, [t])).r;
      await ser(tx, "postgres");
      const p = await unaEn(tx, "select estado, aceptado_canal, aceptado_por, aceptado_at is not null as fecha from presupuestos where id = $1", [SEED.presupuestoEnviado]);
      const obra = await en(tx, "select estado, encargado_id, titulo from obras where presupuesto_id = $1", [SEED.presupuestoEnviado]);
      return { primera, segunda, p, obra };
    });
    const { primera, segunda, p, obra } = valor(r);
    expect(primera).toMatchObject({ ok: true, estado: "aceptado" });
    expect(segunda).toEqual({ ok: false, motivo: "Este presupuesto ya estaba aceptado." });
    expect(p).toEqual({ estado: "aceptado", aceptado_canal: "enlace", aceptado_por: null, fecha: true });
    expect(obra).toEqual([{ estado: "pendiente", encargado_id: null, titulo: "Reforma integral de piso" }]);
  });

  it("no acepta borradores, rechazados, facturados ni tokens inventados", async () => {
    const casos: [string, RegExp][] = [
      [await token(SEED.presupuestoBorrador), /no existe o ya no está disponible/],
      [await token(SEED.presupuestoRechazado), /fue rechazado/],
      [await token(SEED.presupuestoFacturado), /aceptado y facturado/],
      [await token(SEED.presupuestoCocina), /ya estaba aceptado/],
    ];
    for (const [t, motivo] of casos) {
      const r = valor(await base.filas("anon", ACEPTAR, [t]))[0].r as { ok: boolean; motivo: string };
      expect(r.ok).toBe(false);
      expect(r.motivo).toMatch(motivo);
    }
    const inventado = valor(await base.filas("anon", "select aceptar_presupuesto(gen_random_uuid(), 'X Y', null, null) as r"))[0].r;
    expect(inventado).toMatchObject({ ok: false });
  });

  it("con la validez vencida no lo acepta ni el cliente ni gerencia", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "select set_config('tajo.seed', 'on', true)");
      await en(tx, "update presupuestos set created_at = now() - interval '400 days' where id = $1", [SEED.presupuestoEnviado]);
      await en(tx, "select set_config('tajo.seed', 'off', true)");
      const t = (await unaEn(tx, "select token from presupuestos where id = $1", [SEED.presupuestoEnviado])).token;
      await ser(tx, "anon");
      const cliente = (await unaEn(tx, ACEPTAR, [t])).r;
      const sigueVisible = (await unaEn(tx, "select presupuesto_publico($1) is not null as v", [t])).v;
      await ser(tx, GER);
      const gerencia = error(await probar(tx, "update presupuestos set estado = 'aceptado' where id = $1", [SEED.presupuestoEnviado]));
      return { cliente, sigueVisible, gerencia };
    });
    const { cliente, sigueVisible, gerencia } = valor(r);
    expect(cliente).toMatchObject({ ok: false, motivo: expect.stringMatching(/vencido/) });
    expect(sigueVisible).toBe(true);
    expect(gerencia).toMatch(/vencido/);
  });

  it("un usuario con sesión no puede ejecutarla", async () => {
    const t = await token(SEED.presupuestoEnviado);
    expect(codigo(await base.filas(OBRA, ACEPTAR, [t]))).toBe("42501");
  });
});

describe("regenerar_enlace (solo gerencia)", () => {
  it("cambia el token: el viejo ya no lee ni acepta y el nuevo sí", async () => {
    const viejo = await token(SEED.presupuestoEnviado);
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      const nuevo = (await unaEn(tx, "select regenerar_enlace($1) as t", [SEED.presupuestoEnviado])).t;
      await ser(tx, "anon");
      return {
        nuevo,
        leeViejo: (await unaEn(tx, "select presupuesto_publico($1) as j", [viejo])).j,
        aceptaViejo: (await unaEn(tx, ACEPTAR, [viejo])).r,
        leeNuevo: (await unaEn(tx, "select presupuesto_publico($1) is not null as v", [nuevo])).v,
      };
    });
    const x = valor(r);
    expect(x.nuevo).not.toBe(viejo);
    expect(x.leeViejo).toBeNull();
    expect(x.aceptaViejo).toMatchObject({ ok: false });
    expect(x.leeNuevo).toBe(true);
  });

  it("ni el empleado ni con un borrador ni de otra empresa", async () => {
    expect(error(await base.filas(OBRA, "select regenerar_enlace($1)", [SEED.presupuestoEnviado]))).toMatch(/Solo gerencia/);
    expect(error(await base.filas(GER, "select regenerar_enlace($1)", [SEED.presupuestoBorrador]))).toMatch(/borrador/);
    expect(error(await base.filas(GER, "select regenerar_enlace($1)", [SEED.presupuestoE2Enviado]))).toMatch(/no existe o no pertenece/);
  });
});
