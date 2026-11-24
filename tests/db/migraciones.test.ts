// Migraciones y seed: 0007 se aplica sobre una base con datos (como la real: 0001 → 0006 y actividad de la app) sin
// perder nada, aborta con la lista si hay datos que no cumplirían sus reglas, y 0006, 0007 y el seed se pueden volver
// a ejecutar. Después, 0008 sobre esa misma base (ya con 0007 y más actividad): mueve la IP y el navegador a su tabla,
// rellena el nombre de quien envió, no pierde nada y se puede volver a ejecutar. Después, 0009 (caché de propuestas de
// IA): no toca nada de lo que había y se puede volver a ejecutar sin perder las propuestas. El seed va al final
// (necesita 0008 y 0009).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Base,
  E1,
  GER,
  OBRA,
  SEED,
  baseVacia,
  crearUsuariosDemo,
  en,
  migracion,
  migraciones,
  seed,
  ser,
  unaEn,
  valor,
} from "./andamio";

const HASTA_0006 = migraciones().filter((m) => m < "0007");
const HASTA_0007 = migraciones().filter((m) => m < "0008");
const HASTA_0008 = migraciones().filter((m) => m < "0009");

let base: Base;
/** Presupuestos creados como lo haría la app antes de 0007. */
const app = { cliente: "", aceptadoEnlace: "", facturado: "", interno: "", borrador: "" };

/** Lo que no debe cambiar al aplicar 0007: filas de cada tabla y los importes. */
async function foto(b: Base) {
  const n = async (t: string) => Number((await b.one(`select count(*)::int as n from ${t}`))?.n);
  const tablas = [
    "empresas", "perfiles", "invitaciones", "clientes", "materiales", "presupuestos", "presupuesto_lineas", "facturas",
    "factura_lineas", "contadores", "obras", "partes", "parte_materiales", "uso_ia", "uso_ia_reservas",
  ];
  const cuentas: Record<string, number> = {};
  for (const t of tablas) cuentas[t] = await n(t);
  return {
    cuentas,
    totales: await b.q(
      "select id, estado, aceptado_canal, aceptado_por, base_cents::text, total_cents::text from presupuestos_con_totales order by id",
    ),
    facturas: await b.q("select numero, total_cents::text, cliente_nif from facturas order by numero"),
    obras: await b.q(
      "select id, estado, horas::text, coste_real_cents::text, margen_cents::text, consumido_pct::text from obras_resumen order by id",
    ),
    perfiles: await b.q("select id, empresa_id, rol from perfiles order by id"),
  };
}

beforeAll(async () => {
  base = await baseVacia();
  for (const m of HASTA_0006) await base.exec(migracion(m));
  // Usuarios de la base real: invitados (0004) antes de darse de alta.
  await base.exec(`
    insert into invitaciones (email, empresa_id, rol) values
      ('gerencia@reformaslevante.es', '${E1}', 'admin'), ('obra@reformaslevante.es', '${E1}', 'empleado');`);
  await crearUsuariosDemo(base);

  // Actividad de la app con 0001 → 0006: cliente, presupuestos, envío, aceptación por enlace (firma vieja) y por
  // gerencia, factura, obra en curso con un parte y un uso de IA.
  const r = await base.como(
    "postgres",
    async (tx) => {
      await ser(tx, OBRA);
      app.cliente = String(
        (await unaEn(tx, "insert into clientes (empresa_id, nombre, nif) values ($1, 'Cliente real', '48291736Q') returning id", [E1])).id,
      );
      const crear = async (titulo: string) =>
        String(
          (
            await unaEn(
              tx,
              `select guardar_presupuesto(null, $1, $2, 21, 30,
                 '[{"orden":1,"descripcion":"Partida","cantidad":2.5,"precio_cents":1999,"material_id":null},
                   {"orden":2,"descripcion":"Otra","cantidad":1.333,"precio_cents":3333,"material_id":null}]'::jsonb) as id`,
              [app.cliente, titulo],
            )
          ).id,
        );
      app.aceptadoEnlace = await crear("Aceptado por el cliente");
      app.facturado = await crear("Facturado");
      app.interno = await crear("Aceptado por gerencia");
      app.borrador = await crear("Borrador");
      await en(tx, "update presupuestos set estado = 'enviado' where id = any($1)", [
        [app.aceptadoEnlace, app.facturado, app.interno],
      ]);
      await en(tx, "select * from consumir_uso_ia()");
      await ser(tx, "postgres");
      const tokens = await en(tx, "select token from presupuestos where id = any($1)", [[app.aceptadoEnlace, app.facturado]]);
      await ser(tx, "anon");
      for (const t of tokens) await en(tx, "select aceptar_presupuesto($1::uuid)", [t.token]);
      await ser(tx, GER);
      await en(tx, "update presupuestos set estado = 'aceptado' where id = $1", [app.interno]);
      await en(tx, "select facturar_presupuesto($1)", [app.facturado]);
      await en(tx, "update obras set estado = 'en_curso', encargado_id = $2 where presupuesto_id = $1", [app.aceptadoEnlace, OBRA]);
      await ser(tx, OBRA);
      await en(tx, "select guardar_parte(null, (select id from obras where presupuesto_id = $1), null, 6, 'Parte real', '[]')", [
        app.aceptadoEnlace,
      ]);
    },
    { guardar: true },
  );
  valor(r);
});
afterAll(() => base?.cerrar());

