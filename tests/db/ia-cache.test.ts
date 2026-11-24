// Caché de propuestas de «Montar con IA» (0009, D14): misma descripción y mismo almacén → la misma propuesta.
// Solo se escribe con guardar_propuesta_ia(), que exige y gasta una reserva de consumir_uso_ia() propia, reciente y sin
// usar; cada empresa lee solo las suyas; anon no tiene nada.

import type { Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Base, E1, E2, GER, GER2, INTRUSO, OBRA, OBRA2, codigo, crearBase, en, error, probar, seed, ser, unaEn, valor } from "./andamio";

let base: Base;
beforeAll(async () => {
  base = await crearBase();
});
afterAll(() => base?.cerrar());

const CLAVE = "a".repeat(64);
const OTRA_CLAVE = "b".repeat(64);
const PROPUESTA = {
  partidas: [
    { descripcion: "Demolición de alicatado (m²)", cantidad: 14, unidad: "", precio_euros: 12, material_id: null },
    { descripcion: "Oficial alicatador (h)", cantidad: 16, unidad: "", precio_euros: 24.5, material_id: null },
  ],
  supuestos: ["Altura de techo de 2,50 m"],
};
const OTRA = { ...PROPUESTA, partidas: [{ ...PROPUESTA.partidas[0], cantidad: 20 }] };

const GUARDAR = "select guardar_propuesta_ia($1, $2, $3::jsonb, $4) as g";

/** Consume un uso como el usuario actual de la transacción y devuelve la reserva. */
async function reservar(tx: Transaction): Promise<string> {
  return String((await unaEn(tx, "select * from consumir_uso_ia()")).reserva);
}

function guardar(tx: Transaction, reserva: string, clave = CLAVE, respuesta: unknown = PROPUESTA, sustituir = false) {
  return probar(tx, GUARDAR, [reserva, clave, JSON.stringify(respuesta), sustituir]);
}

const usosHoy = async (tx: Transaction, empresa: string) =>
  Number(
    (await unaEn(tx, "select coalesce((select usos from uso_ia where empresa_id = $1 and dia = (now() at time zone 'Europe/Madrid')::date), 0) as n", [empresa]))
      .n,
  );

describe("permisos", () => {
  it("anon no lee la tabla ni ejecuta las funciones", async () => {
    expect(codigo(await base.filas("anon", "select * from ia_propuestas"))).toBe("42501");
    expect(codigo(await base.filas("anon", GUARDAR, [crypto.randomUUID(), CLAVE, JSON.stringify(PROPUESTA), false]))).toBe("42501");
    expect(codigo(await base.filas("anon", "select ia_propuesta_valida('{}'::jsonb)"))).toBe("42501");
  });

  it("nadie escribe en la tabla directamente, ni gerencia", async () => {
    for (const quien of [OBRA, GER]) {
      expect(
        codigo(
          await base.filas(quien, "insert into ia_propuestas (empresa_id, clave, respuesta, reserva) values ($1, $2, $3, gen_random_uuid())", [
            E1,
            CLAVE,
            JSON.stringify(PROPUESTA),
          ]),
        ),
        quien,
      ).toBe("42501");
      expect(codigo(await base.filas(quien, "update ia_propuestas set respuesta = '{}'"))).toBe("42501");
      expect(codigo(await base.filas(quien, "delete from ia_propuestas"))).toBe("42501");
      expect(codigo(await base.filas(quien, "select ia_propuesta_valida('{}'::jsonb)"))).toBe("42501");
    }
  });

  it("un usuario sin perfil no guarda nada", async () => {
    expect(error(await base.filas(INTRUSO, GUARDAR, [crypto.randomUUID(), CLAVE, JSON.stringify(PROPUESTA), false]))).toMatch(/empresa asignada/);
  });
});

