// Andamio de Supabase en PGlite para los tests de base de datos (npm run test:pglite).
//
// Monta en memoria lo que las migraciones esperan de Supabase:
//   · roles anon, authenticated y service_role (este con bypassrls), concedidos a postgres;
//   · esquema auth con auth.users (id, email, email_confirmed_at…) y auth.uid(), que lee request.jwt.claim.sub como hace
//     PostgREST con el JWT;
//   · los privilegios por defecto de Supabase: todo lo que postgres crea en public se concede a anon, authenticated y
//     service_role. Así se comprueba que cada migración quita lo que no debe quedar abierto.
// Después aplica supabase/migrations en orden (0001 → última), crea los dos usuarios de demo con el email confirmado y
// ejecuta seed.sql. Cada fichero de tests crea su propia base: no dependen unos de otros.
//
// Para actuar como un usuario: base.como(quien, fn) abre una transacción, hace "set local role" (anon o
// authenticated), pone el "sub" del JWT y ejecuta fn. Por defecto la transacción se deshace al final, así cada
// comprobación parte del mismo estado; con { guardar: true } se confirma. Si algo falla devuelve { ok: false, code, msg }
// (code = SQLSTATE: 42501 sin permiso, P0001 raise exception, 23514 check…).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const MIGRACIONES = join(RAIZ, "supabase", "migrations");

export const E1 = "00000000-0000-0000-0000-000000000001";
export const E2 = "00000000-0000-0000-0000-000000000002";
/** Laura, gerencia de Reformas Levante (admin). */
export const GER = "aaaaaaaa-0000-4000-8000-000000000001";
/** Toni, obra de Reformas Levante (empleado, encargado de sus obras en el seed). */
export const OBRA = "aaaaaaaa-0000-4000-8000-000000000002";
/** Otro empleado de Reformas Levante. */
export const OBRA2 = "aaaaaaaa-0000-4000-8000-000000000003";
/** Gerencia de la segunda empresa (Construcciones Ajenas). */
export const GER2 = "aaaaaaaa-0000-4000-8000-000000000004";
/** Usuario de Auth sin invitación: no tiene perfil. */
export const INTRUSO = "aaaaaaaa-0000-4000-8000-000000000005";