describe("0007 sobre una base 0001 → 0006 con datos", () => {
  it("con datos que no cumplirían sus reglas, no aplica nada y dice cuáles", async () => {
    await base.exec(`
      select set_config('tajo.seed', 'on', false);
      update clientes set nif = '12345678A' where id = '${app.cliente}';
      update presupuesto_lineas set orden = 1 where presupuesto_id = '${app.borrador}';
      select set_config('tajo.seed', 'off', false);`);
    let msg = "";
    try {
      await base.exec(migracion("0007_auditoria2.sql"));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/No se ha aplicado nada/);
    expect(msg).toMatch(/12345678A \(Cliente real\)/);
    expect(msg).toMatch(/dos partidas con el mismo orden: P-\d{4}-\d{4}/);
    // Nada a medias: ni la función, ni las columnas, ni la tabla nuevas.
    const quedo = await base.one(`
      select to_regprocedure('public.nif_valido(text)') as f, to_regclass('public.uso_ia_perfiles') as t,
             exists (select 1 from information_schema.columns where table_name = 'presupuestos' and column_name = 'aceptado_nombre') as c`);
    expect(quedo).toEqual({ f: null, t: null, c: false });
    await base.exec(`
      select set_config('tajo.seed', 'on', false);
      update clientes set nif = '48291736Q' where id = '${app.cliente}';
      update presupuesto_lineas l set orden = x.n
        from (select id, row_number() over (order by descripcion) as n from presupuesto_lineas where presupuesto_id = '${app.borrador}') x
       where l.id = x.id;
      select set_config('tajo.seed', 'off', false);`);
  });

  it("se aplica sin perder ni cambiar nada, y marca usadas las invitaciones con perfil", async () => {
    const antes = await foto(base);
    await base.exec(migracion("0007_auditoria2.sql"));
    const despues = await foto(base);
    expect(despues).toEqual(antes);
    const inv = await base.q("select email, usada_at is not null as usada from invitaciones order by email");
    expect(inv.every((i) => i.usada)).toBe(true);
    // Lo aceptado antes de 0007 se queda sin nombre, IP ni navegador (no se sabe) y sin quién lo envió.
    const viejo = await base.one(
      "select aceptado_canal, aceptado_nombre, aceptado_ip, aceptado_user_agent, enviado_por from presupuestos where id = $1",
      [app.aceptadoEnlace],
    );
    expect(viejo).toEqual({ aceptado_canal: "enlace", aceptado_nombre: null, aceptado_ip: null, aceptado_user_agent: null, enviado_por: null });
  });

  it("la app sigue funcionando con la firma nueva: un presupuesto viejo enviado se acepta con nombre", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      await en(tx, "select guardar_presupuesto($1, $2, 'Borrador', 21, 30, $3::jsonb)", [
        app.borrador,
        app.cliente,
        JSON.stringify([{ orden: 1, descripcion: "Partida", cantidad: 1, precio_cents: 100, material_id: null }]),
      ]);
      await en(tx, "update presupuestos set estado = 'enviado' where id = $1", [app.borrador]);
      const t = (await unaEn(tx, "select token from presupuestos where id = $1", [app.borrador])).token;
      await ser(tx, "anon");
      return (await unaEn(tx, "select aceptar_presupuesto($1, 'Cliente real', '203.0.113.1', 'UA') as r", [t])).r;
    });
    expect(valor(r)).toMatchObject({ ok: true });
  });

  it("0007 se puede volver a ejecutar y deja lo mismo", async () => {
    const antes = await foto(base);
    await base.exec(migracion("0007_auditoria2.sql"));
    expect(await foto(base)).toEqual(antes);
  });

  it("volver a ejecutar 0006 no falla; después hay que volver a ejecutar 0007, que deja el semáforo y las reglas", async () => {
    await base.exec(migracion("0006_obras.sql"));
    expect(
      await base.one("select count(*)::int as n from information_schema.columns where table_name = 'obras_resumen' and column_name = 'semaforo'"),
    ).toEqual({ n: 0 });
    await base.exec(migracion("0007_auditoria2.sql"));
    const r = await base.filas(OBRA, "select semaforo, consumido_pct from obras_resumen");
    expect(valor(r).every((f) => f.semaforo && f.consumido_pct === null)).toBe(true);
  });
});

