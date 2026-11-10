import { eventosSalud } from "@/lib/db/eventos-salud";
import type { FilaTurno } from "@/lib/db/turnos";
import type { TipoEvento } from "./catalogo";
import type { SenalesTurno } from "./senales";

// Anota eventos de salud (PRD §15 G7) sin frenar ni romper a quien llama: si
// la escritura falla, solo se registra el tipo de error en el log.

function registrarFalla(error: unknown) {
  console.error("[salud] no se pudo anotar el evento", { tipo: error instanceof Error ? error.name : typeof error });
}

export function anotarEvento(tipo: TipoEvento, traceId: string | null = null): void {
  eventosSalud.registrar(tipo, { traceId }).catch(registrarFalla);
}

export interface EventoDeTurno {
  tipo: TipoEvento;
  // true: solo se anota si el servicio venía con aviso o falla.
  recuperacion: boolean;
}

const CAUSA_RESPALDO = { limite_uso: "gemini_limite_uso", sobrecarga: "gemini_sobrecarga" } as const;

// Eventos que deja un turno cerrado. Una falla real deja el mismo evento que
// la simulada (salvo la causa de la caída de Gemini, que solo se conoce si la
// simuló un interruptor).
export function eventosDeTurno({
  fila,
  senales,
  detectorFallo,
}: {
  fila: FilaTurno;
  senales: SenalesTurno;
  // El detector de inyección falló y bloqueó (falla cerrada).
  detectorFallo: boolean;
}): EventoDeTurno[] {
  const salida: EventoDeTurno[] = [];
  const evento = (tipo: TipoEvento) => salida.push({ tipo, recuperacion: false });
  const recuperacion = (tipo: TipoEvento) => salida.push({ tipo, recuperacion: true });

  if (fila.tipoFalla === "modelo") evento("modelos_caidos");
  else if (fila.duracionMs !== null && fila.resultado !== "bloqueo") {
    // Respondió un modelo: Gemini (recuperado) o el respaldo (Gemini cayó).
    if (senales.respaldo) evento(senales.respaldo.causa ? CAUSA_RESPALDO[senales.respaldo.causa] : "gemini_fallo");
    else recuperacion("gemini_recuperado");
    recuperacion("openai_recuperado");
  }
  if (senales.busqueda?.agotada) evento("busqueda_agotada");
  else if ((senales.busqueda?.intentos ?? 0) > 1) evento("busqueda_reintentos");
  if (senales.alcanceFallaAbierta) evento("alcance_falla_abierta");
  if (detectorFallo) evento("detector_falla_cerrada");
  return salida;
}

export async function anotarEventosDeTurno(eventos: readonly EventoDeTurno[], traceId: string | null): Promise<void> {
  for (const e of eventos) {
    try {
      if (e.recuperacion) await eventosSalud.registrarRecuperacion(e.tipo, { traceId });
      else await eventosSalud.registrar(e.tipo, { traceId });
    } catch (error) {
      registrarFalla(error);
    }
  }
}
