"use client";

import { useEffect, useId, useState, useTransition, type KeyboardEvent } from "react";
import { MarcaTajo } from "@/components/logo";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { controlClasses, controlState } from "@/components/ui/field";
import { sugerirPartidas } from "@/lib/actions/ia";
import { LIMITES_PRESUPUESTO, type PartidaRaw } from "@/lib/domain/presupuestos";
import { LIMITES_IA, validarDescripcionObra } from "@/lib/domain/sugerencias";

interface MontarConIaProps {
  /** ¿Hay ya partidas escritas en el formulario? Si las hay, se ofrece añadir la propuesta detrás en vez de sustituirlas. */
  hayPartidas: boolean;
  /** ¿Tiene ya el presupuesto el máximo de partidas? Entonces solo se puede pedir para sustituirlas. */
  lleno: boolean;
  /**
   * Mete las partidas en el formulario: sustituyen a las que hay o, con `anadir`, van detrás. Devuelve cuántas han
   * cabido (máx. 100 por presupuesto).
   */
  onPropuesta: (partidas: PartidaRaw[], anadir: boolean) => number;
}

interface Resultado {
  anadidas: number;
  sustituidas: boolean;
  /** Propuestas válidas que no han cabido en el presupuesto. */
  sinHueco: number;
  descartadas: number;
  supuestos: string[];
  /** Misma descripción y mismo almacén que una propuesta anterior: la misma, sin gastar cuota (D14). */
  repetida: boolean;
  /** null si no ha gastado ninguna propuesta (repetida). */
  quedan: number | null;
}

const EJEMPLO =
  "Ej.: Reforma de baño de 6 m²: quitar la bañera y poner plato de ducha de 120, alicatado hasta el techo, mampara, inodoro nuevo y grifería termostática.";

// Lo que hace la IA mientras se espera. Es texto de ambiente: no se anuncia a los lectores de pantalla.
const FASES = [
  "Leyendo la descripción de la obra…",
  "Buscando materiales en tu almacén…",
  "Midiendo superficies y cantidades…",
  "Calculando la mano de obra…",
  "Ordenando las partidas como en obra…",
  "Repasando precios y unidades…",
];

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

function resumen(r: Resultado): string {
  const partes = r.repetida ? ["Misma descripción que una propuesta anterior: mismas partidas."] : [];
  partes.push(
    `${r.sustituidas ? "Se han puesto" : "Se han añadido"} ${plural(r.anadidas, "partida", "partidas")} propuestas por el asistente${r.sustituidas ? " en lugar de las que había" : ""}. Revísalas antes de guardar.`,
  );
  if (r.sinHueco > 0) {
    partes.push(`${plural(r.sinHueco, "partida no ha cabido", "partidas no han cabido")}: un presupuesto tiene como mucho 100.`);
  }
  if (r.descartadas > 0) {
    partes.push(`${plural(r.descartadas, "propuesta no se ha añadido", "propuestas no se han añadido")} porque no ${r.descartadas === 1 ? "era válida" : "eran válidas"}.`);
  }
  return partes.join(" ");
}

function quedanTexto(quedan: number | null): string {
  if (quedan === null) return "Esta no ha gastado ninguna de tus propuestas del asistente de hoy.";
  // Puede acabarse la cuota del usuario (15) o la de la empresa (40): el mensaje vale para las dos.
  return quedan === 0
    ? "Has gastado las propuestas del asistente de hoy. Mañana se renuevan."
    : `Te ${quedan === 1 ? "queda" : "quedan"} ${plural(quedan, "propuesta", "propuestas")} del asistente hoy.`;
}

/** Lo que oye un lector de pantalla al terminar: resumen, supuestos y usos que quedan, en un solo anuncio. */
function anuncio(r: Resultado): string {
  const supuestos = r.supuestos.length > 0 ? ` El asistente ha supuesto: ${r.supuestos.join("; ")}.` : "";
  return `${resumen(r)}${supuestos} ${quedanTexto(r.quedan)}`;
}

