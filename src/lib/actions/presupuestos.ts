"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile, isAdmin, type SupabaseServerClient } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import {
  validatePresupuesto,
  type PartidaField,
  type PartidaRaw,
  type PresupuestoField,
  type PresupuestoInput,
  type PresupuestoRaw,
} from "@/lib/domain/presupuestos";
import { canTransition, type EstadoPresupuesto } from "@/lib/domain/status";
import { isUuid, type FieldErrors } from "@/lib/domain/validation";

export interface PresupuestoFormState {
  error?: string;
  fieldErrors?: FieldErrors<PresupuestoField>;
  /** Mismo índice que las partidas del formulario. */
  partidaErrors?: (FieldErrors<PartidaField> | undefined)[];
}

export interface AccionState {
  error?: string;
}

const REVISA = "Revisa los campos marcados.";

/** Lee la cabecera y las partidas del formulario (las partidas van como listas paralelas, en orden). */
function readPresupuestoForm(formData: FormData): PresupuestoRaw {
  const one = (campo: string) => {
    const valor = formData.get(campo);
    return typeof valor === "string" ? valor : "";
  };
  const all = (campo: string) => formData.getAll(campo).map((v) => (typeof v === "string" ? v : ""));

  const descripciones = all("partida_descripcion");
  const cantidades = all("partida_cantidad");
  const precios = all("partida_precio");
  const materiales = all("partida_material");
  const total = Math.max(descripciones.length, cantidades.length, precios.length, materiales.length);
  const partidas: PartidaRaw[] = Array.from({ length: total }, (_, i) => ({
    descripcion: descripciones[i] ?? "",
    cantidad: cantidades[i] ?? "",
    precio: precios[i] ?? "",
    material_id: materiales[i] ?? "",
  }));

  return {
    cliente_id: one("cliente_id"),
    titulo: one("titulo"),
    iva_pct: one("iva_pct"),
    validez_dias: one("validez_dias"),
    partidas,
  };
}

/** Comprueba que el cliente y los materiales existen y son de la empresa (la RLS solo deja ver los propios). */
async function checkReferencias(
  supabase: SupabaseServerClient,
  data: PresupuestoInput,
): Promise<PresupuestoFormState | null> {
  const materialIds = [...new Set(data.partidas.flatMap((p) => (p.material_id ? [p.material_id] : [])))];
  const [clienteRes, materialesRes] = await Promise.all([
    supabase.from("clientes").select("id").eq("id", data.cliente_id).maybeSingle<{ id: string }>(),
    materialIds.length > 0
      ? supabase.from("materiales").select("id").in("id", materialIds).overrideTypes<{ id: string }[], { merge: false }>()
      : null,
  ]);

  if (clienteRes.error) return { error: dbErrorMessage(clienteRes.error) };
  if (!clienteRes.data) {
    return { error: REVISA, fieldErrors: { cliente_id: "El cliente no existe o no es de tu empresa." } };
  }
  if (materialesRes?.error) return { error: dbErrorMessage(materialesRes.error) };

  const existentes = new Set((materialesRes?.data ?? []).map((m) => m.id));
  const partidaErrors = data.partidas.map((p) =>
    p.material_id && !existentes.has(p.material_id)
      ? { material_id: "Este material ya no está en el almacén. Elige otro o quita el vínculo." }
      : undefined,
  );
  return partidaErrors.some(Boolean) ? { error: REVISA, partidaErrors } : null;
}

/**
 * Alta (id = null) o edición de un presupuesto en borrador con sus partidas. Si va bien, redirige al detalle.
 * Se guarda en una sola transacción con guardar_presupuesto() (0003): nunca envía numero, estado, token ni fechas (D7).
 */
