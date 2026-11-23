// Tipos de las tablas de Supabase según DECISIONES D1. Escritos a mano, sin generador.
// Dinero siempre en céntimos (int). Fechas y timestamps llegan como texto ISO.

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
}
