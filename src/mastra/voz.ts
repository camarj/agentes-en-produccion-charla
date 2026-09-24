import { Readable } from "node:stream";
import { OpenAIVoice } from "@mastra/voice-openai";
import type { FormatoAudio } from "@/lib/transcripcion";

// Dictado por voz (speech-to-text) con Mastra Voice (@mastra/voice-openai).
// gpt-transcribe es el modelo que OpenAI recomienda hoy para transcribir
// (mejor que whisper-1 en español y más barato: $0,0045/min). OpenAIVoice
// declara solo 'whisper-1' en sus tipos, pero pasa el nombre tal cual a la API.
export const MODELO_TRANSCRIPCION = "gpt-transcribe";

// Se crea al primer uso: el constructor exige OPENAI_API_KEY y no debe romper
// el build ni los tests que no dictan.
let voz: OpenAIVoice | undefined;
function instancia(): OpenAIVoice {
  voz ??= new OpenAIVoice({
    listeningModel: { name: MODELO_TRANSCRIPCION as "whisper-1", apiKey: process.env.OPENAI_API_KEY },
  });
  return voz;
}

// Pistas para gpt-transcribe: la charla usa jerga en inglés que, sin ellas,
// sale escrita «como suena» (p. ej. «hárnis» en vez de «harness»).
export const CONTEXTO_TRANSCRIPCION =
  "Pregunta de un asistente a la charla «Cómo lograr que tus agentes sobrevivan a producción», sobre agentes de IA.";
export const PALABRAS_CLAVE_TRANSCRIPCION = [
  "harness",
  "agente",
  "evals",
  "guardrails",
  "Mastra",
  "observabilidad",
  "PRD",
  "prompt",
  "LLM",
  "kill switch",
  "fallback",
  "tokens",
  "Inteliside",
];

// Transcribe el audio en español. No hay span de Mastra para esta llamada
// (listen() va directo al SDK de OpenAI), así que ni el audio ni el texto
// llegan a las trazas. El audio vive solo en memoria durante la petición.
export async function transcribirAudio(audio: Uint8Array, formato: FormatoAudio): Promise<string> {
  // gpt-transcribe usa `languages` (plural) en vez de `language`. listen()
  // pasa estas opciones tal cual a audio.transcriptions.create.
  const texto = await instancia().listen(Readable.from([Buffer.from(audio)]), {
    filetype: formato,
    languages: ["es"],
    prompt: CONTEXTO_TRANSCRIPCION,
    keywords: PALABRAS_CLAVE_TRANSCRIPCION,
  });
  return typeof texto === "string" ? texto : "";
}
