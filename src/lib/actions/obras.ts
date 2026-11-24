"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile, isAdmin, type SupabaseServerClient } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/domain/errors";
import {
  accionesEstadoObra,
  admitePartesNuevos,
  camposEditablesObra,
  diaMadrid,
  errorCambioEstadoObra,
  errorParteNuevo,
  isEstadoObra,
  partesEditables,
  puedeGestionarObra,
  validateObra,
  validateParte,
  type EstadoObra,
  type ObraField,
  type ParteField,
} from "@/lib/domain/obras";
import { AVISO_FIN_PREVISTA_QUITADA, parteEditablePor } from "@/lib/domain/obras-pantalla";
import { isUuid, type FieldErrors } from "@/lib/domain/validation";
import type { Obra, Parte } from "@/lib/types";

export interface ObraAccionState {
  error?: string;
  /** Confirmación corta tras guardar (p. ej. «Encargado cambiado»). */
  ok?: string;
}

export interface DatosObraFormState {
  error?: string;
  ok?: string;
  fieldErrors?: FieldErrors<ObraField>;
}

export interface ParteFormState {
  error?: string;
  fieldErrors?: FieldErrors<ParteField>;
}

type ObraBase = Pick<
  Obra,
  "id" | "estado" | "encargado_id" | "fecha_inicio" | "fecha_fin_prevista" | "fecha_fin" | "presupuesto_id" | "cliente_id"
>;

const NO_EXISTE = "La obra no existe o no es de tu empresa.";
const REVISA = "Revisa los campos marcados.";

async function leerObra(
  supabase: SupabaseServerClient,
  id: string,
): Promise<{ obra: ObraBase | null; error?: string }> {
  const { data, error } = await supabase
    .from("obras")
    .select("id, estado, encargado_id, fecha_inicio, fecha_fin_prevista, fecha_fin, presupuesto_id, cliente_id")
    .eq("id", id)
    .maybeSingle<ObraBase>();
  if (error) return { obra: null, error: dbErrorMessage(error) };
  return { obra: data };
}

/** Rutas que muestran datos de la obra: listado, detalle, panel, su presupuesto y la ficha del cliente. */
function revalidarObra(obra: ObraBase) {
  revalidatePath("/obras");
  revalidatePath(`/obras/${obra.id}`);
  revalidatePath("/");
  revalidatePath(`/presupuestos/${obra.presupuesto_id}`);
  revalidatePath(`/clientes/${obra.cliente_id}`);
}

// ----------------------------------------------------------------------------
// Estado de la obra
// ----------------------------------------------------------------------------

/**
 * Empezar, parar, reanudar o terminar una obra. Solo gerencia o su encargado (la RLS de 0006 también) y solo las
 * transiciones permitidas (el trigger obras_reglas también). Se envía solo { estado }: las fechas de inicio y fin las
 * pone la base de datos al empezar y al terminar.
 */
export async function cambiarEstadoObra(obraId: string, destino: EstadoObra): Promise<ObraAccionState> {
  if (!isUuid(obraId)) return { error: NO_EXISTE };
  if (!isEstadoObra(destino)) return { error: "Ese estado de obra no existe." };

  const { perfil, supabase } = await getSessionProfile();
  const { obra, error } = await leerObra(supabase, obraId);
  if (error) return { error };
  if (!obra) return { error: NO_EXISTE };

  const esEncargado = obra.encargado_id === perfil.id;
  if (!puedeGestionarObra(perfil.rol, esEncargado)) {
    return { error: "Solo gerencia o el encargado de la obra pueden cambiar su estado." };
  }
  if (!accionesEstadoObra(obra.estado, perfil.rol, esEncargado).includes(destino)) {
    return { error: errorCambioEstadoObra(obra.estado, destino) ?? "La obra ya está en ese estado." };
  }

  const { data, error: errorUpdate } = await supabase
    .from("obras")
    .update({ estado: destino })
    .eq("id", obraId)
    .select("id, fecha_fin_prevista")
    .maybeSingle<{ id: string; fecha_fin_prevista: string | null }>();
  if (errorUpdate) return { error: dbErrorMessage(errorUpdate) };
  if (!data) return { error: "No se ha podido cambiar el estado: solo gerencia o el encargado de la obra pueden hacerlo." };

  revalidarObra(obra);
  // Al empezar, la base de datos vacía la fin prevista si ya había pasado (quedaría antes del inicio). El botón de
  // empezar desaparece con el cambio de estado, así que el aviso va en la URL y se pinta junto a «Fin prevista».
  if (obra.fecha_fin_prevista !== null && data.fecha_fin_prevista === null) {
    redirect(`/obras/${obraId}?aviso=${AVISO_FIN_PREVISTA_QUITADA}`);
  }
  return {};
}

