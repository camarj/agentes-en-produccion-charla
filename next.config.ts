import type { NextConfig } from "next";

// Versión de este build (lib/version-app.ts). Se fija una sola vez en
// process.env para que los procesos hijos del build (que heredan el entorno y
// vuelven a cargar este archivo) usen la misma. `env` la escribe tal cual en el
// bundle del cliente y en el del servidor.
process.env.VERSION_APP ||= new Date().toISOString();

const nextConfig: NextConfig = {
  output: "standalone",
  env: { VERSION_APP: process.env.VERSION_APP },
  serverExternalPackages: ["@mastra/*", "@libsql/client", "libsql"],
  // Service worker (guía de PWA de Next 16): nunca en caché HTTP, para que una
  // versión nueva llegue en la siguiente visita; y solo scripts del propio sitio.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
