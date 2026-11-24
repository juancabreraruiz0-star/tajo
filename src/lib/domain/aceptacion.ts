// Aceptación por enlace con evidencia (D12): el nombre que escribe el cliente, la IP y el navegador de la petición, y
// los textos con los que se enseña en el detalle del presupuesto. Puro: sin Next ni Supabase.

import { formatFechaHora } from "./dates";
import type { CanalAceptacion } from "./linea-tiempo";
import { text } from "./validation";

/** Mismos límites que aceptar_presupuesto() (0007): el nombre, de 2 a 120 caracteres. IP y navegador se recortan. */
export const LIMITES_ACEPTACION = { nombreMin: 2, nombre: 120, ip: 64, userAgent: 400 } as const;

export type NombreAceptacion = { ok: true; nombre: string } | { ok: false; error: string };

/** Caracteres de control (saltos de línea, tabuladores, nulos…) → espacio: no tienen sitio en un nombre ni en una cabecera. */
function sinControl(valor: string): string {
  return valor.replace(/\p{Cc}/gu, " ");
}

/**
 * Espacios Unicode (espacio duro, separadores…) → espacio normal, y caracteres invisibles de formato (espacio de
 * ancho cero, BOM, marcas de dirección…) fuera: así « Ana» es «Ana» y «​​» queda vacío.
 */
function sinInvisibles(valor: string): string {
  return valor.replace(/\p{Z}/gu, " ").replace(/\p{Cf}/gu, "");
}

/** Cuenta caracteres como char_length() de Postgres (puntos de código, no unidades UTF-16). */
function largo(valor: string): number {
  return [...valor].length;
}

function recortar(valor: string, max: number): string {
  return [...valor].slice(0, max).join("");
}

/**
 * Valida el nombre con el que el cliente acepta: obligatorio, de 2 a 120 caracteres y con alguna letra. Se quitan los
 * caracteres de control y los invisibles, y se juntan los espacios repetidos («  Ana   López » → «Ana López»).
 */
export function validateNombreAceptacion(valor: unknown): NombreAceptacion {
  const nombre = sinInvisibles(sinControl(text(valor))).replace(/\s+/g, " ").trim();
  if (nombre === "") return { ok: false, error: "Escribe tu nombre y apellidos para aceptar." };
  if (!/\p{L}/u.test(nombre)) return { ok: false, error: "El nombre tiene que llevar letras." };
  if (largo(nombre) < LIMITES_ACEPTACION.nombreMin) {
    return { ok: false, error: `El nombre tiene que tener al menos ${LIMITES_ACEPTACION.nombreMin} caracteres.` };
  }
  if (largo(nombre) > LIMITES_ACEPTACION.nombre) {
    return { ok: false, error: `El nombre puede tener como mucho ${LIMITES_ACEPTACION.nombre} caracteres.` };
  }
  return { ok: true, nombre };
}

/** Lo mínimo de `Headers` que hace falta (así se prueba sin Next). */
export interface CabecerasLike {
  get(nombre: string): string | null;
}

export interface EvidenciaPeticion {
  ip: string | null;
  userAgent: string | null;
}

function limpiar(valor: string | null | undefined, max: number): string | null {
  const limpio = sinControl(valor ?? "").trim();
  return limpio === "" ? null : recortar(limpio, max);
}

/**
 * IP y navegador de la petición, para guardarlos con la aceptación. La IP es el primer valor de `x-forwarded-for`
 * (el cliente, según el proxy de Vercel) o, si no viene, `x-real-ip`. Se recortan y, si faltan, van a null.
 * Es evidencia razonable, no una prueba: quien llame a la base de datos directamente puede inventarlas.
 */
export function evidenciaPeticion(cabeceras: CabecerasLike): EvidenciaPeticion {
  const reenviada = cabeceras.get("x-forwarded-for")?.split(",")[0];
  return {
    ip: limpiar(reenviada, LIMITES_ACEPTACION.ip) ?? limpiar(cabeceras.get("x-real-ip"), LIMITES_ACEPTACION.ip),
    userAgent: limpiar(cabeceras.get("user-agent"), LIMITES_ACEPTACION.userAgent),
  };
}

export interface DatosAceptacion {
  canal: CanalAceptacion | null;
  aceptadoAt: string | null;
  /** Nombre que escribió el cliente en el enlace (0007); null en las aceptaciones de antes. */
  aceptadoNombre?: string | null;
  /** Nombre del perfil de gerencia que lo dio por aceptado desde la app, si se conoce. */
  aceptadoPor?: string | null;
}

/**
 * Frase de constancia de la aceptación para el detalle del presupuesto:
 * «Aceptado por Ana López desde el enlace el 24/11/2026 a las 10:32» o
 * «Dado por aceptado por Marta (gerencia) desde la app el …». null si no está aceptado.
 */
export function textoAceptacion(datos: DatosAceptacion): string | null {
  if (datos.canal === null) return null;
  const cuando = datos.aceptadoAt ? ` el ${formatFechaHora(datos.aceptadoAt)}` : "";
  if (datos.canal === "enlace") {
    const quien = datos.aceptadoNombre?.trim() || "el cliente";
    return `Aceptado por ${quien} desde el enlace${cuando}`;
  }
  const quien = datos.aceptadoPor?.trim() ? `${datos.aceptadoPor.trim()} (gerencia)` : "gerencia";
  return `Dado por aceptado por ${quien} desde la app${cuando}`;
}

/** «Enviado por Marta el 20/11/2026 a las 9:15»; null si no se sabe quién lo envió. */
export function textoEnviadoPor(enviadoPor: string | null | undefined, enviadoAt: string | null): string | null {
  const quien = enviadoPor?.trim();
  if (!quien) return null;
  return `Enviado por ${quien}${enviadoAt ? ` el ${formatFechaHora(enviadoAt)}` : ""}`;
}
