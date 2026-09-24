# Agente demo · «Cómo lograr que tus agentes sobrevivan a producción»

Agente de chat para los 26 asistentes de la charla de Raúl Camacho (Inteliside). Entran por un QR, se identifican con su email y preguntan sobre la presentación. Todo el tráfico queda trazado y evaluado para la demo final, donde se muestran PRD, especificaciones, contrato, evals, observabilidad, resiliencia y guardrails con datos reales.

**Fecha límite:** la charla es en 3 días. Prioriza que funcione de punta a punta antes que pulir.

## Reglas para trabajar en este repo

1. Ejecuta **una tarea a la vez**, en orden, desde `.claude/tasks/`. Cada tarea es autocontenida: si algo no está en la tarea, no existe.
2. Una tarea termina cuando **todo su checklist pasa**. Marca cada casilla en el archivo de la tarea y deja una nota breve en `.claude/sessions/TNN.md` con lo que hiciste y cualquier desvío.
3. Si la API real de una librería difiere de lo escrito en la tarea, **gana la documentación oficial actual**. Adapta el código, conserva el comportamiento y anota el desvío en la sesión.
4. No agregues funcionalidades que no estén en una tarea. Fuera de alcance: autenticación fuerte, memoria entre sesiones, acciones externas, panel de administración de asistentes.
5. Todo texto visible al usuario va en **español neutro**. Los errores técnicos nunca se muestran al asistente.
6. Nunca registres emails ni nombres en logs ni trazas.

## Stack

| Capa | Tecnología |
| --- | --- |
| App | Next.js 16 (App Router), TypeScript estricto, Tailwind CSS, shadcn/ui |
| Agente | Mastra (`@mastra/core`, `@mastra/memory`, `@mastra/libsql`, `@mastra/ai-sdk`) |
| Evals y observabilidad | `@mastra/evals`, `@mastra/observability`, Mastra Studio autohospedado |
| Modelos | Principal `openai/gpt-6-luna`; respaldo `anthropic/claude-sonnet-5`. Guardrails y jueces `openai/gpt-6-luna` (respaldo `anthropic/claude-haiku-4-5`). Constantes en `src/mastra/modelos.ts`. Decisión de Raúl (2026-09-23): prevalece sobre los modelos que citen las tareas. |
| Datos | SQLite: `data/charla.db` (app, vía `@libsql/client`) y `data/mastra.db` (Mastra) |
| Búsqueda | SQLite FTS5 (sin embeddings) |
| UI de chat | `useChat` de AI SDK UI + stream de Mastra convertido con `toAISdkStream` |
| Despliegue | Dokploy: servicio `web` + servicio `studio`, volumen compartido `/app/data` |
| Gestor de paquetes | pnpm |

## Estructura

```
app/                 Next.js (page.tsx, panel/, api/)
components/ui/       shadcn
components/chat/     composer, mensajes, estados
src/mastra/          index.ts, agents/, tools/, processors/, scorers/
lib/db/              cliente SQLite, migraciones, repositorios
lib/session.ts       cookie de sesión firmada
evals/               charla-v1.json + runner
scripts/             importar-laminas, importar-inscritos, purgar-personales
data/                volumen (fuera de git)
```

## Identidad visual (tokens de la presentación)

`--bg #000000` · `--surface #0A0A0A` · `--fg #FFFFFF` · `--muted #A1A1AA` · `--border #27272A` · `--accent oklch(84% .16 215)` (solo foco, enlaces y enviar) · IBM Plex Sans / IBM Plex Mono. Tema oscuro único.

## Orden de tareas

| # | Tarea | Depende de |
| --- | --- | --- |
| T01 | Fundación del proyecto | — |
| T02 | Base de datos SQLite | T01 |
| T03 | Scripts de importación y purga | T02 |
| T04 | Herramientas del agente | T02 |
| T05 | Agente, instrucciones y memoria | T04 |
| T06 | Guardrails | T05 |
| T07 | Observabilidad y scorers | T05 |
| T08 | API de identificación, perfil, sugerencias y feedback | T02 |
| T09 | API de chat | T05, T06, T08 |
| T10 | UI de entrada y perfil | T08 |
| T11 | UI de chat | T09, T10 |
| T12 | Panel del speaker | T02, T09 |
| T13 | Runner de evals | T07, T09 |
| T14 | Despliegue en Dokploy y prueba de carga | todas |

T04 y T08 pueden avanzar en paralelo. T10 puede empezar con la API simulada.

## Comandos

```bash
pnpm dev                 # app en :3000
pnpm mastra:studio       # Studio en :4111
pnpm db:migrate          # migraciones de charla.db
pnpm importar:laminas <html>
pnpm importar:inscritos <csv|xlsx>
pnpm purgar:personales
pnpm evals               # dataset charla-v1; falla si no pasa los gates
pnpm test                # vitest
```
