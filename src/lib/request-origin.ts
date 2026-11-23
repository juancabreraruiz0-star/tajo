import { headers } from "next/headers";
import { originFromHeaders } from "@/lib/domain/presupuestos";

/** Origen (https://host) de la petición actual, para construir enlaces absolutos. */
export async function getRequestOrigin(): Promise<string | null> {
  const h = await headers();
  return originFromHeaders({
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}
