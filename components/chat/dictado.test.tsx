// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

const toastSimulado = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSimulado }));

// ---------- MediaRecorder y micrófono simulados ----------

class GrabadorFalso {
  static soportados = ["audio/webm;codecs=opus", "audio/webm"];
  static isTypeSupported = (t: string) => GrabadorFalso.soportados.includes(t);
  static instancias: GrabadorFalso[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    opciones?: { mimeType?: string },
  ) {
    this.mimeType = opciones?.mimeType ?? "audio/webm";
    GrabadorFalso.instancias.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const pista = { stop: vi.fn() };
let getUserMedia: ReturnType<typeof vi.fn>;
let fetchSimulado: ReturnType<typeof vi.fn>;

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  GrabadorFalso.instancias = [];
  pista.stop.mockClear();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [pista] }) as unknown as MediaStream);
  vi.stubGlobal("MediaRecorder", GrabadorFalso);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  fetchSimulado = vi.fn(async () => json(200, { texto: "¿Qué es el harness?" }));
  vi.stubGlobal("fetch", fetchSimulado);
  toastSimulado.mockClear();
  toastSimulado.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

function Envoltura(props: { inicial?: string; ocupado?: boolean; deshabilitado?: boolean; onEnviar?: () => void; onPausa?: (m: string) => void }) {
  const [valor, setValor] = useState(props.inicial ?? "");
  return (
    <Composer
      valor={valor}
      onCambiar={setValor}
      onEnviar={props.onEnviar ?? vi.fn()}
      onDetener={vi.fn()}
      ocupado={props.ocupado ?? false}
      deshabilitado={props.deshabilitado ?? false}
      onPausaDictado={props.onPausa}
    />
  );
}

const caja = () => screen.getByPlaceholderText("Pregunta sobre la charla…") as HTMLTextAreaElement;
const microfono = () => screen.getByRole("button", { name: "Dictar pregunta" }) as HTMLButtonElement;

async function grabarYDetener() {
  await act(async () => fireEvent.click(microfono()));
  const detener = await screen.findByRole("button", { name: "Detener dictado" });
  await act(async () => fireEvent.click(detener));
}

