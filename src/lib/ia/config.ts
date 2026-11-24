// «Montar con IA» (D10): ¿está configurada la IA en este servidor?
// Solo se llama desde el servidor (páginas y Server Actions). La clave nunca llega al navegador: no es NEXT_PUBLIC_*,
// y lo único que sale de aquí hacia la página es un sí o un no.

/** true si hay ANTHROPIC_API_KEY. Sin clave, la función «Montar con IA» no se ofrece. */
export function iaConfigurada(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? "").trim() !== "";
}