/** Datos fijos del seed. */
export const SEED = {
  presupuesto: (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  obra: (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  cliente: (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  material: (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  /** Reforma de cocina: aceptada, obra en curso y en rojo (encargado: obra). */
  presupuestoCocina: "30000000-0000-4000-8000-000000000004",
  obraCocina: "40000000-0000-4000-8000-000000000004",
  /** Cambio de ventanas: aceptado por gerencia (interno), obra pendiente sin partes. */
  presupuestoVentanas: "30000000-0000-4000-8000-000000000007",
  obraVentanas: "40000000-0000-4000-8000-000000000007",
  /** Reforma integral de piso: enviado, dentro de validez. */
  presupuestoEnviado: "30000000-0000-4000-8000-000000000008",
  /** Humedades del zaguán: enviado. */
  presupuestoEnviado2: "30000000-0000-4000-8000-000000000009",
  /** Alicatado del restaurante: rechazado. */
  presupuestoRechazado: "30000000-0000-4000-8000-000000000003",
  /** Baño de cortesía: borrador. */
  presupuestoBorrador: "30000000-0000-4000-8000-000000000010",
  /** Reforma completa de baño: facturado, obra terminada con partes. */
  presupuestoFacturado: "30000000-0000-4000-8000-000000000001",
  obraTerminada: "40000000-0000-4000-8000-000000000001",
  /** Segunda empresa. */
  clienteE2: "10000000-0000-4000-8000-000000000101",
  presupuestoE2Enviado: "30000000-0000-4000-8000-000000000101",
  presupuestoE2Aceptado: "30000000-0000-4000-8000-000000000102",
  obraE2: "40000000-0000-4000-8000-000000000102",
} as const;

export type Fila = Record<string, unknown>;

export type Resultado<T> = { ok: true; r: T } | { ok: false; code: string; msg: string };

/** Quién ejecuta: "anon" (sin sesión) o el id de un usuario de Auth (rol authenticated). */
export type Quien = "anon" | "postgres" | string;

export interface Base {
  db: PGlite;
  /** Como postgres (el SQL Editor): filas. */
  q: (sql: string, params?: unknown[]) => Promise<Fila[]>;
  /** Como postgres: primera fila (o undefined). */
  one: (sql: string, params?: unknown[]) => Promise<Fila | undefined>;
  /** Como postgres: ejecuta un script entero (varias sentencias, una transacción). */
  exec: (sql: string) => Promise<void>;
  como: <T>(quien: Quien, fn: (tx: Transaction) => Promise<T>, opciones?: { guardar?: boolean }) => Promise<Resultado<T>>;
  /** Atajo: una consulta como quien y sus filas. */
  filas: (quien: Quien, sql: string, params?: unknown[], opciones?: { guardar?: boolean }) => Promise<Resultado<Fila[]>>;
  cerrar: () => Promise<void>;
}

export const ANDAMIO_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant anon, authenticated, service_role to postgres;
  create schema auth;
  create table auth.users (
    id                 uuid primary key,
    email              text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}',
    created_at         timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export function leer(ruta: string): string {
  return readFileSync(ruta, "utf8");
}

/** Ficheros de supabase/migrations en orden (0001_…, 0002_…). */
export function migraciones(): string[] {
  return readdirSync(MIGRACIONES)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort();
}

export function migracion(nombre: string): string {
  return leer(join(MIGRACIONES, nombre));
}

export function seed(): string {
  return leer(join(RAIZ, "supabase", "seed.sql"));
}

function errorDe(e: unknown): { code: string; msg: string } {
  const err = e as { code?: string; message?: string };
  return { code: err.code ?? "", msg: err.message ?? String(e) };
}

const DESHACER = new Error("deshacer");

/** Base vacía con el andamio de Supabase (sin migraciones). */
export async function baseVacia(): Promise<Base> {
  const db = new PGlite();
  await db.waitReady;
  await db.exec("set timezone = 'UTC'");
  await db.exec(ANDAMIO_SUPABASE);

  const q = async (sql: string, params?: unknown[]) => (await db.query<Fila>(sql, params)).rows;

  const como: Base["como"] = async (quien, fn, opciones) => {
    let valor: unknown;
    try {
      await db.transaction(async (tx) => {
        if (quien !== "postgres") {
          await tx.exec(`set local role ${quien === "anon" ? "anon" : "authenticated"}`);
          await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [quien === "anon" ? "" : quien]);
        }
        valor = await fn(tx);
        if (!opciones?.guardar) throw DESHACER;
      });
    } catch (e) {
      if (e !== DESHACER) return { ok: false, ...errorDe(e) };
    }
    return { ok: true, r: valor as never };
  };

  return {
    db,
    q,
    one: async (sql, params) => (await q(sql, params))[0],
    exec: async (sql) => {
      await db.exec(sql);
    },
    como,
    filas: (quien, sql, params, opciones) =>
      como(quien, async (tx) => (await tx.query<Fila>(sql, params)).rows, opciones),
    cerrar: () => db.close(),
  };
}

/** Usuarios de Auth de demo (confirmados): gerencia y obra, antes del seed. */
export async function crearUsuariosDemo(base: Base): Promise<void> {
  await base.q(
    `insert into auth.users (id, email, email_confirmed_at) values
       ($1, 'gerencia@reformaslevante.es', now()), ($2, 'obra@reformaslevante.es', now())`,
    [GER, OBRA],
  );
}

/**
 * Usuarios extra tras el seed: otro empleado de Reformas Levante, la gerencia de la segunda empresa (con el email en
 * mayúsculas y con un espacio, como lo podría escribir alguien) y un usuario sin invitación.
 */
export async function crearUsuariosExtra(base: Base): Promise<void> {
  await base.exec(`
    insert into public.invitaciones (email, empresa_id, rol) values
      ('obra2@reformaslevante.es', '${E1}', 'empleado'),
      ('jefa@construccionesajenas.es', '${E2}', 'admin');
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OBRA2}', 'obra2@reformaslevante.es', now()),
      ('${GER2}', 'Jefa@ConstruccionesAjenas.es ', now()),
      ('${INTRUSO}', 'cualquiera@gmail.com', now());
  `);
}

/** Base completa: andamio, todas las migraciones, usuarios de demo, seed y usuarios extra. */
export async function crearBase(): Promise<Base> {
  const base = await baseVacia();
  for (const m of migraciones()) {
    try {
      await base.exec(migracion(m));
    } catch (e) {
      throw new Error(`No se aplica ${m}: ${errorDe(e).msg}`);
    }
  }
  await crearUsuariosDemo(base);
  await base.exec(seed());
  await crearUsuariosExtra(base);
  return base;
}

/** Fecha de hoy en Madrid (AAAA-MM-DD), como la calcula la base de datos. */
export async function hoyMadrid(base: Base): Promise<string> {
  const f = await base.one(`select ((now() at time zone 'Europe/Madrid')::date)::text as d`);
  return String(f?.d);
}

/** Filas de una consulta dentro de una transacción ya abierta. */
export async function en(tx: Transaction, sql: string, params?: unknown[]): Promise<Fila[]> {
  return (await tx.query<Fila>(sql, params)).rows;
}

/** Primera fila dentro de una transacción ya abierta. */
export async function unaEn(tx: Transaction, sql: string, params?: unknown[]): Promise<Fila> {
  const filas = await en(tx, sql, params);
  if (filas.length === 0) throw new Error(`Sin filas: ${sql}`);
  return filas[0];
}

/** Pasa si la operación falla o no afecta a ninguna fila (lo que ve PostgREST con RLS). */
export function bloqueado(r: Resultado<Fila[]>): boolean {
  return !r.ok || r.r.length === 0;
}

/** Mensaje de error (o "" si no ha fallado), para expect(...).toMatch(). */
export function error(r: Resultado<unknown>): string {
  return r.ok ? "" : r.msg;
}

/** Código SQLSTATE (o "ok"). */
export function codigo(r: Resultado<unknown>): string {
  return r.ok ? "ok" : r.code;
}

/** Valor de la respuesta; falla el test con el error de la base si no ha ido bien. */
export function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Ha fallado (${r.code}): ${r.msg}`);
  return r.r;
}

/**
 * Cambia de usuario dentro de una transacción abierta con base.como("postgres", …): así una misma escena puede tener
 * varios actores (gerencia envía, el cliente acepta, obra apunta un parte) y deshacerse entera al final.
 */
export async function ser(tx: Transaction, quien: Quien): Promise<void> {
  await tx.exec("reset role");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
    quien === "anon" || quien === "postgres" ? "" : quien,
  ]);
  if (quien !== "postgres") await tx.exec(`set local role ${quien === "anon" ? "anon" : "authenticated"}`);
}

/**
 * Ejecuta un paso que puede fallar sin abortar la transacción (savepoint): devuelve { ok, r } o { ok: false, code, msg }
 * y, si falla, deja la base como estaba antes del paso.
 */
export async function intento<T>(tx: Transaction, fn: () => Promise<T>): Promise<Resultado<T>> {
  await tx.exec("savepoint intento");
  try {
    const r = await fn();
    await tx.exec("release savepoint intento");
    return { ok: true, r };
  } catch (e) {
    await tx.exec("rollback to savepoint intento");
    return { ok: false, ...errorDe(e) };
  }
}

/** intento() de una sola consulta: sus filas. */
export function probar(tx: Transaction, sql: string, params?: unknown[]): Promise<Resultado<Fila[]>> {
  return intento(tx, () => en(tx, sql, params));
}
