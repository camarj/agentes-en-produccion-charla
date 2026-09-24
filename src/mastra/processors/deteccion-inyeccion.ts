import { AsyncLocalStorage } from "node:async_hooks";
import { TripWire } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import {
  PromptInjectionDetector,
  type PromptInjectionDetectionEvent,
  type ProcessInputArgs,
  type Processor,
} from "@mastra/core/processors";
import { MODELO_LIGERO, MODELO_LIGERO_RESPALDO, OPCIONES_PROVEEDOR_LIGERO } from "../modelos";
import { MENSAJES_BLOQUEO, type MetadataBloqueo } from "./mensajes";
import { registrarEnTraza } from "./traza-guardrail";

// Si el detector con el modelo ligero (OpenAI) falla, se repite la detección
// una vez con este modelo (Anthropic) antes de fallar cerrado. El
// PromptInjectionDetector solo acepta un modelo (no una cadena de fallback).
export const MODELO_DETECTOR_RESPALDO = MODELO_LIGERO_RESPALDO;

// Configuración del PromptInjectionDetector de Mastra (T06).
// - errorStrategy 'strict': si el modelo detector falla, Mastra aborta (falla cerrada).
// - lastMessageOnly: solo el mensaje nuevo; el historial de la memoria no se
//   vuelve a analizar (ahorra una llamada por mensaje y evita que una
//   inyección vieja bloquee el hilo para siempre).
export const OPCIONES_DETECTOR_INYECCION = {
  model: MODELO_LIGERO,
  strategy: "block",
  detectionTypes: ["injection", "jailbreak", "system-override"],
  threshold: 0.8,
  errorStrategy: "strict",
  lastMessageOnly: true,
  // Sin razonamiento en OpenAI: la detección es una clasificación simple y la
  // latencia de este guardrail se suma a cada mensaje.
  providerOptions: OPCIONES_PROVEEDOR_LIGERO,
} as const;

interface RegistroDeteccion {
  confianza?: number;
  tipos?: string[];
}

export interface OpcionesDeteccionInyeccion {
  // Solo para tests: modelos falsos en lugar de los reales.
  model?: MastraModelConfig;
  modeloRespaldo?: MastraModelConfig;
}

// El detector no pudo decidir (error del modelo o salida inválida).
class FallaDetector extends Error {}

type ResultadoIntento = { ok: true; mensajes: Awaited<ReturnType<PromptInjectionDetector["processInput"]>> } | { ok: false };

// Envuelve el PromptInjectionDetector de Mastra para que el bloqueo llegue con
// el mensaje fijo en español y con metadata (guardrail, motivo, confianza), en
// vez del texto en inglés del detector. La confianza sale de `onDetection`,
// aislada por petición con AsyncLocalStorage (la instancia es compartida).
//
// Resiliencia: si el detector principal (OpenAI) no puede decidir, se repite la
// detección una sola vez con el de respaldo (Anthropic). Si ninguno decide, se
// bloquea (falla cerrada). Así una caída de OpenAI no bloquea todos los mensajes.
export class DeteccionInyeccion implements Processor<"deteccion-inyeccion"> {
  readonly id = "deteccion-inyeccion" as const;
  readonly name = "Detección de inyección (PromptInjectionDetector)";
  private readonly detector: PromptInjectionDetector;
  private readonly detectorRespaldo: PromptInjectionDetector;
  private readonly registro = new AsyncLocalStorage<RegistroDeteccion>();
  private readonly umbral: number = OPCIONES_DETECTOR_INYECCION.threshold;

  constructor(opciones: OpcionesDeteccionInyeccion = {}) {
    const crear = (model: MastraModelConfig) =>
      new PromptInjectionDetector({
        ...OPCIONES_DETECTOR_INYECCION,
        detectionTypes: [...OPCIONES_DETECTOR_INYECCION.detectionTypes],
        providerOptions: { openai: { ...OPCIONES_PROVEEDOR_LIGERO.openai } },
        model,
        onDetection: (evento) => this.anotar(evento),
      });
    this.detector = crear(opciones.model ?? OPCIONES_DETECTOR_INYECCION.model);
    this.detectorRespaldo = crear(opciones.modeloRespaldo ?? MODELO_DETECTOR_RESPALDO);
  }

  private anotar({ detectionResult, flagged }: PromptInjectionDetectionEvent) {
    const registro = this.registro.getStore();
    if (!registro || !flagged) return;
    const categorias = detectionResult.categories ?? [];
    registro.confianza = Math.max(...categorias.map((c) => c.score));
    registro.tipos = categorias.filter((c) => c.score >= this.umbral).map((c) => c.type);
  }

  private bloquear(args: ProcessInputArgs, registro: RegistroDeteccion, respaldo: boolean): never {
    // Sin confianza = ningún detector pudo decidir: se bloquea igual (falla cerrada).
    const metadata: MetadataBloqueo =
      registro.confianza === undefined
        ? { guardrail: "deteccion_inyeccion", motivo: "inyeccion", falla_detector: true }
        : {
            guardrail: "deteccion_inyeccion",
            motivo: "inyeccion",
            confianza: registro.confianza,
            tipos: registro.tipos,
            ...(respaldo ? { detector_respaldo: true } : {}),
          };
    registrarEnTraza(args.tracingContext, metadata);
    return args.abort(MENSAJES_BLOQUEO.inyeccion, { metadata });
  }

  // Un intento con un detector. Una detección real aborta (TripWire); un error
  // del modelo o una salida inválida devuelve `{ ok: false }`.
  private async intentar(
    detector: PromptInjectionDetector,
    args: ProcessInputArgs,
    respaldo: boolean,
  ): Promise<ResultadoIntento> {
    const registro: RegistroDeteccion = {};
    const abort = (): never => {
      // Con `errorStrategy: 'strict'` el detector también llama a `abort` cuando
      // su modelo falla; sin confianza registrada no hubo detección.
      if (registro.confianza === undefined) throw new FallaDetector();
      return this.bloquear(args, registro, respaldo);
    };
    try {
      const mensajes = await this.registro.run(registro, () => detector.processInput({ ...args, abort }));
      return { ok: true, mensajes };
    } catch (error) {
      if (error instanceof TripWire) throw error;
      return { ok: false };
    }
  }

  async processInput(args: ProcessInputArgs) {
    const principal = await this.intentar(this.detector, args, false);
    if (principal.ok) return principal.mensajes;

    const respaldo = await this.intentar(this.detectorRespaldo, args, true);
    if (respaldo.ok) {
      registrarEnTraza(args.tracingContext, { detector_respaldo: true });
      return respaldo.mensajes;
    }
    return this.bloquear(args, {}, true);
  }
}
