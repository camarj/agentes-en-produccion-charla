# T12 · Panel del speaker

**Objetivo:** Construir `/panel`, protegido con contraseña, con métricas en vivo, selector de lámina actual, interruptores de caos y cola de escalamientos, pensado para proyectarse.

**Cubre:** RF-10, RF-11, RF-12, guion de demo (PRD §12).

## Archivos
- `proxy.ts` (Next.js 16) — Basic Auth en `/panel` y `/api/panel/*` con `PANEL_PASSWORD`
- `app/panel/page.tsx` y `components/panel/*`
- `app/api/panel/metricas/route.ts`
- `app/api/panel/interruptores/route.ts` (GET, POST `{ clave, valor }`)
- `app/api/panel/escalamientos/route.ts` (GET, PATCH `{ id, estado }`)

## Lógica
1. **Métricas** (refresco cada 5 s): asistentes con al menos un mensaje / total inscritos; mensajes totales; latencia p50 y p95 de la última hora; errores; bloqueos por guardrail; escalamientos pendientes; coste estimado acumulado vs `PRESUPUESTO_MAX_USD`. Latencia, errores y bloqueos salen de la observabilidad de Mastra (API de trazas o consulta al storage); el resto de `charla.db`.
2. **Lámina actual:** stepper − / + y campo numérico (1–39); guarda en `interruptores.lamina_actual`.
3. **Interruptores de caos:** 3 switches (`herramienta_caida`, `latencia_alta`, `modelo_caido`) con hora de última activación. **Kill switch** separado, rojo, con diálogo de confirmación.
4. **Cola de escalamientos:** pendientes primero, por antigüedad. Cada fila: pregunta, motivo (badge), rol anónimo, hora; acciones "Respondida" y "Descartar". Nunca mostrar nombre ni email.
5. Enlace "Abrir Mastra Studio" (URL de `STUDIO_URL`).

## Diseño
Escritorio, tipografía grande (métricas 40 px en mono), tokens de la charla, sin animaciones distractoras. Legible desde el fondo de una sala en un proyector 1080p.

## Checklist
- [x] Sin contraseña, `/panel` y `/api/panel/*` responden 401
- [x] Activar `herramienta_caida` y preguntar en el chat produce la traza de reintentos y un escalamiento `falla_tecnica` en la cola
- [x] Kill switch pide confirmación, pone el chat en mantenimiento y al apagarlo el chat vuelve
- [x] Cambiar la lámina actual cambia las sugerencias del chat
- [x] Las métricas se actualizan sin recargar
