// «Prueba Tajo en 3 minutos» (T15): guía de la demo en el panel. Los pasos se marcan solos según los datos (lo que
// ya se ha hecho hoy), no por clics. Se puede ocultar con una cookie. Puro: sin Next ni Supabase.

export type PasoGuiaClave = "crear" | "enviar" | "aceptar" | "facturar" | "parte";

export interface PasoGuia {
  clave: PasoGuiaClave;
  titulo: string;
  descripcion: string;
  /** Dónde se hace. */
  href: string;
  hecho: boolean;
}

/** Lo que ya ha pasado hoy (día de Madrid), leído de la base de datos con conteos baratos. */
export interface HechosGuia {
  /** Hay un presupuesto creado hoy en la empresa. */
  presupuestoCreado: boolean;
  /** Hay un presupuesto marcado como enviado hoy. */
  presupuestoEnviado: boolean;
  /** Hay un presupuesto aceptado hoy por el cliente desde el enlace (canal «enlace»). */
  aceptadoPorEnlace: boolean;
  /** Hay una factura con fecha de hoy (solo lo puede saber gerencia). */
  facturado: boolean;
  /** Este usuario ha apuntado hoy un parte de trabajo. */
  parteApuntado: boolean;
}

export interface OpcionesGuia {
  /** ¿Está configurada «Montar con IA» en este servidor? */
  ia: boolean;
  /** Gerencia ve además el paso de facturar (solo ella factura). */
  admin: boolean;
}

export interface GuiaDemo {
  pasos: PasoGuia[];
  hechos: number;
  total: number;
  completa: boolean;
  /** El primer paso sin hacer (el que se resalta), o null si están todos. */
  siguiente: PasoGuiaClave | null;
}

/** Pasos de la guía según la configuración y el rol, con los que ya están hechos marcados. */
export function guiaDemo(hechos: HechosGuia, { ia, admin }: OpcionesGuia): GuiaDemo {
  const crear: PasoGuia = ia
    ? {
        clave: "crear",
        titulo: "Monta un presupuesto con IA",
        descripcion: "Describe la obra en una frase y revisa las partidas que propone.",
        href: "/presupuestos/nuevo",
        hecho: hechos.presupuestoCreado,
      }
    : {
        clave: "crear",
        titulo: "Crea un presupuesto",
        descripcion: "Elige un cliente y añade un par de partidas del almacén.",
        href: "/presupuestos/nuevo",
        hecho: hechos.presupuestoCreado,
      };
  const pasos: PasoGuia[] = [
    crear,
    {
      clave: "enviar",
      titulo: "Márcalo como enviado y ábrelo como el cliente",
      descripcion: "En su ficha: «Marcar como enviado» y después «Abrir vista del cliente».",
      href: "/presupuestos?estado=borrador",
      hecho: hechos.presupuestoEnviado,
    },
    {
      clave: "aceptar",
      titulo: "Haz de cliente y acéptalo",
      descripcion: "Abre el enlace en una ventana de incógnito, escribe un nombre y acepta.",
      href: "/presupuestos?estado=enviado",
      hecho: hechos.aceptadoPorEnlace,
    },
    // Solo gerencia factura.
    ...(admin
      ? [
          {
            clave: "facturar",
            titulo: "Factúralo",
            descripcion: "Un clic en el presupuesto aceptado y sale la factura, lista para PDF.",
            href: "/presupuestos?estado=aceptado",
            hecho: hechos.facturado,
          } satisfies PasoGuia,
        ]
      : []),
    {
      clave: "parte",
      titulo: "Apunta un parte en una obra",
      descripcion: "Abre una obra en curso y añade las horas y el material de hoy.",
      href: "/obras",
      hecho: hechos.parteApuntado,
    },
  ];

  const hechosTotal = pasos.filter((p) => p.hecho).length;
  return {
    pasos,
    hechos: hechosTotal,
    total: pasos.length,
    completa: hechosTotal === pasos.length,
    siguiente: pasos.find((p) => !p.hecho)?.clave ?? null,
  };
}

// ----------------------------------------------------------------------------
// Ocultar la guía («Ya lo conozco»): una cookie del navegador, no un dato de la base.
// ----------------------------------------------------------------------------

export const COOKIE_GUIA = "tajo_guia";
export const VALOR_GUIA_OCULTA = "oculta";
/** Un año: quien ya conoce Tajo no vuelve a verla salvo que la pida. */
export const DURACION_COOKIE_GUIA_S = 60 * 60 * 24 * 365;

export function guiaOculta(valorCookie: string | undefined): boolean {
  return valorCookie === VALOR_GUIA_OCULTA;
}

// ----------------------------------------------------------------------------
// «Hoy» para las consultas: instante en que empieza el día en una zona horaria (timestamptz).
// ----------------------------------------------------------------------------

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Diferencia (ms) entre la hora de la zona y la UTC en un instante: +1 h en invierno en Madrid, +2 h en verano. */
function desfaseMs(instante: number, timeZone: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instante));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"), valor("second"));
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/**
 * Instante (ISO, UTC) en que empieza el día `dia` (AAAA-MM-DD) en la zona horaria: inicioDelDia("2026-11-23",
 * "Europe/Madrid") → "2026-11-22T23:00:00.000Z". Sirve para filtrar timestamps «de hoy» (created_at ≥ inicio).
 */
export function inicioDelDia(dia: string, timeZone: string): string {
  const partes = DIA.exec(dia);
  if (!partes) throw new Error(`Fecha no válida: «${dia}».`);
  const medianocheUtc = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  // Primera aproximación con el desfase de esa medianoche UTC; se corrige una vez por si cruza un cambio de hora.
  let instante = medianocheUtc - desfaseMs(medianocheUtc, timeZone);
  instante = medianocheUtc - desfaseMs(instante, timeZone);
  return new Date(instante).toISOString();
}
