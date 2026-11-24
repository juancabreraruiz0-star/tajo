// Tajo · tests de la base de datos contra el Supabase real (npm run test:db). No forman parte de `npm test`.
//
// Entra como anónimo, como obra (empleado) y como gerencia (admin) y comprueba qué puede y qué no puede hacer cada
// uno: RLS, triggers y funciones de 0001–0009. Necesita la base migrada hasta 0009 y el seed recién ejecutado.
// Lo mismo, y bastante más, se comprueba sin Supabase ni contraseñas con `npm run test:pglite` (tests/db/).
//
// Configuración:
//   · NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY: de .env.local (o del entorno).
//   · TAJO_PASS_GERENCIA y TAJO_PASS_OBRA: contraseñas de los usuarios de demo, SOLO por variable de entorno.
//     PowerShell:  $env:TAJO_PASS_GERENCIA = "..."; $env:TAJO_PASS_OBRA = "..."; npm run test:db
//     bash:        TAJO_PASS_GERENCIA=... TAJO_PASS_OBRA=... npm run test:db
//
// Lo que crea lleva el prefijo «[test]» y se borra al final con gerencia (y al principio, por si quedó algo de una
// ejecución anterior), salvo lo que la base de datos ya no deja borrar:
//   · Los DOS presupuestos de prueba aceptados (uno por el enlace y otro por gerencia), con sus obras y sus clientes.
//     Desde 0007 un presupuesto aceptado no se borra (ni gerencia) y no puede volver a rechazado, así que se quedan
//     hasta el siguiente seed.sql, que limpia las empresas de demo. Cada ejecución deja dos más; la limpieza borra los
//     partes de sus obras (salvo en obras terminadas) para que no cuenten horas ni costes.
//   · Si algún fallo llegara a crear una factura de prueba, tampoco se borra desde la API.
// Las pruebas solo terminan una obra sin partes. Si un fallo dejara una obra de prueba terminada y con partes, la
// limpieza lo avisará en cada ejecución hasta el siguiente seed.sql.
// La comprobación de la cuota de IA por usuario gasta 15 usos de obra y los devuelve enseguida (neto cero); si la
// empresa ya llevaba más de 25 usos hoy, falla avisando de que no se puede comprobar.
// Del seed solo se leen datos (y se intenta un update con el mismo valor que ya tenía, que no cambia nada).
// Cada ejecución consume números de presupuesto (P-AAAA-…) aunque luego se borren: la numeración queda con huecos
// hasta el siguiente seed.sql, que la reinicia. No lo ejecutes contra una base con datos reales.
//
// Salida: una línea ✔/✘ por comprobación. Código de salida 0 si todo pasa, 1 si falla alguna y 2 si falta
// configuración o no se puede entrar.

import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_DEMO = "00000000-0000-0000-0000-000000000001";
const EMPRESA_AJENA = "00000000-0000-0000-0000-000000000002";
const CLIENTE_AJENO = "10000000-0000-4000-8000-000000000101";
const PRESUPUESTO_AJENO = "30000000-0000-4000-8000-000000000101";
const EMAIL_GERENCIA = "gerencia@reformaslevante.es";
const EMAIL_OBRA = "obra@reformaslevante.es";
const PREFIJO = "[test]";
/** DNI de prueba con su letra de control correcta (12345678 mod 23 = 14 → Z). */
const NIF_TEST = "12345678Z";
/** Error propio de facturar_presupuesto() cuando el cliente no tiene NIF (0004). */
const ERROR_SIN_NIF = "TJ001";
/** Datos fijos del seed (0006): obra terminada con partes, obra de la segunda empresa, un parte de obra de un día
 * anterior y un presupuesto cuya obra tiene partes. */
const OBRA_TERMINADA = "40000000-0000-4000-8000-000000000001";
const OBRA_AJENA = "40000000-0000-4000-8000-000000000102";
const PARTE_DE_AYER = "50000000-0000-4000-8000-000000000407";
const PRESUPUESTO_CON_PARTES = "30000000-0000-4000-8000-000000000004";

const TABLAS = [
  "empresas",
  "perfiles",
  "invitaciones",
  "clientes",
  "materiales",
  "presupuestos",
  "presupuesto_lineas",
  "presupuestos_con_totales",
  "presupuesto_aceptaciones",
  "facturas",
  "factura_lineas",
  "contadores",
  "obras",
  "partes",
  "parte_materiales",
  "obras_resumen",
  "ia_propuestas",
];

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------

function escribir(linea) {
  process.stdout.write(`${linea}\n`);
}

function abortar(mensaje) {
  process.stderr.write(`${mensaje}\n`);
  process.exit(2);
}

/** Variables de .env.local (KEY=valor, sin comillas). No se imprime ninguna. */
function leerEnvLocal() {
  const ruta = new URL("../.env.local", import.meta.url);
  if (!existsSync(ruta)) return {};
  const vars = {};
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linea);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return vars;
}

const resultados = { ok: 0, fallos: 0 };

/**
 * Ejecuta una comprobación. `fn` devuelve true si pasa o un texto con el motivo si falla.
 * Una excepción también cuenta como fallo.
 */
async function comprobar(nombre, fn) {
  let resultado;
  try {
    resultado = await fn();
  } catch (error) {
    resultado = error instanceof Error ? error.message : String(error);
  }
  if (resultado === true) {
    resultados.ok += 1;
    escribir(`  ✔ ${nombre}`);
  } else {
    resultados.fallos += 1;
    escribir(`  ✘ ${nombre}${resultado ? ` — ${resultado}` : ""}`);
  }
  return resultado === true;
}

function seccion(titulo) {
  escribir(`\n${titulo}`);
}

/** Pasa si la consulta falla o no devuelve filas. */
function sinFilas({ data, error }) {
  if (error) return true;
  const filas = Array.isArray(data) ? data : data ? [data] : [];
  return filas.length === 0 ? true : `ha devuelto ${filas.length} fila(s)`;
}

/** Pasa si la llamada falla; opcionalmente, con un mensaje que encaje con `patron`. */
function falla({ error }, patron) {
  if (!error) return "no ha dado error";
  if (patron && !patron.test(error.message ?? "")) return `ha fallado con otro mensaje: «${error.message}»`;
  return true;
}

function errorTexto(error) {
  return `${error.code ?? "sin código"}: ${error.message}`;
}

/** Mismo redondeo que src/lib/domain/totals.ts. */
function importeCents(cantidad, precioCents) {
  return Math.round(Number((Number(cantidad) * Number(precioCents)).toFixed(6)));
}

function ivaCents(baseCents, ivaPct) {
  return Math.round((baseCents * ivaPct) / 100);
}

// ----------------------------------------------------------------------------
// Configuración y sesiones
// ----------------------------------------------------------------------------

const envLocal = leerEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const passGerencia = process.env.TAJO_PASS_GERENCIA;
const passObra = process.env.TAJO_PASS_OBRA;

