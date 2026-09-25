import { desgloseFallas, etiquetaMotivoBloqueo, latencia, modeloActual, respaldoUltimaHora, SIN_DATO, ultimaRespuesta, usd } from "@/lib/panel/formato";
import type { EstadoInterruptores, MetricasPanel } from "@/lib/panel/tipos";
import { cn } from "@/lib/utils";

// Tarjeta de una métrica: título legible desde el fondo y valor de 2,5 rem en mono.
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
      <div className="flex items-baseline gap-2 font-mono text-[2.5rem] leading-none tabular-nums">{children}</div>
      {detalle ? <div className="text-base text-muted-foreground">{detalle}</div> : null}
    </section>
  );
}

// Color del valor de «Modelo en uso»: el principal en blanco, el respaldo en
// ámbar y «Sin modelo» en rojo (el acento queda para foco, enlaces y enviar).
const CLASE_MODELO = { principal: undefined, respaldo: "text-amber-300", sin_modelo: "text-red-300" } as const;

// `valores`: interruptores actuales. «Modelo en uso» sale de ellos, así que
// cambia apenas se toca «Modelo caído» / «Modelos caídos».
export function Metricas({ datos, valores }: { datos: MetricasPanel; valores: EstadoInterruptores["valores"] | null }) {
  const obs = datos.observabilidad;
  const motivos = obs.disponible
    ? Object.entries(obs.bloqueos.por_motivo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];
  const desglose = obs.disponible ? desgloseFallas(obs.errores_por_tipo) : null;
  const modelo = modeloActual(valores);

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
      <Metrica
        titulo="Modelo en uso"
        detalle={
          <>
            <p>{ultimaRespuesta(obs.disponible ? obs.modelo_en_uso : null)}</p>
            {obs.disponible ? <p>{respaldoUltimaHora(obs.respaldo.ultima_hora)}</p> : null}
          </>
        }
      >
        {/* Texto largo («claude-sonnet-5 · respaldo»): más chico que las cifras para que quepa. */}
        <span data-testid="modelo-en-uso" className={cn("text-[1.75rem] leading-tight break-words", modelo.estado && CLASE_MODELO[modelo.estado])}>
          {modelo.texto}
        </span>
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
