# T08 · API de identificación, perfil, sugerencias y feedback

> **Actualización 2026-09-25 — requisitos vigentes:**
> - **Identificación:** 60 intentos por minuto por IP (antes 10), porque el Wi-Fi de la sala comparte una IP.
> - **Tramos** (40 láminas): 1–13 Conceptos · 14–32 Decisión y diseño · 33–40 En producción. Se definen solo en `lib/tramos.ts`. El chat pide las sugerencias cada 5 s, sin caché.
> - **Feedback:** se guarda en la tabla `feedback` de `charla.db` (un voto por asistente y traza, el último reemplaza al anterior) y se copia a la observabilidad de Mastra solo si hay Neon (`OBSERVABILIDAD_DATABASE_URL`).
> - El speaker no es asistente (25 inscritos).
>
> Fuente de verdad de los cambios: PRD §15 «Registro de cambios de requisitos». El texto de abajo es el plan original y se conserva como historial; donde choca con esta lista, gana esta lista.

**Objetivo:** Implementar el acceso por email con sesión en cookie, la captura de perfil, las sugerencias iniciales y el registro de feedback.

**Cubre:** RF-01, RF-02, RF-09, RF-13.

## Archivos
- `lib/session.ts` — cookie `sesion` httpOnly, `secure`, `sameSite=lax`, 12 h; valor = token firmado con HMAC-SHA256 (`SESSION_SECRET`)
- `lib/rate-limit.ts` — limitador en memoria por clave (IP o asistente)
- `app/api/identificar/route.ts`
- `app/api/perfil/route.ts`
- `app/api/sugerencias/route.ts`
- `app/api/feedback/route.ts`
- `app/api/sesion/route.ts` — GET, devuelve estado de la sesión actual para el cliente

## Contratos
| Ruta | Entrada | Salida 200 | Errores |
| --- | --- | --- | --- |
| POST `/api/identificar` | `{ email }` | `{ estado: 'listo' \| 'falta_perfil' \| 'nuevo', nombre_pila? }` + cookie | 400 `email_invalido`, 429 |
| POST `/api/perfil` | `{ nombre?, rol (2–120), descripcion? (≤ 300, qué construye con IA) }` | `{ ok: true, nombre_pila }` | 400, 401 |
| GET `/api/sesion` | — | `{ autenticado, estado, nombre_pila? }` | — |
| GET `/api/sugerencias` | — | `{ sugerencias: string[3] }` | 401 |
| POST `/api/feedback` | `{ trace_id, valor: 1 \| -1 }` | `{ ok: true }` | 400, 401 |

## Lógica
1. **identificar:** validar email con zod; rate limit ~~10/min~~ **60/min** por IP. Buscar asistente. Si existe con rol → `listo`. Si existe sin rol → `falta_perfil`. Si no existe → crear invitado con `nombre = ''` y devolver `nuevo`. En todos los casos crear sesión y setear cookie. `nombre_pila` = primera palabra del nombre. **Nunca** devolver rol, descripción ni email.
2. **perfil:** requiere sesión. Para `nuevo`, `nombre` es obligatorio. Guarda y responde `nombre_pila`.
3. **sugerencias:** lee `lamina_actual` y devuelve 3 preguntas de una tabla fija en código por tramos: 1–13 (conceptos: agente, loop, harness), ~~14–31~~ **14–32** (decisión, PRD, patrones), ~~32–39~~ **33–40** (resiliencia, guardrails, evals, observabilidad).
4. **feedback:** requiere sesión; **vigente:** guarda en `charla.db` (tabla `feedback`) y luego llama `createFeedback` de la observabilidad de Mastra con `feedbackType: 'rating'`, `feedbackSource: 'user'` anclado al `trace_id`.
5. Respuestas de error con forma `{ error: codigo, mensaje }` en español.

## Checklist
- [x] Email inscrito con rol → `listo` y cookie seteada
- [x] Email inscrito sin rol → `falta_perfil`
- [x] Email desconocido → `nuevo`; tras `/api/perfil` con nombre y rol queda `listo`
- [x] La respuesta de `/api/identificar` nunca incluye rol, descripción ni email
- [x] 11 intentos en un minuto desde la misma IP → 429 (Raúl lo subió a 60/min el 2026-09-23: el intento 61 es el que da 429)
- [x] Cookie manipulada → 401