/** Panel «Montar con IA» (D10): la IA propone partidas y se añaden al formulario para revisarlas. No guarda nada. */
export function MontarConIa({ hayPartidas, lleno, onPropuesta }: MontarConIaProps) {
  const id = useId();
  const ids = {
    texto: `${id}-texto`,
    ayuda: `${id}-ayuda`,
    error: `${id}-error`,
    anadir: `${id}-anadir`,
    lleno: `${id}-lleno`,
  };

  const [texto, setTexto] = useState("");
  /** Por defecto la propuesta sustituye a las partidas que hay; marcado, va detrás. */
  const [anadir, setAnadir] = useState(false);
  /** Error de la descripción (junto al campo). */
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  /** Error de la propuesta (servidor, cuota, IA). */
  const [errorIa, setErrorIa] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [segundos, setSegundos] = useState(0);

  // Reloj de la espera: cuenta los segundos (la frase cambia cada 5 s).
  useEffect(() => {
    if (!pending) return;
    const inicio = Date.now();
    const reloj = window.setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => window.clearInterval(reloj);
  }, [pending]);

  function proponer() {
    // Sin hueco para partidas nuevas no se pide nada (no se gasta un uso de la cuota).
    if (pending || (lleno && anadir)) return;
    const descripcion = validarDescripcionObra(texto);
    setResultado(null);
    setErrorIa(null);
    if (!descripcion.ok) {
      setErrorCampo(descripcion.error);
      return;
    }
    setErrorCampo(null);
    setSegundos(0);
    const anadirAhora = anadir && hayPartidas;
    const sustituidas = !anadir && hayPartidas;
    startTransition(async () => {
      let respuesta: Awaited<ReturnType<typeof sugerirPartidas>>;
      try {
        respuesta = await sugerirPartidas(descripcion.valor);
      } catch {
        setErrorIa("No se ha podido conectar con el servidor. Revisa la conexión e inténtalo de nuevo.");
        return;
      }
      if (respuesta.error !== undefined) {
        setErrorIa(respuesta.error);
        return;
      }
      const anadidas = onPropuesta(respuesta.partidas, anadirAhora);
      setResultado({
        anadidas,
        sustituidas,
        sinHueco: respuesta.partidas.length - anadidas,
        descartadas: respuesta.descartadas,
        supuestos: respuesta.supuestos,
        repetida: respuesta.repetida,
        quedan: respuesta.quedan,
      });
      setAnadir(false);
    });
  }

  function atajo(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      proponer();
    }
  }

  const fase = FASES[Math.floor(segundos / 5) % FASES.length];
  const largo = texto.length;
  const sinHueco = lleno && anadir;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm transition-[border-color,box-shadow] duration-300 sm:p-5",
        pending ? "border-amber-400 shadow-[0_0_0_4px_rgb(236_147_28/0.12)]" : "border-amber-200",
      )}
    >
      {/* Mientras trabaja, la franja de obra avanza por el borde de arriba. */}
      {pending && <div aria-hidden="true" className="franja-obra absolute inset-x-0 top-0 h-1 motion-safe:animate-franja" />}
      <div className="flex items-start gap-3.5">
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 shadow-[0_6px_16px_-6px_rgb(7_27_44/0.55),inset_0_1px_0_rgb(255_255_255/0.12)] ring-1 ring-white/10 ring-inset">
          <MarcaTajo tone="dark" animada={pending} className="size-6" />
          <span
            aria-hidden="true"
            className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[0.5rem] font-bold text-stone-950 ring-2 ring-white"
          >
            IA
          </span>
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-titulo`} className="text-base font-semibold text-stone-900">
            Asistente Tajo
          </h3>
          <p className="text-sm text-stone-600">
            Describe la obra y el asistente, con IA, te propone las partidas con los materiales y precios de tu almacén. Sustituyen a las
            de abajo (o van detrás, si lo marcas) para que las revises; no se guarda nada hasta que pulses «Guardar».
            Con el mismo almacén, la misma descripción da siempre las mismas partidas.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <label htmlFor={ids.texto} className="block text-sm font-medium text-stone-800">
          Descripción de la obra
        </label>
        {/* Sin name: no viaja con el formulario del presupuesto. */}
        <textarea
          id={ids.texto}
          rows={4}
          maxLength={LIMITES_IA.descripcionMax}
          placeholder={EJEMPLO}
          value={texto}
          disabled={pending}
          onChange={(e) => {
            setTexto(e.target.value);
            if (errorCampo) setErrorCampo(null);
          }}
          onKeyDown={atajo}
          aria-invalid={errorCampo ? true : undefined}
          aria-describedby={errorCampo ? `${ids.error} ${ids.ayuda}` : ids.ayuda}
          className={cn(controlClasses, controlState(errorCampo ?? undefined), "min-h-28 resize-y py-2.5")}
        />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <p id={ids.ayuda} className="text-xs text-stone-500">
            Medidas, qué se quita, qué se pone y calidades. Lo que falte, la IA lo supone y te lo dice.
          </p>
          <p
            className={cn(
              "ml-auto text-xs tabular-nums",
              largo >= LIMITES_IA.descripcionMax ? "font-medium text-amber-700" : "text-stone-500",
            )}
          >
            {largo}/{LIMITES_IA.descripcionMax}
            <span className="sr-only"> caracteres</span>
          </p>
        </div>
        {errorCampo && (
          <p id={ids.error} className="text-sm text-red-600">
            {errorCampo}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {hayPartidas ? (
          <label
            htmlFor={ids.anadir}
            className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-stone-700 sm:min-h-0"
          >
            <input
              id={ids.anadir}
              type="checkbox"
              checked={anadir}
              disabled={pending}
              onChange={(e) => setAnadir(e.target.checked)}
              className="size-4 accent-amber-600"
            />
            Añadir detrás de las partidas actuales
          </label>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Button
          variant="primary"
          onClick={proponer}
          disabled={pending || sinHueco}
          aria-describedby={sinHueco ? ids.lleno : undefined}
          className="w-full sm:w-auto"
        >
          {pending ? (
            <>
              <MarcaTajo mono animada className="size-4" />
              Estudiando la obra…
            </>
          ) : (
            <>
              <MarcaTajo mono className="size-4" />
              Proponer partidas
            </>
          )}
        </Button>
      </div>

      {sinHueco && (
        <p id={ids.lleno} className="mt-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
          El presupuesto ya tiene {LIMITES_PRESUPUESTO.partidas} partidas, el máximo. Quita alguna o desmarca «Añadir
          detrás de las partidas actuales» para que la propuesta las sustituya.
        </p>
      )}

      {/* Única región que se anuncia (inicio de la espera y resultado completo, supuestos incluidos). No la frase que
          va cambiando ni las cajas de abajo, que no tienen role para no anunciar dos veces lo mismo. */}
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Estudiando la obra. Puede tardar hasta un minuto." : resultado ? anuncio(resultado) : ""}
      </p>

      {pending && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-white/80 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="font-medium text-stone-800" aria-hidden="true">
              {fase}
            </p>
            <p className="shrink-0 text-xs text-stone-500 tabular-nums" aria-hidden="true">
              {segundos} s
            </p>
          </div>
          <div className="mt-3 space-y-2" aria-hidden="true">
            {[88, 72, 80].map((ancho, i) => (
              <div key={ancho} className="flex items-center gap-3">
                <div
                  className="h-3 rounded bg-amber-200/70 motion-safe:animate-pulse"
                  style={{ width: `${ancho}%`, animationDelay: `${i * 200}ms` }}
                />
                <div
                  className="h-3 flex-1 rounded bg-stone-200 motion-safe:animate-pulse"
                  style={{ animationDelay: `${i * 200 + 100}ms` }}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">Suele tardar entre 20 y 60 segundos. Puedes seguir mirando el formulario.</p>
        </div>
      )}

      {errorIa && !pending && (
        <Alert className="mt-4" title="No se han podido proponer partidas">
          {errorIa}
        </Alert>
      )}

      {resultado && !pending && (
        <div className="mt-4 space-y-3 motion-safe:escalonado">
          {/* Sin role: ya lo anuncia la región aria-live de arriba. */}
          <p className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800">
            {resumen(resultado)}
          </p>
          {resultado.supuestos.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">El asistente ha supuesto:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {resultado.supuestos.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-stone-500">
            {quedanTexto(resultado.quedan)}
          </p>
        </div>
      )}
    </section>
  );
}
