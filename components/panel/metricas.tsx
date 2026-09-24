import { desgloseFallas, etiquetaMotivoBloqueo, horaCorta, latencia, SIN_DATO, usd } from "@/lib/panel/formato";
import type { MetricasPanel } from "@/lib/panel/tipos";
import { cn } from "@/lib/utils";

// Tarjeta de una métrica: título legible desde el fondo y valor de 40 px en mono.
function Metrica({
  titulo,
  children,
  detalle,
  className,
}: {
  titulo: string;
  children: React.ReactNode;
  detalle?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      role="group"
      aria-label={titulo}
      className={cn("flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4", className)}
    >
      <h3 className="text-lg leading-tight text-muted-foreground">{titulo}</h3>
      <div className="flex items-baseline gap-2 font-mono text-[40px] leading-none tabular-nums">{children}</div>
      {detalle ? <div className="text-base text-muted-foreground">{detalle}</div> : null}
    </section>
  );
}

export function Metricas({ datos }: { datos: MetricasPanel }) {
  const obs = datos.observabilidad;
  const motivos = obs.disponible
    ? Object.entries(obs.bloqueos.por_motivo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];
  const desglose = obs.disponible ? desgloseFallas(obs.errores_por_tipo) : null;
  // Respuestas que dio el modelo de respaldo porque el principal falló.
  const respaldo = obs.disponible
    ? obs.respaldo.ultima_en
      ? `última hora · la última a las ${horaCorta(obs.respaldo.ultima_en)}`
      : "última hora"
    : undefined;

  return (
    <div className="grid grid-cols-5 gap-4">
      <Metrica titulo="Asistentes activos" detalle="con al menos un mensaje">
        <span>{datos.asistentes.con_mensajes}</span>
        <span className="text-2xl text-muted-foreground">/ {datos.asistentes.registrados}</span>
      </Metrica>
      <Metrica titulo="Mensajes">
        <span>{datos.mensajes}</span>
      </Metrica>
      <Metrica titulo="Latencia p50 (última hora)" detalle={obs.disponible ? `${obs.muestras_latencia} respuestas` : undefined}>
        <span>{obs.disponible ? latencia(obs.latencia_p50_ms) : SIN_DATO}</span>
      </Metrica>
      <Metrica titulo="Latencia p95 (última hora)">
        <span>{obs.disponible ? latencia(obs.latencia_p95_ms) : SIN_DATO}</span>
      </Metrica>
      <Metrica
        titulo="Fallas técnicas"
        detalle={
          <>
            <p>fallas de herramientas o modelos (12 h)</p>
            {desglose ? <p className="text-foreground">{desglose}</p> : null}
          </>
        }
      >
        <span>{obs.disponible ? obs.errores : SIN_DATO}</span>
      </Metrica>
      <Metrica
        titulo="Bloqueos de guardrails"
        detalle={
          motivos.length > 0 ? (
            <ul className="flex flex-wrap gap-x-3">
              {motivos.map(([motivo, n]) => (
                <li key={motivo}>{`${etiquetaMotivoBloqueo(motivo)} ${n}`}</li>
              ))}
            </ul>
          ) : undefined
        }
      >
        <span>{obs.disponible ? obs.bloqueos.total : SIN_DATO}</span>
      </Metrica>
      <Metrica titulo="Escalamientos pendientes">
        <span>{datos.escalamientos_pendientes}</span>
      </Metrica>
      <Metrica
        titulo="Coste estimado"
        detalle={datos.presupuesto.maximo_usd === null ? "sin tope" : `de ${usd(datos.presupuesto.maximo_usd)}`}
      >
        <span>{usd(datos.presupuesto.acumulado_usd)}</span>
      </Metrica>
      <Metrica titulo="Modelo de respaldo" detalle={respaldo}>
        <span>{obs.disponible ? obs.respaldo.ultima_hora : SIN_DATO}</span>
      </Metrica>
      <Metrica titulo="Votos">
        <span aria-label={`${datos.votos.positivos} votos positivos`}>👍 {datos.votos.positivos}</span>
        <span className="ml-6" aria-label={`${datos.votos.negativos} votos negativos`}>
          👎 {datos.votos.negativos}
        </span>
      </Metrica>
    </div>
  );
}
