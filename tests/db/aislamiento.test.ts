// Aislamiento y superficie expuesta: qué ve y qué puede ejecutar cada rol (anon, usuario sin invitación, empleado,
// gerencia de otra empresa), escalada de rol y marcas tajo.* desde la API.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Base,
  E1,
  E2,
  GER,
  GER2,
  INTRUSO,
  OBRA,
  SEED,
  bloqueado,
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

const TABLAS_Y_VISTAS = [
  "empresas", "perfiles", "invitaciones", "clientes", "materiales", "presupuestos", "presupuesto_lineas",
  "presupuestos_con_totales", "facturas", "factura_lineas", "contadores", "uso_ia", "uso_ia_reservas", "uso_ia_perfiles",
  "obras", "partes", "parte_materiales", "obras_resumen",
];

describe("superficie de la base", () => {
  it("anon no tiene ningún permiso sobre tablas ni vistas de public", async () => {
    const abiertas = await base.q(`
      select c.relname from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
         and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
              or has_any_column_privilege('anon', c.oid, 'select, insert, update'))`);
    expect(abiertas).toEqual([]);
    for (const t of TABLAS_Y_VISTAS) {
      expect(codigo(await base.filas("anon", `select * from ${t} limit 1`)), t).toBe("42501");
    }
  });

  it("todas las tablas de public tienen RLS", async () => {
    expect(await base.q("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity")).toEqual([]);
  });

  it("todas las funciones security definer fijan search_path y son de postgres", async () => {
    const malas = await base.q(`
      select p.oid::regprocedure::text as f from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and (p.proowner <> 'postgres'::regrole
              or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
    expect(malas).toEqual([]);
  });

  it("las funciones internas no se pueden llamar desde la API", async () => {
    for (const sql of [
      `select siguiente_numero('${E1}', 'F')`,
      `select totales_presupuesto('${SEED.presupuestoEnviado}')`,
      `select crear_factura_copia('${SEED.presupuestoCocina}', 'F-2099-0001', null, null)`,
      "select presupuestos_crear_obra()",
      "select handle_new_user()",
    ]) {
      expect(codigo(await base.filas(OBRA, sql)), sql).toBe("42501");
      expect(codigo(await base.filas("anon", sql)), sql).toBe("42501");
    }
  });

  it("anon no ejecuta las funciones de la app", async () => {
    for (const sql of [
      `select guardar_presupuesto(null, '${SEED.cliente(1)}', 'x', 21, 30, '[]')`,
      `select facturar_presupuesto('${SEED.presupuestoCocina}')`,
      `select regenerar_enlace('${SEED.presupuestoEnviado}')`,
      "select * from consumir_uso_ia()",
      `select devolver_uso_ia('${SEED.presupuestoEnviado}')`,
      `select guardar_parte(null, '${SEED.obraCocina}', null, 1, null, '[]')`,
      `select presupuesto_base_cents('${SEED.presupuestoEnviado}')`,
      "select nif_valido('12345678Z')",
    ]) {
      expect(codigo(await base.filas("anon", sql)), sql).toBe("42501");
    }
  });
});

describe("alta por invitación", () => {
  it("un usuario sin invitación no tiene perfil, no ve nada y no puede crearse uno", async () => {
    expect(await base.one("select 1 from perfiles where id = $1", [INTRUSO])).toBeUndefined();
    for (const t of ["empresas", "clientes", "presupuestos", "presupuestos_con_totales", "materiales", "obras", "obras_resumen"]) {
      expect(valor(await base.filas(INTRUSO, `select * from ${t}`)), t).toEqual([]);
    }
    expect(bloqueado(await base.filas(INTRUSO, "insert into perfiles (id, empresa_id, rol) values ($1, $2, 'admin') returning id", [INTRUSO, E1]))).toBe(true);
    expect(bloqueado(await base.filas(INTRUSO, "insert into clientes (empresa_id, nombre) values ($1, 'x') returning id", [E1]))).toBe(true);
    expect(error(await base.filas(INTRUSO, "select * from consumir_uso_ia()"))).toMatch(/empresa asignada/);
  });

  it("la invitación casa con el email aunque llegue con mayúsculas o espacios", async () => {
    expect(await base.one("select empresa_id, rol from perfiles where id = $1", [GER2])).toEqual({ empresa_id: E2, rol: "admin" });
  });
});

describe("empleado: escalada de rol y lo que no ve", () => {
  it("no se hace admin, no cambia de empresa ni el nombre de otro", async () => {
    expect(codigo(await base.filas(OBRA, "update perfiles set rol = 'admin' where id = $1 returning rol", [OBRA]))).toBe("42501");
    expect(codigo(await base.filas(OBRA, "update perfiles set empresa_id = $2 where id = $1 returning id", [OBRA, E2]))).toBe("42501");
    expect(valor(await base.filas(OBRA, "update perfiles set nombre = 'x' where id = $1 returning id", [GER]))).toEqual([]);
    expect(valor(await base.filas(OBRA, "update perfiles set nombre = 'Toni' where id = $1 returning id", [OBRA]))).toHaveLength(1);
  });

  it("gerencia tampoco cambia roles ni el coste por hora de la empresa por la API", async () => {
    expect(codigo(await base.filas(GER, "update perfiles set rol = 'admin' where id = $1 returning id", [OBRA]))).toBe("42501");
    expect(bloqueado(await base.filas(GER, "update empresas set coste_hora_cents = 1 returning id"))).toBe(true);
  });

  it("no lee facturas, sus partidas, invitaciones, contadores ni la cuota de IA", async () => {
    for (const t of ["facturas", "factura_lineas"]) expect(valor(await base.filas(OBRA, `select * from ${t}`)), t).toEqual([]);
    for (const t of ["invitaciones", "contadores", "uso_ia", "uso_ia_reservas", "uso_ia_perfiles"]) {
      expect(codigo(await base.filas(OBRA, `select * from ${t}`)), t).toBe("42501");
    }
  });

  it("las marcas tajo.* puestas desde la API no tienen efecto", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, OBRA);
      const salida: Record<string, string> = {};
      for (const marca of ["seed", "aceptando", "facturando", "regenerando"]) {
        await en(tx, `select set_config('tajo.${marca}', 'on', true)`);
      }
      salida.numero = error(await probar(tx, "update presupuestos set numero = 'P-1999-0001' where id = $1 returning id", [SEED.presupuestoEnviado]));
      salida.aceptar = error(await probar(tx, "update presupuestos set estado = 'aceptado' where id = $1 returning id", [SEED.presupuestoEnviado]));
      salida.token = error(await probar(tx, "update presupuestos set token = gen_random_uuid() where id = $1 returning id", [SEED.presupuestoEnviado]));
      salida.alta = error(
        await probar(tx, "insert into presupuestos (empresa_id, cliente_id, titulo, estado) values ($1, $2, 'x', 'aceptado') returning id", [E1, SEED.cliente(1)]),
      );
      await ser(tx, GER);
      for (const marca of ["seed", "facturando"]) await en(tx, `select set_config('tajo.${marca}', 'on', true)`);
      salida.facturar = error(await probar(tx, "update presupuestos set estado = 'facturado' where id = $1 returning id", [SEED.presupuestoCocina]));
      salida.partidas = error(await probar(tx, "delete from presupuesto_lineas where presupuesto_id = $1 returning id", [SEED.presupuestoEnviado]));
      return salida;
    });
    const s = valor(r);
    expect(s.numero).toMatch(/número/);
    expect(s.aceptar).toMatch(/Solo gerencia/);
    expect(s.token).toMatch(/Regenerar enlace/);
    expect(s.alta).toMatch(/empieza en borrador/);
    expect(s.facturar).toMatch(/solo pasa a facturado/);
    expect(s.partidas).toMatch(/borrador/);
  });
});

describe("gerencia de otra empresa (E2)", () => {
  it("no ve nada de Reformas Levante en ninguna tabla ni vista", async () => {
    for (const t of ["clientes", "materiales", "presupuestos", "presupuesto_lineas", "presupuestos_con_totales", "facturas",
      "factura_lineas", "perfiles", "obras", "partes", "parte_materiales", "obras_resumen"]) {
      expect(valor(await base.filas(GER2, `select * from ${t} where empresa_id = $1`, [E1])), t).toEqual([]);
    }
    expect(valor(await base.filas(GER2, "select id from empresas"))).toEqual([{ id: E2 }]);
    expect(valor(await base.filas(GER2, "select presupuesto_base_cents($1) as b", [SEED.presupuestoEnviado]))).toEqual([{ b: null }]);
  });

  it("y Reformas Levante no ve nada suyo", async () => {
    for (const quien of [OBRA, GER]) {
      for (const t of ["clientes", "presupuestos", "presupuestos_con_totales", "obras", "partes", "obras_resumen"]) {
        expect(valor(await base.filas(quien, `select * from ${t} where empresa_id = $1`, [E2])), t).toEqual([]);
      }
    }
  });

  it("no factura, no regenera, no escribe ni asigna nada en Reformas Levante", async () => {
    const intentos: [string, unknown[]][] = [
      ["select facturar_presupuesto($1)", [SEED.presupuestoCocina]],
      ["select regenerar_enlace($1)", [SEED.presupuestoEnviado]],
      ["insert into clientes (empresa_id, nombre) values ($1, 'x') returning id", [E1]],
      ["insert into presupuesto_lineas (empresa_id, presupuesto_id, orden, descripcion, cantidad, precio_cents) values ($1, $2, 9, 'x', 1, 1) returning id", [E2, SEED.presupuestoBorrador]],
      ["insert into partes (empresa_id, obra_id, horas) values ($1, $2, 1) returning id", [E2, SEED.obraCocina]],
      ["update obras set notas = 'x' where id = $1 returning id", [SEED.obraCocina]],
      ["update obras set encargado_id = $1 where empresa_id = $2 returning id", [OBRA, E2]],
      ["select guardar_parte(null, $1, null, 1, null, '[]')", [SEED.obraCocina]],
    ];
    for (const [sql, p] of intentos) expect(bloqueado(await base.filas(GER2, sql, p)), sql).toBe(true);
  });

  it("no crea presupuestos en Reformas Levante ni mueve su numeración", async () => {
    const contador = async () => base.q("select anio, ultimo from contadores where empresa_id = $1 and prefijo = 'P'", [E1]);
    const antes = await contador();
    const r = await base.filas(GER2, "insert into presupuestos (empresa_id, cliente_id, titulo) values ($1, $2, 'x') returning id", [E1, SEED.cliente(1)]);
    expect(r.ok).toBe(false);
    expect(await contador()).toEqual(antes);
  });

  it("guardar_presupuesto no mezcla empresas (cliente, material o presupuesto ajenos)", async () => {
    const material = valor(
      await base.filas("postgres", "insert into materiales (empresa_id, nombre, unidad, precio_cents) values ($1, 'Ajeno', 'ud', 100) returning id", [E2], { guardar: true }),
    )[0].id;
    const partidas = (m: unknown) => JSON.stringify([{ orden: 1, descripcion: "x", cantidad: 1, precio_cents: 1, material_id: m }]);
    expect(bloqueado(await base.filas(OBRA, "select guardar_presupuesto(null, $1, 'x', 21, 30, $2::jsonb)", [SEED.cliente(1), partidas(material)]))).toBe(true);
    expect(bloqueado(await base.filas(OBRA, "select guardar_presupuesto(null, $1, 'x', 21, 30, $2::jsonb)", [SEED.clienteE2, partidas(null)]))).toBe(true);
    expect(error(await base.filas(OBRA, "select guardar_presupuesto($1, $2, 'x', 21, 30, $3::jsonb)", [SEED.presupuestoE2Enviado, SEED.cliente(1), partidas(null)]))).toMatch(/no existe o no tienes acceso/);
  });

  it("su empleado tampoco usa materiales ni obras de Reformas Levante", async () => {
    const r = await base.como("postgres", async (tx) => {
      await ser(tx, GER2);
      await en(tx, "update obras set encargado_id = $2 where id = $1", [SEED.obraE2, GER2]);
      const parte = (await unaEn(tx, "insert into partes (empresa_id, obra_id, horas) values ($1, $2, 2) returning id", [E2, SEED.obraE2])).id;
      return probar(tx, "insert into parte_materiales (empresa_id, parte_id, material_id, cantidad) values ($1, $2, $3, 1) returning id", [E2, parte, SEED.material(1)]);
    });
    expect(error(valor(r))).toMatch(/no es de tu empresa/);
  });
});