const faltan = [
  !url && "NEXT_PUBLIC_SUPABASE_URL (en .env.local)",
  !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY (en .env.local)",
  !passGerencia && "TAJO_PASS_GERENCIA (variable de entorno)",
  !passObra && "TAJO_PASS_OBRA (variable de entorno)",
].filter(Boolean);
if (faltan.length > 0) {
  abortar(
    `Faltan datos para los tests de la base de datos: ${faltan.join(", ")}.\n` +
      'Ejemplo en PowerShell: $env:TAJO_PASS_GERENCIA = "..."; $env:TAJO_PASS_OBRA = "..."; npm run test:db',
  );
}

const OPCIONES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function nuevoCliente() {
  return createClient(url, anonKey, OPCIONES);
}

async function entrar(email, password) {
  const supabase = nuevoCliente();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    abortar(`No se ha podido entrar como ${email}: ${error ? error.message : "sin usuario"}. Revisa la contraseña.`);
  }
  return { supabase, id: data.user.id };
}

const anon = nuevoCliente();
const { supabase: obra, id: obraId } = await entrar(EMAIL_OBRA, passObra);
const { supabase: gerencia, id: gerenciaId } = await entrar(EMAIL_GERENCIA, passGerencia);

/** Estados en los que un presupuesto se puede borrar (0007). */
const BORRABLES = ["borrador", "enviado", "rechazado"];

/**
 * Borra con gerencia los partes de las obras de prueba y los presupuestos de prueba que aún se pueden borrar (sus obras
 * van en cascada), los materiales de prueba y los clientes de prueba que ya no tienen presupuestos. Los aceptados y
 * facturados de prueba se quedan hasta el siguiente seed (ver la cabecera).
 */
async function limpiar() {
  const obras = await gerencia.from("obras").select("id, estado").like("titulo", `${PREFIJO}%`);
  if (obras.error) return `obras: ${errorTexto(obras.error)}`;
  const vivas = obras.data.filter((o) => o.estado !== "terminada").map((o) => o.id);
  if (vivas.length > 0) {
    const partes = await gerencia.from("partes").delete().in("obra_id", vivas).select("id");
    if (partes.error) return `partes: ${errorTexto(partes.error)}`;
  }
  const presupuestos = await gerencia
    .from("presupuestos")
    .delete()
    .like("titulo", `${PREFIJO}%`)
    .in("estado", BORRABLES)
    .select("id");
  if (presupuestos.error) return `presupuestos: ${errorTexto(presupuestos.error)}`;
  // Solo si alguna comprobación del coste de los materiales fallara llegaría a crearse uno de prueba.
  const materiales = await gerencia.from("materiales").delete().like("nombre", `${PREFIJO}%`).select("id");
  if (materiales.error) return `materiales: ${errorTexto(materiales.error)}`;
  const quedan = await gerencia.from("presupuestos").select("id, cliente_id, estado").like("titulo", `${PREFIJO}%`);
  if (quedan.error) return `presupuestos: ${errorTexto(quedan.error)}`;
  const conPresupuesto = [...new Set(quedan.data.map((p) => p.cliente_id))];
  let clientes = gerencia.from("clientes").delete().like("nombre", `${PREFIJO}%`);
  if (conPresupuesto.length > 0) clientes = clientes.not("id", "in", `(${conPresupuesto.join(",")})`);
  const borrados = await clientes.select("id");
  if (borrados.error) return `clientes: ${errorTexto(borrados.error)}`;
  const restos = quedan.data.filter((p) => BORRABLES.includes(p.estado));
  return restos.length === 0 ? true : `quedan ${restos.length} presupuestos de prueba que se podían borrar`;
}

// Ids que se van creando (null si el paso que los crea falla).
const creado = { clienteSinNif: null, clienteConNif: null, forjado: null, sinNif: null, enlace: null };

async function crearPresupuesto(clienteId, titulo) {
  const { data, error } = await obra.rpc("guardar_presupuesto", {
    p_id: null,
    p_cliente: clienteId,
    p_titulo: titulo,
    p_iva: 21,
    p_validez: 30,
    p_partidas: [{ orden: 1, descripcion: `${PREFIJO} partida`, cantidad: 2.5, precio_cents: 1999, material_id: null }],
  });
  if (error) throw new Error(errorTexto(error));
  return data;
}

// ----------------------------------------------------------------------------
// 0. Preparación
// ----------------------------------------------------------------------------

seccion("Preparación");
await comprobar("Limpieza de restos de ejecuciones anteriores", limpiar);

// ----------------------------------------------------------------------------
// 1. Anónimo
// ----------------------------------------------------------------------------

seccion("Anónimo (sin sesión)");

for (const tabla of TABLAS) {
  await comprobar(`No lee ${tabla}`, async () => sinFilas(await anon.from(tabla).select("*").limit(1)));
}

await comprobar("No puede registrarse (auth.signUp cerrado)", async () => {
  const { data, error } = await anon.auth.signUp({
    email: `tajo-test-${Date.now()}@example.com`,
    password: `Tajo-${randomUUID()}`,
  });
  if (error && (error.code === "signup_disabled" || /signups? not allowed/i.test(error.message))) return true;
  if (error) return `ha fallado por otro motivo (${error.code ?? error.status}: ${error.message}); revisa a mano que el registro esté desactivado`;
  return `se ha creado un usuario (${data.user?.email ?? "?"}): el registro está abierto. Desactívalo y borra ese usuario en Authentication → Users`;
});

await comprobar("presupuesto_publico con un token inventado no devuelve datos", async () => {
  const { data, error } = await anon.rpc("presupuesto_publico", { p_token: randomUUID() });
  if (error) return errorTexto(error);
  return data === null ? true : "ha devuelto datos";
});

await comprobar("aceptar_presupuesto con un token inventado no acepta nada", async () => {
  const { data, error } = await anon.rpc("aceptar_presupuesto", {
    p_token: randomUUID(),
    p_nombre: `${PREFIJO} Cliente`,
    p_ip: null,
    p_user_agent: null,
  });
  if (error) return errorTexto(error);
  return data?.ok === false ? true : "no ha devuelto ok: false";
});

await comprobar("No puede llamar a regenerar_enlace", async () =>
  falla(await anon.rpc("regenerar_enlace", { p_presupuesto: randomUUID() })),
);

await comprobar("No puede llamar a facturar_presupuesto", async () =>
  falla(await anon.rpc("facturar_presupuesto", { p_presupuesto: randomUUID() })),
);

await comprobar("No puede guardar una propuesta de IA (guardar_propuesta_ia, 0009)", async () =>
  falla(await anon.rpc("guardar_propuesta_ia", { p_reserva: randomUUID(), p_clave: "a".repeat(64), p_respuesta: {} })),
);

// ----------------------------------------------------------------------------
// 2. Obra (empleado)
// ----------------------------------------------------------------------------

seccion("Obra (empleado)");

await comprobar("Su perfil es empleado de Reformas Levante", async () => {
  const { data, error } = await obra.from("perfiles").select("rol, empresa_id").eq("id", obraId).single();
  if (error) return errorTexto(error);
  return data.rol === "empleado" && data.empresa_id === EMPRESA_DEMO ? true : `rol ${data.rol}, empresa ${data.empresa_id}`;
});

