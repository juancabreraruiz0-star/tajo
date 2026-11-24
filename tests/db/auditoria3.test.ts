// Tercera auditoría externa (docs/AUDITORIA-3.md) → migración 0008 (D13): validez desde el envío (M1), sin envíos de
// 0 € (menor 7), constancia fija de quién envió y IP y navegador solo para gerencia (menor 3), y el coste de los
// materiales solo para gerencia (M2, trigger de 0006 que la app respeta).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbErrorMessage } from "@/lib/domain/errors";
import { isExpired, validUntil } from "@/lib/domain/presupuestos";
import {
  type Base,
  E1,
  GER,
  GER2,
  OBRA,
  SEED,
  codigo,
  crearBase,
  en,
  error,
  probar,
  ser,
  unaEn,
  valor,
} from "./andamio";

let base: Base;
beforeAll(async () => {
  base = await crearBase();
});
afterAll(() => base?.cerrar());

const ACEPTAR = "select aceptar_presupuesto($1, 'Cliente de prueba', '203.0.113.5', 'Mozilla/5.0') as r";
const ACEPTAR_INTERNO = "update presupuestos set estado = 'aceptado' where id = $1 returning aceptado_canal";

/** Mediodía (hora de Madrid) de hace n días: así el día de Madrid no depende de la hora a la que corre el test. */
const HACE_DIAS = "(((now() at time zone 'Europe/Madrid')::date - $2::int) + time '12:00') at time zone 'Europe/Madrid'";

