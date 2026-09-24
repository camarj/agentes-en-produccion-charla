import type { MetadataRoute } from "next";

// Manifiesto de la app instalable (Next sirve esto en /manifest.webmanifest).
// Íconos en public/icons/, generados con `pnpm iconos`.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agentes en producción · Charla",
    short_name: "Agentes",
    description: "Asistente de la charla «Cómo lograr que tus agentes sobrevivan a producción».",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "es",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