await comprobar("No puede cambiarse el rol en perfiles", async () => {
  const intento = await obra.from("perfiles").update({ rol: "admin" }).eq("id", obraId).select("rol");
  const { data } = await obra.from("perfiles").select("rol").eq("id", obraId).single();
  if (data?.rol !== "empleado") return `ahora su rol es ${data?.rol}`;
  return falla(intento);
});

await comprobar("Ve clientes de su empresa y solo de su empresa", async () => {
  const { data, error } = await obra.from("clientes").select("id, empresa_id");
  if (error) return errorTexto(error);
  if (data.length === 0) return "no ve ningún cliente (¿falta ejecutar el seed?)";
  return data.every((c) => c.empresa_id === EMPRESA_DEMO) ? true : "ve clientes de otra empresa";
});

await comprobar("No ve el cliente de la segunda empresa", async () =>
  sinFilas(await obra.from("clientes").select("id").eq("id", CLIENTE_AJENO)),
);

await comprobar("No ve presupuestos de la segunda empresa", async () =>
  sinFilas(await obra.from("presupuestos").select("id").eq("empresa_id", EMPRESA_AJENA)),
);

await comprobar("No puede crear un cliente en la segunda empresa", async () => {
  const intento = await obra
    .from("clientes")
    .insert({ empresa_id: EMPRESA_AJENA, nombre: `${PREFIJO} intruso` })
    .select("id");
  return falla(intento);
});

for (const tabla of ["facturas", "factura_lineas", "invitaciones", "contadores"]) {
  await comprobar(`No lee ${tabla}`, async () => sinFilas(await obra.from(tabla).select("*").limit(1)));
}

await comprobar("La vista presupuestos_con_totales cuadra con las partidas (misma regla que la app)", async () => {
  const vista = await obra
    .from("presupuestos_con_totales")
    .select("id, empresa_id, iva_pct, base_cents, iva_cents, total_cents, num_partidas, cliente_nombre");
  if (vista.error) return errorTexto(vista.error);
  if (vista.data.length === 0) return "no ve ningún presupuesto";
  if (!vista.data.every((p) => p.empresa_id === EMPRESA_DEMO)) return "ve presupuestos de otra empresa";
  const lineas = await obra.from("presupuesto_lineas").select("presupuesto_id, cantidad, precio_cents");
  if (lineas.error) return errorTexto(lineas.error);
  for (const p of vista.data) {
    const suyas = lineas.data.filter((l) => l.presupuesto_id === p.id);
    const base = suyas.reduce((suma, l) => suma + importeCents(l.cantidad, l.precio_cents), 0);
    const iva = ivaCents(base, p.iva_pct);
    if (p.base_cents !== base || p.iva_cents !== iva || p.total_cents !== base + iva || p.num_partidas !== suyas.length) {
      return `no cuadra el presupuesto ${p.id}`;
    }
    if (!p.cliente_nombre) return `falta cliente_nombre en ${p.id}`;
  }
  return true;
});

await comprobar(`Crea clientes de prueba; el NIF se guarda normalizado (${NIF_TEST})`, async () => {
  const { data, error } = await obra
    .from("clientes")
    .insert([
      { empresa_id: EMPRESA_DEMO, nombre: `${PREFIJO} Cliente sin NIF` },
      { empresa_id: EMPRESA_DEMO, nombre: `${PREFIJO} Cliente con NIF`, nif: " 12345678-z " },
    ])
    .select("id, nombre, nif");
  if (error) return errorTexto(error);
  creado.clienteSinNif = data.find((c) => c.nif === null)?.id ?? null;
  const conNif = data.find((c) => c.nif !== null);
  creado.clienteConNif = conNif?.id ?? null;
  return conNif?.nif === NIF_TEST ? true : `NIF guardado: ${conNif?.nif}`;
});

await comprobar("Un NIF con formato imposible se rechaza", async () =>
  falla(
    await obra
      .from("clientes")
      .insert({ empresa_id: EMPRESA_DEMO, nombre: `${PREFIJO} NIF raro`, nif: "123" })
      .select("id"),
  ),
);

await comprobar("Un NIF con la letra de control mal (12345678A) se rechaza en la base", async () =>
  falla(
    await obra
      .from("clientes")
      .insert({ empresa_id: EMPRESA_DEMO, nombre: `${PREFIJO} NIF con letra mal`, nif: "12345678A" })
      .select("id"),
    /nif_valido/,
  ),
);

let forjado = null;
await comprobar("Al crear un presupuesto se ignoran created_at, token, enviado_at y aceptado_* inventados", async () => {
  const tokenInventado = randomUUID();
  const { data, error } = await obra
    .from("presupuestos")
    .insert({
      empresa_id: EMPRESA_DEMO,
      cliente_id: creado.clienteSinNif,
      titulo: `${PREFIJO} fechas inventadas`,
      created_at: "2099-01-01T00:00:00Z",
      enviado_at: "2099-01-01T00:00:00Z",
      token: tokenInventado,
      aceptado_canal: "interno",
      aceptado_por: obraId,
    })
    .select("id, estado, created_at, enviado_at, token, aceptado_canal, aceptado_por")
    .single();
  if (error) return errorTexto(error);
  forjado = data;
  creado.forjado = data.id;
  const problemas = [];
  if (Math.abs(Date.parse(data.created_at) - Date.now()) > 10 * 60 * 1000) problemas.push(`created_at ${data.created_at}`);
  if (data.token === tokenInventado) problemas.push("token elegido");
  if (data.enviado_at !== null) problemas.push("enviado_at puesto");
  if (data.aceptado_canal !== null || data.aceptado_por !== null) problemas.push("aceptado_* puestos");
  if (data.estado !== "borrador") problemas.push(`estado ${data.estado}`);
  return problemas.length === 0 ? true : problemas.join(", ");
});

await comprobar("No puede poner aceptado_por ni aceptado_canal con un update", async () => {
  if (!forjado) return "no hay presupuesto de prueba";
  const canal = await obra.from("presupuestos").update({ aceptado_canal: "enlace" }).eq("id", forjado.id).select("id");
  const por = await obra.from("presupuestos").update({ aceptado_por: obraId }).eq("id", forjado.id).select("id");
  const a = falla(canal);
  const b = falla(por);
  return a === true && b === true ? true : `aceptado_canal: ${a === true ? "bloqueado" : a}; aceptado_por: ${b === true ? "bloqueado" : b}`;
});

await comprobar("guardar_presupuesto rechaza más de 100 partidas", async () => {
  const partidas = Array.from({ length: 101 }, (_, i) => ({
    orden: i + 1,
    descripcion: `${PREFIJO} partida ${i + 1}`,
    cantidad: 1,
    precio_cents: 100,
    material_id: null,
  }));
  return falla(
    await obra.rpc("guardar_presupuesto", {
      p_id: null,
      p_cliente: creado.clienteSinNif,
      p_titulo: `${PREFIJO} demasiadas partidas`,
      p_iva: 21,
      p_validez: 30,
      p_partidas: partidas,
    }),
    /100 partidas/,
  );
});

