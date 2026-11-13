# Panel del speaker: métricas sin tope, salud del sistema y alertas

Objective: the speaker panel must stay complete and cheap with 1000+ attendees (DevFest 2026-12-05) and turn every failure (simulated or real) into a visible, traceable demo of observability and resilience.
Branch: `feat/devfest-acceso-google-gemini` (continues after 4299f50) · Delivery: ask-on-risk · Test runner: `pnpm test` (vitest), plus `pnpm lint` and `pnpm exec next typegen && pnpm exec tsc --noEmit`.

## Specs

- **S1 — Complete metrics without a cap.** The panel today re-reads every trace of the last 12 h on each poll and stops at 2000 turns (`lib/panel/metricas-trazas.ts`, `PAGINAS_MAXIMAS = 20`); DevFest may reach ~3600 turns. User (2026-11-10): "Esto tambien hay que corregirlo". Approved design: when a chat turn ends, the app writes one short row to its own DB (`charla.db`, new migration): start time, duration, outcome (ok / bloqueo / falla), failure type, model that answered, fallback used, trace id. Never emails, names or question text. Panel counters (turnos, latencia p50/p95 última hora, fallas técnicas y su desglose, bloqueos por motivo, respaldo última hora, modelo en uso/última respuesta) come from SQL aggregates with no cap. Eval traffic (`esTrazaDeEval`/origin eval) stays excluded as today. Existing panel numbers and labels keep their meaning; existing tests for them must keep passing (adapt only the data source).
- **S2 — "Salud del sistema" with a traffic light per service.** User: "ver que otra cosa se puede mostrar en el panel del speaker como alertas en rate limits, del modelo de db u otro servicio que afecte al agente. Lo que quiero es que si falla algo sea parte del demo y se pueda capturar y que muetre la observabilidad y la resiliencia". Approved table (green / amber / red):
  - Gemini (principal): responds / errors or Google usage limit 429 → fallback answered / —
  - OpenAI (respaldo): idle or responding / isolated errors / also down → technical failure + escalation
  - Base de datos: ok / slow queries / errors (routes return 500)
  - Trazas / observabilidad: ok / a trace or vote could not be saved / no connection
  - Búsqueda de láminas: ok / retries / exhausted 3 attempts
  - Guardrails: ok / scope classifier timed out and let it through (fail-open) / injection detector failed and blocked (fail-closed)
  - Entrada y límites: ok / people stopped by rate limits (entry, chat, dictation) / —
  - Presupuesto: < 70 % / 70–90 % / exhausted → chat paused
  States are computed from recent events (suggested window: last 5 minutes) and return to green on their own when events stop.
- **S3 — Live event log.** Below the traffic lights, newest first, each line with time, colored level, Spanish text and a "ver traza" link to Mastra Studio when there is a trace id (Studio URL from `STUDIO_URL`, same as the existing "Abrir Mastra Studio" link). Examples approved by the user:
  `19:42:10  🟠 Gemini con alta demanda (503) → respaldo activo      [ver traza]`
  `19:42:31  🟠 Gemini: límite de uso (429) ×12 en 1 min      [ver traza]`
  `19:43:05  🔴 buscar_laminas agotó 3 intentos              [ver traza]`
  `19:44:00  🟢 Gemini responde de nuevo`
  Repeated events of the same kind within a short window are grouped (×N) instead of flooding the log. Real failures are recorded exactly like simulated ones. Events never contain emails, names or question text; technical error text is never shown (only a short Spanish label).
- **S4 — Two new chaos switches.** User approved: «Límite de Gemini» — the primary model fails with a simulated Google usage-limit error (HTTP 429, `RESOURCE_EXHAUSTED`, retryable) without calling the provider, so Mastra falls back to OpenAI; «Base de datos lenta» — adds a fixed delay (suggested 1.5 s) to app DB queries so latency rises and the DB light turns amber. Both appear in the panel's switch list like the existing ones (`herramienta_caida`, `latencia_alta`, `modelo_caido`, `modelos_caidos`, `kill_switch`), default off, with a migration seeding them, and `pnpm reiniciar:charla` turns them off.
- **S5 — Records.** PRD §15 gets a new row (G7) for this change; DEPLOY.md/README notes if any env var changes; the demo script note in PRD §12 may mention the new switches.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S1 | delegated (context backstop) | done | RED: `lib/db/turnos.test.ts` (module missing), `turno.test.ts` desenlace ×4, `fin-turno.test.ts`, chat/panel/reiniciar tests failing → GREEN: 100 files / 1030 tests, lint and tsc clean. Commit: `17c74b9` |
| T2 | S2, S3 | delegated (context backstop) | done | RED: `eventos-salud.test.ts` (module missing), chat/api/transcribir/respuestas event assertions, `/api/panel/salud` route missing, panel UI salud tests, studio link tests, reiniciar → GREEN: 104 files / 1053 tests, lint and tsc clean. Commit: `8555106` |
| T3 | S4 | delegated (context backstop) | done | RED: `crearErrorLimiteUso` missing, seeded switches, `db-lenta.test.ts` (module missing), panel API/UI switch tests → GREEN: 105 files / 1062 tests, lint and tsc clean. Commit: `d7adb86` |
| T4 | S5 | delegated (context backstop) | done | Docs only (no runnable RED): PRD §15 G7 row, §12 switches and «Salud del sistema» note, DEPLOY.md `STUDIO_URL` row. Suite re-run green. Commit: the commit that adds L10 |