describe("Dictado por voz en el composer", () => {
  it("sin MediaRecorder o sin getUserMedia el botón no aparece", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<Envoltura />);
    expect(screen.queryByRole("button", { name: "Dictar pregunta" })).toBeNull();
    cleanup();
    vi.stubGlobal("MediaRecorder", GrabadorFalso);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<Envoltura />);
    expect(screen.queryByRole("button", { name: "Dictar pregunta" })).toBeNull();
  });

  it("botón accesible de 44 px con anillo de foco; se deshabilita durante el stream o la pausa", () => {
    render(<Envoltura />);
    expect(microfono().className).toMatch(/size-11/);
    expect(microfono().className).toMatch(/focus-visible:ring/);
    expect(microfono().getAttribute("aria-pressed")).toBe("false");
    cleanup();
    render(<Envoltura ocupado />);
    expect(microfono().disabled).toBe(true);
    cleanup();
    render(<Envoltura deshabilitado />);
    expect(microfono().disabled).toBe(true);
  });

  it("graba con webm/opus, muestra el indicador rojo con el tiempo y al detener sube el audio", async () => {
    render(<Envoltura />);
    await act(async () => fireEvent.click(microfono()));
    const detener = screen.getByRole("button", { name: "Detener dictado" });
    expect(detener.getAttribute("aria-pressed")).toBe("true");
    expect(detener.className).toMatch(/bg-red/);
    expect(screen.getByText("0:00")).toBeTruthy();
    expect(GrabadorFalso.instancias[0].mimeType).toBe("audio/webm;codecs=opus");
    await act(async () => fireEvent.click(detener));
    await waitFor(() => expect(fetchSimulado).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSimulado.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/api\/transcribir\?duracion=\d/);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("audio/webm;codecs=opus");
    expect(init.body).toBeInstanceOf(Blob);
    expect(pista.stop).toHaveBeenCalled();
  });

  it("en iOS Safari graba en mp4", async () => {
    GrabadorFalso.soportados = ["audio/mp4"];
    try {
      render(<Envoltura />);
      await grabarYDetener();
      expect(GrabadorFalso.instancias[0].mimeType).toBe("audio/mp4");
    } finally {
      GrabadorFalso.soportados = ["audio/webm;codecs=opus", "audio/webm"];
    }
  });

  it("muestra «Transcribiendo…» mientras espera la respuesta", async () => {
    let responder!: (r: Response) => void;
    fetchSimulado.mockImplementationOnce(() => new Promise<Response>((r) => (responder = r)));
    render(<Envoltura />);
    await grabarYDetener();
    const boton = await screen.findByRole("button", { name: "Transcribiendo…" });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    await act(async () => responder(json(200, { texto: "hola" })));
    expect(await screen.findByRole("button", { name: "Dictar pregunta" })).toBeTruthy();
  });

  it("el texto se inserta en el composer, sin enviarse, y el cuadro queda enfocado", async () => {
    const onEnviar = vi.fn();
    render(<Envoltura onEnviar={onEnviar} />);
    await grabarYDetener();
    await waitFor(() => expect(caja().value).toBe("¿Qué es el harness?"));
    await waitFor(() => expect(document.activeElement).toBe(caja()));
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("si ya había texto, lo agrega al final con un espacio", async () => {
    render(<Envoltura inicial="Hola." />);
    await grabarYDetener();
    await waitFor(() => expect(caja().value).toBe("Hola. ¿Qué es el harness?"));
  });

  it("se detiene sola a los 60 s", async () => {
    vi.useFakeTimers();
    render(<Envoltura />);
    await act(async () => fireEvent.click(microfono()));
    await act(async () => vi.advanceTimersByTime(59_000));
    expect(screen.getByText("0:59")).toBeTruthy();
    expect(GrabadorFalso.instancias[0].state).toBe("recording");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(GrabadorFalso.instancias[0].state).toBe("inactive");
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(fetchSimulado.mock.calls[0][0]).toBe("/api/transcribir?duracion=60");
  });

  it("permiso de micrófono denegado → aviso y no graba", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denegado"), { name: "NotAllowedError" }));
    render(<Envoltura />);
    await act(async () => fireEvent.click(microfono()));
    expect(toastSimulado.error).toHaveBeenCalledWith(
      "Activa el permiso del micrófono para dictar. También puedes escribir tu pregunta.",
    );
    expect(GrabadorFalso.instancias).toHaveLength(0);
    expect(microfono()).toBeTruthy();
  });

  it("transcripción vacía → «No se entendió el audio»", async () => {
    fetchSimulado.mockResolvedValueOnce(json(200, { texto: "" }));
    render(<Envoltura inicial="previo" />);
    await grabarYDetener();
    await waitFor(() => expect(toastSimulado).toHaveBeenCalledWith("No se entendió el audio. Intenta de nuevo."));
    expect(caja().value).toBe("previo");
  });

  it("429 → «Vas muy rápido, espera unos segundos»", async () => {
    fetchSimulado.mockResolvedValueOnce(json(429, { error: "demasiados_dictados", mensaje: "x" }));
    render(<Envoltura />);
    await grabarYDetener();
    await waitFor(() => expect(toastSimulado).toHaveBeenCalledWith("Vas muy rápido, espera unos segundos"));
  });

  it("423 → avisa la pausa al chat (mismo banner)", async () => {
    const onPausa = vi.fn();
    const mensaje = "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.";
    fetchSimulado.mockResolvedValueOnce(json(423, { error: "mantenimiento", mensaje }));
    render(<Envoltura onPausa={onPausa} />);
    await grabarYDetener();
    await waitFor(() => expect(onPausa).toHaveBeenCalledWith(mensaje));
  });

  it("otro error → mensaje del servidor, sin detalles técnicos", async () => {
    fetchSimulado.mockResolvedValueOnce(json(502, { error: "transcripcion_fallida", mensaje: "No pudimos transcribir." }));
    render(<Envoltura />);
    await grabarYDetener();
    await waitFor(() => expect(toastSimulado.error).toHaveBeenCalledWith("No pudimos transcribir."));
  });
});