await comprobar("guardar_presupuesto rechaza cantidades con más de 3 decimales (no las redondea)", async () =>
  falla(
    await obra.rpc("guardar_presupuesto", {
      p_id: null,
      p_cliente: creado.clienteSinNif,
      p_titulo: `${PREFIJO} cuatro decimales`,
      p_iva: 21,
      p_validez: 30,
      p_partidas: [{ orden: 1, descripcion: `${PREFIJO} partida`, cantidad: 1.0005, precio_cents: 100, material_id: null }],
    }),
    /como mucho 3 decimales/,
  ),
);

await comprobar("No envía un presupuesto de 0 € (TJ004, 0008)", async () => {
  const { data: id, error } = await obra.rpc("guardar_presupuesto", {
    p_id: null,
    p_cliente: creado.clienteConNif,
    p_titulo: `${PREFIJO} cero euros`,
    p_iva: 21,
    p_validez: 30,
    p_partidas: [{ orden: 1, descripcion: `${PREFIJO} partida`, cantidad: 1, precio_cents: 0, material_id: null }],
  });
  if (error) return errorTexto(error);
  const intento = await obra.from("presupuestos").update({ estado: "enviado" }).eq("id", id).select("id");
  if (intento.error?.code !== "TJ004") return intento.error ? errorTexto(intento.error) : "lo ha enviado";
  return true;
});

await comprobar("Crea y envía dos presupuestos de prueba; enviado_por = obra y su nombre copiado (lo pone la base)", async () => {
  creado.sinNif = await crearPresupuesto(creado.clienteSinNif, `${PREFIJO} cliente sin NIF`);
  creado.enlace = await crearPresupuesto(creado.clienteConNif, `${PREFIJO} aceptado por el enlace`);
  const { data, error } = await obra
    .from("presupuestos")
    .update({ estado: "enviado", enviado_por_nombre: "Inventado" })
    .in("id", [creado.sinNif, creado.enlace])
    .select("id, estado, enviado_at, enviado_por, enviado_por_nombre");
  if (error) return errorTexto(error);
  if (data.length !== 2 || !data.every((p) => p.estado === "enviado" && p.enviado_at)) return "no se han enviado";
  const { data: perfil } = await obra.from("perfiles").select("nombre").eq("id", obraId).single();
  return data.every((p) => p.enviado_por === obraId && p.enviado_por_nombre === perfil?.nombre)
    ? true
    : `enviado_por: ${data.map((p) => `${p.enviado_por} (${p.enviado_por_nombre})`).join(", ")}`;
});

await comprobar("No puede pasar un presupuesto a aceptado", async () => {
  const intento = await obra.from("presupuestos").update({ estado: "aceptado" }).eq("id", creado.sinNif).select("id");
  const { data } = await obra.from("presupuestos").select("estado").eq("id", creado.sinNif).single();
  if (data?.estado !== "enviado") return `ha quedado en ${data?.estado}`;
  return falla(intento, /gerencia/i);
});

await comprobar("No puede regenerar el enlace", async () =>
  falla(await obra.rpc("regenerar_enlace", { p_presupuesto: creado.sinNif })),
);

let tokenEnlace = null;
await comprobar("No puede ejecutar aceptar_presupuesto con sesión (solo el enlace anónimo)", async () => {
  const { data, error } = await obra.from("presupuestos").select("token").eq("id", creado.enlace).single();
  if (error) return errorTexto(error);
  tokenEnlace = data.token;
  const intento = await obra.rpc("aceptar_presupuesto", {
    p_token: tokenEnlace,
    p_nombre: `${PREFIJO} Obra`,
    p_ip: null,
    p_user_agent: null,
  });
  const { data: despues } = await obra.from("presupuestos").select("estado").eq("id", creado.enlace).single();
  if (despues?.estado !== "enviado") return `ha quedado en ${despues?.estado}`;
  return falla(intento);
});

seccion("Anónimo (enlace público), con un presupuesto de prueba enviado");

await comprobar("Sin nombre no acepta y lo dice junto al campo (campo = 'nombre')", async () => {
  if (!tokenEnlace) return "no hay token del presupuesto de prueba";
  const { data, error } = await anon.rpc("aceptar_presupuesto", {
    p_token: tokenEnlace,
    p_nombre: " ",
    p_ip: null,
    p_user_agent: null,
  });
  if (error) return errorTexto(error);
  return data?.ok === false && data?.campo === "nombre" ? true : JSON.stringify(data);
});

await comprobar("Acepta con su token y su nombre: canal 'enlace', aceptado_por vacío, nombre, IP y navegador guardados (aparte, 0008)", async () => {
  if (!tokenEnlace) return "no hay token del presupuesto de prueba";
  const { data, error } = await anon.rpc("aceptar_presupuesto", {
    p_token: tokenEnlace,
    p_nombre: `  ${PREFIJO}   Cliente  `,
    p_ip: "203.0.113.10",
    p_user_agent: "tajo-test-db",
  });
  if (error) return errorTexto(error);
  if (data?.ok !== true) return `no ha aceptado: ${data?.motivo ?? JSON.stringify(data)}`;
  const { data: p, error: errorLectura } = await gerencia
    .from("presupuestos_con_totales")
    .select("estado, aceptado_at, aceptado_canal, aceptado_por, aceptado_nombre")
    .eq("id", creado.enlace)
    .single();
  if (errorLectura) return errorTexto(errorLectura);
  const { data: e, error: errorEvidencia } = await gerencia
    .from("presupuesto_aceptaciones")
    .select("ip, user_agent")
    .eq("presupuesto_id", creado.enlace)
    .single();
  if (errorEvidencia) return errorTexto(errorEvidencia);
  return p.estado === "aceptado" &&
    p.aceptado_at &&
    p.aceptado_canal === "enlace" &&
    p.aceptado_por === null &&
    p.aceptado_nombre === `${PREFIJO} Cliente` &&
    e.ip === "203.0.113.10" &&
    e.user_agent === "tajo-test-db"
    ? true
    : JSON.stringify({ ...p, ...e });
});

await comprobar("Nadie cambia la evidencia de la aceptación (ni gerencia)", async () =>
  falla(
    await gerencia.from("presupuestos").update({ aceptado_nombre: "Otro" }).eq("id", creado.enlace).select("id"),
    /lo pone el sistema|los pone el sistema/,
  ),
);

// ----------------------------------------------------------------------------
// 3. Gerencia (admin)
// ----------------------------------------------------------------------------

seccion("Gerencia (admin)");

await comprobar("Su perfil es admin de Reformas Levante", async () => {
  const { data, error } = await gerencia.from("perfiles").select("rol, empresa_id").eq("id", gerenciaId).single();
  if (error) return errorTexto(error);
  return data.rol === "admin" && data.empresa_id === EMPRESA_DEMO ? true : `rol ${data.rol}, empresa ${data.empresa_id}`;
});