// ---------------------------------------------------------------------------------------------------------------
describe("M1 · la validez cuenta desde el envío", () => {
  it("un borrador de hace 40 días (validez 30) enviado hoy se puede aceptar: por el cliente y por gerencia", async () => {
    const escena = (aceptar: (tx: Parameters<Parameters<Base["como"]>[1]>[0], token: string) => Promise<unknown>) =>
      base.como("postgres", async (tx) => {
        await en(tx, "select set_config('tajo.seed', 'on', true)");
        await en(tx, `update presupuestos set created_at = ${HACE_DIAS} where id = $1`, [SEED.presupuestoBorrador, 40]);
        await en(tx, "select set_config('tajo.seed', 'off', true)");
        await ser(tx, OBRA);
        await en(tx, "update presupuestos set estado = 'enviado' where id = $1", [SEED.presupuestoBorrador]);
        await ser(tx, "postgres");
        const p = await unaEn(tx, "select token, created_at, enviado_at, validez_dias from presupuestos where id = $1", [
          SEED.presupuestoBorrador,
        ]);
        const fechas = {
          created_at: new Date(String(p.created_at)).toISOString(),
          enviado_at: new Date(String(p.enviado_at)).toISOString(),
        };
        const dominio = {
          desdeCreacion: isExpired({ created_at: fechas.created_at, enviado_at: null }, Number(p.validez_dias)),
          desdeEnvio: isExpired(fechas, Number(p.validez_dias)),
          hasta: validUntil(fechas, Number(p.validez_dias)),
        };
        return { dominio, acepta: await aceptar(tx, String(p.token)) };
      });

    const porEnlace = valor(
      await escena(async (tx, t) => {
        await ser(tx, "anon");
        return (await unaEn(tx, ACEPTAR, [t])).r;
      }),
    );
    // El dominio y la base dicen lo mismo: contado desde la creación estaría vencido; desde el envío, no.
    expect(porEnlace.dominio.desdeCreacion).toBe(true);
    expect(porEnlace.dominio.desdeEnvio).toBe(false);
    expect(porEnlace.acepta).toMatchObject({ ok: true, estado: "aceptado" });

    const porGerencia = valor(
      await escena(async (tx) => {
        await ser(tx, GER);
        return (await unaEn(tx, ACEPTAR_INTERNO, [SEED.presupuestoBorrador])).aceptado_canal;
      }),
    );
    expect(porGerencia.acepta).toBe("interno");
  });

  it("enviado hace 30 días (validez 30) todavía vale; hace 31, ya no: ni el cliente ni gerencia", async () => {
    const intentar = (diasDesdeEnvio: number) =>
      base.como("postgres", async (tx) => {
        await en(tx, "select set_config('tajo.seed', 'on', true)");
        // Creado mucho antes (no importa) y enviado hace diasDesdeEnvio días.
        await en(tx, `update presupuestos set created_at = ${HACE_DIAS} where id = $1`, [SEED.presupuestoEnviado, 90]);
        await en(tx, `update presupuestos set enviado_at = ${HACE_DIAS} where id = $1`, [SEED.presupuestoEnviado, diasDesdeEnvio]);
        await en(tx, "select set_config('tajo.seed', 'off', true)");
        const t = (await unaEn(tx, "select token from presupuestos where id = $1", [SEED.presupuestoEnviado])).token;
        await ser(tx, "anon");
        const cliente = (await unaEn(tx, ACEPTAR, [t])).r as { ok: boolean; motivo?: string };
        await ser(tx, GER);
        const gerencia = await probar(tx, ACEPTAR_INTERNO, [SEED.presupuestoEnviado]);
        return { cliente, gerencia: gerencia.ok ? "ok" : gerencia.msg };
      });

    expect(valor(await intentar(30)).cliente).toMatchObject({ ok: true });
    const vencido = valor(await intentar(31));
    expect(vencido.cliente).toMatchObject({ ok: false, motivo: expect.stringMatching(/vencido/) });
    expect(vencido.gerencia).toMatch(/vencido/);
  });

  it("la fecha de envío la pone la base al enviar y no se puede cambiar después", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const enviado = await unaEn(
        tx,
        "update presupuestos set estado = 'enviado' where id = $1 returning enviado_at is not null as fecha",
        [SEED.presupuestoBorrador],
      );
      await ser(tx, GER);
      const cambiar = error(
        await probar(tx, "update presupuestos set enviado_at = now() + interval '10 days' where id = $1 returning id", [
          SEED.presupuestoBorrador,
        ]),
      );
      return { enviado, cambiar };
    });
    const { enviado, cambiar } = valor(r);
    expect(enviado).toEqual({ fecha: true });
    expect(cambiar).toMatch(/fecha de envío la pone el sistema/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("Menor 7 · un presupuesto de 0 € no se envía", () => {
  async function enviarCon(precioCents: number, cantidad = 1) {
    return base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      await en(tx, "update presupuesto_lineas set precio_cents = $2, cantidad = $3 where presupuesto_id = $1", [
        SEED.presupuestoBorrador,
        precioCents,
        cantidad,
      ]);
      const envio = await probar(tx, "update presupuestos set estado = 'enviado' where id = $1 returning estado", [
        SEED.presupuestoBorrador,
      ]);
      await ser(tx, "postgres");
      const estado = (await unaEn(tx, "select estado from presupuestos where id = $1", [SEED.presupuestoBorrador])).estado;
      return { envio, estado };
    });
  }

  it("con todas las partidas a 0 € se rechaza con TJ004 y la app lo traduce", async () => {
    const { envio, estado } = valor(await enviarCon(0));
    expect(codigo(envio)).toBe("TJ004");
    expect(dbErrorMessage({ code: codigo(envio), message: error(envio) })).toBe(
      "El total es 0 €: pon precio a las partidas antes de enviarlo.",
    );
    expect(estado).toBe("borrador");
  });

  it("con importes que redondean a 0 céntimos (0,001 × 1 céntimo) también", async () => {
    expect(codigo(valor(await enviarCon(1, 0.001)).envio)).toBe("TJ004");
  });

  it("con un total de 1 céntimo sí se envía", async () => {
    const { envio, estado } = valor(await enviarCon(1));
    expect(codigo(envio)).toBe("ok");
    expect(estado).toBe("enviado");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("Menor 3 · constancia fija de quién envió", () => {
  it("el nombre de quien envía se copia al enviar y no cambia aunque cambie su perfil o se borre el usuario", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const alEnviar = await unaEn(
        tx,
        "update presupuestos set estado = 'enviado', enviado_por_nombre = 'Inventado' where id = $1 returning enviado_por_nombre",
        [SEED.presupuestoBorrador],
      );
      await en(tx, "update perfiles set nombre = 'Otro nombre' where id = $1", [OBRA]);
      const trasCambiarPerfil = await unaEn(tx, "select enviado_por_nombre from presupuestos_con_totales where id = $1", [
        SEED.presupuestoBorrador,
      ]);
      const cambiar = {} as Record<string, string>;
      for (const quien of [OBRA, GER, "postgres"]) {
        await ser(tx, quien);
        cambiar[quien] = error(
          await probar(tx, "update presupuestos set enviado_por_nombre = 'Otro' where id = $1 returning id", [
            SEED.presupuestoBorrador,
          ]),
        );
      }
      await ser(tx, "postgres");
      await en(tx, "delete from auth.users where id = $1", [OBRA]);
      const trasBorrar = await unaEn(tx, "select enviado_por, enviado_por_nombre from presupuestos where id = $1", [
        SEED.presupuestoBorrador,
      ]);
      return { alEnviar, trasCambiarPerfil, cambiar, trasBorrar };
    });
    const { alEnviar, trasCambiarPerfil, cambiar, trasBorrar } = valor(r);
    expect(alEnviar).toEqual({ enviado_por_nombre: "Toni Ferrer — Encargado" });
    expect(trasCambiarPerfil).toEqual({ enviado_por_nombre: "Toni Ferrer — Encargado" });
    for (const msg of Object.values(cambiar)) expect(msg).toMatch(/lo pone el sistema/);
    expect(trasBorrar).toEqual({ enviado_por: null, enviado_por_nombre: "Toni Ferrer — Encargado" });
  });

  it("el seed deja el nombre de quien envió en todos los presupuestos enviados de la demo", async () => {
    const r = await base.q(
      `select p.numero, p.enviado_por_nombre, pf.nombre
         from presupuestos p left join perfiles pf on pf.id = p.enviado_por
        where p.empresa_id = $1 and p.estado <> 'borrador'`,
      [E1],
    );
    expect(r.length).toBeGreaterThan(0);
    for (const f of r) expect(f.enviado_por_nombre, String(f.numero)).toBe(f.nombre);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("Menor 3 · la IP y el navegador de la aceptación solo los lee gerencia", () => {
  const LEER = "select presupuesto_id, ip, user_agent from presupuesto_aceptaciones where presupuesto_id = $1";

  it("ya no están en presupuestos ni en la vista que lee toda la empresa", async () => {
    for (const sql of [
      "select aceptado_ip from presupuestos limit 1",
      "select aceptado_user_agent from presupuestos limit 1",
      "select aceptado_ip from presupuestos_con_totales limit 1",
    ]) {
      expect(codigo(await base.filas(OBRA, sql)), sql).toBe("42703");
    }
  });

  it("gerencia los lee; el empleado no ve ninguna fila, la otra empresa tampoco y anon no tiene permiso", async () => {
    expect(valor(await base.filas(GER, LEER, [SEED.presupuestoCocina]))).toEqual([
      { presupuesto_id: SEED.presupuestoCocina, ip: "203.0.113.81", user_agent: expect.stringMatching(/Android/) },
    ]);
    expect(valor(await base.filas(OBRA, "select count(*)::int as n from presupuesto_aceptaciones"))).toEqual([{ n: 0 }]);
    expect(valor(await base.filas(GER2, LEER, [SEED.presupuestoCocina]))).toEqual([]);
    expect(codigo(await base.filas("anon", LEER, [SEED.presupuestoCocina]))).toBe("42501");
  });

  it("al aceptar por el enlace se guardan en su tabla; el empleado sigue sin verlos", async () => {
    const r = await base.como("postgres", async (tx) => {
      const t = (await unaEn(tx, "select token from presupuestos where id = $1", [SEED.presupuestoEnviado])).token;
      await ser(tx, "anon");
      await en(tx, ACEPTAR, [t]);
      await ser(tx, OBRA);
      const obra = await en(tx, LEER, [SEED.presupuestoEnviado]);
      await ser(tx, GER);
      const gerencia = await en(tx, LEER, [SEED.presupuestoEnviado]);
      return { obra, gerencia };
    });
    expect(valor(r)).toEqual({
      obra: [],
      gerencia: [{ presupuesto_id: SEED.presupuestoEnviado, ip: "203.0.113.5", user_agent: "Mozilla/5.0" }],
    });
  });

  it("nadie los escribe desde la API, ni gerencia", async () => {
    for (const quien of [GER, OBRA, "anon"]) {
      for (const sql of [
        `insert into presupuesto_aceptaciones (presupuesto_id, empresa_id, ip) values ('${SEED.presupuestoEnviado}', '${E1}', '1.1.1.1')`,
        `update presupuesto_aceptaciones set ip = '9.9.9.9' where presupuesto_id = '${SEED.presupuestoCocina}'`,
        `delete from presupuesto_aceptaciones where presupuesto_id = '${SEED.presupuestoCocina}'`,
      ]) {
        expect(codigo(await base.filas(quien, sql)), `${quien}: ${sql}`).toBe("42501");
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("M2 · el coste de un material solo lo pone o cambia gerencia", () => {
  const ALTA = `insert into materiales (empresa_id, nombre, unidad, precio_cents, coste_cents)
                values ($1, 'Rodapié de prueba', 'm', 900, $2) returning coste_cents`;

  it("gerencia lo pone al crear, lo cambia y lo vacía", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      const alta = await unaEn(tx, ALTA, [E1, 600]);
      const cambio = await unaEn(tx, "update materiales set coste_cents = 650 where id = $1 returning coste_cents", [
        SEED.material(1),
      ]);
      const vacio = await unaEn(tx, "update materiales set coste_cents = null where id = $1 returning coste_cents", [
        SEED.material(1),
      ]);
      return { alta, cambio, vacio };
    });
    expect(valor(r)).toEqual({ alta: { coste_cents: 600 }, cambio: { coste_cents: 650 }, vacio: { coste_cents: null } });
  });

  it("el empleado crea y edita materiales sin coste, pero no puede ponerlo ni cambiarlo", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const sinCoste = await unaEn(tx, ALTA, [E1, null]);
      const conCoste = error(await probar(tx, ALTA, [E1, 600]));
      const editar = await unaEn(tx, "update materiales set precio_cents = 2500 where id = $1 returning coste_cents", [
        SEED.material(1),
      ]);
      const cambiarCoste = error(
        await probar(tx, "update materiales set coste_cents = 1 where id = $1 returning id", [SEED.material(1)]),
      );
      return { sinCoste, conCoste, editar, cambiarCoste };
    });
    const { sinCoste, conCoste, editar, cambiarCoste } = valor(r);
    expect(sinCoste).toEqual({ coste_cents: null });
    expect(conCoste).toMatch(/Solo gerencia/);
    expect(editar).toEqual({ coste_cents: 1590 });
    expect(cambiarCoste).toMatch(/Solo gerencia/);
  });
});
