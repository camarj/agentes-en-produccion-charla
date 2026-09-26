import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

// Tarjeta de contacto de Raúl para el QR de la charla: estática, con el
// diseño de la presentación y sin datos de asistentes.
export const metadata: Metadata = {
  title: "Raúl Camacho · CEO de Inteliside",
  description: "Redes sociales de Raúl Camacho, CEO de Inteliside.",
};

const REDES: { red: string; usuario: string; href: string }[] = [
  { red: "LinkedIn", usuario: "in/rauljcamacho", href: "https://www.linkedin.com/in/rauljcamacho" },
  { red: "Instagram", usuario: "@raulj.camacho", href: "https://www.instagram.com/raulj.camacho/" },
  { red: "X", usuario: "@rauljcamacho", href: "https://x.com/rauljcamacho" },
  { red: "Blog", usuario: "rauljcamacho.online", href: "https://rauljcamacho.online" },
];

export default function PaginaRedes() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 pt-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
      {/* Logo con fondo transparente: texto gris claro y triángulo turquesa, legible sobre negro. */}
      <Image
        src="/inteliside-logo-horizontal-fondo-blanco.webp"
        alt="Inteliside"
        width={372}
        height={124}
        priority
        className="mb-8 h-9 w-auto self-start"
      />
      <p className="font-mono text-sm text-muted-foreground">Charla · Inteliside</p>
      <h1 className="mt-2 text-[28px] leading-tight font-semibold sm:text-[32px]">Raúl Camacho</h1>
      <p className="mt-1 text-muted-foreground">CEO de Inteliside</p>

      <ul className="mt-8 space-y-3">
        {REDES.map(({ red, usuario, href }) => (
          <li key={red}>
            <a
              href={href}
              target="_blank"
              aria-label={`${red} · ${usuario} (se abre en una pestaña nueva)`}
              rel="noopener noreferrer"
              className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{red}</span>
                <span className="truncate font-mono text-sm text-muted-foreground">{usuario}</span>
              </span>
              <ArrowUpRight aria-hidden className="size-5 shrink-0 text-primary" />
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-10 font-mono text-xs text-muted-foreground">Cómo lograr que tus agentes sobrevivan a producción</p>
    </main>
  );
}
