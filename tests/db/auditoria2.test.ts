// Segunda auditoría externa (docs/AUDITORIA-2.md) → migración 0007 (D12). Un bloque por hallazgo: los dos VULN del
// auditor (A2 y M1) cerrados o documentados, y cada punto nuevo de 0007 (B1–B5, B7).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nifError } from "@/lib/domain/nif";
import { type EstadoObra, semaforoObra } from "@/lib/domain/obras";
import {
  type Base,
  E1,
  GER,
  INTRUSO,
  OBRA,
  OBRA2,
  SEED,
  bloqueado,
  codigo,
  crearBase,
  en,
  error,
  hoyMadrid,
  intento,
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

const ACEPTAR = "select aceptar_presupuesto($1, $2, $3, $4) as r";

async function token(id: string): Promise<string> {
  return String((await base.one("select token from presupuestos where id = $1", [id]))?.token);
}

function diasAntes(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
describe("A2 · aceptación por enlace con evidencia", () => {
  it("el cliente acepta con su nombre: quedan nombre, IP y navegador, canal enlace y sin autor interno", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, "anon");
      const acepta = await unaEn(tx, ACEPTAR, [t, "  Lucía   Esteve\nBaixauli ", " 203.0.113.9 ", "Mozilla/5.0 (prueba)"]);
      await ser(tx, "postgres");
      const fila = await unaEn(
        tx,
        `select estado, aceptado_canal, aceptado_por, aceptado_nombre, aceptado_ip, aceptado_user_agent, enviado_por
           from presupuestos where id = $1`,
        [SEED.presupuestoEnviado],
      );
      return { acepta: acepta.r, fila };
    });
    const { acepta, fila } = valor(r);
    expect(acepta).toMatchObject({ ok: true, estado: "aceptado" });
    expect(fila).toEqual({
      estado: "aceptado",
      aceptado_canal: "enlace",
      aceptado_por: null,
      aceptado_nombre: "Lucía Esteve Baixauli",
      aceptado_ip: "203.0.113.9",
      aceptado_user_agent: "Mozilla/5.0 (prueba)",
      enviado_por: GER,
    });
  });

  it("sin nombre (o con menos de 2 o más de 120 caracteres) no acepta y lo dice junto al campo", async () => {
    const t = await token(SEED.presupuestoEnviado);
    for (const nombre of [null, "", "   ", "A", "x".repeat(121), "\u200B\u200B", "..", "\u00A0\u2003.\uFEFF-", "12 34"]) {
      const r = valor(await base.filas("anon", ACEPTAR, [t, nombre, "203.0.113.9", "UA"]));
      expect(r[0].r).toMatchObject({ ok: false, campo: "nombre" });
      expect(String((r[0].r as { motivo: string }).motivo)).toMatch(/nombre/);
    }
    expect((await base.one("select estado from presupuestos where id = $1", [SEED.presupuestoEnviado]))?.estado).toBe(
      "enviado",
    );
  });

  it("el nombre se limpia de espacios Unicode y de ancho cero, y vale con letras con tilde", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const guardado = async (nombre: string) => {
      const r = await base.como("postgres", async (tx) => {
        await ser(tx, "anon");
        const acepta = (await unaEn(tx, ACEPTAR, [t, nombre, null, null])).r;
        await ser(tx, "postgres");
        const fila = await unaEn(tx, "select aceptado_nombre from presupuestos where id = $1", [SEED.presupuestoEnviado]);
        return { acepta, nombre: fila.aceptado_nombre };
      });
      return valor(r);
    };
    expect(await guardado("\u00A0Ana\u200B\u00A0 Pérez\u3000")).toMatchObject({ acepta: { ok: true }, nombre: "Ana Pérez" });
    expect(await guardado("Ñú")).toMatchObject({ acepta: { ok: true }, nombre: "Ñú" });
  });

  it("la IP (64) y el navegador (400) se recortan y se les quitan los caracteres de control", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, "anon");
      await en(tx, ACEPTAR, [t, "Lucía", `1.2.3.4\u0007${"9".repeat(80)}`, `UA\r\n${"x".repeat(500)}`]);
      await ser(tx, "postgres");
      return unaEn(tx, "select aceptado_ip, aceptado_user_agent from presupuestos where id = $1", [SEED.presupuestoEnviado]);
    });
    const fila = valor(r);
    expect(String(fila.aceptado_ip)).toHaveLength(64);
    expect(String(fila.aceptado_ip).startsWith("1.2.3.4999")).toBe(true);
    expect(String(fila.aceptado_user_agent)).toHaveLength(400);
    expect(String(fila.aceptado_user_agent)).toMatch(/^UAx+$/);
  });

  it("sin IP ni navegador también acepta (los guarda vacíos)", async () => {
    const t = await token(SEED.presupuestoEnviado);
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, "anon");
      await en(tx, ACEPTAR, [t, "Lucía Esteve", null, "  "]);
      await ser(tx, "postgres");
      return unaEn(tx, "select aceptado_ip, aceptado_user_agent from presupuestos where id = $1", [SEED.presupuestoEnviado]);
    });
    expect(valor(r)).toEqual({ aceptado_ip: null, aceptado_user_agent: null });
  });

  it("la versión de un argumento ya no existe y authenticated no puede aceptar", async () => {
    expect((await base.one("select to_regprocedure('public.aceptar_presupuesto(uuid)') as f"))?.f).toBeNull();
    const t = await token(SEED.presupuestoEnviado);
    expect(codigo(await base.filas("anon", "select aceptar_presupuesto($1::uuid)", [t]))).toBe("42883");
    expect(codigo(await base.filas(OBRA, ACEPTAR, [t, "Toni", null, null]))).toBe("42501");
    expect(codigo(await base.filas(GER, ACEPTAR, [t, "Laura", null, null]))).toBe("42501");
  });

  it("(documentado) un empleado que abre el enlace sin sesión puede aceptar, pero queda su rastro: nombre, IP, navegador y quién lo envió", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const t = (await unaEn(tx, "select token from presupuestos where id = $1", [SEED.presupuestoEnviado2])).token;
      await ser(tx, "anon");
      const acepta = await unaEn(tx, ACEPTAR, [t, "Toni Ferrer", "198.51.100.33", "Mozilla/5.0 (incógnito)"]);
      await ser(tx, GER);
      const visto = await unaEn(
        tx,
        `select aceptado_canal, aceptado_nombre, aceptado_ip, aceptado_user_agent, enviado_por
           from presupuestos_con_totales where id = $1`,
        [SEED.presupuestoEnviado2],
      );
      return { acepta: acepta.r, visto };
    });
    const { acepta, visto } = valor(r);
    expect(acepta).toMatchObject({ ok: true });
    expect(visto).toEqual({
      aceptado_canal: "enlace",
      aceptado_nombre: "Toni Ferrer",
      aceptado_ip: "198.51.100.33",
      aceptado_user_agent: "Mozilla/5.0 (incógnito)",
      enviado_por: OBRA,
    });
  });

  it("nadie elige ni cambia la evidencia: ni al crear, ni con un update, ni gerencia, ni el SQL Editor", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const alta = await unaEn(
        tx,
        `insert into presupuestos (empresa_id, cliente_id, titulo, enviado_por, aceptado_nombre, aceptado_ip, aceptado_user_agent)
         values ($1, $2, 'Forjado', $3, 'Falso', '1.1.1.1', 'UA') returning enviado_por, aceptado_nombre, aceptado_ip, aceptado_user_agent`,
        [E1, SEED.cliente(1), GER],
      );
      const cambios: Record<string, string> = {};
      for (const [quien, nombre] of [
        [OBRA, "obra"],
        [GER, "gerencia"],
        ["postgres", "postgres"],
      ] as const) {
        await ser(tx, quien);
        for (const sql of [
          "update presupuestos set aceptado_nombre = 'Otro' where id = $1 returning id",
          "update presupuestos set aceptado_ip = '9.9.9.9' where id = $1 returning id",
          "update presupuestos set aceptado_user_agent = 'otro' where id = $1 returning id",
          "update presupuestos set enviado_por = null where id = $1 returning id",
        ]) {
          cambios[`${nombre}: ${sql.split(" set ")[1].split(" =")[0]}`] = error(
            await probar(tx, sql, [SEED.presupuestoFacturado]),
          );
        }
      }
      return { alta, cambios };
    });
    const { alta, cambios } = valor(r);
    expect(alta).toEqual({ enviado_por: null, aceptado_nombre: null, aceptado_ip: null, aceptado_user_agent: null });
    for (const [paso, msg] of Object.entries(cambios)) {
      expect(msg, paso).toMatch(/lo pone el sistema|los pone el sistema/);
    }
  });

  it("la aceptación interna de gerencia no lleva nombre, IP ni navegador", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      return unaEn(
        tx,
        `update presupuestos set estado = 'aceptado', aceptado_nombre = 'Inventado', aceptado_ip = '1.1.1.1'
          where id = $1 returning aceptado_canal, aceptado_por, aceptado_nombre, aceptado_ip, aceptado_user_agent`,
        [SEED.presupuestoEnviado],
      );
    });
    expect(valor(r)).toEqual({
      aceptado_canal: "interno",
      aceptado_por: GER,
      aceptado_nombre: null,
      aceptado_ip: null,
      aceptado_user_agent: null,
    });
  });

  it("enviado_por lo pone la base al enviar (quien envía) y la vista lo enseña", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const envia = await unaEn(
        tx,
        "update presupuestos set estado = 'enviado', enviado_por = $2 where id = $1 returning enviado_por",
        [SEED.presupuestoBorrador, GER],
      );
      const vista = await unaEn(tx, "select enviado_por from presupuestos_con_totales where id = $1", [
        SEED.presupuestoBorrador,
      ]);
      return { envia, vista };
    });
    expect(valor(r)).toEqual({ envia: { enviado_por: OBRA }, vista: { enviado_por: OBRA } });
  });

  it("el seed deja la evidencia de demo: enviados con autor y aceptados por enlace con el nombre del cliente", async () => {
    const malos = await base.q(
      `select p.numero from presupuestos p join clientes c on c.id = p.cliente_id
        where p.empresa_id = $1 and (
              (p.estado <> 'borrador' and p.enviado_por is null)
           or (p.aceptado_canal = 'enlace' and (p.aceptado_nombre is distinct from c.nombre
               or p.aceptado_ip is null or p.aceptado_user_agent is null))
           or (p.aceptado_canal is distinct from 'enlace' and p.aceptado_nombre is not null))`,
      [E1],
    );
    expect(malos).toEqual([]);
    const conEvidencia = await base.one(
      "select count(*)::int as n from presupuestos where aceptado_canal = 'enlace' and aceptado_nombre is not null",
    );
    expect(Number(conEvidencia?.n)).toBeGreaterThanOrEqual(5);
  });

  it("al borrar el usuario que envió, enviado_por queda a null sin errores (FK)", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "delete from auth.users where id = $1", [OBRA]);
      return unaEn(
        tx,
        "select count(*)::int as n from presupuestos where enviado_por is not null and enviado_por = $1",
        [OBRA],
      );
    });
    expect(valor(r).n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("M1 · el empleado solo ve el semáforo", () => {
  const COLUMNAS =
    "id, estado, presupuestado_cents, coste_mano_obra_cents, coste_material_cents, coste_real_cents, margen_cents, consumido_pct, semaforo";

  it("el empleado recibe importes y % consumido a null, y el semáforo de cada obra", async () => {
    const filas = valor(await base.filas(OBRA, `select ${COLUMNAS} from obras_resumen`));
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(f.presupuestado_cents).toBeNull();
      expect(f.coste_mano_obra_cents).toBeNull();
      expect(f.coste_material_cents).toBeNull();
      expect(f.coste_real_cents).toBeNull();
      expect(f.margen_cents).toBeNull();
      expect(f.consumido_pct).toBeNull();
      expect(["verde", "ambar", "rojo"]).toContain(f.semaforo);
    }
  });

  it("el semáforo es el mismo para empleado y gerencia, y cuadra con semaforoObra() del dominio", async () => {
    const ger = valor(await base.filas(GER, `select ${COLUMNAS} from obras_resumen order by id`));
    const emp = valor(await base.filas(OBRA, `select id, semaforo from obras_resumen order by id`));
    expect(emp.map((f) => f.semaforo)).toEqual(ger.map((f) => f.semaforo));
    for (const f of ger) {
      expect(f.consumido_pct).not.toBeUndefined();
      const pct = f.consumido_pct === null ? null : Number(f.consumido_pct);
      expect(f.semaforo, String(f.id)).toBe(semaforoObra(pct, f.estado as EstadoObra));
    }
    expect(new Set(ger.map((f) => f.semaforo))).toEqual(new Set(["verde", "ambar", "rojo"]));
  });

  it("en el umbral: 80,0 % ámbar, 100,0 % ámbar y 100,1 % rojo, como el dominio", async () => {
    // Obra de ventanas (pendiente, sin partes): se empieza y se le apunta un parte que gaste el % pedido.
    const r = await base.como("postgres", async (tx) => {
      const base_ = Number(
        (await unaEn(tx, "select base_cents from presupuestos_con_totales where id = $1", [SEED.presupuestoVentanas]))
          .base_cents,
      );
      await ser(tx, GER);
      await en(tx, "update obras set estado = 'en_curso' where id = $1", [SEED.obraVentanas]);
      await ser(tx, "postgres");
      const salida: Record<string, string> = {};
      for (const pct of [79.9, 80, 100, 100.1]) {
        await en(tx, "select set_config('tajo.seed', 'on', true)");
        await en(tx, "delete from partes where obra_id = $1", [SEED.obraVentanas]);
        // 1 hora con el coste que haga falta (los partes copian el coste/hora; en modo seed se pone a mano).
        await en(
          tx,
          `insert into partes (empresa_id, obra_id, fecha, autor_id, horas, coste_hora_cents)
           values ($1, $2, $3, $4, 1, $5)`,
          [E1, SEED.obraVentanas, hoy, OBRA, Math.round((base_ * pct) / 100)],
        );
        await en(tx, "select set_config('tajo.seed', 'off', true)");
        await ser(tx, OBRA);
        salida[String(pct)] = String((await unaEn(tx, "select semaforo from obras_resumen where id = $1", [SEED.obraVentanas])).semaforo);
        await ser(tx, "postgres");
      }
      return salida;
    });
    expect(valor(r)).toEqual({ "79.9": "verde", "80": "ambar", "100": "ambar", "100.1": "rojo" });
  });

  it("(límite conocido, D12) los costes copiados siguen siendo legibles por la API dentro de la empresa", async () => {
    const r = valor(await base.filas(OBRA, "select coste_hora_cents from partes where coste_hora_cents is not null limit 1"));
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B1 · cuota de IA también por usuario (15 al día dentro de las 40 de la empresa)", () => {
  it("un empleado gasta sus 15 y la 16.ª da TJ003 sin contar nada; otro usuario de la empresa sigue pudiendo", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const quedan: number[] = [];
      for (let i = 0; i < 15; i++) quedan.push(Number((await unaEn(tx, "select * from consumir_uso_ia()")).quedan));
      const decimosexta = await probar(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const contadores = await unaEn(
        tx,
        `select (select usos from uso_ia where empresa_id = $1) as empresa,
                (select usos from uso_ia_perfiles where perfil_id = $2) as perfil,
                (select count(*)::int from uso_ia_reservas where perfil_id = $2) as reservas`,
        [E1, OBRA],
      );
      await ser(tx, OBRA2);
      const otro = await unaEn(tx, "select * from consumir_uso_ia()");
      return { quedan, decimosexta, contadores, otro };
    });
    const { quedan, decimosexta, contadores, otro } = valor(r);
    expect(quedan).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(codigo(decimosexta)).toBe("TJ003");
    expect(error(decimosexta)).toBe(
      "Has llegado a tu límite de 15 propuestas con IA de hoy. Vuelve a intentarlo mañana.",
    );
    expect(contadores).toEqual({ empresa: 15, perfil: 15, reservas: 15 });
    // OBRA2: le quedan 14 suyas; a la empresa, 40 − 16 = 24.
    expect(Number(otro.quedan)).toBe(14);
  });

  it("con la empresa llena (40) da TJ002 y no cuenta nada en el contador del usuario", async () => {
    const r = await base.como("postgres", async (tx) => {
      for (const [quien, veces] of [
        [OBRA, 15],
        [OBRA2, 15],
        [GER, 10],
      ] as const) {
        await ser(tx, quien);
        for (let i = 0; i < veces; i++) await en(tx, "select * from consumir_uso_ia()");
      }
      await ser(tx, GER);
      const llena = await probar(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const c = await unaEn(
        tx,
        `select (select usos from uso_ia where empresa_id = $1) as empresa,
                (select usos from uso_ia_perfiles where perfil_id = $2) as perfil`,
        [E1, GER],
      );
      return { llena, c };
    });
    const { llena, c } = valor(r);
    expect(codigo(llena)).toBe("TJ002");
    expect(c).toEqual({ empresa: 40, perfil: 10 });
  });

  it("devolver una reserva resta de la empresa y del usuario; una sola vez y solo el mismo usuario", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const { reserva } = await unaEn(tx, "select * from consumir_uso_ia()");
      await en(tx, "select * from consumir_uso_ia()");
      await ser(tx, OBRA2);
      const ajena = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, OBRA);
      const primera = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      const segunda = (await unaEn(tx, "select devolver_uso_ia($1) as d", [reserva])).d;
      await ser(tx, "postgres");
      const c = await unaEn(
        tx,
        `select (select usos from uso_ia where empresa_id = $1) as empresa,
                (select usos from uso_ia_perfiles where perfil_id = $2) as perfil`,
        [E1, OBRA],
      );
      return { ajena, primera, segunda, c };
    });
    expect(valor(r)).toEqual({ ajena: false, primera: true, segunda: false, c: { empresa: 1, perfil: 1 } });
  });

  it("uso_ia_perfiles no se puede leer ni escribir desde la API", async () => {
    for (const quien of ["anon", OBRA, GER] as const) {
      expect(codigo(await base.filas(quien, "select * from uso_ia_perfiles"))).toBe("42501");
      expect(
        codigo(await base.filas(quien, "insert into uso_ia_perfiles (perfil_id, empresa_id, dia, usos) values ($1, $2, current_date, 0)", [OBRA, E1])),
      ).toBe("42501");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B2 · NIF validado en la base con letra o dígito de control", () => {
  it("rechaza un NIF con la letra mal (12345678A) y acepta el bueno normalizado", async () => {
    const malo = await base.filas(OBRA, "insert into clientes (empresa_id, nombre, nif) values ($1, 'X', '12345678A') returning id", [E1]);
    expect(codigo(malo)).toBe("23514");
    expect(error(malo)).toMatch(/clientes_nif_valido_chk/);
    const bueno = valor(
      await base.filas(OBRA, "insert into clientes (empresa_id, nombre, nif) values ($1, 'X', ' 12.345.678-z ') returning nif", [E1]),
    );
    expect(bueno[0].nif).toBe("12345678Z");
    const cambio = await base.filas(OBRA, "update clientes set nif = 'B12345670' where id = $1 returning id", [SEED.cliente(6)]);
    expect(codigo(cambio)).toBe("23514");
  });

  it("nif_valido() da lo mismo que nifError() del dominio en DNI, NIE, K/L/M y CIF, buenos y con el control cambiado", async () => {
    const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";
    const CIF_LETRAS = "ABCDEFGHJNPQRSUVW";
    const casos = new Set<string>();
    let semilla = 12345;
    const azar = (n: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % n;
    };
    const cifras = (n: number) => Array.from({ length: n }, () => azar(10)).join("");
    for (let i = 0; i < 300; i++) {
      const dni = cifras(8);
      const letra = LETRAS[Number(dni) % 23];
      casos.add(dni + letra);
      casos.add(dni + LETRAS[(Number(dni) + 1) % 23]);
      const nie = cifras(7);
      const pre = "XYZ"[azar(3)];
      casos.add(pre + nie + LETRAS[Number(`${"XYZ".indexOf(pre)}${nie}`) % 23]);
      casos.add(pre + nie + LETRAS[azar(23)]);
      const klm = cifras(7);
      casos.add("KLM"[azar(3)] + klm + LETRAS[Number(klm) % 23]);
      const c = cifras(7);
      const ini = CIF_LETRAS[azar(CIF_LETRAS.length)];
      for (const control of ["0123456789"[azar(10)], "JABCDEFGHI"[azar(10)]]) casos.add(ini + c + control);
    }
    for (const raro of ["", "123", "1234567890", "IÑ1234567", "I1234567A", "B1234567K", "00000000T", "X0000000T"]) casos.add(raro);
    const lista = [...casos];
    const filas = await base.q("select x, nif_valido(x) as v from unnest($1::text[]) as x", [lista]);
    const distintos = filas.filter((f) => f.v !== (nifError(String(f.x)) === null)).map((f) => f.x);
    expect(distintos).toEqual([]);
    expect(filas.filter((f) => f.v === true).length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B3 · partes: 24 h por persona y día, 30 días hacia atrás e inicio fijo", () => {
  it("como mucho 24 h por autor y día, sumando todas sus obras; el mensaje dice cuántas lleva", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER);
      await en(tx, "update obras set estado = 'en_curso' where id = $1", [SEED.obraVentanas]);
      await ser(tx, OBRA);
      await en(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 12.5)", [E1, SEED.obraCocina]);
      await en(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 8)", [E1, SEED.obraVentanas]);
      const pasa = await probar(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 4) returning id", [E1, SEED.obraCocina]);
      const justo = await probar(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 3.5) returning id", [E1, SEED.obraCocina]);
      // Otro autor ese mismo día no cuenta para Toni.
      await ser(tx, OBRA2);
      const otro = await probar(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 24) returning id", [E1, SEED.obraCocina]);
      // Gerencia no puede inflar el parte de Toni por encima de 24 h ese día.
      await ser(tx, GER);
      const parte = (await unaEn(tx, "select id from partes where autor_id = $1 and fecha = $2 and horas = 8", [OBRA, hoy])).id;
      const inflar = await probar(tx, "update partes set horas = 9 where id = $1 returning id", [parte]);
      const bajar = await probar(tx, "update partes set horas = 7 where id = $1 returning id", [parte]);
      return { pasa, justo, otro, inflar, bajar };
    });
    const { pasa, justo, otro, inflar, bajar } = valor(r);
    expect(error(pasa)).toBe("Ese día ya tienes 20,5 h apuntadas: como mucho 24 h por persona y día.");
    expect(justo.ok).toBe(true);
    expect(otro.ok).toBe(true);
    expect(error(inflar)).toBe("Ese día ya tienes 16 h apuntadas: como mucho 24 h por persona y día.");
    expect(bajar.ok).toBe(true);
  });

  it("también por guardar_parte y al cambiar la fecha de un parte a un día ya lleno", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      await en(tx, "select guardar_parte(null, $1, null, 20, null, '[]')", [SEED.obraCocina]);
      const rpc = await probar(tx, "select guardar_parte(null, $1, null, 5, null, '[]')", [SEED.obraCocina]);
      const ayer = diasAntes(hoy, 1);
      const parteAyer = (await unaEn(
        tx,
        "select guardar_parte(null, $1, $2, 6, null, '[]') as id",
        [SEED.obraCocina, ayer],
      )).id;
      // El seed ya tiene 6 h de Toni ayer en la cocina: 12 h. Moverlo a hoy (20 h) se pasa.
      const mover = await probar(tx, "update partes set fecha = $2 where id = $1 returning id", [parteAyer, hoy]);
      return { rpc, mover };
    });
    const { rpc, mover } = valor(r);
    expect(error(rpc)).toBe("Ese día ya tienes 20 h apuntadas: como mucho 24 h por persona y día.");
    expect(error(mover)).toMatch(/^Ese día ya tienes 20 h apuntadas/);
  });

  it("la fecha del parte, como mucho 30 días atrás (al crearlo o cambiarle la fecha); corregir horas de uno antiguo sí se puede", async () => {
    const r = await base.como("postgres", async (tx) => {
      // La cocina empezó hace 9 días: se retrasa su inicio (modo seed) para que la regla de 30 días sea la que mande.
      await en(tx, "select set_config('tajo.seed', 'on', true)");
      await en(tx, "update obras set fecha_inicio = $2 where id = $1", [SEED.obraCocina, diasAntes(hoy, 90)]);
      await en(
        tx,
        `insert into partes (id, empresa_id, obra_id, fecha, autor_id, horas, coste_hora_cents, created_at)
         values ('50000000-0000-4000-8000-00000000a040', $1, $2, $3, $4, 4, 2600, now())`,
        [E1, SEED.obraCocina, diasAntes(hoy, 40), OBRA],
      );
      await en(tx, "select set_config('tajo.seed', 'off', true)");
      await ser(tx, OBRA);
      const treinta = await probar(tx, "insert into partes (empresa_id, obra_id, fecha, horas) values ($1, $2, $3, 1) returning id", [
        E1,
        SEED.obraCocina,
        diasAntes(hoy, 30),
      ]);
      const treintaYUno = await probar(tx, "insert into partes (empresa_id, obra_id, fecha, horas) values ($1, $2, $3, 1) returning id", [
        E1,
        SEED.obraCocina,
        diasAntes(hoy, 31),
      ]);
      const rpc = await probar(tx, "select guardar_parte(null, $1, $2, 1, null, '[]')", [SEED.obraCocina, diasAntes(hoy, 45)]);
      await ser(tx, GER);
      const horasAntiguo = await probar(tx, "update partes set horas = 5 where id = '50000000-0000-4000-8000-00000000a040' returning id");
      const fechaAntigua = await probar(tx, "update partes set fecha = $1 where id = '50000000-0000-4000-8000-00000000a040' returning id", [
        diasAntes(hoy, 41),
      ]);
      return { treinta, treintaYUno, rpc, horasAntiguo, fechaAntigua };
    });
    const { treinta, treintaYUno, rpc, horasAntiguo, fechaAntigua } = valor(r);
    const MSG = "La fecha del parte no puede ser de hace más de 30 días.";
    expect(treinta.ok).toBe(true);
    expect(error(treintaYUno)).toBe(MSG);
    expect(error(rpc)).toBe(MSG);
    expect(horasAntiguo.ok).toBe(true);
    expect(error(fechaAntigua)).toBe(MSG);
  });

  it("la fecha de inicio no se cambia una vez empezada la obra (ni el encargado ni gerencia); pendiente, sí", async () => {
    const r = await base.como("postgres", async (tx) => {
      const pasos: Record<string, string> = {};
      for (const [quien, nombre] of [
        [OBRA, "encargado"],
        [GER, "gerencia"],
      ] as const) {
        await ser(tx, quien);
        pasos[`${nombre} atrasa`] = error(
          await probar(tx, "update obras set fecha_inicio = fecha_inicio - 365 where id = $1 returning id", [SEED.obraCocina]),
        );
        pasos[`${nombre} adelanta`] = error(
          await probar(tx, "update obras set fecha_inicio = fecha_inicio + 1 where id = $1 returning id", [SEED.obraCocina]),
        );
      }
      await ser(tx, GER);
      const pendiente = await probar(tx, "update obras set fecha_inicio = $2 where id = $1 returning fecha_inicio::text", [
        SEED.obraVentanas,
        diasAntes(hoy, -4),
      ]);
      const empezar = await unaEn(tx, "update obras set estado = 'en_curso' where id = $1 returning fecha_inicio::text as f", [
        SEED.obraVentanas,
      ]);
      const parada = await en(tx, "update obras set estado = 'parada' where id = $1 returning id", [SEED.obraVentanas]);
      const enParada = await probar(tx, "update obras set fecha_inicio = fecha_inicio - 1 where id = $1 returning id", [SEED.obraVentanas]);
      return { pasos, pendiente, empezar, parada: parada.length, enParada };
    });
    const { pasos, pendiente, empezar, parada, enParada } = valor(r);
    for (const [paso, msg] of Object.entries(pasos)) {
      expect(msg, paso).toBe("La fecha de inicio no se cambia una vez empezada la obra.");
    }
    expect(pendiente.ok).toBe(true);
    // Al empezar, una fecha prevista futura pasa a hoy (0006); a partir de ahí, fija.
    expect(empezar.f).toBe(hoy);
    expect(parada).toBe(1);
    expect(error(enParada)).toBe("La fecha de inicio no se cambia una vez empezada la obra.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B4 · un presupuesto aceptado o facturado no se borra", () => {
  it("gerencia borra borradores, enviados y rechazados", async () => {
    for (const id of [SEED.presupuestoBorrador, SEED.presupuestoEnviado, SEED.presupuestoRechazado]) {
      const r = valor(await base.filas(GER, "delete from presupuestos where id = $1 returning estado", [id]));
      expect(r, id).toHaveLength(1);
    }
  });

  it("aceptados (con obra sin partes o con partes) y facturados: 0 filas para gerencia; mensaje en el SQL Editor", async () => {
    for (const id of [SEED.presupuestoVentanas, SEED.presupuestoCocina, SEED.presupuestoFacturado]) {
      expect(valor(await base.filas(GER, "delete from presupuestos where id = $1 returning id", [id])), id).toEqual([]);
      expect(error(await base.filas("postgres", "delete from presupuestos where id = $1 returning id", [id])), id).toBe(
        "Un presupuesto aceptado o facturado no se borra.",
      );
    }
    expect((await base.one("select count(*)::int as n from obras where id = $1", [SEED.obraVentanas]))?.n).toBe(1);
  });

  it("el empleado no borra ningún presupuesto", async () => {
    expect(bloqueado(await base.filas(OBRA, "delete from presupuestos where id = $1 returning id", [SEED.presupuestoBorrador]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B5 · guardar_presupuesto no redondea en silencio y exige un orden válido", () => {
  const GUARDAR = "select guardar_presupuesto(null, $1, 'Prueba', 21, 30, $2::jsonb) as id";
  const partida = (orden: unknown, cantidad: unknown) => ({ orden, descripcion: "x", cantidad, precio_cents: 100, material_id: null });

  it("cantidad con 4 decimales: rechazada con el número de la partida; con 3, se guarda tal cual", async () => {
    const malo = await base.filas(OBRA, GUARDAR, [SEED.cliente(1), JSON.stringify([partida(1, 1), partida(2, 1.0005)])]);
    expect(error(malo)).toBe("La cantidad de la partida 2 puede tener como mucho 3 decimales.");
    // Como texto JSON se convertiría y redondearía en silencio: se rechaza (también si falta o es null).
    for (const cantidad of ["1.00049", "2", null, undefined]) {
      const r = await base.filas(OBRA, GUARDAR, [SEED.cliente(1), JSON.stringify([partida(1, 1), partida(2, cantidad)])]);
      expect(error(r), String(cantidad)).toBe("La cantidad de la partida 2 no es válida.");
    }
    const r = await base.como(OBRA, async (tx) => {
      const id = (await unaEn(tx, GUARDAR, [SEED.cliente(1), JSON.stringify([partida(1, 1.125)])])).id;
      return unaEn(tx, "select cantidad::text as c from presupuesto_lineas where presupuesto_id = $1", [id]);
    });
    expect(valor(r).c).toBe("1.125");
  });

  it("orden 0, negativo, decimal, ausente o repetido: rechazado", async () => {
    const casos: [unknown[], RegExp][] = [
      [[partida(0, 1)], /orden de la partida 1 tiene que ser un número entero mayor que 0/],
      [[partida(1, 1), partida(-5, 1)], /orden de la partida 2/],
      [[partida(1.5, 1)], /orden de la partida 1/],
      [[partida(null, 1)], /orden de la partida 1/],
      [[partida(1, 1), partida(2, 1), partida(1, 1)], /La partida 3 repite el orden 1/],
    ];
    for (const [partidas, msg] of casos) {
      expect(error(await base.filas(OBRA, GUARDAR, [SEED.cliente(1), JSON.stringify(partidas)]))).toMatch(msg);
    }
  });

  it("por insert directo: unique (presupuesto_id, orden) y orden > 0", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const repetido = await probar(
        tx,
        "insert into presupuesto_lineas (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents) values ($1, $2, 1, 'x', 1, 1)",
        [E1, SEED.presupuestoBorrador],
      );
      const cero = await probar(
        tx,
        "insert into presupuesto_lineas (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents) values ($1, $2, 0, 'x', 1, 1)",
        [E1, SEED.presupuestoBorrador],
      );
      return { repetido, cero };
    });
    const { repetido, cero } = valor(r);
    expect(codigo(repetido)).toBe("23505");
    expect(codigo(cero)).toBe("23514");
  });

  it("editar un borrador reordenando sus partidas sigue funcionando", async () => {
    const r = await base.filas(
      OBRA,
      "select guardar_presupuesto($1, $2, 'Reordenado', 10, 30, $3::jsonb) as id",
      [SEED.presupuestoBorrador, SEED.cliente(5), JSON.stringify([partida(2, 1), partida(1, 3)])],
    );
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("B7 · invitaciones usadas y perfil solo con el email confirmado", () => {
  it("el seed deja usadas las invitaciones de gerencia y obra, y las de los usuarios extra se marcan al darse de alta", async () => {
    const filas = await base.q("select email, usada_at is not null as usada from invitaciones order by email");
    expect(filas).toEqual([
      { email: "gerencia@reformaslevante.es", usada: true },
      { email: "jefa@construccionesajenas.es", usada: true },
      { email: "obra2@reformaslevante.es", usada: true },
      { email: "obra@reformaslevante.es", usada: true },
    ]);
    expect(await base.one("select id from perfiles where id = $1", [INTRUSO])).toBeUndefined();
  });

  it("sin confirmar no hay perfil; al confirmar, sí, y la invitación queda usada", async () => {
    const id = "aaaaaaaa-0000-4000-8000-0000000000b1";
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "insert into invitaciones (email, empresa_id, rol) values ('nueva@reformaslevante.es', $1, 'empleado')", [E1]);
      await en(tx, "insert into auth.users (id, email) values ($1, 'nueva@reformaslevante.es')", [id]);
      const antes = await en(tx, "select rol from perfiles where id = $1", [id]);
      const usadaAntes = (await unaEn(tx, "select usada_at from invitaciones where email = 'nueva@reformaslevante.es'")).usada_at;
      await en(tx, "update auth.users set email_confirmed_at = now() where id = $1", [id]);
      const despues = await en(tx, "select rol, empresa_id from perfiles where id = $1", [id]);
      const usadaDespues = (await unaEn(tx, "select usada_at from invitaciones where email = 'nueva@reformaslevante.es'")).usada_at;
      // Otro cambio del usuario (p. ej. volver a confirmar) no crea nada más ni falla.
      await en(tx, "update auth.users set email_confirmed_at = now() + interval '1 minute' where id = $1", [id]);
      return { antes, usadaAntes, despues, usadaDespues };
    });
    const { antes, usadaAntes, despues, usadaDespues } = valor(r);
    expect(antes).toEqual([]);
    expect(usadaAntes).toBeNull();
    expect(despues).toEqual([{ rol: "empleado", empresa_id: E1 }]);
    expect(usadaDespues).not.toBeNull();
  });

  it("una invitación usada no da perfil a otro usuario con el mismo email (ni al darse de alta ni al confirmar)", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-4000-8000-0000000000b2', 'OBRA@reformaslevante.es', now())");
      await en(tx, "insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-0000000000b3', 'gerencia@reformaslevante.es')");
      await en(tx, "update auth.users set email_confirmed_at = now() where id = 'aaaaaaaa-0000-4000-8000-0000000000b3'");
      return en(tx, "select id from perfiles where id in ('aaaaaaaa-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-0000000000b3')");
    });
    expect(valor(r)).toEqual([]);
  });

  it("para reutilizar el email de una invitación usada basta con usada_at = null", async () => {
    const r = await base.como("postgres", async (tx) => {
      await en(tx, "update invitaciones set usada_at = null where email = 'obra2@reformaslevante.es'");
      await en(tx, "delete from auth.users where id = $1", [OBRA2]);
      await en(tx, "insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-4000-8000-0000000000b4', 'obra2@reformaslevante.es', now())");
      return en(tx, "select rol from perfiles where id = 'aaaaaaaa-0000-4000-8000-0000000000b4'");
    });
    expect(valor(r)).toEqual([{ rol: "empleado" }]);
  });

  it("nadie lee ni escribe invitaciones desde la API (tampoco gerencia)", async () => {
    for (const quien of ["anon", OBRA, GER] as const) {
      expect(codigo(await base.filas(quien, "select * from invitaciones"))).toBe("42501");
      expect(codigo(await base.filas(quien, "update invitaciones set usada_at = null"))).toBe("42501");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("0007 · permisos y forma de las funciones nuevas", () => {
  it("anon solo ejecuta presupuesto_publico y aceptar_presupuesto (más allá de las funciones de trigger)", async () => {
    const f = await base.q(`
      select p.oid::regprocedure::text as f
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and pg_get_function_result(p.oid) <> 'trigger'
         and has_function_privilege('anon', p.oid, 'execute')
       order by 1`);
    expect(f.map((x) => x.f)).toEqual(["aceptar_presupuesto(uuid,text,text,text)", "presupuesto_publico(uuid)"]);
  });

  it("intento() deshace un paso fallido sin romper la escena (control del andamio)", async () => {
    const r = await base.como("postgres", async (tx) => {
      const fallo = await intento(tx, () => en(tx, "select 1/0"));
      return { fallo: codigo(fallo), sigue: (await unaEn(tx, "select 1 as x")).x };
    });
    expect(valor(r)).toEqual({ fallo: "22012", sigue: 1 });
  });
});
