import type { FieldErrors } from "@/lib/domain/validation";

/** Estado que devuelven las Server Actions de formulario (para useActionState). */
export interface FormState<K extends string> {
  /** Error general, se pinta arriba del formulario. */
  error?: string;
  /** Errores por campo, se pintan junto a cada campo. */
  fieldErrors?: FieldErrors<K>;
  /** Lo que escribió el usuario, para no perderlo si hay errores. */
  values?: Partial<Record<K, string>>;
}

/** Lee del FormData solo los campos indicados, como texto. */
export function readFields<K extends string>(formData: FormData, campos: readonly K[]): Record<K, string> {
  return Object.fromEntries(
    campos.map((campo) => {
      const valor = formData.get(campo);
      return [campo, typeof valor === "string" ? valor : ""];
    }),
  ) as Record<K, string>;
}