describe("0008 sobre una base 0001 → 0007 con datos", () => {
  /** Presupuesto enviado por obra y aceptado por el enlace con IP y navegador cuando la base tenía 0007. */
  let conEvidencia = "";

  it("se aplica sin perder nada: copia la IP y el navegador a su tabla, quita las columnas y rellena quién envió", async () => {
    // Actividad con 0007: obra envía el borrador y el cliente lo acepta por el enlace con IP y navegador.
    conEvidencia = app.borrador;
    const r = await base.como(
      "postgres",
      async (tx) => {
        await ser(tx, OBRA);
        await en(tx, "update presupuestos set estado = 'enviado' where id = $1", [conEvidencia]);
        await ser(tx, "postgres");
        const t = (await unaEn(tx, "select token from presupuestos where id = $1", [conEvidencia])).token;
        await ser(tx, "anon");
        await en(tx, "select aceptar_presupuesto($1, 'Cliente real', '203.0.113.7', 'Navegador de antes')", [t]);
      },
      { guardar: true },
    );
    valor(r);
    const nombreObra = (await base.one("select nombre from perfiles where id = $1", [OBRA]))?.nombre;

    const antes = await foto(base);
    await base.exec(migracion("0008_auditoria3.sql"));
    expect(await foto(base)).toEqual(antes);

    expect(
      await base.q(
        `select column_name from information_schema.columns
          where table_name = 'presupuestos' and column_name in ('aceptado_ip', 'aceptado_user_agent')`,
      ),
    ).toEqual([]);
    expect(await base.q("select presupuesto_id, ip, user_agent from presupuesto_aceptaciones")).toEqual([
      { presupuesto_id: conEvidencia, ip: "203.0.113.7", user_agent: "Navegador de antes" },
    ]);
    expect(await base.one("select enviado_por_nombre from presupuestos where id = $1", [conEvidencia])).toEqual({
      enviado_por_nombre: nombreObra,
    });
    // Enviado antes de 0007: no se sabe quién lo envió, así que tampoco su nombre.
    expect(await base.one("select enviado_por, enviado_por_nombre from presupuestos where id = $1", [app.aceptadoEnlace])).toEqual({
      enviado_por: null,
      enviado_por_nombre: null,
    });
  });

  it("0008 se puede volver a ejecutar y deja lo mismo", async () => {
    const antes = {
      foto: await foto(base),
      evidencias: await base.q("select presupuesto_id, ip, user_agent, created_at from presupuesto_aceptaciones order by 1"),
      nombres: await base.q("select id, enviado_por_nombre from presupuestos order by id"),
    };
    await base.exec(migracion("0008_auditoria3.sql"));
    expect({
      foto: await foto(base),
      evidencias: await base.q("select presupuesto_id, ip, user_agent, created_at from presupuesto_aceptaciones order by 1"),
      nombres: await base.q("select id, enviado_por_nombre from presupuestos order by id"),
    }).toEqual(antes);
  });

  it("si falla, no aplica nada (va en una transacción)", async () => {
    const otra = await baseVacia();
    try {
      for (const m of HASTA_0007) await otra.exec(migracion(m));
      // Una comprobación final que no se cumple: la política de lectura de la tabla nueva ya existe con otro nombre.
      await otra.exec(`
        create table public.presupuesto_aceptaciones (presupuesto_id uuid primary key, empresa_id uuid not null,
          ip text, user_agent text, created_at timestamptz not null default now());
        create policy sobra on public.presupuesto_aceptaciones for select using (true);`);
      await expect(otra.exec(migracion("0008_auditoria3.sql"))).rejects.toThrow(/solo la política de lectura de gerencia/);
      await otra.exec("rollback");
      const quedo = await otra.one(`
        select exists (select 1 from information_schema.columns
                        where table_name = 'presupuestos' and column_name = 'aceptado_ip') as ip,
               exists (select 1 from information_schema.columns
                        where table_name = 'presupuestos' and column_name = 'enviado_por_nombre') as nombre`);
      expect(quedo).toEqual({ ip: true, nombre: false });
    } finally {
      await otra.cerrar();
    }
  });
});