describe("guardar_propuesta_ia", () => {
  it("con una reserva propia y reciente la guarda, devuelve lo guardado y gasta la reserva sin tocar la cuota", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const reserva = await reservar(tx);
      const g = valor(await guardar(tx, reserva));
      await ser(tx, "postgres");
      const usos = await usosHoy(tx, E1);
      const fila = await unaEn(tx, "select empresa_id, perfil_id, reserva, respuesta from ia_propuestas where clave = $1", [CLAVE]);
      const quedaReserva = (await en(tx, "select 1 from uso_ia_reservas where id = $1", [reserva])).length;
      await ser(tx, OBRA);
      // Consumir a mano, guardar y devolver no sale gratis: la reserva ya no se puede devolver.
      const devuelta = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, "postgres");
      return { g: g[0].g, fila, reserva, quedaReserva, devuelta, usosAntes: usos, usosDespues: await usosHoy(tx, E1) };
    });
    const x = valor(r);
    expect(x.g).toEqual(PROPUESTA);
    expect(x.fila).toEqual({ empresa_id: E1, perfil_id: OBRA, reserva: x.reserva, respuesta: PROPUESTA });
    expect(x).toMatchObject({ quedaReserva: 0, devuelta: false, usosAntes: 1, usosDespues: 1 });
  });

  it("sin una reserva válida da TJ005 y no guarda: inventada, de otro usuario, de otra empresa, vieja o ya devuelta", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA2);
      const deOtroUsuario = await reservar(tx);
      await ser(tx, GER2);
      const deOtraEmpresa = await reservar(tx);
      await ser(tx, OBRA);
      const vieja = await reservar(tx);
      const devuelta = await reservar(tx);
      await en(tx, "select devolver_uso_ia($1)", [devuelta]);
      await ser(tx, "postgres");
      await en(tx, "update uso_ia_reservas set creado_at = now() - interval '11 minutes' where id = $1", [vieja]);
      await ser(tx, OBRA);
      const intentos = {
        nula: await probar(tx, GUARDAR, [null, CLAVE, JSON.stringify(PROPUESTA), false]),
        inventada: await guardar(tx, crypto.randomUUID()),
        deOtroUsuario: await guardar(tx, deOtroUsuario),
        deOtraEmpresa: await guardar(tx, deOtraEmpresa),
        vieja: await guardar(tx, vieja),
        devuelta: await guardar(tx, devuelta),
      };
      await ser(tx, "postgres");
      return {
        codigos: Object.fromEntries(Object.entries(intentos).map(([k, v]) => [k, codigo(v)])),
        mensaje: error(intentos.inventada),
        guardadas: Number((await unaEn(tx, "select count(*)::int as n from ia_propuestas")).n),
        // Las reservas ajenas siguen ahí: se pueden devolver si hiciera falta.
        ajenas: Number((await unaEn(tx, "select count(*)::int as n from uso_ia_reservas where id = any($1)", [[deOtroUsuario, deOtraEmpresa]])).n),
      };
    });
    const x = valor(r);
    expect(Object.values(x.codigos).every((c) => c === "TJ005")).toBe(true);
    expect(x.mensaje).toBe("No se puede guardar la propuesta: hace falta un uso de IA reciente y sin usar.");
    expect(x).toMatchObject({ guardadas: 0, ajenas: 2 });
  });

  it("una reserva no sirve dos veces, ni para otra clave", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const reserva = await reservar(tx);
      const primera = await guardar(tx, reserva);
      const otraVez = await guardar(tx, reserva, CLAVE, OTRA, true);
      const otraClave = await guardar(tx, reserva, OTRA_CLAVE);
      await ser(tx, "postgres");
      return {
        primera: codigo(primera),
        otraVez: codigo(otraVez),
        otraClave: codigo(otraClave),
        guardadas: await en(tx, "select clave, respuesta from ia_propuestas"),
      };
    });
    expect(valor(r)).toEqual({ primera: "ok", otraVez: "TJ005", otraClave: "TJ005", guardadas: [{ clave: CLAVE, respuesta: PROPUESTA }] });
  });

  it("si ya hay una con esa clave se queda la primera (y es la que devuelve); con p_sustituir se cambia", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      valor(await guardar(tx, await reservar(tx)));
      await ser(tx, OBRA2);
      const segunda = valor(await guardar(tx, await reservar(tx), CLAVE, OTRA))[0].g;
      const leida = (await unaEn(tx, "select respuesta from ia_propuestas where clave = $1", [CLAVE])).respuesta;
      const sustituida = valor(await guardar(tx, await reservar(tx), CLAVE, OTRA, true))[0].g;
      await ser(tx, "postgres");
      const fila = await unaEn(tx, "select perfil_id, respuesta from ia_propuestas where clave = $1", [CLAVE]);
      return { segunda, leida, sustituida, fila, usos: await usosHoy(tx, E1) };
    });
    expect(valor(r)).toEqual({
      segunda: PROPUESTA,
      leida: PROPUESTA,
      sustituida: OTRA,
      fila: { perfil_id: OBRA2, respuesta: OTRA },
      // Cada guardado ha gastado su uso, también el que no ha cambiado nada.
      usos: 3,
    });
  });

  it("rechaza claves y respuestas sin la forma esperada sin gastar la reserva", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const reserva = await reservar(tx);
      const partida = PROPUESTA.partidas[0];
      const malas: [string, unknown][] = [
        ["A".repeat(64), PROPUESTA],
        ["a".repeat(63), PROPUESTA],
        ["", PROPUESTA],
        [CLAVE, []],
        [CLAVE, "texto"],
        [CLAVE, { partidas: [], supuestos: [] }],
        [CLAVE, { partidas: Array(31).fill(partida), supuestos: [] }],
        [CLAVE, { partidas: [partida] }],
        [CLAVE, { partidas: [partida], supuestos: Array(7).fill("x") }],
        [CLAVE, { partidas: "x", supuestos: [] }],
        [CLAVE, { partidas: [partida], supuestos: [], relleno: "x".repeat(140_000) }],
      ];
      const codigos = [];
      for (const [clave, respuesta] of malas) codigos.push(codigo(await guardar(tx, reserva, clave, respuesta)));
      const nula = codigo(await probar(tx, GUARDAR, [reserva, CLAVE, null, false]));
      const buena = codigo(await guardar(tx, reserva, CLAVE, { partidas: Array(30).fill(partida), supuestos: Array(6).fill("x") }));
      return { codigos, nula, buena };
    });
    const x = valor(r);
    expect(x.codigos.every((c) => c === "P0001")).toBe(true);
    expect(x.nula).toBe("P0001");
    expect(x.buena).toBe("ok");
  });
});

