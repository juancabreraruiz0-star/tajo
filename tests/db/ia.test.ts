// Cuota de «Montar con IA» (0005 y 0007): contadores por empresa (40) y por usuario (15) por día de Madrid, y reservas
// que solo devuelve quien las recibió, una vez y en 10 minutos. El sublímite por usuario está en auditoria2.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Base, E1, E2, GER, GER2, INTRUSO, OBRA, OBRA2, codigo, crearBase, en, error, probar, ser, unaEn, valor } from "./andamio";

let base: Base;
beforeAll(async () => {
  base = await crearBase();
});
afterAll(() => base?.cerrar());

const usos = (tx: Parameters<Parameters<Base["como"]>[1]>[0], empresa: string, dia = "(now() at time zone 'Europe/Madrid')::date") =>
  en(tx, `select coalesce((select usos from uso_ia where empresa_id = $1 and dia = ${dia}), 0) as n`, [empresa]).then((f) => Number(f[0].n));

describe("permisos", () => {
  it("nadie lee ni escribe las tablas de la cuota desde la API; anon no ejecuta las funciones", async () => {
    for (const quien of ["anon", OBRA, GER] as const) {
      for (const t of ["uso_ia", "uso_ia_reservas", "uso_ia_perfiles"]) {
        expect(codigo(await base.filas(quien, `select * from ${t}`)), `${quien} ${t}`).toBe("42501");
      }
      expect(codigo(await base.filas(quien, "insert into uso_ia_reservas (empresa_id, perfil_id, dia) values ($1, $2, current_date)", [E1, OBRA]))).toBe("42501");
    }
    expect(codigo(await base.filas("anon", "select * from consumir_uso_ia()"))).toBe("42501");
    expect(codigo(await base.filas("anon", "select devolver_uso_ia(gen_random_uuid())"))).toBe("42501");
  });

  it("sin perfil no se consume ni se devuelve", async () => {
    expect(error(await base.filas(INTRUSO, "select * from consumir_uso_ia()"))).toMatch(/empresa asignada/);
    expect(error(await base.filas(INTRUSO, "select devolver_uso_ia(gen_random_uuid())"))).toMatch(/empresa asignada/);
  });
});

describe("consumir y devolver", () => {
  it("cada llamada suma 1 a la empresa del usuario con una reserva nueva suya", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const a = await unaEn(tx, "select * from consumir_uso_ia()");
      const b = await unaEn(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const reservas = await en(tx, "select perfil_id, empresa_id from uso_ia_reservas where id in ($1, $2)", [a.reserva, b.reserva]);
      return { a: a.quedan, b: b.quedan, distintas: a.reserva !== b.reserva, reservas, usos: await usos(tx, E1) };
    });
    expect(valor(r)).toEqual({
      a: 14,
      b: 13,
      distintas: true,
      reservas: [{ perfil_id: OBRA, empresa_id: E1 }, { perfil_id: OBRA, empresa_id: E1 }],
      usos: 2,
    });
  });

  it("una reserva inventada, de otra empresa o de más de 10 minutos no devuelve nada", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const { reserva } = await unaEn(tx, "select * from consumir_uso_ia()");
      const inventada = (await unaEn(tx, "select devolver_uso_ia(gen_random_uuid()) as d")).d;
      await ser(tx, GER2);
      const otraEmpresa = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, "postgres");
      await en(tx, "update uso_ia_reservas set creado_at = now() - interval '11 minutes' where id = $1", [reserva]);
      await ser(tx, OBRA);
      const vieja = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, "postgres");
      return { inventada, otraEmpresa, vieja, usos: await usos(tx, E1) };
    });
    expect(valor(r)).toEqual({ inventada: false, otraEmpresa: false, vieja: false, usos: 1 });
  });

  it("una reserva de ayer resta de ayer, no de hoy, y el contador nunca baja de 0", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const { reserva } = await unaEn(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const ayer = "(now() at time zone 'Europe/Madrid')::date - 1";
      await en(tx, `update uso_ia_reservas set dia = ${ayer} where id = $1`, [reserva]);
      await en(tx, `insert into uso_ia (empresa_id, dia, usos) values ($1, ${ayer}, 0)`, [E1]);
      await ser(tx, OBRA);
      const d = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, "postgres");
      return { d, hoy: await usos(tx, E1), ayer: await usos(tx, E1, ayer) };
    });
    expect(valor(r)).toEqual({ d: true, hoy: 1, ayer: 0 });
  });

  it("consumir y devolver a mano por RPC: neto cero", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA2);
      for (let i = 0; i < 3; i++) {
        const { reserva } = await unaEn(tx, "select * from consumir_uso_ia()");
        await en(tx, "select devolver_uso_ia($1)", [reserva]);
      }
      await ser(tx, "postgres");
      return {
        empresa: await usos(tx, E1),
        perfil: Number((await unaEn(tx, "select usos from uso_ia_perfiles where perfil_id = $1", [OBRA2])).usos),
      };
    });
    expect(valor(r)).toEqual({ empresa: 0, perfil: 0 });
  });
});

describe("límite de la empresa", () => {
  it("con 40 usos da TJ002 en español, sin sumar ni crear reserva; otra empresa tiene su propio contador", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "insert into uso_ia (empresa_id, dia, usos) values ($1, (now() at time zone 'Europe/Madrid')::date, 39)", [E1]);
      await ser(tx, GER);
      const ultima = await unaEn(tx, "select * from consumir_uso_ia()");
      const llena = await probar(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const reservas = Number((await unaEn(tx, "select count(*)::int as n from uso_ia_reservas where empresa_id = $1", [E1])).n);
      await ser(tx, GER2);
      const otra = await unaEn(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      return { ultima: ultima.quedan, llena, reservas, usos: await usos(tx, E1), otra: otra.quedan, e2: await usos(tx, E2) };
    });
    const x = valor(r);
    expect(x.ultima).toBe(0);
    expect(codigo(x.llena)).toBe("TJ002");
    expect(error(x.llena)).toBe("Has llegado al límite de 40 propuestas con IA de hoy. Vuelve a intentarlo mañana.");
    expect(x).toMatchObject({ reservas: 1, usos: 40, otra: 14, e2: 1 });
  });

  it("al cambiar de día vuelve a haber cuota y se limpian las reservas de hace más de un día", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "insert into uso_ia (empresa_id, dia, usos) values ($1, (now() at time zone 'Europe/Madrid')::date - 1, 40)", [E1]);
      await en(
        tx,
        "insert into uso_ia_reservas (empresa_id, perfil_id, dia, creado_at) values ($1, $2, (now() at time zone 'Europe/Madrid')::date - 2, now() - interval '2 days')",
        [E1, OBRA],
      );
      await ser(tx, OBRA);
      const hoy = await unaEn(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      return { quedan: hoy.quedan, reservas: Number((await unaEn(tx, "select count(*)::int as n from uso_ia_reservas where empresa_id = $1", [E1])).n) };
    });
    expect(valor(r)).toEqual({ quedan: 14, reservas: 1 });
  });
});
