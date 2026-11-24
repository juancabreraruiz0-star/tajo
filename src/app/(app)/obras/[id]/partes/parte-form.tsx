"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { controlClasses, controlState } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { guardarParte, type ParteFormState } from "@/lib/actions/obras";
import { MAX_MATERIALES_PARTE, MAX_NOTAS_PARTE } from "@/lib/domain/obras";
import { buscarMateriales } from "@/lib/domain/obras-pantalla";

export interface MaterialAlmacen {
  id: string;
  nombre: string;
  unidad: string;
}

export interface ParteInicial {
  fecha: string;
  horas: string;
  notas: string;
  materiales: { material_id: string; cantidad: string }[];
}

interface ParteFormProps {
  obraId: string;
  /** null = alta. */
  parteId: string | null;
  almacen: readonly MaterialAlmacen[];
  initial: ParteInicial;
  /** Hoy en Madrid (AAAA-MM-DD): la fecha no puede ser posterior. */
  hoy: string;
  /** Primer día admitido (fechaMinimaParte): hace 30 días o el inicio de la obra, lo que sea más tarde. */
  fechaMinima: string;
  /** Materiales del parte que ya no están en el almacén: se conservan tal cual (no se pueden tocar). */
  conservados: readonly string[];
  cancelHref: string;
}

type Fila = { key: number; material_id: string; cantidad: string };

/** Horas habituales de una jornada: un toque y listo. */
const HORAS_RAPIDAS = ["4", "6", "8"] as const;

/**
 * Parte de trabajo pensado para el móvil: fecha (hoy por defecto), horas con teclado numérico, notas y materiales del
 * almacén buscados por nombre. Los errores del servidor se pintan junto a cada campo.
 */