describe("0009 sobre una base 0001 → 0008 con datos", () => {
  it("se aplica sin perder ni cambiar nada y deja la tabla vacía, con RLS y la función", async () => {
    const antes = await foto(base);
    await base.exec(migracion("0009_ia_cache.sql"));
    expect(await foto(base)).toEqual(antes);
    expect(
      await base.one(`
        select (select count(*)::int from ia_propuestas) as n,
               (select relrowsecurity from pg_class where oid = 'public.ia_propuestas'::regclass) as rls,
               to_regprocedure('public.guardar_propuesta_ia(uuid, text, jsonb, boolean)') is not null as f`),
    ).toEqual({ n: 0, rls: true, f: true });
  });

  it("0009 se puede volver a ejecutar sin perder las propuestas guardadas", async () => {
    const r = await base.como(
      "postgres",
      async (tx) => {
        await ser(tx, OBRA);
        const { reserva } = await unaEn(tx, "select * from consumir_uso_ia()");
        await en(tx, "select guardar_propuesta_ia($1, $2, $3::jsonb)", [
          reserva,
          "c".repeat(64),
          JSON.stringify({ partidas: [{ descripcion: "Partida", cantidad: 1, unidad: "", precio_euros: 1, material_id: null }], supuestos: [] }),
        ]);
      },
      { guardar: true },
    );
    valor(r);
    const antes = { foto: await foto(base), propuestas: await base.q("select * from ia_propuestas order by clave") };
    await base.exec(migracion("0009_ia_cache.sql"));
    expect({ foto: await foto(base), propuestas: await base.q("select * from ia_propuestas order by clave") }).toEqual(antes);
    expect(antes.propuestas).toHaveLength(1);
    expect(await base.one("select count(*)::int as n from pg_policies where tablename = 'ia_propuestas'")).toEqual({ n: 1 });
  });

  it("sin 0008 no se aplica y lo dice; si falla, no deja nada (va en una transacción)", async () => {
    const otra = await baseVacia();
    try {
      for (const m of HASTA_0007) await otra.exec(migracion(m));
      await expect(otra.exec(migracion("0009_ia_cache.sql"))).rejects.toThrow(/Falta la 0008/);
      await otra.exec("rollback");
      await otra.exec(migracion("0008_auditoria3.sql"));
      // Una comprobación final que no se cumple: una política de más en la tabla.
      await otra.exec(`
        create table public.ia_propuestas (empresa_id uuid not null, clave text not null, respuesta jsonb not null,
          perfil_id uuid, reserva uuid not null, created_at timestamptz not null default now(), primary key (empresa_id, clave));
        create policy sobra on public.ia_propuestas for select using (true);`);
      await expect(otra.exec(migracion("0009_ia_cache.sql"))).rejects.toThrow(/solo la política de lectura/);
      await otra.exec("rollback");
      expect(
        await otra.one(`
          select to_regprocedure('public.guardar_propuesta_ia(uuid, text, jsonb, boolean)') as f,
                 (select relrowsecurity from pg_class where oid = 'public.ia_propuestas'::regclass) as rls`),
      ).toEqual({ f: null, rls: false });
    } finally {
      await otra.cerrar();
    }
  });
});

