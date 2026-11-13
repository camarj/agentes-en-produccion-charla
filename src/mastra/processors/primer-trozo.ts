import { APICallError } from "ai";

// Plan B por tiempo (prueba de carga 2026-11-12): una pregunta sola tarda ~4 s,
// pero a veces Gemini en Vertex se queda callado 20-45 s antes del primer
// trozo, sin error. Si el modelo no entrega contenido en este plazo, se cancela
// ese intento y se lanza un 408 reintentable: la cadena nativa de Mastra
// (modelosConRespaldo) reintenta el principal 1 vez y luego pasa al respaldo.
// Solo mide hasta el PRIMER contenido: una respuesta larga que ya empezó nunca se corta.
// 15 s: con 8 s, en la prueba de 100 preguntas a la vez el 39 % pasó al
// respaldo (más lento) porque Gemini bajo carga suele tardar 8-15 s; 15 s solo
// atrapa los silencios largos. Ajustable sin publicar con ESPERA_PRIMER_TROZO_MS.
export const ESPERA_PRIMER_TROZO_MS = 15_000;

export function esperaPrimerTrozoMs(entorno: Record<string, string | undefined> = process.env): number {
  const valor = Number(entorno.ESPERA_PRIMER_TROZO_MS);
  return Number.isInteger(valor) && valor >= 1_000 ? valor : ESPERA_PRIMER_TROZO_MS;
}

// Partes del stream que no son contenido: llegan antes de que el modelo responda.
const SIN_CONTENIDO = new Set(["stream-start", "response-metadata", "raw"]);

const LIMITADO = Symbol.for("charla.modelo-con-limite-primer-trozo");

type Parte = { type?: unknown };
type OpcionesStream = { abortSignal?: AbortSignal };
type ResultadoStream = { stream: ReadableStream<unknown> };
type ModeloConStream = { provider?: string; modelId?: string; doStream: (opciones: never) => PromiseLike<unknown> };

export function crearErrorPrimerTrozoLento(modelo: string, ms: number): APICallError {
  return new APICallError({
    message: `El modelo ${modelo} no empezó a responder en ${ms / 1000} s`,
    url: `limite-primer-trozo://${modelo}`,
    requestBodyValues: {},
    statusCode: 408,
    isRetryable: true,
  });
}

export function esModeloConLimite(modelo: unknown): boolean {
  return typeof modelo === "object" && modelo !== null && (modelo as Record<symbol, unknown>)[LIMITADO] === true;
}

// Envuelve un modelo del AI SDK (cualquier versión de la especificación) sin
// cambiar su identidad: proveedor, id y demás propiedades pasan tal cual.
export function conLimitePrimerTrozo<M extends ModeloConStream>(modelo: M, ms: number = esperaPrimerTrozoMs()): M {
  return new Proxy(modelo, {
    get(objetivo, clave) {
      if (clave === LIMITADO) return true;
      if (clave === "doStream") {
        return (opciones: OpcionesStream) => streamConLimite(objetivo, opciones, ms);
      }
      const valor = Reflect.get(objetivo, clave, objetivo);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}

async function streamConLimite(modelo: ModeloConStream, opciones: OpcionesStream, ms: number) {
  const control = new AbortController();
  const senal = opciones.abortSignal ? AbortSignal.any([opciones.abortSignal, control.signal]) : control.signal;
  const nombre = `${modelo.provider ?? "?"}/${modelo.modelId ?? "?"}`;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => {
      control.abort();
      rechazar(crearErrorPrimerTrozoLento(nombre, ms));
    }, ms);
  });
  vencido.catch(() => {}); // se observa con Promise.race; evita un rechazo sin manejar

  let lector: ReadableStreamDefaultReader<unknown> | undefined;
  try {
    const resultado = (await Promise.race([
      modelo.doStream({ ...opciones, abortSignal: senal } as never),
      vencido,
    ])) as ResultadoStream;
    lector = resultado.stream.getReader();
    const leidos: unknown[] = [];
    for (;;) {
      const { done, value } = await Promise.race([lector.read(), vencido]);
      if (done) break;
      leidos.push(value);
      if (!SIN_CONTENIDO.has(String((value as Parte)?.type))) break;
    }
    clearTimeout(reloj);
    const fuente = lector;
    const stream = new ReadableStream<unknown>({
      start(c) {
        for (const parte of leidos) c.enqueue(parte);
      },
      async pull(c) {
        const { done, value } = await fuente.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel(motivo) {
        return fuente.cancel(motivo);
      },
    });
    return { ...resultado, stream };
  } catch (error) {
    clearTimeout(reloj);
    if (control.signal.aborted) void lector?.cancel().catch(() => {});
    throw error;
  }
}
