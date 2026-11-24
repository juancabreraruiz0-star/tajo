# Cuarta auditoría externa (2026-11-24)

Revisión independiente del commit `88d708b` ya desplegado: lo hecho después de T18 (T19 «misma descripción, mismo presupuesto» con la migración 0009, T20 marca, y los commits del orquestador sobre Vercel, carga, analítica y efectos visuales), README, `PLAN.md` y `DECISIONES.md`. Sus hallazgos se corrigen en T21 (ver `PLAN.md` y la decisión D15).

**Resumen:** dos hallazgos medios (el primero era una sospecha y quedó resuelto: solo afecta a la documentación) y cuatro menores.

## Medios

- **M1 · Sospecha resuelta: la 0009 sí está aplicada en la base real.** `PLAN.md` (T19) y el README decían que estaba sin aplicar y hablaban de una «base que ya tiene hasta la 0008 (como la de la demo)». Se comprobó en producción el 2026-11-24: la misma descripción devolvió «Misma descripción que una propuesta anterior: mismas partidas» con el mismo total y sin gastar cuota. Solo había que corregir la documentación.
- **M2 · Seis commits sin tarea en el plan.** Después de T18 el orquestador hizo cambios directamente, sin pasar por develop y testing: funciones de Vercel en `dub1` junto a Supabase eu-west-1 (`vercel.json`), esqueleto de carga en las pantallas privadas (`src/app/(app)/loading.tsx`), Vercel Analytics y Speed Insights con el token de `/p/` tapado (`src/components/analitica.tsx`), pasos hechos de la guía en verde, renombrado de «Montar con IA» a «Asistente Tajo» con el logo y efectos visuales (tejado animado, franja de obra que avanza, reflejo en el botón principal, tarjetas que se elevan). Sin fila en el plan ni decisión que los explique.

## Menores

1. **Caché de IA: cualquier usuario de la empresa podía sustituir una propuesta guardada.** `guardar_propuesta_ia(..., p_sustituir => true)` (0009) cambiaba la propuesta de otro compañero con solo gastar un uso propio; lo muestra el propio test de PGlite. D14 decía que solo se sustituye si la guardada ya no valida, pero eso solo lo cumplía la app, no la base.
2. **La clave de la caché no recogía toda la petición.** `VERSION_PETICION_IA` incluía modelo, instrucciones y esquema, pero no `effort`, `max_tokens` ni `fallbacks`: cambiar uno de ellos seguía sirviendo propuestas pedidas con los ajustes anteriores. Además, una respuesta dada por un modelo de respaldo (fallback) se guardaba igual que una del modelo principal: no debe entrar en la caché (al usuario se le da igualmente).
3. **Documentación desfasada.** El README pedía pulsar «Montar con IA», pero la interfaz dice «Asistente Tajo» y el botón «Proponer partidas» (también en `CLAUDE.md` y `.env.example`); «La IA ha supuesto:» ahora es «El asistente ha supuesto:»; D14 citaba «propuestas con IA de hoy»; el README hablaba de «las ocho migraciones»; no decía nada de Analytics y Speed Insights. Recuentos de tests por revisar y un README largo para quien evalúa.
4. **Accesibilidad.** El esqueleto de carga tenía `aria-busy="true"` sobre el mismo `role="status"` (algunos lectores de pantalla no anuncian una región ocupada) y la tarjeta de cifras del panel se elevaba al pasar el ratón aunque no fuera un enlace.
