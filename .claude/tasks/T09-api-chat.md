# T09 · API de chat

> **Actualización 2026-09-25 — requisitos vigentes:**
> - **Tope de turno:** 45 s (ya anotado abajo). Mensajes de 1 a 1.000 caracteres; 10 mensajes por minuto por asistente; 30 mensajes por asistente sumando **todos** sus hilos («Nueva conversación» crea un hilo nuevo en `app/api/chat/nuevo`).
> - **Presupuesto:** `PRESUPUESTO_MAX_USD` = **20 USD**. El coste suma el agente, los guardrails y jueces (~0,002 USD por turno) y el dictado por voz (0,0045 USD/min).
> - **Modelos:** `openai/gpt-6-luna` → `anthropic/claude-sonnet-5`, con respaldo nativo de Mastra; la ruta no reintenta. Con el interruptor `modelos_caidos` fallan los dos: mensaje fijo y escalamiento `falla_tecnica`.
> - **Guardrails en paralelo:** `ejecutarTurno` lanza los guardrails de entrada al mismo tiempo que el agente; nada llega al cliente antes del veredicto.
> - **Instrucciones vigentes:** 1.2.1 (`version_instrucciones` en el contexto).
> - **Latencia:** la meta de primer token p95 < 3 s se mantiene y está documentada como no cumplida (p95 ~6,7 s, p50 ~2–3 s).
>
> Fuente de verdad de los cambios: PRD §15 «Registro de cambios de requisitos». El texto de abajo es el plan original y se conserva como historial; donde choca con esta lista, gana esta lista.

**Objetivo:** Exponer `/api/chat` que valida sesión, kill switch y topes, arma el contexto del asistente y hace streaming del agente en formato compatible con AI SDK UI.

**Cubre:** RF-03, RF-08, RF-12, límites de coste (PRD §8).

## Archivos
- `app/api/chat/route.ts`
- `app/api/chat/historial/route.ts` — GET, devuelve los mensajes del hilo
- `lib/presupuesto.ts` — coste acumulado estimado

## Lógica de POST `/api/chat`
1. Validar cookie → asistente y sesión. Si no hay: 401.
2. Leer interruptores. Si `kill_switch = on`: 423 `{ error: 'mantenimiento', mensaje: 'El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.' }`.
3. Validar el último mensaje del usuario: 1–1.000 caracteres; rate limit 10/min por asistente (429).
4. `incrementarMensajes`; si supera `MAX_MENSAJES_ASISTENTE`: 429 `{ error: 'tope', mensaje: 'Llegaste al límite de preguntas de esta charla. Guarda tus dudas para la sesión de preguntas con Raúl.' }`.
5. Si el coste acumulado ≥ `PRESUPUESTO_MAX_USD` (vigente: 20 USD): activar `kill_switch` y responder 423.
6. Construir `RequestContext` con: `asistente_id`, `nombre_pila`, `rol`, `descripcion`, `rol_anonimo`, `lamina_actual`, `interruptores_activos` (lista), `version_instrucciones`.
7. `agent.stream(ultimoMensaje, { maxSteps: 5, memory: { resource: asistente_id, thread: thread_id }, requestContext, abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(20000)]) })`. Enviar solo el último mensaje: el historial lo aporta la memoria de Mastra.
   - **Desvío (Raúl, 2026-09-23):** el tope es de **45 s**, no 20 s (`TIEMPO_MAXIMO_TURNO_MS` en `lib/chat.ts`). Con `latencia_alta` una sola búsqueda puede tardar ~16 s. El turno se lanza con `ejecutarTurno` (T06), que ya hace `agent.stream`.
8. Convertir con `toAISdkStream(stream, { from: 'agent' })` (versión acorde al paquete `ai` instalado) y devolver `createUIMessageStreamResponse`.
9. Adjuntar `trace_id` en los metadatos del mensaje del asistente para el feedback.
10. Al terminar, sumar el coste estimado del uso (tokens × precio configurado en `lib/presupuesto.ts`).
11. Si el stream falla antes del primer token y T05 no pudo hacer el fallback dentro de Mastra, reintentar aquí con el modelo de respaldo. Si también falla, crear escalamiento `falla_tecnica` y devolver un mensaje fijo: "Tuve un problema técnico para responder. Tu pregunta quedó registrada para la sesión de preguntas."
   - **Desvío (T05):** el respaldo ya es nativo dentro del agente (gpt-6-luna → claude-sonnet-5); la ruta no reintenta. Si el turno falla antes del primer token, crea el escalamiento y devuelve el mensaje fijo.

## GET `/api/chat/historial`
Devuelve los mensajes del hilo desde la memoria de Mastra en formato de UI message para hidratar `useChat` al recargar.

## Checklist
- [x] Respuesta en streaming visible token a token con `curl -N`
- [ ] Primer token p95 < 3 s con 10 mensajes de prueba — **no se cumple** en vivo: p50 2,9 s, p95 6,7 s (ver `.claude/sessions/T09.md`)
- [x] Kill switch activo → 423 y no se genera traza del agente
- [x] Mensaje 31 del mismo asistente → 429 de tope
- [x] Al recargar, `historial` devuelve la conversación previa
- [x] Cancelar desde el cliente corta la generación (verificar en la traza)
