// «Enviar por WhatsApp» (T15): teléfono del cliente en formato internacional y mensaje con el enlace público.
// Puro: sin Next ni Supabase.

/** Prefijo que se pone a un número español escrito sin prefijo (9 cifras). */
export const PREFIJO_ESPANA = "34";

/** Un número internacional (E.164) tiene como mucho 15 cifras, prefijo incluido; menos de 8 no es un teléfono. */
const MIN_CIFRAS = 8;
const MAX_CIFRAS = 15;

/** Número español: 9 cifras que empiezan por 6 o 7 (móviles) o por 8 o 9 (fijos). */
const ESPANOL = /^[6-9]\d{8}$/;

/**
 * Teléfono en el formato que pide wa.me: solo cifras, con el prefijo del país y sin «+» ni «00».
 * Se quitan espacios, guiones, puntos, barras y paréntesis. Sin prefijo, se entiende que es español (+34) y tiene que
 * tener 9 cifras y empezar por 6, 7, 8 o 9. Con «+» o «00», se acepta cualquier país (si es +34, con las mismas
 * reglas). Devuelve null si no es un teléfono válido (vacío, letras, demasiado corto o largo…).
 *
 *   "600 112 233" → "34600112233"   ·   "+34 963-600-144" → "34963600144"   ·   "0044 20 7946 0958" → "442079460958"
 */
export function normalizarTelefono(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.trim().replace(/[\s\-.()/]/g, "");
  if (limpio === "") return null;

  let internacional: string;
  if (limpio.startsWith("+")) internacional = limpio.slice(1);
  else if (limpio.startsWith("00")) internacional = limpio.slice(2);
  else if (/^\d+$/.test(limpio) && ESPANOL.test(limpio)) return `${PREFIJO_ESPANA}${limpio}`;
  else if (/^34[6-9]\d{8}$/.test(limpio)) return limpio;
  else return null;

  if (!/^[1-9]\d+$/.test(internacional)) return null;
  if (internacional.startsWith(PREFIJO_ESPANA)) {
    return ESPANOL.test(internacional.slice(PREFIJO_ESPANA.length)) ? internacional : null;
  }
  return internacional.length >= MIN_CIFRAS && internacional.length <= MAX_CIFRAS ? internacional : null;
}

// Palabras que delatan que el cliente es una empresa o una comunidad, no una persona: entonces no se le saluda por
// el nombre de pila («Hola, Comunidad» suena raro).
const ENTIDAD =
  /(^|\s)(s\.?\s?l\.?u?\.?|s\.?\s?a\.?|s\.?\s?c\.?|c\.?\s?b\.?|sociedad|comunidad|cdad\.?|restaurante|hotel|bar|asociaci[oó]n|fundaci[oó]n|ayuntamiento|colegio|cl[ií]nica|promociones|construcciones|inmobiliaria|grupo|talleres)(\s|$)/i;

/** Nombre de pila para el saludo: «Carmen Puig Soler» → «Carmen». null si parece una empresa o no hay nombre. */
export function nombreSaludo(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? "").trim().replace(/\s+/g, " ");
  if (limpio === "" || ENTIDAD.test(limpio) || /\d/.test(limpio)) return null;
  return limpio.split(" ")[0];
}

/** Nombre de la empresa para la firma, sin la forma jurídica: «Reformas Levante S.L.» → «Reformas Levante». */
export function nombreFirma(empresa: string | null | undefined): string {
  return (empresa ?? "")
    .trim()
    .replace(/[\s,]+(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?|c\.?\s?b\.?)$/i, "")
    .trim();
}

/** Primera letra en minúscula, salvo siglas («IVA», «PVC»): «Reforma de baño» → «reforma de baño». */
function enMinuscula(titulo: string): string {
  const limpio = titulo.trim().replace(/\s+/g, " ");
  if (limpio.length < 2) return limpio.toLowerCase();
  const [primera, segunda] = limpio;
  return segunda === segunda.toLowerCase() ? primera.toLowerCase() + limpio.slice(1) : limpio;
}

export interface DatosMensajeWhatsApp {
  cliente: string | null;
  titulo: string;
  enlace: string;
  empresa: string | null;
}

/**
 * Mensaje corto para mandar el presupuesto. El enlace va en su propia línea, para que WhatsApp lo reconozca entero:
 *
 *   Hola, Carmen. Te paso el presupuesto de reforma completa de baño:
 *   https://…/p/…
 *   Cualquier duda me dices. Un saludo,
 *   Reformas Levante
 */
export function mensajeWhatsApp({ cliente, titulo, enlace, empresa }: DatosMensajeWhatsApp): string {
  const nombre = nombreSaludo(cliente);
  const firma = nombreFirma(empresa);
  const asunto = titulo.trim() ? ` de ${enMinuscula(titulo)}` : "";
  return [
    `${nombre ? `Hola, ${nombre}.` : "Hola."} Te paso el presupuesto${asunto}:`,
    enlace.trim(),
    `Cualquier duda me dices. Un saludo${firma ? "," : "."}`,
    ...(firma ? [firma] : []),
  ].join("\n");
}

/**
 * Enlace de WhatsApp: con teléfono válido abre el chat de ese número; sin él, WhatsApp pide elegir el contacto.
 * wa.me/34600112233?text=…  ·  wa.me/?text=…
 */
export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): string {
  const numero = normalizarTelefono(telefono);
  return `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(mensaje)}`;
}
