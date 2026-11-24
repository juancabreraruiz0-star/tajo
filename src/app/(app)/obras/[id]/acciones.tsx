"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { CheckIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import {
  asignarEncargado,
  borrarParte,
  cambiarEstadoObra,
  guardarDatosObra,
  type DatosObraFormState,
  type ObraAccionState,
} from "@/lib/actions/obras";
import { MAX_NOTAS_OBRA, type EstadoObra } from "@/lib/domain/obras";

interface AccionProps {
  action: () => Promise<ObraAccionState>;
  label: string;
  pendingText: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirmacion?: string | null;
}

/** Botón que lanza una Server Action (con confirmación opcional) y muestra su error debajo. */
function Accion({ action, label, pendingText, variant = "secondary", size, confirmacion }: AccionProps) {
  const [state, formAction] = useActionState<ObraAccionState>(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmacion && !window.confirm(confirmacion)) event.preventDefault();
      }}
      className="contents"
    >
      <SubmitButton variant={variant} size={size} pendingText={pendingText}>
        {label}
      </SubmitButton>
      {state.error && <Alert className="basis-full">{state.error}</Alert>}
    </form>
  );
}

export interface AccionEstado {
  destino: EstadoObra;
  label: string;
  confirmacion: string | null;
}

/** Botones de estado de la obra (Empezar, Parar, Reanudar, Terminar), según accionesEstadoObra. */
export function AccionesEstadoObra({ obraId, acciones }: { obraId: string; acciones: readonly AccionEstado[] }) {
  return (
    <>
      {acciones.map((accion) => (
        <Accion
          key={accion.destino}
          action={cambiarEstadoObra.bind(null, obraId, accion.destino)}
          label={accion.label}
          pendingText="Guardando…"
          // Empezar o reanudar es lo que se busca casi siempre: botón principal. Terminar, con confirmación.
          variant={accion.destino === "en_curso" ? "primary" : "secondary"}
          confirmacion={accion.confirmacion}
        />
      ))}
    </>
  );
}

export function BorrarParte({ obraId, parteId }: { obraId: string; parteId: string }) {
  return (
    <Accion
      action={borrarParte.bind(null, obraId, parteId)}
      label="Borrar"
      pendingText="Borrando…"
      variant="ghost"
      size="sm"
      confirmacion="¿Borrar este parte? Se quitan sus horas y su material de la obra; no se puede deshacer."
    />
  );
}

/**
 * Envía el formulario a la acción sin el reinicio automático de React 19 (que vaciaría lo escrito si hay un error).
 */
function enviarSinReiniciar(formAction: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}

/** Mensaje verde corto que se va solo a los pocos segundos. */
function Hecho({ texto, clave }: { texto?: string; clave: unknown }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const temporizador = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(temporizador);
  }, [clave]);
  return (
    <p role="status" className="min-h-5 text-sm">
      {texto && visible && (
        <span className="inline-flex animate-entrada items-center gap-1.5 font-medium text-green-700">
          <CheckIcon className="size-4" strokeWidth={2.5} />
          {texto}
        </span>
      )}
    </p>
  );
}

interface AsignarEncargadoProps {
  obraId: string;
  opciones: readonly SelectOption[];
  actual: string | null;
}

/** Gerencia: elige el encargado entre las personas de la empresa. */
export function AsignarEncargado({ obraId, opciones, actual }: AsignarEncargadoProps) {
  const [state, formAction, pending] = useActionState<ObraAccionState, FormData>(
    asignarEncargado.bind(null, obraId),
    {},
  );
  return (
    <form onSubmit={enviarSinReiniciar(formAction)} className="space-y-2">
      <Select
        label="Encargado"
        name="encargado_id"
        options={opciones}
        placeholder="Sin asignar"
        defaultValue={actual ?? ""}
        hint="Gerencia o el encargado gestionan la obra: estado, fechas y notas."
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-disabled={pending}>
        {pending ? "Guardando…" : "Cambiar encargado"}
      </Button>
      {state.error ? <Alert>{state.error}</Alert> : <Hecho texto={state.ok} clave={state} />}
    </form>
  );
}

interface DatosObraFormProps {
  obraId: string;
  finPrevista: string | null;
  notas: string | null;
  /** Fecha de inicio: la fin prevista no puede ser anterior. */
  fechaInicio: string | null;
  /** ¿Se puede cambiar la fecha de fin prevista? Una obra terminada solo admite cambiar las notas. */
  editaPrevista: boolean;
}

/** Gerencia o el encargado: fecha de fin prevista y notas de la obra. */
export function DatosObraForm({ obraId, finPrevista, notas, fechaInicio, editaPrevista }: DatosObraFormProps) {
  const [state, formAction, pending] = useActionState<DatosObraFormState, FormData>(
    guardarDatosObra.bind(null, obraId),
    {},
  );
  return (
    <form onSubmit={enviarSinReiniciar(formAction)} noValidate className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {editaPrevista && (
        <Input
          label="Fin prevista"
          name="fecha_fin_prevista"
          type="date"
          min={fechaInicio ?? undefined}
          defaultValue={finPrevista ?? ""}
          error={state.fieldErrors?.fecha_fin_prevista}
          hint="Déjala vacía si aún no hay fecha."
        />
      )}
      <Textarea
        label="Notas de la obra"
        name="notas"
        rows={3}
        maxLength={MAX_NOTAS_OBRA}
        defaultValue={notas ?? ""}
        error={state.fieldErrors?.notas}
        placeholder="Horario, llaves, avisos para la cuadrilla…"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : editaPrevista ? "Guardar fecha y notas" : "Guardar notas"}
        </Button>
        <Hecho texto={state.ok} clave={state} />
      </div>
    </form>
  );
}
