import { BottomNav, SidebarNav } from "@/components/app-nav";
import { LogoutIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { signOut } from "@/lib/actions/auth";
import { getSessionProfile } from "@/lib/auth";
import { menuFor, ROL_LABEL } from "@/lib/domain/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil } = await getSessionProfile();
  const items = menuFor(perfil.rol);
  const nombre = perfil.nombre.trim() || perfil.email || user.email || "Usuario";
  const rol = ROL_LABEL[perfil.rol];
  const inicial = nombre.charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:shadow-elevada"
      >
        Saltar al contenido
      </a>

      {/* Escritorio: barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden bg-slate-900 md:flex print:hidden">
        <div aria-hidden="true" className="franja-obra h-1 shrink-0" />
        {/* Cuadrícula de plano muy tenue detrás del logo */}
        <div
          aria-hidden="true"
          className="fondo-plano pointer-events-none absolute inset-x-0 top-0 h-48 [--plano-linea:rgb(148_163_184/0.07)] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="relative px-6 pt-6 pb-8">
          <Logo tone="dark" />
        </div>
        <SidebarNav items={items} />
        <div className="m-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06]">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-stone-950 ring-4 ring-amber-500/15"
            >
              {inicial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{nombre}</p>
              <p className="truncate text-xs text-slate-400">{rol}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                title="Cerrar sesión"
                className="flex size-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-amber-400"
              >
                <LogoutIcon className="size-[1.125rem]" />
                <span className="sr-only">Cerrar sesión</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Móvil: cabecera con usuario y salir */}
      <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-white/90 backdrop-blur-md md:hidden print:hidden">
        <div aria-hidden="true" className="franja-obra h-1" />
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Logo />
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0 text-right leading-tight">
              <p className="truncate text-sm font-medium text-stone-900">{nombre}</p>
              <p className="truncate text-xs text-stone-500">{rol}</p>
            </div>
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-stone-950"
            >
              {inicial}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="flex size-10 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <LogoutIcon className="size-5" />
                <span className="sr-only">Cerrar sesión</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="contenido" tabIndex={-1} className="outline-none md:pl-64 print:pl-0">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pt-10 md:pb-14 lg:px-10 print:max-w-none print:p-0">
          {children}
        </div>
      </main>

      <BottomNav items={items} />
    </div>
  );
}
