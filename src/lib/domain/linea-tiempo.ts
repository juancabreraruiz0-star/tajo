// Línea de tiempo del estado de un presupuesto (detalle): creado → enviado → aceptado/rechazado → facturado y, si
// ya tiene obra, cómo va la obra. Puro.

import type { EstadoObra } from "./obras";
import type { EstadoPresupuesto } from "./status";

export type CanalAceptacion = "enlace" | "interno";

export type EstadoHito =
  /** Ya ocurrió. */
  | "hecho"
  /** Es el siguiente paso y todavía puede pasar. */
  | "siguiente"
  /** Todavía no ha pasado. */
  | "pendiente"
  /** Se cerró sin llegar aquí (rechazado o validez vencida). */
  | "cerrado";

export type HitoClave = "creado" | "enviado" | "aceptado" | "rechazado" | "facturado" | "obra";

export interface Hito {
  clave: HitoClave;
  titulo: string;
  estado: EstadoHito;
  /** Fecha o timestamp ISO del hito, si se conoce. */
  fecha: string | null;
  /** Una línea de contexto (canal de aceptación, número de factura, validez…). */
  detalle: string | null;
}

export interface DatosLineaTiempo {
  estado: EstadoPresupuesto;
  created_at: string;
  enviado_at: string | null;
  aceptado_at: string | null;
  aceptado_canal: CanalAceptacion | null;
  /** Nombre de quien lo dio por aceptado desde la app (gerencia), si se conoce. */
  aceptadoPor?: string | null;
  /** Nombre que escribió el cliente al aceptar desde el enlace (0007), si lo hay. */
  aceptadoNombre?: string | null;
  /** Nombre de quien lo marcó como enviado (0007), si se conoce. */
  enviadoPor?: string | null;
  /** ¿Ha pasado ya el último día de validez? */
  vencido?: boolean;
  /** Último día de validez ya formateado para leerlo («23/12/2026»). */
  validoHasta?: string | null;
  /** Factura del presupuesto, si quien mira puede verla (gerencia). */
  factura?: { numero: string; fecha: string } | null;
  /** Obra del presupuesto (aceptado o facturado), si la tiene. */
  obra?: { estado: EstadoObra; fecha_inicio: string | null; fecha_fin: string | null } | null;
}

const DETALLE_OBRA: Record<EstadoObra, string> = {
  pendiente: "Sin empezar",
  en_curso: "En curso desde esta fecha",
  parada: "Parada",
  terminada: "Obra terminada",
};

/** Hito de la obra: hecho al terminarla; en marcha (siguiente) mientras está en curso o parada. */
function hitoObra(obra: NonNullable<DatosLineaTiempo["obra"]>, facturado: boolean): Hito {
  const terminada = obra.estado === "terminada";
  const empezada = obra.estado === "en_curso" || obra.estado === "parada";
  return {
    clave: "obra",
    titulo: "Obra",
    estado: terminada ? "hecho" : empezada || facturado ? "siguiente" : "pendiente",
    fecha: terminada ? obra.fecha_fin : empezada ? obra.fecha_inicio : null,
    detalle: DETALLE_OBRA[obra.estado],
  };
}

/** Quién y por dónde se aceptó (D9; el nombre del cliente, D12). */
export function textoCanalAceptacion(
  canal: CanalAceptacion | null,
  aceptadoPor?: string | null,
  aceptadoNombre?: string | null,
): string | null {
  switch (canal) {
    case "enlace":
      return aceptadoNombre?.trim() ? `Por ${aceptadoNombre.trim()}, desde el enlace` : "Por el cliente, desde el enlace";
    case "interno":
      return aceptadoPor ? `Por ${aceptadoPor} (gerencia), desde la app` : "Por gerencia, desde la app";
    default:
      return null;
  }
}

/**
 * Hitos del presupuesto en orden. Un rechazado termina en «Rechazado» (sin facturar); el resto termina en
 * «Facturado» y, si ya tiene obra, en «Obra». El primer hito que falta es el «siguiente» salvo que el presupuesto ya no pueda avanzar (vencido).
 */
export function lineaDeTiempo(datos: DatosLineaTiempo): Hito[] {
  const { estado } = datos;
  const enviado = estado !== "borrador";
  const aceptado = estado === "aceptado" || estado === "facturado";
  const facturado = estado === "facturado";
  const vencido = estado === "enviado" && datos.vencido === true;

  const hitos: Hito[] = [
    {
      clave: "creado",
      titulo: "Creado",
      estado: "hecho",
      fecha: datos.created_at,
      detalle: estado === "borrador" ? "Borrador: aún se puede editar" : null,
    },
    {
      clave: "enviado",
      titulo: "Enviado al cliente",
      estado: enviado ? "hecho" : "siguiente",
      fecha: enviado ? datos.enviado_at : null,
      detalle: enviado
        ? datos.enviadoPor?.trim()
          ? `Por ${datos.enviadoPor.trim()}`
          : null
        : "Al enviarlo tendrás el enlace para el cliente",
    },
  ];

  if (estado === "rechazado") {
    hitos.push({ clave: "rechazado", titulo: "Rechazado", estado: "cerrado", fecha: null, detalle: "Ya no se puede aceptar" });
    return hitos;
  }

  hitos.push({
    clave: "aceptado",
    titulo: "Aceptado",
    estado: aceptado ? "hecho" : vencido ? "cerrado" : estado === "enviado" ? "siguiente" : "pendiente",
    fecha: aceptado ? datos.aceptado_at : null,
    detalle: aceptado
      ? textoCanalAceptacion(datos.aceptado_canal, datos.aceptadoPor, datos.aceptadoNombre)
      : vencido
        ? `La validez venció${datos.validoHasta ? ` el ${datos.validoHasta}` : ""}`
        : estado === "enviado" && datos.validoHasta
          ? `Puede aceptarlo hasta el ${datos.validoHasta}`
          : null,
  });

  hitos.push({
    clave: "facturado",
    titulo: "Facturado",
    estado: facturado ? "hecho" : estado === "aceptado" ? "siguiente" : "pendiente",
    fecha: facturado ? (datos.factura?.fecha ?? null) : null,
    detalle: facturado && datos.factura ? `Factura ${datos.factura.numero}` : null,
  });

  if (aceptado && datos.obra) hitos.push(hitoObra(datos.obra, facturado));

  return hitos;
}