await comprobar("Lee las facturas con su copia fija y sus partidas, y cuadran", async () => {
  const facturas = await gerencia
    .from("facturas")
    .select(
      "id, numero, empresa_id, base_cents, iva_cents, total_cents, iva_pct, cliente_nombre, cliente_nif, cliente_direccion, empresa_nombre, empresa_cif, empresa_direccion",
    );
  if (facturas.error) return errorTexto(facturas.error);
  if (facturas.data.length === 0) return "no hay facturas (¿falta ejecutar el seed?)";
  const lineas = await gerencia.from("factura_lineas").select("factura_id, orden, cantidad, precio_cents, importe_cents");
  if (lineas.error) return errorTexto(lineas.error);
  for (const f of facturas.data) {
    if (f.empresa_id !== EMPRESA_DEMO) return `ve la factura ${f.numero} de otra empresa`;
    if (!f.cliente_nombre || !f.cliente_nif || !f.empresa_nombre || !f.empresa_cif || f.iva_pct === null) {
      return `a la factura ${f.numero} le falta la copia de cliente o empresa`;
    }
    const suyas = lineas.data.filter((l) => l.factura_id === f.id);
    if (suyas.length === 0) return `la factura ${f.numero} no tiene partidas`;
    if (suyas.some((l) => l.importe_cents !== importeCents(l.cantidad, l.precio_cents))) {
      return `algún importe de ${f.numero} no es cantidad × precio`;
    }
    const base = suyas.reduce((suma, l) => suma + l.importe_cents, 0);
    if (base !== f.base_cents || f.iva_cents !== ivaCents(base, f.iva_pct) || f.total_cents !== base + f.iva_cents) {
      return `los importes de ${f.numero} no cuadran con sus partidas`;
    }
  }
  return true;
});

for (const tabla of ["clientes", "materiales", "presupuestos", "presupuesto_lineas", "presupuestos_con_totales", "facturas", "factura_lineas", "perfiles", "ia_propuestas"]) {
  await comprobar(`No ve nada de la segunda empresa en ${tabla}`, async () =>
    sinFilas(await gerencia.from(tabla).select("*").eq("empresa_id", EMPRESA_AJENA)),
  );
}

await comprobar("No ve la segunda empresa en empresas", async () =>
  sinFilas(await gerencia.from("empresas").select("id").eq("id", EMPRESA_AJENA)),
);

await comprobar("No lee invitaciones", async () => sinFilas(await gerencia.from("invitaciones").select("*").limit(1)));

await comprobar("No puede regenerar el enlace de un presupuesto de la segunda empresa", async () =>
  falla(await gerencia.rpc("regenerar_enlace", { p_presupuesto: PRESUPUESTO_AJENO }), /no existe o no pertenece/),
);

await comprobar("No puede regenerar el enlace de un borrador", async () =>
  falla(await gerencia.rpc("regenerar_enlace", { p_presupuesto: creado.forjado }), /borrador/),
);

await comprobar("regenerar_enlace cambia el token y el viejo deja de funcionar", async () => {
  const { data: antes, error } = await gerencia.from("presupuestos").select("token").eq("id", creado.sinNif).single();
  if (error) return errorTexto(error);
  const viejoAntes = await anon.rpc("presupuesto_publico", { p_token: antes.token });
  if (viejoAntes.error || viejoAntes.data === null) return "el enlace original no funcionaba antes de regenerarlo";
  const nuevo = await gerencia.rpc("regenerar_enlace", { p_presupuesto: creado.sinNif });
  if (nuevo.error) return errorTexto(nuevo.error);
  if (typeof nuevo.data !== "string" || nuevo.data === antes.token) return "no ha devuelto un token nuevo";
  const viejo = await anon.rpc("presupuesto_publico", { p_token: antes.token });
  const actual = await anon.rpc("presupuesto_publico", { p_token: nuevo.data });
  if (viejo.error || viejo.data !== null) return "el enlace viejo sigue devolviendo datos";
  if (actual.error || actual.data === null) return "el enlace nuevo no funciona";
  return true;
});

await comprobar("Da por aceptado el presupuesto de prueba sin NIF (canal interno, aceptado_por = gerencia)", async () => {
  const { data, error } = await gerencia
    .from("presupuestos")
    .update({ estado: "aceptado" })
    .eq("id", creado.sinNif)
    .select("id, estado, aceptado_at, aceptado_canal, aceptado_por, aceptado_nombre");
  if (error) return errorTexto(error);
  if (data.length !== 1) return `ha cambiado ${data.length}`;
  const [p] = data;
  return p.estado === "aceptado" && p.aceptado_at && p.aceptado_canal === "interno" && p.aceptado_por === gerenciaId &&
    p.aceptado_nombre === null
    ? true
    : JSON.stringify(p);
});

await comprobar("Un presupuesto aceptado no se borra (ni gerencia): 0 filas y sigue ahí", async () => {
  const intento = await gerencia.from("presupuestos").delete().eq("id", creado.sinNif).select("id");
  if (intento.error) return errorTexto(intento.error);
  const { data } = await gerencia.from("presupuestos").select("estado").eq("id", creado.sinNif).single();
  return intento.data.length === 0 && data?.estado === "aceptado" ? true : "lo ha podido borrar";
});

await comprobar(`Facturar a un cliente sin NIF falla con el error propio (${ERROR_SIN_NIF})`, async () => {
  const { error } = await gerencia.rpc("facturar_presupuesto", { p_presupuesto: creado.sinNif });
  if (!error) return "ha facturado (queda una factura de prueba hasta el próximo seed)";
  return error.code === ERROR_SIN_NIF ? true : `ha fallado con otro error: ${errorTexto(error)}`;
});

seccion("Obra (empleado), con un presupuesto ya aceptado");

await comprobar("No lee la IP ni el navegador de la aceptación (solo gerencia, 0008)", async () => {
  const tabla = await obra.from("presupuesto_aceptaciones").select("ip").eq("presupuesto_id", creado.enlace);
  if (tabla.error) return errorTexto(tabla.error);
  if (tabla.data.length > 0) return "ha leído la IP";
  const columna = await obra.from("presupuestos").select("aceptado_ip").eq("id", creado.enlace);
  return columna.error ? true : "presupuestos sigue teniendo aceptado_ip";
});

await comprobar("No puede facturar", async () =>
  falla(await obra.rpc("facturar_presupuesto", { p_presupuesto: creado.sinNif }), /administrador/i),
);

await comprobar("Cuota de IA por usuario: 15 al día y la 16.ª da TJ003 (se devuelven las 15 al acabar)", async () => {
  const reservas = [];
  let resultado = true;
  for (let i = 1; i <= 16; i += 1) {
    const { data, error } = await obra.rpc("consumir_uso_ia");
    if (i <= 15) {
      if (error) {
        resultado = error.code === "TJ002"
          ? "la empresa ya tiene casi gastada la cuota de hoy; no se puede comprobar el límite por usuario"
          : `uso ${i}: ${errorTexto(error)}`;
        break;
      }
      reservas.push(data[0].reserva);
    } else if (!error || error.code !== "TJ003") {
      resultado = error ? `la 16.ª ha dado ${errorTexto(error)}` : "la 16.ª no ha dado error";
    }
  }
  for (const reserva of reservas) {
    const { data, error } = await obra.rpc("devolver_uso_ia", { p_reserva: reserva });
    if (error || data !== true) resultado = `no se ha podido devolver una reserva: ${error ? errorTexto(error) : data}`;
  }
  return resultado;
});

