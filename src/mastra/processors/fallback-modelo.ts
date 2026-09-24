import { SpanType } from "@mastra/core/observability";
import type { ProcessInputStepArgs, ProcessInputStepResult, Processor } from "@mastra/core/processors";
import { APICallError } from "ai";
import { interruptores as interruptoresPorDefecto, type Interruptores } from "@/lib/db/interruptores";
import { MODELO_PRINCIPAL, MODELO_RESPALDO, OPCIONES_PROVEEDOR_PRINCIPAL } from "../modelos";

// Cadena de modelos del agente (fallback nativo de Mastra). Ante un error del
// proveedor, Mastra reintenta el mismo modelo `maxRetries` veces (solo si el
// error es reintentable: 5xx, 529, 408, 409, 429 o de red) y luego pasa al
// siguiente modelo. Principal (OpenAI): 1 reintento; respaldo (Anthropic): 1 intento.
export function modelosConRespaldo() {
  return [
    {
      id: "principal",
      model: MODELO_PRINCIPAL,
      maxRetries: 1,
      // Solo aplica a OpenAI; el respaldo (Anthropic) no la recibe.
      providerOptions: { openai: { ...OPCIONES_PROVEEDOR_PRINCIPAL.openai } },
    },
    { id: "respaldo", model: MODELO_RESPALDO, maxRetries: 0 },
  ];
}

function idModelo(model: { provider?: string; modelId?: string } | undefined): string {
  return `${model?.provider ?? ""}/${model?.modelId ?? ""}`;
}

// Error de sobrecarga simulado con la forma del proveedor del modelo:
// - OpenAI: 503 con `{"error":{"type":"server_error"}}`;
// - Anthropic: 529 con `{"type":"error","error":{"type":"overloaded_error"}}`.
// Ambos son `APICallError` reintentables, como los reales.
export function crearErrorSobrecarga(modelo: string): APICallError {
  const openai = modelo.startsWith("openai/");
  const cuerpo = openai
    ? { error: { message: "The server is overloaded", type: "server_error", param: null, code: null } }
    : { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
  return new APICallError({
    message: "Overloaded (simulado por el interruptor modelo_caido)",
    url: `simulado://${modelo}`,
    requestBodyValues: {},
    statusCode: openai ? 503 : 529,
    responseBody: JSON.stringify(cuerpo),
    isRetryable: true,
  });
}

// Tipos y códigos de error de proveedor que indican sobrecarga o límite temporal.
const TIPOS_SOBRECARGA = new Set(["overloaded_error", "server_error", "rate_limit_exceeded", "rate_limit_error"]);
const PATRON_CUERPO = /"(?:type|code)"\s*:\s*"(overloaded_error|server_error|rate_limit_exceeded|rate_limit_error)"/;

function esTipoSobrecarga(valor: unknown): boolean {
  return typeof valor === "string" && TIPOS_SOBRECARGA.has(valor);
}

// ¿El error (o alguna de sus causas) es un 5xx, 529, 429 o una sobrecarga?
// Reconoce las formas de Anthropic (529 `overloaded_error`) y de OpenAI
// (`server_error`, `rate_limit_exceeded`), también dentro del cuerpo de un
// `APICallError` del AI SDK.
export function esErrorDeSobrecarga(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual && typeof actual === "object"; i++) {
    const e = actual as {
      statusCode?: unknown;
      status?: unknown;
      type?: unknown;
      code?: unknown;
      error?: { type?: unknown; code?: unknown };
      message?: unknown;
      responseBody?: unknown;
      cause?: unknown;
    };
    const codigo = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : null;
    if (codigo !== null && (codigo >= 500 || codigo === 429)) return true;
    if (esTipoSobrecarga(e.type) || esTipoSobrecarga(e.code)) return true;
    if (esTipoSobrecarga(e.error?.type) || esTipoSobrecarga(e.error?.code)) return true;
    if (typeof e.message === "string" && /overloaded|sobrecarga/i.test(e.message)) return true;
    if (typeof e.responseBody === "string" && PATRON_CUERPO.test(e.responseBody)) return true;
    actual = e.cause;
  }
  return false;
}

// Modelo (LanguageModelV2) con el mismo id que el principal que falla con un
// error de sobrecarga (503 en OpenAI) sin llamar al proveedor. Como el error es reintentable, Mastra aplica su
// reintento y su cambio de modelo igual que con una caída real.
export function crearModeloCaido(modelo: string) {
  const [provider, ...resto] = modelo.split("/");
  const fallar = async (): Promise<never> => {
    throw crearErrorSobrecarga(modelo);
  };
  return {
    specificationVersion: "v2" as const,
    provider,
    modelId: resto.join("/"),
    supportedUrls: {},
    doGenerate: fallar,
    doStream: fallar,
  };
}

interface SpanMinimo {
  update(opciones: { metadata?: Record<string, unknown> }): void;
  findParent?(tipo: SpanType): SpanMinimo | undefined;
}

export interface OpcionesFallbackModelo {
  interruptores?: { obtenerTodos: () => Promise<Pick<Interruptores, "modelo_caido">> };
  principal?: string;
  respaldo?: string;
}

// Procesador de entrada por paso. Corre dentro del bucle de fallback de Mastra,
// así que `model` es el modelo del intento actual:
// - principal + `modelo_caido = on` → lo cambia por un modelo que falla (503 simulado);
// - respaldo → marca `modelo_respaldo = true` en los spans del agente y del modelo.
export class FallbackModelo implements Processor<"fallback-modelo"> {
  readonly id = "fallback-modelo" as const;
  readonly name = "Fallback de modelo";
  private readonly interruptores: NonNullable<OpcionesFallbackModelo["interruptores"]>;
  private readonly principal: string;
  private readonly respaldo: string;

  constructor(opciones: OpcionesFallbackModelo = {}) {
    this.interruptores = opciones.interruptores ?? interruptoresPorDefecto;
    this.principal = opciones.principal ?? MODELO_PRINCIPAL;
    this.respaldo = opciones.respaldo ?? MODELO_RESPALDO;
  }

  private async modeloCaido(): Promise<boolean> {
    try {
      return (await this.interruptores.obtenerTodos()).modelo_caido === "on";
    } catch {
      return false; // si no se pueden leer, se asume apagado
    }
  }

  async processInputStep({ model, tracingContext }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined> {
    const span = tracingContext?.currentSpan as SpanMinimo | undefined;
    const actual = idModelo(model);

    if (actual === this.respaldo) {
      const marca = { metadata: { modelo_respaldo: true, modelo_usado: actual } };
      span?.update(marca);
      span?.findParent?.(SpanType.AGENT_RUN)?.update(marca);
      span?.findParent?.(SpanType.MODEL_GENERATION)?.update(marca);
      return undefined;
    }

    if (actual === this.principal && (await this.modeloCaido())) {
      span?.update({ metadata: { modelo_caido_simulado: true } });
      return { model: crearModeloCaido(this.principal) as unknown as ProcessInputStepResult["model"] };
    }
    return undefined;
  }
}
