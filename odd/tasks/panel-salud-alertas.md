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
  `19:42:10  🟠 Gemini respondió 503 → respondió OpenAI      [ver traza]`
  `19:42:31  🟠 Gemini: límite de uso (429) ×12 en 1 min      [ver traza]`
  `19:43:05  🔴 buscar_laminas agotó 3 intentos              [ver traza]`
  `19:44:00  🟢 Gemini se recuperó`
  Repeated events of the same kind within a short window are grouped (×N) instead of flooding the log. Real failures are recorded exactly like simulated ones. Events never contain emails, names or question text; technical error text is never shown (only a short Spanish label).
- **S4 — Two new chaos switches.** User approved: «Límite de Gemini» — the primary model fails with a simulated Google usage-limit error (HTTP 429, `RESOURCE_EXHAUSTED`, retryable) without calling the provider, so Mastra falls back to OpenAI; «Base de datos lenta» — adds a fixed delay (suggested 1.5 s) to app DB queries so latency rises and the DB light turns amber. Both appear in the panel's switch list like the existing ones (`herramienta_caida`, `latencia_alta`, `modelo_caido`, `modelos_caidos`, `kill_switch`), default off, with a migration seeding them, and `pnpm reiniciar:charla` turns them off.
- **S5 — Records.** PRD §15 gets a new row (G7) for this change; DEPLOY.md/README notes if any env var changes; the demo script note in PRD §12 may mention the new switches.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S1 | delegated (context backstop) | pending | |
| T2 | S2, S3 | delegated (context backstop) | pending | |
| T3 | S4 | delegated (context backstop) | pending | |
| T4 | S5 | delegated (context backstop) | pending | |

Route evidence: the parent session passed ~150k context tokens (long-session backstop); one bounded writer implements T1–T4 sequentially with one commit per task.

## Log

- L1 (2026-11-10, user, verbatim): "Esto tambien hay que corregirlo y ver que otra cosa se puede mostrar en el panel del speaker como alertas en rate limits, del modelo de db u otro servicio que afecte al agente. Lo que quiero es que si falla algo sea parte del demo y se pueda capturar y que muetre la observabilidad y la resiliencia"
- L2 (2026-11-10, user, verbatim): "si apruebo, agrega los dos interruptores si" — approves the design (DB-backed metrics, traffic lights, event log with trace link) and both switches.
- L3: Context. Primary model is `google-vertex/gemini-3.8-flash` (fallback `openai/gpt-6-luna`); chaos is applied in `src/mastra/processors/fallback-modelo.ts` (`crearErrorSobrecarga`, `crearModeloCaido`). Guardrail signals already in trace metadata: `alcance_falla_abierta`, `falla_detector`; tool signal `falla_herramienta`. Rate limiters in `lib/rate-limit.ts`; DB errors surface through `errorInterno(ruta, error)` in `lib/respuestas.ts`; feedback→observability failures in `app/api/feedback/route.ts`; budget in `lib/presupuesto.ts`. Stage 3 will move `charla.db` to Cloud SQL Postgres: keep new SQL portable (no SQLite-only functions where avoidable).