// Caché de propuestas de IA (0009). Sin gastar cuota: guardar una de verdad gastaría un uso y dejaría una fila que solo
// borra el seed (eso, y que una reserva no sirva dos veces, lo comprueba test:pglite).
const PROPUESTA_DE_PRUEBA = {
  partidas: [{ descripcion: `${PREFIJO} partida`, cantidad: 1, unidad: "", precio_euros: 1, material_id: null }],
  supuestos: [],
};

await comprobar("No escribe en ia_propuestas directamente (0009)", async () =>
  falla(
    await obra
      .from("ia_propuestas")
      .insert({ empresa_id: EMPRESA_DEMO, clave: "a".repeat(64), respuesta: PROPUESTA_DE_PRUEBA, reserva: randomUUID() })
      .select("clave"),
  ),
);

await comprobar("No guarda una propuesta de IA sin una reserva suya y sin usar (TJ005, 0009)", async () => {
  const { error } = await obra.rpc("guardar_propuesta_ia", {
    p_reserva: randomUUID(),
    p_clave: "a".repeat(64),
    p_respuesta: PROPUESTA_DE_PRUEBA,
  });
  if (!error) return "ha guardado la propuesta";
  return error.code === "TJ005" ? true : `ha fallado con otro error: ${errorTexto(error)}`;
});

// ----------------------------------------------------------------------------
// 4. Obras (0006): alta automática, partes, permisos por rol y la vista obras_resumen
// ----------------------------------------------------------------------------

seccion("Obras");

/** Obra de cada presupuesto de prueba (null si no la hay). */
const obraDe = { enlace: null, sinNif: null };
/** Partes de prueba creados por obra y por gerencia. */
const parteDe = { obra: null, gerencia: null };

await comprobar("Al aceptar (por el enlace o por gerencia) se crea la obra pendiente, sin encargado", async () => {
  const ids = [creado.enlace, creado.sinNif];
  const { data, error } = await gerencia
    .from("obras")
    .select("id, presupuesto_id, estado, titulo, encargado_id, empresa_id")
    .in("presupuesto_id", ids);
  if (error) return errorTexto(error);
  for (const o of data) {
    if (o.presupuesto_id === creado.enlace) obraDe.enlace = o.id;
    if (o.presupuesto_id === creado.sinNif) obraDe.sinNif = o.id;
  }
  if (data.length !== 2) return `hay ${data.length} obras de 2`;
  return data.every((o) => o.estado === "pendiente" && o.encargado_id === null && o.titulo.startsWith(PREFIJO) && o.empresa_id === EMPRESA_DEMO)
    ? true
    : JSON.stringify(data);
});

for (const tabla of ["obras", "partes", "parte_materiales", "obras_resumen"]) {
  await comprobar(`Obra ve ${tabla} de su empresa y nada de la segunda`, async () => {
    const propias = await obra.from(tabla).select("empresa_id").limit(50);
    if (propias.error) return errorTexto(propias.error);
    if (propias.data.length === 0) return "no ve nada (¿falta ejecutar el seed?)";
    if (!propias.data.every((x) => x.empresa_id === EMPRESA_DEMO)) return "ve filas de otra empresa";
    return sinFilas(await obra.from(tabla).select("*").eq("empresa_id", EMPRESA_AJENA));
  });
}

await comprobar("La vista obras_resumen cuadra con sus partes y su presupuesto (misma regla que la app)", async () => {
  const [vista, partes, materiales, presupuestos] = await Promise.all([
    gerencia.from("obras_resumen").select("id, presupuesto_id, presupuestado_cents, horas, coste_mano_obra_cents, coste_material_cents, coste_real_cents, margen_cents, consumido_pct, num_partes"),
    gerencia.from("partes").select("id, obra_id, horas, coste_hora_cents"),
    gerencia.from("parte_materiales").select("parte_id, cantidad, coste_unit_cents"),
    gerencia.from("presupuestos_con_totales").select("id, base_cents"),
  ]);
  for (const r of [vista, partes, materiales, presupuestos]) if (r.error) return errorTexto(r.error);
  if (vista.data.length === 0) return "no hay obras (¿falta ejecutar el seed?)";
  for (const o of vista.data) {
    const suyos = partes.data.filter((p) => p.obra_id === o.id);
    const manoObra = suyos.reduce((s, p) => s + importeCents(p.horas, p.coste_hora_cents), 0);
    const ids = new Set(suyos.map((p) => p.id));
    const material = materiales.data
      .filter((m) => ids.has(m.parte_id))
      .reduce((s, m) => s + importeCents(m.cantidad, m.coste_unit_cents), 0);
    const base = presupuestos.data.find((p) => p.id === o.presupuesto_id)?.base_cents;
    const real = manoObra + material;
    const pct = base === 0 ? null : Number((BigInt(real) * BigInt(2000) + BigInt(base)) / (BigInt(2) * BigInt(base))) / 10;
    if (o.presupuestado_cents !== base || o.coste_mano_obra_cents !== manoObra || o.coste_material_cents !== material
        || o.coste_real_cents !== real || o.margen_cents !== base - real || o.num_partes !== suyos.length
        || (pct === null ? o.consumido_pct !== null : Number(o.consumido_pct) !== pct)) {
      return `no cuadra la obra ${o.id}`;
    }
  }
  return true;
});

await comprobar("Obra (no es el encargado) no cambia el estado de una obra", async () => {
  const intento = await obra.from("obras").update({ estado: "en_curso" }).eq("id", obraDe.enlace).select("id");
  if (intento.error) return errorTexto(intento.error);
  const { data } = await gerencia.from("obras").select("estado").eq("id", obraDe.enlace).single();
  return intento.data.length === 0 && data?.estado === "pendiente" ? true : `ha quedado en ${data?.estado}`;
});

await comprobar("Obra no añade partes a una obra pendiente", async () =>
  falla(await obra.rpc("guardar_parte", { p_id: null, p_obra: obraDe.enlace, p_fecha: null, p_horas: 8, p_notas: PREFIJO, p_materiales: [] }), /no ha empezado/),
);

await comprobar("Gerencia pone a obra de encargado y la obra en curso", async () => {
  const { data, error } = await gerencia
    .from("obras")
    .update({ encargado_id: obraId, estado: "en_curso" })
    .eq("id", obraDe.enlace)
    .select("estado, encargado_id, fecha_inicio")
    .single();
  if (error) return errorTexto(error);
  return data.estado === "en_curso" && data.encargado_id === obraId && data.fecha_inicio ? true : JSON.stringify(data);
});

