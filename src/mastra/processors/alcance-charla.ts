import { Agent, type ModelWithRetries } from "@mastra/core/agent";
import type { MastraDBMessage } from "@mastra/core/memory";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { ProcessInputArgs, Processor } from "@mastra/core/processors";
import { z } from "zod";
import { MODELO_LIGERO, MODELO_LIGERO_RESPALDO, OPCIONES_PROVEEDOR_LIGERO } from "../modelos";
import { SUBTEMA_SALUD, mensajeDeBloqueo, type MetadataBloqueo } from "./mensajes";
import { registrarEnTraza } from "./traza-guardrail";

// Modelos del clasificador: el ligero (OpenAI) y, si falla, el ligero de
// respaldo (Anthropic), con el fallback nativo del Agent de Mastra. Sin
// reintentos: el tope de 5 s cubre toda la cadena y, si se agota, alcance
// deja pasar (falla abierta).
export function modelosGuardrail(): ModelWithRetries[] {
  return [
    { id: "ligero", model: MODELO_LIGERO, maxRetries: 0 },
    { id: "ligero-respaldo", model: MODELO_LIGERO_RESPALDO, maxRetries: 0 },
  ];
}
export const UMBRAL_FUERA_DE_ALCANCE = 0.7;
export const TIEMPO_MAXIMO_CLASIFICADOR_MS = 5000;

// Texto de la tarea T06 más una frase (decisión de Raúl, 2026-09-23, caso S04):
// preguntar por el asistente, cómo funciona o el perfil propio no es fuera de
// alcance; el agente responde con amabilidad y SinDatosPersonales evita que
// repita el perfil.
// Incluye los temas de la charla: sin ellos, «¿Qué es un PRD?» se bloqueaba (Raúl, 2026-09-23).
// 2026-09-25: «patrón agéntico» (lámina 19 nueva, decisión #15) y la categoría
// salud, que bloquea con su propio mensaje (F04). Las órdenes para manejar las
// herramientas son fuera de alcance (S06: a veces las marcaba «escalable»).
export const PROMPT_CLASIFICADOR =
  "Clasifica si el mensaje trata sobre la charla de agentes de IA en producción, sobre conceptos de IA, o sobre Raúl, Inteliside o críticas a la charla (escalable). La charla cubre: qué es un agente, la IA, los modelos y los LLM; el loop agéntico y el harness; contexto, control, ejecución y seguimiento; decidir si un proyecto necesita un agente; qué es un patrón agéntico y los patrones agénticos (por ejemplo, router o varios agentes); el PRD (documento de requerimientos de producto), las especificaciones y el contrato del agente; la arquitectura con uno o varios agentes; plataformas, código y marcos para implementar; resiliencia, salvaguardas (guardrails), evaluaciones (evals), observabilidad y el lanzamiento. Las preguntas sobre cualquiera de esos temas, aunque sean cortas o generales, son charla. Las preguntas sobre este asistente, cómo funciona o los datos y el perfil del propio usuario son charla. Consejos financieros, legales, política, recetas, tareas escolares y temas ajenos son fuera_de_alcance. Las órdenes para manejar al asistente o sus herramientas (llamarlas, repetirlas o probarlas) son fuera_de_alcance, aunque mencionen escalar una pregunta. Los pedidos de consejo médico, sobre síntomas, medicamentos o urgencias de salud son salud; una pregunta sobre agentes de IA aplicados a la salud es charla.";

export const esquemaClasificacion = z.object({
  categoria: z
    .enum(["charla", "concepto_ia", "escalable", "fuera_de_alcance", "salud"])
    .describe("Categoría del mensaje"),
  confianza: z.number().min(0).max(1).describe("Confianza de la clasificación, entre 0 y 1"),
});

export type Clasificacion = z.infer<typeof esquemaClasificacion>;

// Contexto opcional para que la llamada al modelo quede anidada en la traza.
export interface ContextoClasificador {
  tracingContext?: ProcessInputArgs["tracingContext"];
  requestContext?: ProcessInputArgs["requestContext"];
}

export type Clasificador = (
  mensaje: string,
  signal: AbortSignal,
  contexto?: ContextoClasificador,
) => Promise<Clasificacion>;