describe("seed sobre 0001 → 0009", () => {
  async function fotoSeed() {
    return {
      presupuestos: await base.q(
        `select id, numero, estado, aceptado_canal, aceptado_por, aceptado_nombre, enviado_por, enviado_por_nombre
           from presupuestos where empresa_id = $1 order by id`,
        [E1],
      ),
      facturas: await base.q("select numero, fecha::text, total_cents::text from facturas order by numero"),
      obras: await base.q("select id, estado, semaforo, consumido_pct::text from obras_resumen order by id"),
      contadores: await base.q("select empresa_id, prefijo, anio, ultimo from contadores order by 1, 2, 3"),
      invitaciones: await base.q("select email, rol, usada_at is not null as usada from invitaciones order by email"),
    };
  }

  it("se ejecuta, borra lo de las empresas de demo (también aceptados y facturados) y se puede repetir", async () => {
    await base.exec(seed());
    const primera = await fotoSeed();
    await base.exec(seed());
    expect(await fotoSeed()).toEqual(primera);
    expect(await base.one("select count(*)::int as n from presupuestos where id = $1", [app.facturado])).toEqual({ n: 0 });
    expect(primera.presupuestos).toHaveLength(11);
    expect(primera.invitaciones.filter((i) => i.usada)).toHaveLength(2);
    expect(new Set(primera.obras.map((o) => o.semaforo))).toEqual(new Set(["verde", "ambar", "rojo"]));
  });

  it("los números de presupuesto y factura del seed siguen siendo consecutivos y con su año", async () => {
    const p = await base.q("select numero from presupuestos where empresa_id = $1 order by numero", [E1]);
    expect(p.every((x) => /^P-\d{4}-\d{4}$/.test(String(x.numero)))).toBe(true);
    const f = await base.q("select numero, extract(year from fecha)::int as anio from facturas order by numero");
    expect(f.every((x) => String(x.numero).startsWith(`F-${x.anio}-`))).toBe(true);
    expect(await base.one("select estado from presupuestos where id = $1", [SEED.presupuestoCocina])).toEqual({ estado: "aceptado" });
  });

  it("sin 0007 el seed se niega a ejecutarse y lo dice", async () => {
    const otra = await baseVacia();
    try {
      for (const m of HASTA_0006) await otra.exec(migracion(m));
      await crearUsuariosDemo(otra);
      await expect(otra.exec(seed())).rejects.toThrow(/Falta aplicar migrations\/0007_auditoria2\.sql/);
    } finally {
      await otra.cerrar();
    }
  });

  it("sin 0008 el seed se niega a ejecutarse y lo dice", async () => {
    const otra = await baseVacia();
    try {
      for (const m of HASTA_0007) await otra.exec(migracion(m));
      await crearUsuariosDemo(otra);
      await expect(otra.exec(seed())).rejects.toThrow(/Falta aplicar migrations\/0008_auditoria3\.sql/);
    } finally {
      await otra.cerrar();
    }
  });

  it("sin 0009 el seed se niega a ejecutarse y lo dice", async () => {
    const otra = await baseVacia();
    try {
      for (const m of HASTA_0008) await otra.exec(migracion(m));
      await crearUsuariosDemo(otra);
      await expect(otra.exec(seed())).rejects.toThrow(/Falta aplicar migrations\/0009_ia_cache\.sql/);
    } finally {
      await otra.cerrar();
    }
  });
});
