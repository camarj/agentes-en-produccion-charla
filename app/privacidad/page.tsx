import type { Metadata } from "next";
import Link from "next/link";

// Política de privacidad que exige Google Auth Platform para publicar el
// acceso con Google. Estática y sin datos de asistentes. Responsable: Raúl
// Camacho a título personal (sin vincularla con ninguna empresa).
export const metadata: Metadata = {
  title: "Política de privacidad · Demo de agentes en producción",
  description: "Qué datos usa la demo de la charla, para qué, con quién se comparten y cuándo se borran.",
};

const CORREO = "raulj.camacho@gmail.com";

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <div className="mt-2 space-y-2 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PaginaPrivacidad() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-5 pt-[max(32px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))] leading-relaxed">
      <p className="font-mono text-sm text-muted-foreground">charla.codetrain.cloud</p>
      <h1 className="mt-2 text-[28px] leading-tight font-semibold sm:text-[32px]">Política de privacidad</h1>
      <p className="mt-3 text-muted-foreground">
        Esta página explica cómo la demo de la charla «Cómo lograr que tus agentes sobrevivan a producción» usa tus
        datos. El responsable es Raúl Camacho, speaker de la charla.
      </p>

      <Seccion titulo="Qué datos usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu nombre y tu correo de Google, solo cuando entras con tu cuenta. No recibimos tu contraseña.</li>
          <li>Las preguntas que escribes o dictas al asistente y sus respuestas.</li>
          <li>Tus votos (pulgar arriba o abajo) sobre las respuestas.</li>
          <li>Datos técnicos sin identificarte: tiempos de respuesta, errores y qué modelo respondió.</li>
        </ul>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <p>
          Para que puedas usar el asistente durante la charla, para evitar que alguien entre con la cuenta de otra
          persona y para mostrar en vivo, en la demo, cómo se observa y se mide un agente en producción. En la pantalla
          de la charla nunca se muestran nombres ni correos.
        </p>
      </Seccion>

      <Seccion titulo="Con quién se comparten">
        <p>
          Tus preguntas se envían a Google (Gemini) para generar la respuesta y, si Gemini no responde, a OpenAI como
          respaldo. Si dictas por voz, el audio se envía a OpenAI para convertirlo en texto. Un extracto corto y sin
          datos personales de algunas preguntas se envía a TypeSafe para medir el ánimo de la sala.
        </p>
        <p>No vendemos ni compartimos tus datos con nadie más, ni los usamos para publicidad.</p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los guardamos">
        <p>
          Tu nombre y tu correo se borran a más tardar 30 días después de la última charla en la que se usa la demo.
          Las conversaciones y los datos técnicos, ya sin tu nombre ni tu correo, se conservan hasta 90 días para
          analizar la charla y luego se borran.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>
          Puedes pedir en cualquier momento que borremos tus datos o saber qué guardamos de ti escribiendo a{" "}
          <a href={`mailto:${CORREO}`} className="text-primary underline-offset-4 hover:underline">
            {CORREO}
          </a>
          . Respondemos en un máximo de 15 días.
        </p>
      </Seccion>

      <p className="mt-10 font-mono text-xs text-muted-foreground">Última actualización: 11 de noviembre de 2026</p>
      <Link href="/" className="mt-4 inline-block text-primary underline-offset-4 hover:underline">
        Volver a la demo
      </Link>
    </main>
  );
}