// ----------------------------------------------------------------------------
// Encargado (solo gerencia)
// ----------------------------------------------------------------------------

export async function asignarEncargado(
  obraId: string,
  _prev: ObraAccionState,
  formData: FormData,
): Promise<ObraAccionState> {
  if (!isUuid(obraId)) return { error: NO_EXISTE };
  const valor = formData.get("encargado_id");
  const encargadoId = typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
  if (encargadoId !== null && !isUuid(encargadoId)) return { error: "Elige una persona de la lista." };

  const { perfil, supabase } = await getSessionProfile();
  if (!isAdmin(perfil)) return { error: "Solo gerencia puede asignar el encargado de una obra." };

  const { obra, error } = await leerObra(supabase, obraId);
  if (error) return { error };
  if (!obra) return { error: NO_EXISTE };
  if (obra.estado === "terminada") return { error: "La obra está terminada: ya no se cambia el encargado." };

  if (encargadoId !== null) {
    // La RLS de perfiles solo deja ver a los de la propia empresa.
    const { data: persona, error: errorPersona } = await supabase
      .from("perfiles")
      .select("id")
      .eq("id", encargadoId)
      .maybeSingle<{ id: string }>();
    if (errorPersona) return { error: dbErrorMessage(errorPersona) };
    if (!persona) return { error: "Esa persona no es de tu empresa." };
  }

  const { data, error: errorUpdate } = await supabase
    .from("obras")
    .update({ encargado_id: encargadoId })
    .eq("id", obraId)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (errorUpdate) return { error: dbErrorMessage(errorUpdate) };
  if (!data) return { error: "No se ha podido cambiar el encargado. Recarga la página e inténtalo de nuevo." };

  revalidarObra(obra);
  return { ok: encargadoId ? "Encargado asignado." : "La obra se ha quedado sin encargado." };
}

// ----------------------------------------------------------------------------
// Fin prevista y notas (gerencia o el encargado; en una obra terminada, solo las notas)
// ----------------------------------------------------------------------------

