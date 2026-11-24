# Tercera auditoría externa (2026-11-24)

Revisión independiente, con un agente nuevo, del commit `69935c1` ya desplegado: migraciones 0001–0007, Server Actions, autenticación, IA, páginas, README, `CLAUDE.md` y agentes, historial de git, 10 ataques en PGlite y peticiones GET a la app publicada. Sus hallazgos se corrigen en T18 (ver `PLAN.md` y la decisión D13).

**Veredicto del auditor:** entregable tal cual; ningún bloqueante ni fallo de seguridad.

## Medios

- **M1 · La validez se contaba desde que se creaba el borrador, no desde el envío.** Un borrador de hace 40 días con 30 de validez se podía enviar sin aviso y el cliente ya no podía aceptarlo; tampoco gerencia. Comprobado en PGlite.
- **M2 · El coste de un material no se podía poner desde la app.** Un material nuevo apuntado en un parte usaba el precio de venta como coste y su margen salía 0. El README prometía «material a su coste».

## Menores

1. Demo compartida: cuota de IA por usuario y guía de la demo que comparten todos los evaluadores; la obra «Reforma de cocina» se puede terminar y romper el recorrido.
2. Sin `error.tsx` ni `global-error.tsx`: un error no controlado mostraba la pantalla genérica de Next, en inglés.
3. Constancia: el empleado podía leer por la API la IP y el navegador de la aceptación, y la constancia «Enviado por…» usaba el nombre actual del perfil, que el propio usuario puede cambiar.
4. `CLAUDE.md` y los agentes no mencionaban obras, IA ni `test:pglite`.
5. Código muerto (`costesObra`, `tipoNif`, `EmpresaCosteHora`, `MaterialCoste`) y un comentario viejo sobre la cuota de IA.
6. Factura sin IBAN junto a «Transferencia bancaria».
7. Un presupuesto de 0 € se podía enviar, aceptar y facturar, gastando número de factura.
8. El seed usaba móviles y correos @gmail.com que podrían ser de personas reales; «Enviar por WhatsApp» abriría su chat.
9. Historial de git con pocos commits grandes: el bucle de agentes se sigue en `docs/PLAN.md`.

## Revisado y correcto

Aislamiento entre empresas y RLS; roles; sin permisos de anon; transiciones con triggers y marcas `tajo.*` solo con `current_user = postgres`; numeración de facturas sin huecos y con bloqueo; facturas inmutables; tope de 24 h en partes con bloqueo; cuota de IA sin forma de saltarla; validación de la respuesta de la IA (materiales de otra empresa o precios inventados se descartan); parámetros del SDK de Anthropic; sin secretos en el historial; `npm audit --omit=dev` sin vulnerabilidades; cabeceras de seguridad en producción; 404 con tokens o ids inválidos y redirección a /login sin sesión; fechas en hora de Madrid.
