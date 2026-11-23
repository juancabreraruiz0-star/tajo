import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "./env";

// Imágenes, favicon, fuentes y webmanifest. Lo de /_next/ se trata aparte.
const STATIC_FILE = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|webmanifest)$/i;

/** Rutas accesibles sin sesión: login, enlaces públicos de presupuesto y recursos estáticos. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/p/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return STATIC_FILE.test(pathname);
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/** Refresca la sesión de Supabase y manda a /login si no hay usuario en una ruta privada. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const isPublic = isPublicPath(request.nextUrl.pathname);
  const env = readSupabaseEnv();

  // Sin configuración no hay forma de validar la sesión: se cierra el acceso a lo privado.
  if (!env) {
    return isPublic ? NextResponse.next({ request }) : redirectToLogin(request);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // No meter código entre createServerClient y getClaims: refresca el token si hace falta.
  const { data } = await supabase.auth.getClaims();
  const hasUser = Boolean(data?.claims);

  if (!hasUser && !isPublic) {
    const redirect = redirectToLogin(request);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