Route evidence: the parent session passed ~150k context tokens (long-session backstop); one bounded writer implements T1–T4 sequentially with one commit per task.

## Log

- L1 (2026-11-10, user, verbatim): "Esto tambien hay que corregirlo y ver que otra cosa se puede mostrar en el panel del speaker como alertas en rate limits, del modelo de db u otro servicio que afecte al agente. Lo que quiero es que si falla algo sea parte del demo y se pueda capturar y que muetre la observabilidad y la resiliencia"
- L2 (2026-11-10, user, verbatim): "si apruebo, agrega los dos interruptores si" — approves the design (DB-backed metrics, traffic lights, event log with trace link) and both switches.
- L3: Context. Primary model is `google-vertex/gemini-3.8-flash` (fallback `openai/gpt-6-luna`); chaos is applied in `src/mastra/processors/fallback-modelo.ts` (`crearErrorSobrecarga`, `crearModeloCaido`). Guardrail signals already in trace metadata: `alcance_falla_abierta`, `falla_detector`; tool signal `falla_herramienta`. Rate limiters in `lib/rate-limit.ts`; DB errors surface through `errorInterno(ruta, error)` in `lib/respuestas.ts`; feedback→observability failures in `app/api/feedback/route.ts`; budget in `lib/presupuesto.ts`. Stage 3 will move `charla.db` to Cloud SQL Postgres: keep new SQL portable (no SQLite-only functions where avoidable).
- L4 (2026-11-10, writer): T1 done. New table `turnos` (migration 007, epoch-ms integers, portable SQL); the chat route writes one row when each turn closes (`lib/salud/fin-turno.ts` + per-turn signals in the requestContext from FallbackModelo and buscar_laminas); `/api/panel/metricas` reads `turnos.resumen()` (SQL aggregates, percentiles via ORDER BY … LIMIT 1 OFFSET k, no cap). `lib/panel/observabilidad.ts` removed; trace classifiers stay for Jev. `pnpm reiniciar:charla` also clears `turnos`. Eval traffic stays out because evals never write through the production route DB.
- L5 (2026-11-10, writer): T1 commit `17c74b9`.
- L6 (2026-11-10, writer): T2 done. Migration 008 `eventos_salud` (grouped ×N within 1 min); `lib/salud/catalogo.ts` (8 services, event types, Spanish texts, light rules: worst event in the last 5 min after the last recovery; budget by percentage); events come from the chat route (fallback cause, both models down, search retries/exhausted, scope fail-open, injection fail-closed, chat rate limit, budget exhausted), `/api/identificar` and `/api/transcribir` rate limits, `/api/feedback` observability failure, `errorInterno` (500 → DB red) and a 30 s observability probe. New `GET /api/panel/salud` and «Salud del sistema» column with «ver traza» → `${STUDIO_URL}/traces?traceId=…`. Deviation: a real Gemini failure is logged as «Cambio al respaldo: respondió OpenAI» (no status code), because reading the provider error would need changes to the model chain, which is out of scope.
- L7 (2026-11-10, writer): T2 commit `8555106`.
- L8 (2026-11-10, writer): T3 done. Migration 009 seeds `limite_gemini` and `base_datos_lenta` (off). «Límite de Gemini»: FallbackModelo swaps the primary for a model that throws a simulated 429 `RESOURCE_EXHAUSTED` (retryable) without calling Google; Mastra retries once and falls back; the turn signal carries cause `limite_uso` → event «Límite de uso del proyecto alcanzado (429) → respaldo activo». «Base de datos lenta»: the app's charla.db client (`db` in `lib/db/client.ts`) is wrapped by `lib/salud/db-lenta.ts`; with the switch on each execute/batch waits 1.5 s; any query over 1 s (simulated or real) logs `db_lenta` (at most once per 5 s). The switch value reaches the wrapper through `interruptores.obtenerTodos` (`alLeer`). Both switches show in the panel and `pnpm reiniciar:charla` turns them off. Decision: the new keys live in `CLAVES_CAOS_G7`/`InterruptoresCompletos` instead of `Interruptores`, so eval and test fixtures outside the authorized surfaces did not need edits.
- L9 (2026-11-10, writer): T3 commit `d7adb86`.
- L10 (2026-11-10, writer): T4 done. PRD §15 G7, §12 notes, DEPLOY.md (`STUDIO_URL` also feeds «ver traza»; no new env vars; migrations 007–009 run on start with `pnpm db:migrate`). Pending follow-ups: real Gemini failures show without status code; the trace-reading code in `lib/panel/metricas-trazas.ts` (`leerMetricasTrazas`) is no longer used by the panel.
- L-texto (2026-11-10, user, verbatim): "Es muy agrecivo decir en un evento de google que geminis fallo podria ser una frase menos dura?" — panel texts reworded around resilience: «Límite de uso del proyecto alcanzado (429) → respaldo activo», «Gemini con alta demanda (503) → respaldo activo», «Cambio al respaldo: respondió OpenAI», «Gemini responde de nuevo», «Ningún modelo disponible → falla técnica y escalamiento».
