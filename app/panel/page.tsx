import type { Metadata } from "next";
import { connection } from "next/server";
import { Panel } from "@/components/panel/panel";
import { urlStudio } from "@/lib/panel/studio";

export const metadata: Metadata = {
  title: "Panel del speaker",
  robots: { index: false, follow: false },
};

// Protegida por proxy.ts (Basic Auth). Se renderiza en cada petición para leer
// STUDIO_URL del entorno en ejecución, no del momento del build.
export default async function PaginaPanel() {
  await connection();
  return <Panel studioUrl={urlStudio(process.env.STUDIO_URL)} />;
}
