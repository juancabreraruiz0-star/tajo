/**
 * Esqueleto mientras llega la página. Al navegar por el menú la pantalla cambia al instante (Next precarga este
 * esqueleto en los enlaces) y el contenido entra en cuanto el servidor lo envía.
 */
export default function Cargando() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden="true" className="animate-pulse">
        <header className="mb-6 sm:mb-8">
          <div className="h-8 w-48 rounded-lg bg-stone-200/80" />
          <div className="mt-3 h-4 w-72 max-w-full rounded bg-stone-200/60" />
        </header>
        <div className="rounded-xl border border-stone-200/90 bg-white shadow-tarjeta">
          <div className="border-b border-stone-100 px-4 py-4 sm:px-5">
            <div className="h-4 w-32 rounded bg-stone-200/80" />
          </div>
          <ul className="divide-y divide-stone-100">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <div className="h-4 w-24 shrink-0 rounded bg-stone-200/70" />
                <div className="h-4 flex-1 rounded bg-stone-100" />
                <div className="hidden h-4 w-20 shrink-0 rounded bg-stone-200/70 sm:block" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
