import type { Metadata } from "next";
import Image from "next/image";
import { MENSAJE_DEMASIADOS_INTENTOS } from "@/lib/acceso";
import { ERRORES_CHAT } from "@/lib/chat";

// Página para los colaboradores de Raúl: la abren en su teléfono para mostrar
// el QR y resolver dudas de los asistentes. Estática y sin datos personales.
export const metadata: Metadata = {
  title: "QR y ayuda · Agentes en producción",
  robots: { index: false, follow: false },
};

const DIRECCION = "charla.codetrain.cloud";

const PASOS = [
  "Escanea el QR con la cámara del teléfono y abre el enlace.",
  "Escribe el email con el que te inscribiste en Luma y toca «Entrar».",
  "Si no estás inscrito, escribe tu email igual: te pedirá tu nombre y a qué te dedicas.",
  "Pregunta lo que quieras sobre la charla. El asistente cita la lámina de donde saca la respuesta.",
];

const PROBLEMAS: { situacion: string; ayuda: string }[] = [
  {
    situacion: "«Revisa tu correo: no parece una dirección válida.»",
    ayuda: "Revisa que el email no tenga espacios ni letras de más.",
  },
  {
    situacion: `«${MENSAJE_DEMASIADOS_INTENTOS}»`,
    ayuda: "Muchas personas entraron a la vez desde la misma red. Espera un minuto y vuelve a intentar.",
  },
  {
    situacion: `«${ERRORES_CHAT.mantenimiento}»`,
    ayuda: "Raúl pausó el asistente un momento. Vuelve solo, no hace falta recargar.",
  },
  {
    situacion: `«${ERRORES_CHAT.tope}»`,
    ayuda: "Cada persona tiene 30 preguntas. Las dudas pendientes se hacen en la sesión de preguntas.",
  },
  {
    situacion: "No aparece en su pantalla de inicio",
    ayuda: "Android: toca «Instalar app» en el chat. iPhone (Safari): Compartir → «Agregar a inicio».",
  },
  {
    situacion: "¿Qué hacen con mi email?",
    ayuda: "Solo se usa para personalizar las respuestas durante la charla.",
  },
];

export default function PaginaQr() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-5 pt-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
      <p className="font-mono text-sm text-muted-foreground">Charla · Inteliside</p>
      <h1 className="mt-2 text-2xl leading-tight font-semibold">Ayuda para asistentes</h1>

      <div className="mt-6 rounded-2xl bg-white p-3">
        <Image
          src="/qr-charla.svg"
          alt={`QR para entrar a ${DIRECCION}`}
          width={600}
          height={600}
          priority
          unoptimized
          className="h-auto w-full"
        />
      </div>
      <p className="mt-3 text-center font-mono text-lg">{DIRECCION}</p>

      <h2 className="mt-8 text-lg font-semibold">Cómo entrar</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        {PASOS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>

      <h2 className="mt-8 text-lg font-semibold">Si algo falla</h2>
      <dl className="mt-3 space-y-4">
        {PROBLEMAS.map(({ situacion, ayuda }) => (
          <div key={situacion} className="rounded-xl border border-border bg-card p-4">
            <dt className="font-medium">{situacion}</dt>
            <dd className="mt-1 text-muted-foreground">{ayuda}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 text-sm text-muted-foreground">
        Si nada de esto funciona, anota la pregunta de la persona para la sesión de preguntas con Raúl.
      </p>
    </main>
  );
}
