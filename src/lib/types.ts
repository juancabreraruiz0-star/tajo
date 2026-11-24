// Tipos de las tablas de Supabase según DECISIONES D1. Escritos a mano, sin generador.
// Dinero siempre en céntimos (bigint en la base desde 0004; en JS, number entero). Fechas y timestamps llegan como texto
// ISO.

import type { EstadoObra, Semaforo } from "@/lib/domain/obras";
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
  /**
   * Lo que le cuesta a la empresa, sin IVA (0006): lo copian los partes de obra. null = se usa precio_cents. Solo lo
   * pone o cambia gerencia (trigger materiales_coste_solo_gerencia).
   */
  coste_cents: number | null;
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
  // Evidencia (0007, D12). La pone la base de datos; no se envía nunca desde la app.
  /** Nombre que escribió el cliente al aceptar por el enlace; null en los demás casos (y en los aceptados antes de 0007). */
  aceptado_nombre: string | null;
  /** Perfil que lo pasó a enviado; null si sigue en borrador, se envió antes de 0007 o se borró el usuario. */
  enviado_por: Uuid | null;
  /**
   * Copia del nombre de quien lo envió, tomada al enviarlo (0008, D13): no cambia aunque luego cambie su perfil o se
   * borre el usuario. null si sigue en borrador o no se sabe quién lo envió.
   */
  enviado_por_nombre: string | null;
}

/**
 * IP y navegador de la aceptación por enlace (tabla presupuesto_aceptaciones, 0008, D13). Solo los lee gerencia; los
 * escribe aceptar_presupuesto(). Los manda el servidor de la app: son una constancia razonable, no una prueba.
 */
export interface PresupuestoAceptacion {
  presupuesto_id: Uuid;
  empresa_id: Uuid;
  /** Como mucho 64 caracteres. */
  ip: string | null;
  /** Como mucho 400 caracteres. */
  user_agent: string | null;
  created_at: Timestamp;
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

// ----------------------------------------------------------------------------
// Obras (0006, D11)
// ----------------------------------------------------------------------------

export interface Obra {
  id: Uuid;
  empresa_id: Uuid;
  /** Único: una obra por presupuesto. */
  presupuesto_id: Uuid;
  /** Copia del cliente y el título del presupuesto al crearse la obra; no se cambian. */
  cliente_id: Uuid;
  titulo: string;
  /** Perfil de la empresa; null = sin encargado (o se borró su usuario). */
  encargado_id: Uuid | null;
  estado: EstadoObra;
  fecha_inicio: Fecha | null;
  fecha_fin_prevista: Fecha | null;
  /** Solo (y siempre) en obras terminadas. */
  fecha_fin: Fecha | null;
  notas: string | null;
  created_at: Timestamp;
}

/**
 * Fila de la vista obras_resumen (0006, 0007): la obra con presupuestado frente a coste real. Los importes (*_cents) y
 * el % consumido solo los ve gerencia: para el resto de usuarios llegan a null. El semáforo lo ven todos.
 */
export interface ObraResumen extends Obra {
  cliente_nombre: string;
  presupuesto_numero: string;
  /** Base del presupuesto (sin IVA). null si no es gerencia. */
  presupuestado_cents: number | null;
  /** numeric: puede llegar como texto. */
  horas: number;
  coste_mano_obra_cents: number | null;
  coste_material_cents: number | null;
  coste_real_cents: number | null;
  /** Negativo = en pérdidas. null si no es gerencia. */
  margen_cents: number | null;
  /**
   * % del presupuestado consumido, 1 decimal; null si el presupuestado es 0 o si no es gerencia (0007). numeric: puede
   * llegar como texto.
   */
  consumido_pct: number | null;
  num_partes: number;
  ultimo_parte: Fecha | null;
  /** Semáforo calculado en SQL con el % real, misma regla que semaforoObra(); lo ven todos (0007). */
  semaforo: Semaforo;
}

export interface Parte {
  id: Uuid;
  empresa_id: Uuid;
  obra_id: Uuid;
  /** Día del trabajo (no posterior a hoy). */
  fecha: Fecha;
  /** Lo pone la base de datos (auth.uid()); null si se borró el usuario. */
  autor_id: Uuid | null;
  /** numeric: más de 0, como mucho 24 y con 2 decimales como mucho (no se redondea: se rechaza). */
  horas: number;
  /** Copia del coste por hora de la empresa al crear el parte. */
  coste_hora_cents: number;
  notas: string | null;
  /** Cuándo se registró: su autor lo puede cambiar ese mismo día (hora de Madrid). */
  created_at: Timestamp;
}

export interface ParteMaterial {
  id: Uuid;
  empresa_id: Uuid;
  parte_id: Uuid;
  /** null si el material se borró del almacén; la línea conserva su copia. */
  material_id: Uuid | null;
  /** Copias del material al añadirlo al parte. */
  material_nombre: string;
  unidad: string;
  /** numeric(13,3): puede llegar como texto. */
  cantidad: number;
  coste_unit_cents: number;
}
