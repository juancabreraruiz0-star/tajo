// Tipos de las tablas de Supabase según DECISIONES D1. Escritos a mano, sin generador.
// Dinero siempre en céntimos (bigint en la base desde 0004; en JS, number entero). Fechas y timestamps llegan como texto
// ISO.

import type { EstadoPresupuesto, Rol } from "@/lib/domain/status";

export type Uuid = string;
/** Timestamp ISO 8601 (timestamptz). */
export type Timestamp = string;
/** Fecha AAAA-MM-DD (date). */
export type Fecha = string;

export interface Empresa {
  id: Uuid;
  nombre: string;
  cif: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface Perfil {
  /** = auth.users.id */
  id: Uuid;
  empresa_id: Uuid;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface Cliente {
  id: Uuid;
  empresa_id: Uuid;
  nombre: string;
  /** NIF, NIE o CIF normalizado (mayúsculas, sin espacios, puntos ni guiones); null si no se ha indicado. */
  nif: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  notas: string | null;
  created_at: Timestamp;
}

export interface Material {
  id: Uuid;
  empresa_id: Uuid;
  nombre: string;
  unidad: string;
  precio_cents: number;
  /** numeric: admite decimales. */
  stock: number;
  /** numeric: admite decimales. */
  stock_minimo: number;
}

export interface Presupuesto {
  id: Uuid;
  empresa_id: Uuid;
  cliente_id: Uuid;
  numero: string;
  titulo: string;
  estado: EstadoPresupuesto;
  iva_pct: number;
  validez_dias: number;
  token: Uuid;
  created_at: Timestamp;
  enviado_at: Timestamp | null;
  aceptado_at: Timestamp | null;
  /** Perfil de gerencia que lo dio por aceptado (canal interno); null si lo aceptó el cliente o se borró el perfil. */
  aceptado_por: Uuid | null;
  /** Por dónde se aceptó; null mientras no está aceptado ni facturado. */
  aceptado_canal: CanalAceptacion | null;
}

export type CanalAceptacion = "enlace" | "interno";

/** Fila de la vista presupuestos_con_totales (0004): el presupuesto con el nombre del cliente y sus totales en SQL. */
export interface PresupuestoConTotales extends Presupuesto {
  cliente_nombre: string;
  base_cents: number;
  iva_cents: number;
  total_cents: number;
  num_partidas: number;
}

export interface PresupuestoLinea {
  id: Uuid;
  empresa_id: Uuid;
  presupuesto_id: Uuid;
  orden: number;
  descripcion: string;
  /** numeric: admite decimales (p. ej. 2,5 m²). */
  cantidad: number;
  precio_cents: number;
  material_id: Uuid | null;
}

export interface Factura {
  id: Uuid;
  empresa_id: Uuid;
  presupuesto_id: Uuid;
  cliente_id: Uuid;
  numero: string;
  fecha: Fecha;
  base_cents: number;
  iva_cents: number;
  total_cents: number;
  // Copia fija de los datos del momento de facturar (0004): la factura se pinta solo con esto.
  cliente_nombre: string;
  cliente_nif: string | null;
  cliente_direccion: string | null;
  empresa_nombre: string;
  empresa_cif: string | null;
  empresa_direccion: string | null;
  iva_pct: number;
}

/** Partida de una factura: copia de la del presupuesto al facturar (0004). */
export interface FacturaLinea {
  id: Uuid;
  empresa_id: Uuid;
  factura_id: Uuid;
  orden: number;
  descripcion: string;
  /** Unidad del material vinculado en el momento de facturar, si lo había. */
  unidad: string | null;
  /** numeric: puede llegar como texto. */
  cantidad: number;
  precio_cents: number;
  importe_cents: number;
}
