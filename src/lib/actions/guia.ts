"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSessionProfile } from "@/lib/auth";
import { COOKIE_GUIA, DURACION_COOKIE_GUIA_S, VALOR_GUIA_OCULTA } from "@/lib/domain/guia-demo";

/** «Ya lo conozco»: oculta la guía de la demo del panel. Se recuerda en una cookie de este navegador, no en la base. */
export async function ocultarGuia(): Promise<void> {
  await getSessionProfile();
  (await cookies()).set(COOKIE_GUIA, VALOR_GUIA_OCULTA, {
    path: "/",
    maxAge: DURACION_COOKIE_GUIA_S,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/");
}

/** Vuelve a mostrar la guía de la demo en el panel. */
export async function mostrarGuia(): Promise<void> {
  await getSessionProfile();
  (await cookies()).delete(COOKIE_GUIA);
  revalidatePath("/");
}