export async function guardarDatosObra(
  obraId: string,
  _prev: DatosObraFormState,
  formData: FormData,
): Promise<DatosObraFormState> {
  if (!isUuid(obraId)) return { error: NO_EXISTE };

  const { perfil, supabase } = await getSessionProfile();
  const { obra, error } = await leerObra(supabase, obraId);
  if (error) return { error };
  if (!obra) return { error: NO_EXISTE };
  if (!puedeGestionarObra(perfil.rol, obra.encargado_id === perfil.id)) {
    return { error: "Solo gerencia o el encargado de la obra pueden cambiar sus datos." };
  }

  // Una obra terminada solo admite cambiar las notas: la fecha prevista no se toca.
  const editaPrevista = camposEditablesObra(obra.estado).includes("fecha_fin_prevista");
  const fechaPrevista = editaPrevista ? formData.get("fecha_fin_prevista") : obra.fecha_fin_prevista;

  // Fecha del parte más antiguo: la fecha de inicio no puede quedar después (validateObra).
  const { data: primero, error: errorPrimero } = await supabase
    .from("partes")
    .select("fecha")
    .eq("obra_id", obraId)
    .order("fecha")
    .limit(1)
    .maybeSingle<{ fecha: string }>();
  if (errorPrimero) return { error: dbErrorMessage(errorPrimero) };

  const validation = validateObra(
    {
      fecha_inicio: obra.fecha_inicio,
      fecha_fin_prevista: fechaPrevista,
      fecha_fin: obra.fecha_fin,
      notas: formData.get("notas"),
    },
    { estado: obra.estado, hoyMadrid: diaMadrid(new Date()), primerParte: primero?.fecha ?? null },
  );
  if (!validation.ok) {
    const { fecha_fin_prevista, notas, ...otros } = validation.errors;
    // Inicio y fin real no están en este formulario: su error (si lo hay) va arriba.
    const general = Object.values(otros)[0];
    return { error: general ?? REVISA, fieldErrors: { fecha_fin_prevista, notas } };
  }

  const cambios = editaPrevista
    ? { fecha_fin_prevista: validation.data.fecha_fin_prevista, notas: validation.data.notas }
    : { notas: validation.data.notas };
  const { data, error: errorUpdate } = await supabase
    .from("obras")
    .update(cambios)
    .eq("id", obraId)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (errorUpdate) return { error: dbErrorMessage(errorUpdate) };
  if (!data) return { error: "No se han podido guardar los cambios: solo gerencia o el encargado de la obra pueden hacerlo." };

  revalidarObra(obra);
  return { ok: "Cambios guardados." };
}

// ----------------------------------------------------------------------------
// Partes de trabajo
// ----------------------------------------------------------------------------

type PartePermiso = Pick<Parte, "id" | "autor_id" | "created_at">;

/** Materiales del formulario: dos listas paralelas (material_id y material_cantidad), en orden. */
function leerMateriales(formData: FormData): { material_id: string; cantidad: string }[] {
  const texto = (v: FormDataEntryValue) => (typeof v === "string" ? v : "");
  const ids = formData.getAll("material_id").map(texto);
  const cantidades = formData.getAll("material_cantidad").map(texto);
  return ids.map((id, i) => ({ material_id: id, cantidad: cantidades[i] ?? "" }));
}

/**
 * Alta (parteId = null) o edición de un parte con sus materiales, con guardar_parte() (0006) en una sola
 * transacción. Valida con el dominio, comprueba la obra y el permiso antes de escribir y, si va bien, vuelve a la obra.
 * Siempre se manda la lista completa de materiales: en una edición, los que faltan se quitan.
 */
