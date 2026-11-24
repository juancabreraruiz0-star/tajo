"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { controlClasses, controlState } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { savePresupuesto, type PresupuestoFormState } from "@/lib/actions/presupuestos";
import { combinarPropuesta } from "@/lib/domain/cache-ia";
import { centsToEurosInput, formatEuros } from "@/lib/domain/money";
import {
  draftLineCents,
  draftTotals,
  IVA_OPCIONES,
  LIMITES_PRESUPUESTO,
  type PartidaField,
  type PartidaRaw,
  type PresupuestoRaw,
} from "@/lib/domain/presupuestos";
import { MontarConIa } from "./montar-con-ia";

export interface ClienteOpcion {
  id: string;
  nombre: string;
}

export interface MaterialOpcion {
  id: string;
  nombre: string;
  unidad: string;
  precio_cents: number;
}

export type PresupuestoInicial = Omit<PresupuestoRaw, "partidas"> & { partidas: PartidaRaw[] };

interface PresupuestoFormProps {
  /** null = alta. */
  id: string | null;
  clientes: readonly ClienteOpcion[];
  materiales: readonly MaterialOpcion[];
  initial: PresupuestoInicial;
  cancelHref: string;
  /** ¿Se ofrece «Montar con IA»? Solo si el servidor tiene la clave configurada (D10). */
  ia: boolean;
}

type Fila = PartidaRaw & { key: number };
type Cabecera = Omit<PresupuestoRaw, "partidas">;

const IVA_TEXTO: Record<(typeof IVA_OPCIONES)[number], string> = {
  21: "21 % · general",
  10: "10 % · reforma de vivienda",
};

const ANADIR_ID = "anadir-partida";

const PARTIDA_VACIA: PartidaRaw = { descripcion: "", cantidad: "1", precio: "", material_id: "" };

/** Partida sin nada escrito (la cantidad trae 1 por defecto, así que no cuenta). */
function esFilaVacia(p: PartidaRaw): boolean {
  return p.descripcion.trim() === "" && p.precio.trim() === "" && p.material_id === "";
}

/** Tiempo que se resaltan las partidas que acaba de proponer la IA. */
const RESALTADO_MS = 4000;