export function ParteForm({ obraId, parteId, almacen, initial, hoy, fechaMinima, conservados, cancelHref }: ParteFormProps) {
  const [state, formAction, pending] = useActionState<ParteFormState, FormData>(
    guardarParte.bind(null, obraId, parteId),
    {},
  );
  const [horas, setHoras] = useState(initial.horas);
  const [filas, setFilas] = useState<Fila[]>(() => initial.materiales.map((m, key) => ({ key, ...m })));
  const siguienteKey = useRef(filas.length);
  const [busqueda, setBusqueda] = useState("");
  const [foco, setFoco] = useState<{ id: string } | null>(null);
  const buscadorId = useId();

  useEffect(() => {
    if (foco) document.getElementById(foco.id)?.focus();
  }, [foco]);

  const porId = new Map(almacen.map((m) => [m.id, m]));
  const enParte = new Set(filas.map((f) => f.material_id));
  const lleno = filas.length + conservados.length >= MAX_MATERIALES_PARTE;
  const resultados = busqueda.trim() === "" ? [] : buscarMateriales(almacen, busqueda, enParte);
  const errores = state.fieldErrors;

  function anadir(materialId: string) {
    const key = siguienteKey.current++;
    setFilas((actuales) => [...actuales, { key, material_id: materialId, cantidad: "" }]);
    setBusqueda("");
    setFoco({ id: `material-${key}-cantidad` });
  }

  function quitar(key: number) {
    setFilas((actuales) => actuales.filter((f) => f.key !== key));
    setFoco({ id: buscadorId });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}

      <Card className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Fecha del trabajo"
            name="fecha"
            type="date"
            required
            defaultValue={initial.fecha}
            max={hoy}
            min={fechaMinima}
            error={errores?.fecha}
          />
          <div className="space-y-2">
            <Input
              label="Horas"
              name="horas"
              required
              inputMode="decimal"
              autoComplete="off"
              placeholder="8"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              error={errores?.horas}
              hint="Las de toda la cuadrilla. Admite decimales: 7,5."
            />
            <div className="flex gap-2" role="group" aria-label="Horas habituales">
              {HORAS_RAPIDAS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHoras(h)}
                  aria-pressed={horas.trim() === h}
                  className={cn(
                    "h-9 min-w-12 rounded-full px-3 text-sm font-medium tabular-nums ring-1 ring-inset transition-colors",
                    horas.trim() === h
                      ? "bg-amber-50 text-amber-900 ring-amber-400"
                      : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50",
                  )}
                >
                  {h} h
                </button>
              ))}
            </div>
          </div>
        </div>

        <Textarea
          label="Notas"
          name="notas"
          rows={3}
          maxLength={MAX_NOTAS_PARTE}
          defaultValue={initial.notas}
          error={errores?.notas}
          placeholder="Qué se ha hecho hoy, incidencias, lo que falta…"
        />
      </Card>

      <section aria-labelledby="materiales-titulo" className="space-y-3">
        <div>
          <h2 id="materiales-titulo" className="text-lg font-semibold text-stone-900">
            Material gastado
          </h2>
          <p className="text-sm text-stone-500">Opcional. Busca en el almacén por nombre y escribe la cantidad.</p>
        </div>

        {errores?.materiales && (
          <p id="materiales-error" role="alert" className="text-sm font-medium text-red-700">
            {errores.materiales}
          </p>
        )}

        {conservados.length > 0 && (
          <Alert tone="info">
            Se conservan tal cual, porque ya no están en el almacén: {conservados.join(", ")}.
          </Alert>
        )}

        {filas.length > 0 && (
          <ol className="space-y-2.5">
            {filas.map((fila, i) => {
              const material = porId.get(fila.material_id);
              const id = `material-${fila.key}-cantidad`;
              return (
                <li key={fila.key}>
                  <Card className="flex flex-wrap items-end gap-3 p-3 sm:flex-nowrap sm:p-4">
                    <input type="hidden" name="material_id" value={fila.material_id} />
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <label htmlFor={id} className="block text-sm font-medium break-words text-stone-900">
                        {material?.nombre ?? "Material no disponible"}
                        <span className="sr-only">: cantidad</span>
                      </label>
                      <p className="text-xs text-stone-500">Material {i + 1}</p>
                    </div>
                    <div className="flex flex-1 items-center gap-2 sm:flex-none">
                      <input
                        id={id}
                        name="material_cantidad"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        value={fila.cantidad}
                        onChange={(e) =>
                          setFilas((actuales) =>
                            actuales.map((f) => (f.key === fila.key ? { ...f, cantidad: e.target.value } : f)),
                          )
                        }
                        aria-describedby={errores?.materiales ? "materiales-error" : undefined}
                        className={cn(controlClasses, controlState(), "h-11 w-full text-right tabular-nums sm:w-28")}
                      />
                      <span className="w-10 shrink-0 text-sm text-stone-600">{material?.unidad}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => quitar(fila.key)}
                      aria-label={`Quitar ${material?.nombre ?? `el material ${i + 1}`}`}
                    >
                      Quitar
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}

        {almacen.length === 0 ? (
          <p className="text-sm text-stone-500">El almacén está vacío: no hay materiales que apuntar.</p>
        ) : lleno ? (
          <p className="text-sm text-stone-500">Un parte puede tener como mucho {MAX_MATERIALES_PARTE} materiales.</p>
        ) : (
          <div className="space-y-2">
            <label htmlFor={buscadorId} className="block text-sm font-medium text-stone-800">
              Añadir material del almacén
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-stone-400" />
              <input
                id={buscadorId}
                type="search"
                autoComplete="off"
                placeholder="Azulejo, cemento cola, tubería…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  // Intro elige el primero de la lista en vez de enviar el formulario.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (resultados[0]) anadir(resultados[0].id);
                  }
                }}
                aria-describedby={`${buscadorId}-resultados`}
                className={cn(controlClasses, controlState(), "h-11 pl-10")}
              />
            </div>
            <div id={`${buscadorId}-resultados`} aria-live="polite">
              {busqueda.trim() !== "" &&
                (resultados.length === 0 ? (
                  <p className="text-sm text-stone-500">Ningún material del almacén se llama así.</p>
                ) : (
                  <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-tarjeta">
                    {resultados.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => anadir(m.id)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-amber-50/60 focus-visible:bg-amber-50"
                        >
                          <span className="min-w-0 break-words text-stone-900">
                            {m.nombre} <span className="text-stone-500">({m.unidad})</span>
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-800">
                            <PlusIcon className="size-4" />
                            Añadir
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
        <LinkButton href={cancelHref}>Cancelar</LinkButton>
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : parteId ? "Guardar cambios" : "Guardar parte"}
        </Button>
      </div>
    </form>
  );
}
