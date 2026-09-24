# T01 · Fundación del proyecto

**Objetivo:** Crear el proyecto Next.js 16 con TypeScript, Tailwind, shadcn y Mastra instalados, los tokens visuales de la charla aplicados y la estructura de carpetas lista.

**Cubre:** base para todas las tareas.

## Archivos
- `package.json`, `tsconfig.json`, `next.config.ts` (`output: 'standalone'`)
- `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder)
- `components/ui/*` (shadcn)
- `src/mastra/index.ts` (instancia vacía de Mastra)
- `.env.example`, `.gitignore` (incluye `data/`)
- `Dockerfile`

## Lógica
1. Crear el proyecto con `create-next-app` (App Router, TS, Tailwind, ESLint, sin `src/app`; la app vive en `app/`).
2. Instalar dependencias: `@mastra/core @mastra/memory @mastra/libsql @mastra/ai-sdk @mastra/evals @mastra/observability @mastra/loggers @libsql/client ai @ai-sdk/react zod` y en desarrollo `mastra vitest tsx`.
3. Inicializar shadcn con tema oscuro y agregar: `button textarea input card badge scroll-area sonner switch separator tooltip dropdown-menu skeleton`.
4. En `globals.css` definir variables CSS con los tokens (`--bg #000000`, `--surface #0A0A0A`, `--fg #FFFFFF`, `--muted #A1A1AA`, `--border #27272A`, `--accent oklch(84% .16 215)`) y mapearlas a las variables de shadcn (`--background`, `--foreground`, `--card`, `--border`, `--ring`, `--primary` = accent). Un solo tema oscuro; `html` con `class="dark"` y `color-scheme: dark`.
5. Cargar IBM Plex Sans (400, 500, 600) e IBM Plex Mono (400, 500) con `next/font/google`, exponerlas como `--font-sans` y `--font-mono`.
6. En `layout.tsx`: `lang="es"`, metadata con el título de la charla, `viewport` con `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`, `themeColor #000000`.
7. `src/mastra/index.ts` exporta `mastra = new Mastra({ storage: new LibSQLStore({ id: 'mastra-storage', url: process.env.MASTRA_DB_URL ?? 'file:./data/mastra.db' }) })`.
8. Scripts en `package.json`: `dev`, `build`, `start`, `mastra:studio` (`mastra studio`), `test` (`vitest run`). Los demás se agregan en sus tareas.
9. `.env.example` con: `ANTHROPIC_API_KEY`, `DATABASE_PATH=./data/charla.db`, `MASTRA_DB_URL=file:./data/mastra.db`, `PANEL_PASSWORD`, `SESSION_SECRET`, `MAX_MENSAJES_ASISTENTE=30`, `PRESUPUESTO_MAX_USD`, `PUBLIC_URL`.
10. `Dockerfile` multi-stage (node:22-alpine, pnpm, build standalone), `WORKDIR /app`, `VOLUME /app/data`, expone 3000.

## Checklist
- [x] `pnpm dev` levanta la app en :3000 con fondo negro e IBM Plex Sans
- [x] `pnpm build` termina sin errores de tipos
- [x] `pnpm mastra:studio` abre Studio sin errores
- [x] `docker build .` genera la imagen
- [x] `data/` está en `.gitignore`

## Comandos
```bash
pnpm create next-app@latest . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*"
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button textarea input card badge scroll-area sonner switch separator tooltip dropdown-menu skeleton
```

## Notas
- Si `mastra studio` requiere un entrypoint distinto, configúralo apuntando a `src/mastra/index.ts` y anótalo en la sesión.
