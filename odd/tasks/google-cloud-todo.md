# Todo en Google: Cloud Run + Cloud SQL (sin Neon, sin SQLite)

Objective: run the whole demo on Google Cloud for ESPOL (2026-11-25) and DevFest Guayaquil (2026-12-05): Gemini (done), hosting on Cloud Run, all storage on Cloud SQL for PostgreSQL. GCP project `eng-particle-514416-q3`.
Branch: `feat/google-cloud-todo` (from `feat/devfest-acceso-google-gemini`) · Delivery: ask-on-risk · Test runner: `pnpm test` (vitest) + `pnpm lint` + `pnpm exec next typegen && pnpm exec tsc --noEmit`.

## Specs

- **S1 — Everything on Google.** User (2026-11-11): "si vamos a usar Google, usemos Google para todo" · "La idea es que todo corre en Google. O sea, si la charla es del Google devfest, lo lógico es que si no estamos usando su framework de agentes, por lo menos usemos su infraestructura y su modelo." Neon is dropped: "ya no vamos a usar NeonDB, porque NeonDB me pone unos límites de consumo si no pago ... ya me pasó en el demo anterior que me quedé fuera de los límites y me dañó la presentación".
- **S2 — App database on Postgres.** Everything in `charla.db` (lib/db repositories, migrations, budget, scripts) runs on Cloud SQL for PostgreSQL. Existing behavior, Spanish texts and panel numbers keep their meaning; existing tests keep passing against Postgres semantics (tests may use an embedded Postgres such as PGlite instead of a temp SQLite file). Migrations are Postgres SQL, safe when several containers start at once (advisory lock).
- **S3 — Slide search on Postgres full text.** Replaces FTS5: Spanish, accent-insensitive, title weighted above body, same fallback order of queries; `buscar_laminas` tests and evals keep passing.
- **S4 — Mastra on Postgres.** Memory, scores, experiments and observability all in the same Cloud SQL database through `@mastra/pg`; no `data/mastra.db`, no `OBSERVABILIDAD_DATABASE_URL` pointing to Neon. Scripts that read Mastra tables (`reiniciar-charla`, experiments import/export) follow.
- **S5 — Cloud Run deploy.** Image without volume; services `web` (public, `charla.codetrain.cloud`) and `studio` (protected); secrets in Secret Manager; Cloud SQL connection from Cloud Run; one `web` instance minimum (no cold start) and a maximum chosen so in-memory limits/caches stay correct, or shared limits if more than one instance. DEPLOY.md rewritten for Cloud Run.
- **S6 — Proof.** Smoke test on the real URL (Google sign-in → question → Gemini answers → panel), load test, and PRD §15 row.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S2 | delegated (context backstop) | pending | |
| T2 | S3 | delegated (context backstop) | pending | |
| T3 | S4 | delegated (context backstop) | pending | |
| T4 | S5 | delegated + parent (gcloud) | pending | |
| T5 | S6 | parent | pending | |

Route evidence: the parent session is far past ~150k context tokens (long-session backstop); bounded writers implement T1–T4 code sequentially (shared files: lib/db, tests), the parent runs gcloud infra with the user's authorized account.

## Log

- L1 (2026-11-11, user, verbatim): "Eso lo dejamos al final. Quiero es que terminemos de integrar Google, todo el tema de la base de datos que vamos a usar de Google, todo eso. Acuérdate que ya no vamos a usar NeonDB, porque NeonDB me pone unos límites de consumo si no pago. Para el plan gratuito tengo unos límites y ya me pasó en el demo anterior que me quedé fuera de los límites y me dañó la presentación. Entonces lo que quiero es que usemos, si vamos a usar Google, usemos Google para todo."
- L2 (2026-11-11, user, verbatim): "La idea es que todo corre en Google. O sea, si la charla es del Google devfest, lo lógico es que si no estamos usando su framework de agentes, por lo menos usemos su infraestructura y su modelo. Eso es lo que quiero."
- L3: Map (explorer): ~60 SQL statements in 11 lib/db files + ~50 in scripts; SQLite-only SQL: `datetime('now')` TEXT dates parsed by `isoDeSqlite`, AUTOINCREMENT / rowid PKs (007, 008), `INSERT OR IGNORE`, `ORDER BY rowid` in sesiones, PRAGMA, `sqlite_master`, `VACUUM INTO`; transactions only via `c.batch`; `rowsAffected`; FTS5 `laminas_fts` with bm25(2,1,1) and unicode61 remove_diacritics; `@mastra/pg` 1.26.0 and `pg` 8.23.0 already installed; process-local state: 4 rate limiters, 2 s switch cache, 60 s attendee caches, 30 s probe, Jev singleton; entrypoint migrates on every start; 36 test files depend on temp SQLite via `lib/db/prueba.ts`.
- L4: Plan: keep the `FuenteDb`/`execute`/`batch` shape with a thin pg adapter (`?` → `$n`, batch → transaction, `rowsAffected`) so repositories change only dialect; one Postgres baseline migration (fresh database); tests on PGlite. Pending: user installs `gcloud` and logs in with the Inteliside account.
