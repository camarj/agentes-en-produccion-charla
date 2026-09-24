import type {
  ProcessInputArgs,
  ProcessInputStepArgs,
  ProcessInputStepResult,
  ProcessOutputResultArgs,
  ProcessOutputStreamArgs,
  Processor,
} from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import type { ChunkType } from "@mastra/core/stream";
import { ultimoTextoDeUsuario } from "./alcance-charla";
import { registrarEnTraza } from "./traza-guardrail";
import {
  CLAVE_VEREDICTO,
  promesaDeVeredicto,
  veredictoSiListo,
  verificarEntrada as verificarPorDefecto,
  type Veredicto,
  type VerificarEntrada,
} from "./verificacion-entrada";

export const ID_GUARDIA_ENTRADA = "guardia-entrada";

// true si esta ejecución del agente creó su propio veredicto (uso directo,
// p. ej. Studio) y por lo tanto debe retener la salida él mismo.
const CLAVE_RETENCION_INTERNA = "veredicto_entrada_interno";

// Veredictos ya tomados por una ejecución. Si un requestContext se reutiliza
// en otra llamada, su veredicto viejo no vale para el mensaje nuevo.
const reclamados = new WeakSet<Promise<Veredicto>>();

export interface OpcionesGuardiaEntrada {
  verificar?: VerificarEntrada;
}

// Guardrails de entrada sin frenar al agente (decisión de Raúl, 2026-09-23).
// Va en `inputProcessors` y en `outputProcessors` (primero en ambos).
//
// - processInput (una vez por ejecución, no en cada paso): si `ejecutarTurno`
//   ya dejó el veredicto en el requestContext, lo usa; si no (uso directo desde
//   Studio o `agent.generate`), lanza él mismo la verificación SIN esperarla y
//   la deja en el requestContext. El primer paso del modelo arranca enseguida.
// - escalar_pregunta espera ese veredicto antes de escribir.
// - Si el veredicto es «bloqueado», el procesador corta la ejecución con
//   `abort()` (tripwire) en el siguiente punto de control: antes de un paso,
//   en el siguiente chunk o al final. Un tripwire de procesador no guarda nada
//   en la memoria (a diferencia de cancelar con `abortSignal`, que guarda la
//   pregunta y la respuesta parcial).
// - Uso directo: retiene cada chunk de salida hasta conocer el veredicto (nada
//   sin verificar llega al cliente). Con `ejecutarTurno` la retención la hace
//   el turno, fuera del bucle, y aquí no se espera (el agente sigue avanzando
//   con herramientas y pasos mientras los guardrails deciden).
// - processOutputResult espera siempre el veredicto: así el agent_run lo
//   registra en la traza y la memoria nunca guarda un turno bloqueado.
export class GuardiaEntrada implements Processor<typeof ID_GUARDIA_ENTRADA> {
  readonly id = ID_GUARDIA_ENTRADA;
  readonly name = "Guardrails de entrada (en paralelo con el agente)";
  private readonly verificar: VerificarEntrada;

  constructor(opciones: OpcionesGuardiaEntrada = {}) {
    this.verificar = opciones.verificar ?? verificarPorDefecto;
  }

  private bloquear(
    veredicto: Extract<Veredicto, { bloqueado: true }>,
    abort: ProcessInputArgs["abort"],
    tracingContext: ProcessInputArgs["tracingContext"],
  ): never {
    registrarEnTraza(tracingContext, veredicto.metadata);
    return abort(veredicto.mensaje, { metadata: veredicto.metadata });
  }

  async processInput({ messages, requestContext, tracingContext, abortSignal }: ProcessInputArgs) {
    if (!requestContext) return messages;
    const previo = promesaDeVeredicto(requestContext);
    const externo = previo !== undefined && !reclamados.has(previo);
    if (externo) reclamados.add(previo);
    else {
      const veredicto = this.verificar(ultimoTextoDeUsuario(messages), { requestContext, tracingContext }, abortSignal);
      // Evita un rechazo no manejado mientras nadie lo espera (verificar no lanza).
      veredicto.catch(() => undefined);
      reclamados.add(veredicto);
      requestContext.set(CLAVE_VEREDICTO, veredicto);
    }
    requestContext.set(CLAVE_RETENCION_INTERNA, !externo);
    return messages;
  }

  // Antes de cada paso: si ya se sabe que está bloqueado, no se llama más al modelo.
  async processInputStep({ requestContext, abort, tracingContext }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined> {
    const v = await veredictoSiListo(promesaDeVeredicto(requestContext));
    if (v?.bloqueado) this.bloquear(v, abort, tracingContext);
    return undefined;
  }

  async processOutputStream({ part, requestContext, abort, tracingContext }: ProcessOutputStreamArgs): Promise<ChunkType | null> {
    const promesa = promesaDeVeredicto(requestContext);
    const v = retieneInterno(requestContext) ? await promesa : await veredictoSiListo(promesa);
    if (v?.bloqueado) this.bloquear(v, abort, tracingContext);
    return part;
  }

  async processOutputResult({ messages, requestContext, abort, tracingContext }: ProcessOutputResultArgs) {
    const v = await promesaDeVeredicto(requestContext);
    if (!v) return messages;
    if (v.bloqueado) this.bloquear(v, abort, tracingContext);
    registrarEnTraza(tracingContext, v.metadata);
    return messages;
  }
}

function retieneInterno(requestContext: RequestContext | undefined): boolean {
  return requestContext?.get(CLAVE_RETENCION_INTERNA) === true;
}
