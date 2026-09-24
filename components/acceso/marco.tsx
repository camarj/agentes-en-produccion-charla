import { cn } from "@/lib/utils";

// Anillo de foco visible en el color de acento, separado del control por un
// borde negro para que también se vea sobre el botón de acento.
export const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Layout de las pantallas de acceso: centrado en 100dvh, 20 px a los lados,
// ancho máximo 420 px y respeta las zonas seguras (notch, barra de inicio).
export function Marco({ children, className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "flex min-h-dvh w-full flex-1 flex-col items-center justify-center",
        "pt-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]",
        "pl-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))]",
        className,
      )}
      {...props}
    >
      <div className="w-full max-w-[420px]">{children}</div>
    </main>
  );
}

export function Eyebrow() {
  return <p className="font-mono text-sm text-muted-foreground">Charla · Inteliside</p>;
}

// En móvil, al abrir el teclado, asegura que el control (p. ej., el botón de
// enviar) quede visible. Espera a que el teclado termine de aparecer.
export function mostrarAlAbrirTeclado(elemento: HTMLElement | null) {
  window.setTimeout(() => elemento?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 300);
}