export async function guardarParte(
  obraId: string,
  parteId: string | null,
  _prev: ParteFormState,
  formData: FormData,
): Promise<ParteFormState> {
  if (!isUuid(obraId)) return { error: NO_EXISTE };
  if (parteId !== null && !isUuid(parteId)) return { error: "El parte no existe." };

  const { perfil, supabase } = await getSessionProfile();
  const { obra, error } = await leerObra(supabase, obraId);
  if (error) return { error };
  if (!obra) return { error: NO_EXISTE };

  const ahora = new Date();
  // Al editar, la fecha que ya tenía el parte: si no se cambia, no cuenta el límite de 30 días (como la base).
  let fechaAnterior: string | null = null;
  if (parteId === null) {
    if (!admitePartesNuevos(obra.estado)) return { error: errorParteNuevo(obra.estado) ?? "La obra no admite partes." };
  } else {
    if (!partesEditables(obra.estado)) return { error: "La obra está terminada: sus partes ya no se pueden cambiar." };
    const { data: actual, error: errorParte } = await supabase
      .from("partes")
      .select("id, autor_id, created_at, fecha")
      .eq("id", parteId)
      .eq("obra_id", obraId)
      .maybeSingle<PartePermiso & Pick<Parte, "fecha">>();
    if (errorParte) return { error: dbErrorMessage(errorParte) };
    if (!actual) return { error: "Este parte ya no existe." };
    if (!parteEditablePor(actual, perfil, obra.estado, ahora)) {
      return { error: "Este parte solo lo puede cambiar su autor el mismo día en que lo apuntó, o gerencia." };
    }
    fechaAnterior = actual.fecha;
  }

  const validation = validateParte(
    {
      fecha: formData.get("fecha"),
      horas: formData.get("horas"),
      notas: formData.get("notas"),
      materiales: leerMateriales(formData),
    },
    diaMadrid(ahora),
    obra.fecha_inicio,
    fechaAnterior,
  );
  if (!validation.ok) return { error: REVISA, fieldErrors: validation.errors };
  const parte = validation.data;

  // Los materiales tienen que ser del almacén de la empresa (la RLS solo deja ver los propios).
  const materialIds = parte.materiales.map((m) => m.material_id);
  if (materialIds.length > 0) {
    const { data: existentes, error: errorMateriales } = await supabase
      .from("materiales")
      .select("id")
      .in("id", materialIds)
      .overrideTypes<{ id: string }[], { merge: false }>();
    if (errorMateriales) return { error: dbErrorMessage(errorMateriales) };
    const ids = new Set((existentes ?? []).map((m) => m.id));
    const falta = materialIds.findIndex((id) => !ids.has(id));
    if (falta !== -1) {
      return {
        error: REVISA,
        fieldErrors: { materiales: `Material ${falta + 1}: ya no está en el almacén. Quítalo y elige otro.` },
      };
    }
  }

  const { data, error: errorGuardar } = await supabase.rpc("guardar_parte", {
    p_id: parteId,
    p_obra: obraId,
    p_fecha: parte.fecha,
    p_horas: parte.horas,
    p_notas: parte.notas,
    p_materiales: parte.materiales,
  });
  if (errorGuardar) return { error: dbErrorMessage(errorGuardar) };
  if (typeof data !== "string" || !isUuid(data)) {
    return { error: "El parte se ha guardado, pero no se ha podido comprobar. Recarga la obra." };
  }

  revalidarObra(obra);
  redirect(`/obras/${obraId}#partes`);
}

/** Borra un parte (y sus materiales, en cascada). Su autor el mismo día o gerencia; nunca en una obra terminada. */
export async function borrarParte(obraId: string, parteId: string): Promise<ObraAccionState> {
  if (!isUuid(obraId)) return { error: NO_EXISTE };
  if (!isUuid(parteId)) return { error: "El parte no existe." };

  const { perfil, supabase } = await getSessionProfile();
  const { obra, error } = await leerObra(supabase, obraId);
  if (error) return { error };
  if (!obra) return { error: NO_EXISTE };

  const { data: actual, error: errorParte } = await supabase
    .from("partes")
    .select("id, autor_id, created_at")
    .eq("id", parteId)
    .eq("obra_id", obraId)
    .maybeSingle<PartePermiso>();
  if (errorParte) return { error: dbErrorMessage(errorParte) };
  if (!actual) return { error: "Este parte ya no existe." };
  if (!parteEditablePor(actual, perfil, obra.estado, new Date())) {
    return {
      error: partesEditables(obra.estado)
        ? "Este parte solo lo puede borrar su autor el mismo día en que lo apuntó, o gerencia."
        : "La obra está terminada: sus partes ya no se pueden borrar.",
    };
  }

  const { data, error: errorBorrar } = await supabase
    .from("partes")
    .delete()
    .eq("id", parteId)
    .eq("obra_id", obraId)
    .select("id");
  if (errorBorrar) return { error: dbErrorMessage(errorBorrar) };
  // Si la RLS no deja, el delete no da error: simplemente no borra ninguna fila.
  if (!data || data.length === 0) {
    return { error: "No se ha podido borrar el parte: solo su autor el mismo día o gerencia pueden hacerlo." };
  }

  revalidarObra(obra);
  return {};
}
