// NIF de clientes (R4, D9): NIF de persona (DNI con letra; también K, L y M), NIE (X, Y, Z) y CIF de entidad.
// La base de datos normaliza igual (trigger clientes_normalizar) y comprueba solo el formato (9 letras o cifras);
// la letra o el dígito de control se validan aquí. Puro: sin Next ni Supabase.

export type TipoNif = "dni" | "nie" | "nif_especial" | "cif";

/** Letra de control de DNI y NIE: número mod 23. */
const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";
/** Letra de control del CIF según el dígito calculado (0 = J, 1 = A … 9 = I). */
const LETRAS_CIF = "JABCDEFGHI";

/** Letras iniciales de CIF que llevan dígito de control (sociedades anónimas, limitadas, comunidades de bienes…). */
const CIF_CON_NUMERO = "ABEH";
/** Letras iniciales de CIF que llevan letra de control (organismos públicos, entidades religiosas, no residentes…). */
const CIF_CON_LETRA = "NPQRSW";
/** Todas las letras iniciales de CIF; las que no están arriba admiten número o letra (C, D, F, G, J, U, V). */
const CIF_LETRAS = "ABCDEFGHJNPQRSUVW";

const DNI = /^(\d{8})([A-Z])$/;
const NIE = /^([XYZ])(\d{7})([A-Z])$/;
const NIF_ESPECIAL = /^([KLM])(\d{7})([A-Z])$/;
const CIF = /^([A-Z])(\d{7})([0-9A-J])$/;

const EJEMPLO = "ej.: 12345678Z, X1234567L o B12345674";

/** Mayúsculas y sin espacios, puntos ni guiones (como el trigger de la base). Vacío → null. */
export function normalizeNif(valor: string): string | null {
  const limpio = valor.toUpperCase().replace(/[\s.-]/g, "");
  return limpio === "" ? null : limpio;
}

function letraDni(numero: string): string {
  return LETRAS_DNI[Number(numero) % 23];
}

/** Dígito de control de un CIF (0–9) a partir de sus 7 cifras centrales. */
export function cifControlDigit(cifras: string): number {
  let suma = 0;
  for (let i = 0; i < cifras.length; i += 1) {
    const n = Number(cifras[i]);
    if (i % 2 === 1) {
      suma += n;
    } else {
      const doble = n * 2;
      suma += Math.floor(doble / 10) + (doble % 10);
    }
  }
  return (10 - (suma % 10)) % 10;
}

/** Tipo de documento según la forma (sin comprobar el control), o null si no encaja con ninguno. */
export function tipoNif(nif: string): TipoNif | null {
  if (DNI.test(nif)) return "dni";
  if (NIE.test(nif)) return "nie";
  if (NIF_ESPECIAL.test(nif)) return "nif_especial";
  const cif = CIF.exec(nif);
  return cif && CIF_LETRAS.includes(cif[1]) ? "cif" : null;
}

/**
 * Comprueba un NIF ya normalizado. Devuelve null si es válido o el motivo en español si no lo es.
 */
export function nifError(nif: string): string | null {
  if (nif.length !== 9) return `Un NIF tiene 9 letras o cifras (${EJEMPLO}).`;

  const dni = DNI.exec(nif);
  if (dni) {
    return letraDni(dni[1]) === dni[2] ? null : "La letra no corresponde al número del DNI. Revísalo.";
  }

  const nie = NIE.exec(nif);
  if (nie) {
    const numero = `${"XYZ".indexOf(nie[1])}${nie[2]}`;
    return letraDni(numero) === nie[3] ? null : "La letra no corresponde al número del NIE. Revísalo.";
  }

  const especial = NIF_ESPECIAL.exec(nif);
  if (especial) {
    return letraDni(especial[2]) === especial[3] ? null : "La letra de control del NIF no es correcta. Revísalo.";
  }

  const cif = CIF.exec(nif);
  if (cif && CIF_LETRAS.includes(cif[1])) {
    const [, letra, cifras, control] = cif;
    const digito = cifControlDigit(cifras);
    const esNumero = /\d/.test(control);
    if (CIF_CON_NUMERO.includes(letra) && !esNumero) {
      return `Un CIF que empieza por ${letra} termina en número, no en letra.`;
    }
    if (CIF_CON_LETRA.includes(letra) && esNumero) {
      return `Un CIF que empieza por ${letra} termina en letra, no en número.`;
    }
    const correcto = esNumero ? Number(control) === digito : control === LETRAS_CIF[digito];
    return correcto ? null : "El dígito o la letra de control del CIF no es correcto. Revísalo.";
  }

  return `No parece un NIF, NIE ni CIF (${EJEMPLO}).`;
}

/** Campo NIF de un formulario: opcional. Devuelve el NIF normalizado (o null si está vacío) y el error, si lo hay. */
export function parseNif(valor: unknown): { valor: string | null; error?: string } {
  const nif = normalizeNif(typeof valor === "string" ? valor : "");
  if (nif === null) return { valor: null };
  const error = nifError(nif);
  return error ? { valor: null, error } : { valor: nif };
}
