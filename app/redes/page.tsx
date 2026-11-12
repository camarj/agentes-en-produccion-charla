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
  { red: "GitHub", usuario: "@camarj", href: "https://github.com/camarj" },
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
        className="mb-6 h-8 w-auto self-start"
      />

      {/* Retrato en blanco y negro sobre negro, como en la diapositiva de presentación del speaker. */}
      <figure>
        <div className="relative aspect-[16/11] w-full overflow-hidden">
          <Image
            src="/raul-camacho.jpg"
            alt="Retrato de Raúl Camacho"
            fill
            priority
            sizes="(max-width: 420px) 100vw, 380px"
            className="object-cover object-[50%_27%] contrast-[1.2]"
          />
        </div>
        <figcaption className="mt-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Infraestructura · IA · Software
        </figcaption>
      </figure>

      <h1 className="mt-7 text-[40px] leading-none font-semibold tracking-tight">Raúl Camacho</h1>
      <p className="mt-2 text-muted-foreground">CEO de Inteliside</p>

      <ul className="mt-7 border-b border-border">
        {REDES.map(({ red, usuario, href }) => (
          <li key={red} className="border-t border-border">
            <a
              href={href}
              target="_blank"
              aria-label={`${red} · ${usuario} (se abre en una pestaña nueva)`}
              rel="noopener noreferrer"
              className="group flex min-h-[52px] items-center justify-between gap-4 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="font-medium transition-colors group-hover:text-primary">{red}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-sm text-muted-foreground">{usuario}</span>
                <ArrowUpRight aria-hidden className="size-4 shrink-0 text-primary" />
              </span>
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-8 font-mono text-xs leading-relaxed text-muted-foreground">
        Cómo lograr que tu agente de IA sobreviva en producción
      </p>
    </main>
  );
}
