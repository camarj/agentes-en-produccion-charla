# DevFest: acceso con Google, sesión única y Gemini

Objective: get the demo ready for the ESPOL talk (2026-11-25) and Google DevFest Guayaquil (2026-12-05, 1000+ attendees). Stage 1 = access security + Gemini.
Branch: `feat/devfest-acceso-google-gemini` · Delivery: ask-on-risk · Test runner: `pnpm test` (vitest).

## Specs

- **S1 — One session per attendee, proven by Google.** User: "cualquier asistente que pueda tener el email de otro podria abrir otra sesion lo ideal es que sea una sesion por asistente por medio de su email." Decision (2026-11-10): "si solo lo que escanee el qr con google" → anyone who scans the QR and signs in with a Google account may enter (no registration list required). The server must verify the Google ID token (audience = our OAuth client ID, `email_verified` true) and never trust a typed email.
- **S2 — Single active session.** Signing in again revokes the attendee's previous sessions (their old cookie stops working). The per-attendee message counter and conversation thread are preserved.
- **S3 — Shared venue Wi‑Fi must not block entry.** The current 60/min per IP limit would block hundreds of people behind one public IP. Replace with a high per-IP flood limit plus a per-Google-account limit.
- **S4 — Models.** User: "el modelo principal sera el de gemini y el secundario openai." Primary `gemini-3.8-flash` (GA on Vertex AI, location `global`) via Vertex so GCP credits apply; fallback `openai/gpt-6-luna`. Assumption: guardrails/judges stay on `openai/gpt-6-luna` (fallback Haiku) until measured.
- **S5 — Records.** Every requirement change goes into PRD §15 (project rule 7); `.env.example` and `DEPLOY.md` list the new variables.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S2 | inline | done | RED 2 failing → GREEN; `lib/db/sesiones.test.ts` |
| T2 | S1, S3 | inline | done | RED 33/8 failing → GREEN; full suite 1002 passed, lint and tsc clean |
| T3 | S4 | inline | done | RED 4 → GREEN; HTTP-level fallback tests (Vertex express + OpenAI) pass; suite 1006 passed |
| T4 | S5 | inline | done (except `.env.example`: access denied) | PRD §15 G1–G5, DEPLOY.md, .claude/CLAUDE.md, dataset 1.6.0 |

Route evidence: no writer trigger (sequential, shared files); parent works inline.

## Log

- L1 (2026-11-10, user, verbatim): "Hola te omento que esta demo la vamos a usar para el google devday fast de guayaquil para la charla que voy a dar. y tenemos que mejorar algunas cosas de seguridad y base de datos. Lo primero es que cualquier asistente que pueda tener el email de otro podria abrir otra sesion lo ideal es que sea una sesion por asistente por medio de su email. Lo otro es que el plan de neon nos quedo corta para la charla pasada solo con 13 personas que asistieron para este evento posiblemente haya mas de 1000 personas como el evento es de google quiero hacer varias cosas la primera es que la bd que quiero usar es una bd de google en gcp y lo otro el modelo principal sera el de gemini y el secundario openai. Y a lo mejor tambien migrar donde se hosteara la aplicacion que propones y opinas."
- L2 (2026-11-10, user): "la charla pequena es el 25 de noviembre si solo lo que escanee el qr con google, si te autorizo". Authorized stage 1 (Google sign-in, single session, Wi‑Fi limit, Gemini). Stage 3 (Cloud SQL, Cloud Run, load test) comes later.
- L3: Notes. The 20 USD global budget cap (PRD #4) will pause the agent with 1000+ attendees; revisit in stage 3. GCP free trial credit stops covering Vertex Gemini for sign-ups/upgrades on or after 2026-11-16.
- L4 (2026-11-10): T1+T2 implemented. Google ID token verified with `google-auth-library` 11.3.4 (`lib/google.ts`); `/api/identificar` takes `{ credencial }`; `sesiones.reemplazar` revokes previous sessions; limits 600/min per IP + 10/min per Google account; `pnpm carga` creates sessions in DB. PRD §15 G1–G4. `.env.example` not updated: read access denied by user settings — user must add `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Pending: OAuth client ID from the user (GCP console) for a real end-to-end check.
- L5 (2026-11-10): Independent verifier on 7d6b742: no blockers; S1–S3 pass. Advisories applied: `/qr` page instructions now describe Google sign-in; per-IP entry limit raised 600 → 2000/min. Advisories left: in-memory limiters are per instance (stage 3, Cloud Run); `pnpm carga` no longer exercises the Google entry.
- L6 (2026-11-10): T3 done. Primary `google-vertex/gemini-3.8-flash` built per turn (`model: () => modeloPrincipal()`) so the app boots without Vertex credentials; thinkingLevel `low`; fallback `openai/gpt-6-luna` effort `low`. Price 0.75/0.075/3.75 USD per 1M (intro until 2026-12-31). Not verified against the real Vertex API: needs the user's GCP project. Risk for stage 3: 20 USD budget cap vs ~7x price and 1000+ attendees.
- L7 (2026-11-10, user): "si, baja el tope a 15 y sube a 120". Default per-attendee cap 30 → 15 (`MAX_MENSAJES_POR_DEFECTO`), `PRESUPUESTO_MAX_USD` documented as 120 (env value, set at deploy). PRD §15 G6. `.env.example` still lists `MAX_MENSAJES_ASISTENTE=30`: read access denied, user must edit. Stage 3 note: panel trace metrics read at most 2000 turns (`lib/panel/metricas-trazas.ts`); DevFest may reach ~3600.
