import type { Metadata } from "next";
import { SalaEnVivo } from "@/components/jev/sala-en-vivo";

export const metadata: Metadata = {
  title: "Jev · la sala en vivo",
  robots: { index: false, follow: false },
};

// Protegida por proxy.ts (Basic Auth, igual que el panel del speaker).
export default function PaginaJev() {
  return <SalaEnVivo />;
}
