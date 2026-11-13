import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": raiz },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".mastra/**"],
    // PGlite (Postgres embebido de los tests) se inicializa una vez por corrida.
    globalSetup: ["./lib/db/prueba-global.ts"],
    // Arrancar PGlite en cada proceso de tests toma ~1 s (más con la máquina cargada).
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