export async function savePresupuesto(
  id: string | null,
  _prev: PresupuestoFormState,
  formData: FormData,
): Promise<PresupuestoFormState> {
  if (id !== null && !isUuid(id)) return { error: "El presupuesto no existe." };

  const validation = validatePresupuesto(readPresupuestoForm(formData));
  if (!validation.ok) {
    return { error: REVISA, fieldErrors: validation.errors.campos, partidaErrors: validation.errors.partidas };
  }

  const { supabase } = await getSessionProfile();

  // En la edición: comprobación amable del estado y cliente anterior (para revalidar su ficha si cambia).
  let clienteAnterior: string | null = null;
  if (id !== null) {
    const { data: actual, error } = await supabase
      .from("presupuestos")
      .select("estado, cliente_id")
      .eq("id", id)
      .maybeSingle<{ estado: EstadoPresupuesto; cliente_id: string }>();
    if (error) return { error: dbErrorMessage(error) };
    if (!actual) return { error: "El presupuesto no existe o no tienes acceso a él." };
    if (actual.estado !== "borrador") {
      return { error: "Solo se puede editar un presupuesto en borrador. Este ya se ha enviado." };
    }
    clienteAnterior = actual.cliente_id;
  }

  const referencias = await checkReferencias(supabase, validation.data);
  if (referencias) return referencias;

  const { partidas, cliente_id, titulo, iva_pct, validez_dias } = validation.data;
  const { data, error } = await supabase.rpc("guardar_presupuesto", {
    p_id: id,
    p_cliente: cliente_id,
    p_titulo: titulo,
    p_iva: iva_pct,
    p_validez: validez_dias,
    p_partidas: partidas,
  });
  // 23503 aquí = el cliente o un material se ha borrado entre la comprobación de arriba y el guardado.
  if (error) return { error: dbErrorMessage(error, "guardar_presupuesto") };
  const presupuestoId: unknown = data;
  if (typeof presupuestoId !== "string" || !isUuid(presupuestoId)) {
    return { error: "El presupuesto se ha guardado, pero no se ha podido abrir. Búscalo en Presupuestos." };
  }

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${presupuestoId}`);
  revalidatePath(`/clientes/${cliente_id}`);
  if (clienteAnterior && clienteAnterior !== cliente_id) revalidatePath(`/clientes/${clienteAnterior}`);
  redirect(`/presupuestos/${presupuestoId}`);
}

const DESTINOS = ["enviado", "aceptado", "rechazado"] as const;
type Destino = (typeof DESTINOS)[number];

/**
 * Cambia el estado de un presupuesto desde la zona privada (enviar, marcar aceptado o rechazado).
 * Solo se envía { estado }: las fechas las pone la base de datos y los triggers validan la transición (D7).
 */
export async function cambiarEstado(id: string, destino: Destino): Promise<AccionState> {
  if (!isUuid(id)) return { error: "El presupuesto no existe." };
  if (!DESTINOS.includes(destino)) return { error: "Ese cambio de estado no existe." };

  const { supabase } = await getSessionProfile();
  const { data: actual, error } = await supabase
    .from("presupuestos")
    .select("estado, cliente_id")
    .eq("id", id)
    .maybeSingle<{ estado: EstadoPresupuesto; cliente_id: string }>();
  if (error) return { error: dbErrorMessage(error) };
  if (!actual) return { error: "El presupuesto no existe o no tienes acceso a él." };
  if (!canTransition(actual.estado, destino)) {
    return { error: `No se puede pasar un presupuesto de «${actual.estado}» a «${destino}».` };
  }
  if (destino === "enviado") {
    // La base de datos también lo impide (0003); aquí se da el mensaje antes de intentarlo.
    const { count, error: errorPartidas } = await supabase
      .from("presupuesto_lineas")
      .select("id", { count: "exact", head: true })
      .eq("presupuesto_id", id);
    if (errorPartidas || !count) return { error: "Añade al menos una partida antes de enviarlo." };
  }

  const { data, error: errorUpdate } = await supabase
    .from("presupuestos")
    .update({ estado: destino })
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (errorUpdate) return { error: dbErrorMessage(errorUpdate) };
  if (!data) return { error: "No se ha podido cambiar el estado. Recarga la página e inténtalo de nuevo." };

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${id}`);
  revalidatePath(`/clientes/${actual.cliente_id}`);
  revalidatePath("/");
  return {};
}

/** Convierte un presupuesto aceptado en factura (solo gerencia; la función SQL lo comprueba también). */
export async function facturarPresupuesto(id: string): Promise<AccionState> {
  if (!isUuid(id)) return { error: "El presupuesto no existe." };

  const { perfil, supabase } = await getSessionProfile();
  if (!isAdmin(perfil)) return { error: "Solo gerencia puede convertir presupuestos en factura." };

  const { data, error } = await supabase.rpc("facturar_presupuesto", { p_presupuesto: id });
  if (error) return { error: dbErrorMessage(error) };
  const facturaId: unknown = data;
  if (typeof facturaId !== "string" || !isUuid(facturaId)) {
    return { error: "La factura se ha creado, pero no se ha podido abrir. Búscala en Facturas." };
  }

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${id}`);
  revalidatePath("/facturas");
  revalidatePath("/materiales");
  revalidatePath("/");
  redirect(`/facturas/${facturaId}`);
}