describe("aislamiento entre empresas", () => {
  it("cada empresa lee solo las suyas; toda la empresa lee las de su empresa; la misma clave en dos empresas son dos", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      valor(await guardar(tx, await reservar(tx)));
      await ser(tx, GER2);
      const e2AntesDeGuardar = await en(tx, "select * from ia_propuestas");
      const e2Guarda = valor(await guardar(tx, await reservar(tx), CLAVE, OTRA))[0].g;
      const e2Lee = await en(tx, "select empresa_id, respuesta from ia_propuestas");
      await ser(tx, OBRA2);
      const companero = await en(tx, "select empresa_id, respuesta from ia_propuestas");
      await ser(tx, GER);
      const gerencia = await en(tx, "select empresa_id from ia_propuestas where empresa_id = $1", [E2]);
      await ser(tx, INTRUSO);
      const intruso = await en(tx, "select * from ia_propuestas");
      return { e2AntesDeGuardar, e2Guarda, e2Lee, companero, gerencia, intruso };
    });
    expect(valor(r)).toEqual({
      e2AntesDeGuardar: [],
      // La primera de E1 no cuenta para E2: guarda la suya.
      e2Guarda: OTRA,
      e2Lee: [{ empresa_id: E2, respuesta: OTRA }],
      companero: [{ empresa_id: E1, respuesta: PROPUESTA }],
      gerencia: [],
      intruso: [],
    });
  });
});

describe("seed después de 0009", () => {
  it("se ejecuta y borra las propuestas guardadas de las empresas de demo", async () => {
    const r = await base.como(
      "postgres",
      async (tx) => {
        await ser(tx, OBRA);
        valor(await guardar(tx, await reservar(tx)));
        await ser(tx, GER2);
        valor(await guardar(tx, await reservar(tx)));
      },
      { guardar: true },
    );
    valor(r);
    expect(await base.one("select count(*)::int as n from ia_propuestas")).toEqual({ n: 2 });
    await base.exec(seed());
    expect(await base.one("select count(*)::int as n from ia_propuestas")).toEqual({ n: 0 });
    expect(await base.one("select count(*)::int as n from materiales where empresa_id = $1", [E1])).not.toEqual({ n: 0 });
  });
});