await comprobar("El encargado (obra) la para y la vuelve a poner en curso", async () => {
  const parada = await obra.from("obras").update({ estado: "parada" }).eq("id", obraDe.enlace).select("estado");
  if (parada.error) return errorTexto(parada.error);
  const curso = await obra.from("obras").update({ estado: "en_curso" }).eq("id", obraDe.enlace).select("estado");
  if (curso.error) return errorTexto(curso.error);
  return parada.data[0]?.estado === "parada" && curso.data[0]?.estado === "en_curso" ? true : "no ha cambiado de estado";
});

await comprobar("Una transición no válida (en curso → pendiente) se rechaza con mensaje", async () =>
  falla(await obra.from("obras").update({ estado: "pendiente" }).eq("id", obraDe.enlace).select("id"), /no puede pasar de/),
);

await comprobar("Obra no cambia el título de una obra (permiso por columna)", async () =>
  falla(await obra.from("obras").update({ titulo: `${PREFIJO} otro` }).eq("id", obraDe.enlace).select("id")),
);

await comprobar("Obra añade un parte: autor, coste por hora y fecha de alta los pone la base de datos", async () => {
  const empresa = await obra.from("empresas").select("coste_hora_cents").eq("id", EMPRESA_DEMO).single();
  if (empresa.error) return errorTexto(empresa.error);
  const { data, error } = await obra
    .from("partes")
    .insert({
      empresa_id: EMPRESA_DEMO,
      obra_id: obraDe.enlace,
      horas: 7.5,
      notas: `${PREFIJO} parte de obra`,
      autor_id: gerenciaId,
      coste_hora_cents: 1,
      created_at: "2001-01-01T00:00:00Z",
    })
    .select("id, autor_id, coste_hora_cents, created_at")
    .single();
  if (error) return errorTexto(error);
  parteDe.obra = data.id;
  const problemas = [];
  if (data.autor_id !== obraId) problemas.push(`autor ${data.autor_id}`);
  if (data.coste_hora_cents !== empresa.data.coste_hora_cents) problemas.push(`coste ${data.coste_hora_cents}`);
  if (Math.abs(Date.parse(data.created_at) - Date.now()) > 10 * 60 * 1000) problemas.push(`created_at ${data.created_at}`);
  return problemas.length === 0 ? true : problemas.join(", ");
});

await comprobar("guardar_parte con un material: copia su coste (o su precio si no tiene coste)", async () => {
  const material = await obra.from("materiales").select("id, coste_cents, precio_cents").limit(1).single();
  if (material.error) return errorTexto(material.error);
  const { data: id, error } = await obra.rpc("guardar_parte", {
    p_id: parteDe.obra,
    p_obra: obraDe.enlace,
    p_fecha: null,
    p_horas: 6,
    p_notas: `${PREFIJO} parte de obra`,
    p_materiales: [{ material_id: material.data.id, cantidad: 2.5 }],
  });
  if (error) return errorTexto(error);
  const linea = await obra.from("parte_materiales").select("coste_unit_cents, cantidad").eq("parte_id", id).single();
  if (linea.error) return errorTexto(linea.error);
  const esperado = material.data.coste_cents ?? material.data.precio_cents;
  return linea.data.coste_unit_cents === esperado && Number(linea.data.cantidad) === 2.5 ? true : JSON.stringify(linea.data);
});

await comprobar("Obra no cambia el autor ni el coste por hora de su parte", async () => {
  const autor = falla(await obra.from("partes").update({ autor_id: gerenciaId }).eq("id", parteDe.obra).select("id"));
  const coste = falla(await obra.from("partes").update({ coste_hora_cents: 1 }).eq("id", parteDe.obra).select("id"));
  return autor === true && coste === true ? true : `autor: ${autor}; coste: ${coste}`;
});

await comprobar("Obra no añade partes a una obra terminada ni a una de la segunda empresa", async () => {
  const terminada = falla(
    await obra.from("partes").insert({ empresa_id: EMPRESA_DEMO, obra_id: OBRA_TERMINADA, horas: 1 }).select("id"),
    /terminada/,
  );
  const ajena = falla(
    await obra.from("partes").insert({ empresa_id: EMPRESA_DEMO, obra_id: OBRA_AJENA, horas: 1 }).select("id"),
    /no existe o no es de tu empresa/,
  );
  return terminada === true && ajena === true ? true : `terminada: ${terminada}; ajena: ${ajena}`;
});

await comprobar("Obra no edita su parte de un día anterior (del seed)", async () => {
  const { data: antes, error } = await obra.from("partes").select("horas, autor_id").eq("id", PARTE_DE_AYER).single();
  if (error) return `${errorTexto(error)} (¿falta ejecutar el seed?)`;
  if (antes.autor_id !== obraId) return "ese parte del seed no es de obra";
  const intento = await obra.from("partes").update({ horas: antes.horas }).eq("id", PARTE_DE_AYER).select("id");
  if (intento.error) return errorTexto(intento.error);
  return intento.data.length === 0 ? true : "lo ha podido editar";
});

await comprobar("Gerencia añade un parte y obra no lo puede editar ni borrar", async () => {
  const { data, error } = await gerencia
    .from("partes")
    .insert({ empresa_id: EMPRESA_DEMO, obra_id: obraDe.enlace, horas: 2, notas: `${PREFIJO} parte de gerencia` })
    .select("id, autor_id")
    .single();
  if (error) return errorTexto(error);
  parteDe.gerencia = data.id;
  if (data.autor_id !== gerenciaId) return `autor ${data.autor_id}`;
  const editar = await obra.from("partes").update({ horas: 1 }).eq("id", data.id).select("id");
  const borrar = await obra.from("partes").delete().eq("id", data.id).select("id");
  if (editar.error || borrar.error) return errorTexto(editar.error ?? borrar.error);
  return editar.data.length === 0 && borrar.data.length === 0 ? true : "lo ha podido editar o borrar";
});

await comprobar("Gerencia edita el parte de obra", async () => {
  const { data, error } = await gerencia.from("partes").update({ horas: 5 }).eq("id", parteDe.obra).select("horas");
  if (error) return errorTexto(error);
  return data.length === 1 && Number(data[0].horas) === 5 ? true : "no lo ha editado";
});

await comprobar("Nadie cambia los partes de una obra terminada (tampoco gerencia)", async () => {
  const { data, error } = await gerencia.from("partes").select("id, horas").eq("obra_id", OBRA_TERMINADA).limit(1).single();
  if (error) return `${errorTexto(error)} (¿falta ejecutar el seed?)`;
  return falla(await gerencia.from("partes").update({ horas: data.horas }).eq("id", data.id).select("id"), /terminada/);
});