export function PresupuestoForm({ id, clientes, materiales, initial, cancelHref, ia }: PresupuestoFormProps) {
  const [state, formAction, pending] = useActionState<PresupuestoFormState, FormData>(
    savePresupuesto.bind(null, id),
    {},
  );

  const { partidas: partidasIniciales, ...cabeceraInicial } = initial;
  const [cabecera, setCabecera] = useState<Cabecera>(cabeceraInicial);
  const [filas, setFilas] = useState<Fila[]>(() =>
    (partidasIniciales.length > 0 ? partidasIniciales : [PARTIDA_VACIA]).map((p, key) => ({ ...p, key })),
  );
  const siguienteKey = useRef(filas.length);
  // Elemento que recibe el foco tras añadir o quitar una partida (objeto nuevo cada vez para repetir el mismo id).
  const [foco, setFoco] = useState<{ id: string } | null>(null);
  // Orden de las filas al enviar: los errores del servidor vienen por posición.
  const [keysEnviadas, setKeysEnviadas] = useState<number[]>([]);
  // Partidas recién propuestas por la IA: se resaltan un momento.
  const [resaltadas, setResaltadas] = useState<ReadonlySet<number>>(new Set());
  // La IA tarda hasta un minuto y mientras tanto se puede seguir editando: al llegar, se parte de las filas de ese momento.
  const filasActuales = useRef(filas);

  useEffect(() => {
    filasActuales.current = filas;
  }, [filas]);

  useEffect(() => {
    if (foco) document.getElementById(foco.id)?.focus();
  }, [foco]);

  useEffect(() => {
    if (resaltadas.size === 0) return;
    const temporizador = window.setTimeout(() => setResaltadas(new Set()), RESALTADO_MS);
    return () => window.clearTimeout(temporizador);
  }, [resaltadas]);

  const materialPorId = new Map(materiales.map((m) => [m.id, m]));
  const totales = draftTotals(filas, cabecera.iva_pct);
  const campoError = state.fieldErrors;

  function setCampo(campo: keyof Cabecera, valor: string) {
    setCabecera((actual) => ({ ...actual, [campo]: valor }));
  }

  function updateFila(key: number, cambios: Partial<PartidaRaw>) {
    setFilas((actuales) => actuales.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  }

  /** Vincula un material: pone su precio y su nombre, pero no pisa una descripción escrita a mano. */
  function elegirMaterial(key: number, materialId: string) {
    const material = materialPorId.get(materialId);
    setFilas((actuales) =>
      actuales.map((f) => {
        if (f.key !== key) return f;
        if (!material) return { ...f, material_id: "" };
        const anterior = f.material_id ? materialPorId.get(f.material_id) : undefined;
        const descripcion = f.descripcion.trim();
        const rellenar = descripcion === "" || (anterior !== undefined && descripcion === anterior.nombre.trim());
        return {
          ...f,
          material_id: material.id,
          descripcion: rellenar ? material.nombre : f.descripcion,
          precio: centsToEurosInput(material.precio_cents),
        };
      }),
    );
  }

  function addFila() {
    const key = siguienteKey.current++;
    setFilas((actuales) => [...actuales, { ...PARTIDA_VACIA, key }]);
    setFoco({ id: `partida-${key}-descripcion` });
  }

  /** Quita una partida y lleva el foco a la descripción de la anterior (o a «Añadir partida» si era la primera). */
  function removeFila(key: number) {
    if (filas.length <= 1) return;
    const indice = filas.findIndex((f) => f.key === key);
    const anterior = indice > 0 ? filas[indice - 1] : undefined;
    setFilas((actuales) => actuales.filter((f) => f.key !== key));
    setFoco({ id: anterior ? `partida-${anterior.key}-descripcion` : ANADIR_ID });
  }

  /**
   * Partidas de «Montar con IA» (D14): por defecto sustituyen a las que hay; con `anadir`, van detrás (quitando las
   * filas vacías). Solo hasta el máximo de partidas del presupuesto. Devuelve cuántas se han metido.
   */
  function ponerPropuesta(partidas: PartidaRaw[], anadir: boolean): number {
    const propuesta = partidas.map((p) => ({ ...p, key: siguienteKey.current++ }));
    const { filas: nuevasFilas, nuevas } = combinarPropuesta(filasActuales.current, propuesta, {
      anadir,
      esVacia: esFilaVacia,
      max: LIMITES_PRESUPUESTO.partidas,
    });
    if (nuevas.length === 0) return 0;
    setFilas(nuevasFilas);
    setResaltadas(new Set(nuevas.map((f) => f.key)));
    return nuevas.length;
  }

  function errorFila(key: number, campo: PartidaField): string | undefined {
    const indice = keysEnviadas.indexOf(key);
    return indice === -1 ? undefined : state.partidaErrors?.[indice]?.[campo];
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setKeysEnviadas(filas.map((f) => f.key));
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}

      <Card className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Cliente"
            name="cliente_id"
            required
            placeholder="Elige un cliente…"
            options={clientes.map((c) => ({ value: c.id, label: c.nombre }))}
            value={cabecera.cliente_id}
            onChange={(e) => setCampo("cliente_id", e.target.value)}
            error={campoError?.cliente_id}
          />
          <Input
            label="Título"
            name="titulo"
            required
            autoComplete="off"
            maxLength={LIMITES_PRESUPUESTO.titulo}
            placeholder="Reforma de baño"
            value={cabecera.titulo}
            onChange={(e) => setCampo("titulo", e.target.value)}
            error={campoError?.titulo}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset
            aria-describedby={campoError?.iva_pct ? "iva_pct-error" : "iva_pct-hint"}
            className="space-y-1.5"
          >
            <legend className="mb-1.5 block text-sm font-medium text-stone-800">IVA</legend>
            <div className="flex flex-wrap gap-2">
              {IVA_OPCIONES.map((iva) => {
                const elegido = cabecera.iva_pct === String(iva);
                return (
                  <label
                    key={iva}
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-500/40",
                      elegido ? "border-amber-500 bg-amber-50 text-stone-900" : "border-stone-300 bg-white text-stone-700",
                    )}
                  >
                    <input
                      type="radio"
                      name="iva_pct"
                      value={iva}
                      checked={elegido}
                      onChange={() => setCampo("iva_pct", String(iva))}
                      className="size-4 accent-amber-600"
                    />
                    {IVA_TEXTO[iva]}
                  </label>
                );
              })}
            </div>
            {campoError?.iva_pct ? (
              <p id="iva_pct-error" className="text-sm text-red-600">
                {campoError.iva_pct}
              </p>
            ) : (
              <p id="iva_pct-hint" className="text-xs text-stone-500">
                10 % para reformas de vivienda habitual.
              </p>
            )}
          </fieldset>

          <Input
            label="Validez (días)"
            name="validez_dias"
            required
            inputMode="numeric"
            autoComplete="off"
            placeholder="30"
            hint="Días que el cliente tiene para aceptarlo, contados desde que se envía."
            value={cabecera.validez_dias}
            onChange={(e) => setCampo("validez_dias", e.target.value)}
            error={campoError?.validez_dias}
          />
        </div>
      </Card>

      <section aria-labelledby="partidas-titulo" className="space-y-3">
        <div>
          <h2 id="partidas-titulo" className="text-lg font-semibold text-stone-900">
            Partidas
          </h2>
          <p className="text-sm text-stone-500">
            Precios sin IVA. Si eliges un material del almacén, se rellenan su nombre y su precio.
          </p>
        </div>

        {ia && (
          <MontarConIa
            hayPartidas={filas.some((f) => !esFilaVacia(f))}
            lleno={filas.filter((f) => !esFilaVacia(f)).length >= LIMITES_PRESUPUESTO.partidas}
            onPropuesta={ponerPropuesta}
          />
        )}

        {campoError?.partidas && <Alert>{campoError.partidas}</Alert>}

        <ol className="space-y-3">
          {filas.map((fila, indice) => {
            const n = indice + 1;
            const material = fila.material_id ? materialPorId.get(fila.material_id) : undefined;
            const importe = draftLineCents(fila);
            const ids = {
              descripcion: `partida-${fila.key}-descripcion`,
              material: `partida-${fila.key}-material`,
              cantidad: `partida-${fila.key}-cantidad`,
              precio: `partida-${fila.key}-precio`,
            };
            const errores = {
              descripcion: errorFila(fila.key, "descripcion"),
              material: errorFila(fila.key, "material_id"),
              cantidad: errorFila(fila.key, "cantidad"),
              precio: errorFila(fila.key, "precio"),
            };
            const resaltada = resaltadas.has(fila.key);
            return (
              <li
                key={fila.key}
                className={cn(
                  "rounded-xl transition-shadow duration-700 motion-reduce:transition-none",
                  resaltada && "ring-2 ring-amber-400",
                )}
              >
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                      Partida {n}
                      {resaltada && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Propuesta por la IA
                        </span>
                      )}
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFila(fila.key)}
                      disabled={filas.length === 1}
                      aria-label={`Quitar partida ${n}`}
                    >
                      Quitar
                    </Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
                    <CampoPartida n={n} id={ids.descripcion} label="Descripción" error={errores.descripcion}>
                      <input
                        id={ids.descripcion}
                        name="partida_descripcion"
                        autoComplete="off"
                        maxLength={LIMITES_PRESUPUESTO.descripcion}
                        placeholder="Alicatado de paredes con azulejo 30×60"
                        value={fila.descripcion}
                        onChange={(e) => updateFila(fila.key, { descripcion: e.target.value })}
                        aria-invalid={errores.descripcion ? true : undefined}
                        aria-describedby={errores.descripcion ? `${ids.descripcion}-error` : undefined}
                        className={cn(controlClasses, controlState(errores.descripcion), "h-11")}
                      />
                    </CampoPartida>

                    <CampoPartida n={n} id={ids.material} label="Material del almacén (opcional)" error={errores.material}>
                      <select
                        id={ids.material}
                        name="partida_material"
                        value={fila.material_id}
                        onChange={(e) => elegirMaterial(fila.key, e.target.value)}
                        aria-invalid={errores.material ? true : undefined}
                        aria-describedby={errores.material ? `${ids.material}-error` : undefined}
                        className={cn(controlClasses, controlState(errores.material), "h-11 pr-8")}
                      >
                        <option value="">Sin vincular</option>
                        {/* Un material borrado del almacén se sigue mostrando para no perder el vínculo sin avisar. */}
                        {fila.material_id && !material && <option value={fila.material_id}>Material no disponible</option>}
                        {materiales.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre} ({formatEuros(m.precio_cents)}/{m.unidad})
                          </option>
                        ))}
                      </select>
                    </CampoPartida>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <CampoPartida
                      n={n}
                      id={ids.cantidad}
                      label={material ? `Cantidad (${material.unidad})` : "Cantidad"}
                      error={errores.cantidad}
                    >
                      <input
                        id={ids.cantidad}
                        name="partida_cantidad"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="1"
                        value={fila.cantidad}
                        onChange={(e) => updateFila(fila.key, { cantidad: e.target.value })}
                        aria-invalid={errores.cantidad ? true : undefined}
                        aria-describedby={errores.cantidad ? `${ids.cantidad}-error` : undefined}
                        className={cn(controlClasses, controlState(errores.cantidad), "h-11 text-right tabular-nums")}
                      />
                    </CampoPartida>

                    <CampoPartida n={n} id={ids.precio} label="Precio unitario (€)" error={errores.precio}>
                      <input
                        id={ids.precio}
                        name="partida_precio"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0,00"
                        value={fila.precio}
                        onChange={(e) => updateFila(fila.key, { precio: e.target.value })}
                        aria-invalid={errores.precio ? true : undefined}
                        aria-describedby={errores.precio ? `${ids.precio}-error` : undefined}
                        className={cn(controlClasses, controlState(errores.precio), "h-11 text-right tabular-nums")}
                      />
                    </CampoPartida>

                    <div className="col-span-2 flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 sm:col-span-1 sm:block sm:bg-transparent sm:p-0">
                      <p className="text-sm font-medium text-stone-800 sm:mb-1.5">Importe</p>
                      <p className="text-right text-base font-semibold text-stone-900 tabular-nums sm:flex sm:h-11 sm:items-center sm:justify-end">
                        {importe === null ? <span className="text-stone-400">—</span> : formatEuros(importe)}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>

        <Button id={ANADIR_ID} variant="secondary" onClick={addFila} disabled={filas.length >= LIMITES_PRESUPUESTO.partidas}>
          <PlusIcon className="size-4" />
          Añadir partida
        </Button>
      </section>

      <Card className="p-4 sm:p-6">
        <dl className="ml-auto max-w-sm space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">Base imponible</dt>
            <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(totales.baseCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">IVA ({IVA_OPCIONES.find((i) => String(i) === cabecera.iva_pct) ?? "—"} %)</dt>
            <dd className="font-medium text-stone-900 tabular-nums">{formatEuros(totales.ivaCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-stone-200 pt-2 text-base">
            <dt className="font-semibold text-stone-900">Total</dt>
            <dd className="font-bold text-stone-900 tabular-nums">{formatEuros(totales.totalCents)}</dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
        <LinkButton href={cancelHref}>Cancelar</LinkButton>
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? "Guardando…" : id ? "Guardar cambios" : "Crear presupuesto"}
        </Button>
      </div>
    </form>
  );
}

function CampoPartida({
  n,
  id,
  label,
  error,
  children,
}: {
  /** Número de la partida, para que el lector de pantalla distinga los campos de cada una. */
  n: number;
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        <span className="sr-only"> de la partida {n}</span>
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
