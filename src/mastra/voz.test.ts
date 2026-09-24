import { beforeEach, describe, expect, it, vi } from "vitest";

const simulado = vi.hoisted(() => ({
  configs: [] as unknown[],
  listen: vi.fn<(s: NodeJS.ReadableStream, o?: Record<string, unknown>) => Promise<unknown>>(async () => "¿Qué es el harness?"),
}));
vi.mock("@mastra/voice-openai", () => ({
  OpenAIVoice: class {
    constructor(config: unknown) {
      simulado.configs.push(config);
    }
    listen = simulado.listen;
  },
}));

import { MODELO_TRANSCRIPCION, transcribirAudio } from "./voz";

async function leer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of s) partes.push(Buffer.from(p as Buffer));
  return Buffer.concat(partes);
}

beforeEach(() => simulado.listen.mockClear());

describe("transcribirAudio (Mastra Voice + OpenAI)", () => {
  it("usa gpt-transcribe en español, con pistas de la jerga de la charla, y crea la voz una sola vez", async () => {
    const audio = new Uint8Array([1, 2, 3]);
    expect(await transcribirAudio(audio, "webm")).toBe("¿Qué es el harness?");
    await transcribirAudio(audio, "mp4");
    expect(MODELO_TRANSCRIPCION).toBe("gpt-transcribe");
    expect(simulado.configs).toHaveLength(1);
    expect(simulado.configs[0]).toMatchObject({ listeningModel: { name: "gpt-transcribe" } });
    const [flujo, opciones] = simulado.listen.mock.calls[0];
    expect(await leer(flujo)).toEqual(Buffer.from(audio));
    expect(opciones).toMatchObject({ filetype: "webm", languages: ["es"] });
    expect(opciones?.keywords).toEqual(expect.arrayContaining(["harness", "evals", "guardrails"]));
    expect(simulado.listen.mock.calls[1][1]).toMatchObject({ filetype: "mp4" });
  });

  it("si el proveedor no devuelve texto, responde cadena vacía", async () => {
    simulado.listen.mockResolvedValueOnce(undefined);
    expect(await transcribirAudio(new Uint8Array([1]), "wav")).toBe("");
  });
});