await comprobar("Una obra terminada no admite partes nuevos", async () => {
  for (const estado of ["en_curso", "terminada"]) {
    const { error } = await gerencia.from("obras").update({ estado }).eq("id", obraDe.sinNif).select("id");
    if (error) return `${estado}: ${errorTexto(error)}`;
  }
  const { data } = await gerencia.from("obras").select("estado, fecha_fin").eq("id", obraDe.sinNif).single();
  if (data?.estado !== "terminada" || !data.fecha_fin) return `estado ${data?.estado}, fin ${data?.fecha_fin}`;
  return falla(
    await obra.from("partes").insert({ empresa_id: EMPRESA_DEMO, obra_id: obraDe.sinNif, horas: 1 }).select("id"),
    /terminada/,
  );
});

await comprobar("De una obra terminada solo se cambian las notas", async () => {
  const encargado = falla(
    await gerencia.from("obras").update({ encargado_id: gerenciaId }).eq("id", obraDe.sinNif).select("id"),
    /solo se pueden cambiar las notas/,
  );
  if (encargado !== true) return `encargado: ${encargado}`;
  const { data, error } = await gerencia
    .from("obras")
    .update({ notas: `${PREFIJO} notas tras terminar` })
    .eq("id", obraDe.sinNif)
    .select("id");
  if (error) return errorTexto(error);
  return data.length === 1 ? true : "no ha cambiado las notas";
});

await comprobar("Un parte no puede tener fecha anterior al inicio de la obra", async () => {
  const { data, error } = await obra.from("obras").select("fecha_inicio").eq("id", obraDe.enlace).single();
  if (error) return errorTexto(error);
  const antes = new Date(`${data.fecha_inicio}T12:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  return falla(
    await obra.rpc("guardar_parte", {
      p_id: null,
      p_obra: obraDe.enlace,
      p_fecha: antes.toISOString().slice(0, 10),
      p_horas: 1,
      p_notas: PREFIJO,
      p_materiales: [],
    }),
    /anterior al inicio de la obra/,
  );
});

await comprobar("guardar_parte rechaza horas con 3 decimales y materiales sin id (no redondea en silencio)", async () => {
  const horas = falla(
    await obra.rpc("guardar_parte", { p_id: null, p_obra: obraDe.enlace, p_fecha: null, p_horas: 7.125, p_notas: PREFIJO, p_materiales: [] }),
    /como mucho 2 decimales/,
  );
  const material = falla(
    await obra.rpc("guardar_parte", {
      p_id: null,
      p_obra: obraDe.enlace,
      p_fecha: null,
      p_horas: 1,
      p_notas: PREFIJO,
      p_materiales: [{ material_id: null, cantidad: 1 }],
    }),
    /elige un material/,
  );
  return horas === true && material === true ? true : `horas: ${horas}; material: ${material}`;
});

await comprobar("Obra ve obras_resumen sin importes ni % consumido (solo gerencia), pero con el semáforo de gerencia", async () => {
  const [deObra, deGerencia] = await Promise.all([
    obra
      .from("obras_resumen")
      .select("id, presupuestado_cents, coste_mano_obra_cents, coste_material_cents, coste_real_cents, margen_cents, consumido_pct, semaforo"),
    gerencia.from("obras_resumen").select("id, semaforo"),
  ]);
  if (deObra.error || deGerencia.error) return errorTexto(deObra.error ?? deGerencia.error);
  if (deObra.data.length === 0) return "no ve ninguna obra";
  const conImporte = deObra.data.filter((o) =>
    [o.presupuestado_cents, o.coste_mano_obra_cents, o.coste_material_cents, o.coste_real_cents, o.margen_cents, o.consumido_pct].some(
      (v) => v !== null,
    ),
  );
  if (conImporte.length > 0) return `ve importes o % consumido en ${conImporte.length} obra(s)`;
  const distinto = deObra.data.filter((o) => deGerencia.data.find((g) => g.id === o.id)?.semaforo !== o.semaforo);
  return distinto.length === 0 ? true : `semáforo distinto del de gerencia en ${distinto.length} obra(s)`;
});

await comprobar("Obra no pone ni cambia el coste de un material (solo gerencia)", async () => {
  const alta = falla(
    await obra
      .from("materiales")
      .insert({ empresa_id: EMPRESA_DEMO, nombre: `${PREFIJO} material con coste`, precio_cents: 100, coste_cents: 50 })
      .select("id"),
    /Solo gerencia/,
  );
  const { data: material, error } = await obra.from("materiales").select("id, coste_cents").limit(1).single();
  if (error) return errorTexto(error);
  const cambio = falla(
    await obra
      .from("materiales")
      .update({ coste_cents: (material.coste_cents ?? 0) + 1 })
      .eq("id", material.id)
      .select("id"),
    /Solo gerencia/,
  );
  return alta === true && cambio === true ? true : `alta: ${alta}; cambio: ${cambio}`;
});

await comprobar("Nadie borra obras (ni gerencia)", async () => {
  const deGerencia = falla(await gerencia.from("obras").delete().eq("id", obraDe.sinNif).select("id"));
  const deObra = falla(await obra.from("obras").delete().eq("id", obraDe.sinNif).select("id"));
  return deGerencia === true && deObra === true ? true : `gerencia: ${deGerencia}; obra: ${deObra}`;
});

await comprobar("No se borra un presupuesto cuya obra tiene partes", async () =>
  falla(await gerencia.from("presupuestos").delete().eq("id", PRESUPUESTO_CON_PARTES).select("id"), /partes de trabajo/),
);

await comprobar("Anónimo no puede llamar a guardar_parte", async () =>
  falla(await anon.rpc("guardar_parte", { p_id: null, p_obra: obraDe.enlace, p_fecha: null, p_horas: 1, p_notas: null, p_materiales: [] })),
);

await comprobar("Como mucho 24 h por persona y día (obra ya tiene su parte de hoy)", async () =>
  falla(
    await obra.from("partes").insert({ empresa_id: EMPRESA_DEMO, obra_id: obraDe.enlace, horas: 20, notas: PREFIJO }).select("id"),
    /como mucho 24 h por persona y día/,
  ),
);

await comprobar("La fecha de inicio de una obra empezada no se cambia (ni gerencia)", async () => {
  const { data, error } = await gerencia.from("obras").select("fecha_inicio").eq("id", obraDe.enlace).single();
  if (error) return errorTexto(error);
  const antes = new Date(`${data.fecha_inicio}T12:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  return falla(
    await gerencia.from("obras").update({ fecha_inicio: antes.toISOString().slice(0, 10) }).eq("id", obraDe.enlace).select("id"),
    /no se cambia una vez empezada/,
  );
});

await comprobar("Obra borra su parte del día", async () => {
  const { data, error } = await obra.from("partes").delete().eq("id", parteDe.obra).select("id");
  if (error) return errorTexto(error);
  return data.length === 1 ? true : "no lo ha borrado";
});

// ----------------------------------------------------------------------------
// 5. Limpieza y resumen
// ----------------------------------------------------------------------------

seccion("Limpieza");
await comprobar("Borra los datos de prueba", limpiar);

await Promise.all([obra.auth.signOut(), gerencia.auth.signOut()]);

escribir(`\n${resultados.ok} correctas, ${resultados.fallos} fallidas.`);
process.exitCode = resultados.fallos > 0 ? 1 : 0;
