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
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Saltar al contenido
      </a>

      {/* Escritorio: barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-900 md:flex print:hidden">
        <div className="px-6 pt-6 pb-8">
          <Logo tone="dark" />
        </div>
        <SidebarNav items={items} />
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white"
            >
              {inicial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{nombre}</p>
              <p className="truncate text-xs text-slate-400">{rol}</p>
            </div>
          </div>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <LogoutIcon className="size-4" />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      {/* Móvil: cabecera con usuario y salir */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-stone-200 bg-white/95 px-4 backdrop-blur md:hidden print:hidden">
        <Logo />
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 text-right leading-tight">
            <p className="truncate text-sm font-medium text-stone-900">{nombre}</p>
            <p className="truncate text-xs text-stone-500">{rol}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex size-10 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
            >
              <LogoutIcon className="size-5" />
              <span className="sr-only">Cerrar sesión</span>
            </button>
          </form>
        </div>
      </header>

      <main id="contenido" className="md:pl-64 print:pl-0">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pt-10 md:pb-12 lg:px-10 print:max-w-none print:p-0">{children}</div>
      </main>

      <BottomNav items={items} />
    </div>
  );
}
