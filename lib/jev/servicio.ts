// Conecta el analizador de Jev con lo real: el store de observabilidad de la
// instancia de Mastra (Neon o LibSQL, solo lectura) y el cliente de TypeSafe.
// Solo servidor: la clave TYPESAFE_API_KEY nunca llega al navegador.

import { TypeSafeClient } from "@typesafe-ai/sdk";
import { jev } from "@/lib/db/jev";
import { mastra } from "@/src/mastra";
import { crearAnalizadorJev, type AnalizadorJev, type EvaluarTurno, type StoreJev } from "./analizador";
import { estadoDelTurno, preguntasDelTurno, type EntradaTurno } from "./preguntas";
import type { ResultadoJev } from "./resultado";
import type { TurnoJev } from "./turnos";

// Tope por llamada a Jev (responde en ~250 ms) y un solo reintento.
export const TIEMPO_POR_LLAMADA_MS = 6000;

export function entradaDe(t: TurnoJev): EntradaTurno {
  return { pregunta: t.pregunta, respuesta: t.respuesta, evidencia: t.evidencia, bloqueado: t.motivoBloqueo !== null };
}

export function crearEvaluar(apiKey: string | undefined): EvaluarTurno | null {
  const clave = apiKey?.trim();
  if (!clave) return null;
  // logLevel "off": el SDK no registra nada (ni el estado ni las preguntas).
  const cliente = new TypeSafeClient({
    apiKey: clave,
    logLevel: "off",
    timeout: TIEMPO_POR_LLAMADA_MS,
    retry: { maxRetries: 1 },
  });
  return async (turno) => {
    const entrada = entradaDe(turno);
    const inicio = performance.now();
    const resultado = await cliente.systemOne({ state: estadoDelTurno(entrada), questions: preguntasDelTurno(entrada) });
    return { resultado: resultado as unknown as ResultadoJev, latenciaMs: performance.now() - inicio };
  };
}

async function obtenerStore(): Promise<StoreJev | undefined> {
  const store = await mastra.getStorage()?.getStore("observability");
  if (!store) return undefined;
  return {
    listTracesLight: (args) => store.listTracesLight(args) as unknown as ReturnType<StoreJev["listTracesLight"]>,
    getTrace: (args) => store.getTrace(args) as unknown as ReturnType<StoreJev["getTrace"]>,
  };
}

let analizador: AnalizadorJev | null = null;

// Se crea al primer uso, así lee TYPESAFE_API_KEY del entorno en ejecución.
export function analizadorJev(): AnalizadorJev {
  analizador ??= crearAnalizadorJev({ obtenerStore, evaluar: crearEvaluar(process.env.TYPESAFE_API_KEY), repo: jev });
  return analizador;
}