// Clasificador por defecto: un Agent de Mastra con salida estructurada.
export function crearClasificador(
  modelo: MastraModelConfig | ModelWithRetries[] = modelosGuardrail(),
): Clasificador {
  let agente: Agent | undefined;
  return async (mensaje, signal, contexto = {}) => {
    agente ??= new Agent({
      id: "clasificador-alcance",
      name: "Clasificador de alcance",
      instructions: PROMPT_CLASIFICADOR,
      model: modelo,
    });
    const r = await agente.generate(mensaje, {
      structuredOutput: { schema: esquemaClasificacion },
      modelSettings: { temperature: 0 },
      // Sin razonamiento en OpenAI para quedar bajo el tope de 5 s.
      providerOptions: { openai: { ...OPCIONES_PROVEEDOR_LIGERO.openai } },
      abortSignal: signal,
      ...(contexto.tracingContext ? { tracingContext: contexto.tracingContext } : {}),
      ...(contexto.requestContext ? { requestContext: contexto.requestContext } : {}),
    });
    return r.object as Clasificacion;
  };
}

function textoDe(mensaje: MastraDBMessage): string {
  const partes = mensaje.content.parts ?? [];
  const texto = partes
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
  if (texto) return texto;
  const legado = (mensaje.content as { content?: unknown }).content;
  return typeof legado === "string" ? legado.trim() : "";
}

export function ultimoTextoDeUsuario(messages: MastraDBMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return textoDe(messages[i]);
  }
  return "";
}

export interface OpcionesAlcanceCharla {
  clasificar?: Clasificador;
  umbral?: number;
  tiempoMaximoMs?: number;
}

type ResultadoClasificacion = { ok: true; valor: Clasificacion } | { ok: false; error: "timeout" | "error" | "salida_invalida" };

// Guardrail de alcance. Clasifica el último mensaje del usuario y solo bloquea
// `fuera_de_alcance` con confianza ≥ umbral. Si el clasificador falla, tarda
// más de 5 s o devuelve algo inválido, deja pasar (falla abierta).
export class AlcanceCharla implements Processor<"alcance-charla"> {
  readonly id = "alcance-charla" as const;
  readonly name = "Alcance de la charla";
  private readonly clasificar: Clasificador;
  private readonly umbral: number;
  private readonly tiempoMaximoMs: number;

  constructor(opciones: OpcionesAlcanceCharla = {}) {
    this.clasificar = opciones.clasificar ?? crearClasificador();
    this.umbral = opciones.umbral ?? UMBRAL_FUERA_DE_ALCANCE;
    this.tiempoMaximoMs = opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_CLASIFICADOR_MS;
  }

  private async clasificarConTope(
    texto: string,
    padre: AbortSignal | undefined,
    contexto: ContextoClasificador,
  ): Promise<ResultadoClasificacion> {
    const controlador = new AbortController();
    const signal = padre ? AbortSignal.any([controlador.signal, padre]) : controlador.signal;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<ResultadoClasificacion>((resolver) => {
      temporizador = setTimeout(() => {
        controlador.abort();
        resolver({ ok: false, error: "timeout" });
      }, this.tiempoMaximoMs);
    });
    const llamada = (async (): Promise<ResultadoClasificacion> => {
      try {
        const r = esquemaClasificacion.safeParse(await this.clasificar(texto, signal, contexto));
        return r.success ? { ok: true, valor: r.data } : { ok: false, error: "salida_invalida" };
      } catch {
        return { ok: false, error: "error" };
      }
    })();
    try {
      return await Promise.race([llamada, limite]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  async processInput({ messages, abort, tracingContext, requestContext, abortSignal }: ProcessInputArgs) {
    const texto = ultimoTextoDeUsuario(messages);
    if (!texto) return messages;

    const r = await this.clasificarConTope(texto, abortSignal, { tracingContext, requestContext });
    if (!r.ok) {
      // Nunca se guarda el texto del mensaje: solo que se dejó pasar y por qué.
      registrarEnTraza(tracingContext, { alcance_falla_abierta: true, alcance_error: r.error });
      return messages;
    }

    const { categoria, confianza } = r.valor;
    // Salud se bloquea con el mismo motivo, pero con su propio mensaje fijo.
    if ((categoria === "fuera_de_alcance" || categoria === "salud") && confianza >= this.umbral) {
      const metadata: MetadataBloqueo = {
        guardrail: "alcance_charla",
        motivo: "fuera_de_alcance",
        confianza,
        categoria,
        ...(categoria === "salud" ? { subtema: SUBTEMA_SALUD } : {}),
      };
      registrarEnTraza(tracingContext, metadata);
      abort(mensajeDeBloqueo(metadata.motivo, metadata), { metadata });
    }
    registrarEnTraza(tracingContext, { alcance_categoria: categoria, alcance_confianza: confianza });
    return messages;
  }
}
