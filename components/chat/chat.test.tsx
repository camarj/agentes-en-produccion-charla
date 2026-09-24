// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_PENDIENTE, Chat } from "./chat";

const toastSimulado = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSimulado }));

// ---------- fetch simulado ----------

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

// Stream SSE de AI SDK UI que el test controla parte por parte.
function streamControlado() {
  const cod = new TextEncoder();
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (control = c) });
  return {
    respuesta: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    empujar: (...partes: object[]) => {
      for (const p of partes) control.enqueue(cod.encode(`data: ${JSON.stringify(p)}\n\n`));
    },
    cerrar: () => {
      control.enqueue(cod.encode("data: [DONE]\n\n"));
      control.close();
    },
  };
}

const inicio = (traceId = "traza-1") => [{ type: "start", messageMetadata: { trace_id: traceId } }, { type: "start-step" }];
const texto = (t: string) => [
  { type: "text-start", id: "x" },
  { type: "text-delta", id: "x", delta: t },
  { type: "text-end", id: "x" },
];
const fin = (traceId = "traza-1") => [{ type: "finish-step" }, { type: "finish", messageMetadata: { trace_id: traceId } }];

function respuestaCompleta(t: string, traceId = "traza-1") {
  const s = streamControlado();
  s.empujar(...inicio(traceId), ...texto(t), ...fin(traceId));
  s.cerrar();
  return s.respuesta;
}

type Manejador = (init: RequestInit | undefined) => Response | Promise<Response>;

let historial: unknown[];
let colaChat: Manejador[];
let fetchSimulado: ReturnType<typeof vi.fn>;
let enLinea: boolean;

const SUGERENCIAS = ["¿Qué es el loop de un agente?", "¿Qué es el harness?", "¿Qué diferencia a un agente de un chatbot?"];

beforeEach(() => {
  historial = [];
  colaChat = [];
  enLinea = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => enLinea });
  fetchSimulado = vi.fn(async (url: string, init?: RequestInit) => {
    switch (url) {
      case "/api/chat/historial":
        return json(200, { messages: historial });
      case "/api/sugerencias":
        return json(200, { sugerencias: SUGERENCIAS });
      case "/api/feedback":
      case "/api/chat/nuevo":
        return json(200, { ok: true });
      case "/api/chat": {
        const siguiente = colaChat.shift();
        if (!siguiente) throw new Error("sin respuesta preparada para /api/chat");
        return siguiente(init);
      }
    }
    throw new Error(`ruta inesperada ${url}`);
  });
  vi.stubGlobal("fetch", fetchSimulado);
  toastSimulado.mockClear();
  toastSimulado.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    // sin almacenamiento
  }
});

const llamadasA = (url: string) => fetchSimulado.mock.calls.filter((c) => c[0] === url);
const caja = () => screen.getByPlaceholderText("Pregunta sobre la charla…") as HTMLTextAreaElement;
const botonEnviar = () => screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;

async function montar(props: Partial<React.ComponentProps<typeof Chat>> = {}) {
  const onSesionExpirada = props.onSesionExpirada ?? vi.fn();
  render(<Chat nombrePila="Andrea" onSesionExpirada={onSesionExpirada} intervaloReintentoMs={50} {...props} />);
  await waitFor(() => expect(caja().disabled).toBe(false));
  return { onSesionExpirada };
}

async function preguntar(t: string) {
  await userEvent.type(caja(), t);
  await userEvent.click(botonEnviar());
}

// ---------- tests ----------

describe("Chat: hidratación y estado vacío", () => {
  it("sin conversación: saludo y 3 sugerencias; tocar una la envía", async () => {
    colaChat.push(() => respuestaCompleta("El loop es percibir, decidir y actuar (lámina 5)."));
    await montar();
    expect(screen.getByRole("heading", { name: "Hola, Andrea." })).toBeTruthy();
    const chips = SUGERENCIAS.map((s) => screen.getByRole("button", { name: s }));
    expect(chips).toHaveLength(3);

    await userEvent.click(chips[0]);
    expect(await screen.findByText("lámina 5")).toBeTruthy();
    expect(within(screen.getByRole("log")).getByText(SUGERENCIAS[0])).toBeTruthy(); // burbuja del usuario
    expect(screen.queryByRole("heading", { name: "Hola, Andrea." })).toBeNull();

    // Solo el último mensaje viaja: el historial lo aporta la memoria del servidor.
    const cuerpo = JSON.parse(llamadasA("/api/chat")[0][1].body);
    expect(cuerpo.messages).toHaveLength(1);
    expect(cuerpo.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: SUGERENCIAS[0] }] });
  });

  it("saludo sin nombre", async () => {
    await montar({ nombrePila: undefined });
    expect(screen.getByRole("heading", { name: "Hola." })).toBeTruthy();
  });

  it("al montar carga el historial y lo muestra (respuesta partida en dos mensajes)", async () => {
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "¿Qué es el harness?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "tool-buscar_laminas", toolCallId: "c", state: "output-available", input: {}, output: {} }], metadata: { trace_id: "t-h" } },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Es lo que rodea al **modelo**." }] },
    ];
    await montar();
    expect(within(screen.getByRole("log")).getByText("¿Qué es el harness?")).toBeTruthy();
    expect(screen.getByText("modelo").tagName).toBe("STRONG");
    expect(screen.queryByRole("heading", { name: "Hola, Andrea." })).toBeNull();
    // Una sola respuesta con sus acciones (y el trace_id del historial).
    expect(screen.getAllByRole("button", { name: "Copiar" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Me sirvió" }));
    expect(JSON.parse(llamadasA("/api/feedback")[0][1].body)).toEqual({ trace_id: "t-h", valor: 1 });
  });

  it("historial con sesión vencida → vuelve a la entrada", async () => {
    fetchSimulado.mockImplementationOnce(async () => json(401, { error: "no_autenticado", mensaje: "Tu sesión expiró." }));
    const onSesionExpirada = vi.fn();
    render(<Chat nombrePila="Andrea" onSesionExpirada={onSesionExpirada} />);
    await waitFor(() => expect(onSesionExpirada).toHaveBeenCalled());
  });

  it("la zona de respuesta es aria-live polite", async () => {
    await montar();
    expect(screen.getByRole("log").getAttribute("aria-live")).toBe("polite");
  });
});

describe("Chat: streaming e indicadores", () => {
  it("pensando → buscando en las láminas → texto → acciones con el trace_id", async () => {
    const s = streamControlado();
    colaChat.push(() => s.respuesta);
    await montar();
    await preguntar("¿Qué es el harness?");

    expect(await screen.findByText("Pensando…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detener" })).toBeTruthy();

    act(() => s.empujar(...inicio("traza-7"), { type: "tool-input-start", toolCallId: "c1", toolName: "buscar_laminas" }));
    expect(await screen.findByText("Buscando en las láminas…")).toBeTruthy();

    act(() =>
      s.empujar(
        { type: "tool-input-available", toolCallId: "c1", toolName: "buscar_laminas", input: { consulta: "harness" } },
        { type: "tool-output-available", toolCallId: "c1", output: { laminas: [] } },
        ...texto("Rodea al modelo (lámina 11)."),
      ),
    );
    expect(await screen.findByText("lámina 11")).toBeTruthy();
    expect(screen.queryByText("Buscando en las láminas…")).toBeNull();
    expect(screen.queryByText("Pensando…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();

    act(() => {
      s.empujar(...fin("traza-7"));
      s.cerrar();
    });
    await userEvent.click(await screen.findByRole("button", { name: "No me sirvió" }));
    expect(JSON.parse(llamadasA("/api/feedback")[0][1].body)).toEqual({ trace_id: "traza-7", valor: -1 });
    expect(botonEnviar()).toBeTruthy();
  });

  it("si escala, muestra «Enviando tu pregunta a Raúl…»", async () => {
    const s = streamControlado();
    colaChat.push(() => s.respuesta);
    await montar();
    await preguntar("¿Cuánto cobra Raúl?");
    act(() => s.empujar(...inicio(), { type: "tool-input-start", toolCallId: "c1", toolName: "escalar_pregunta" }));
    expect(await screen.findByText("Enviando tu pregunta a Raúl…")).toBeTruthy();
  });

  it("detener corta la petición y conserva el texto parcial", async () => {
    const s = streamControlado();
    let senal: AbortSignal | undefined;
    colaChat.push((init) => {
      senal = init?.signal ?? undefined;
      return s.respuesta;
    });
    await montar();
    await preguntar("Explícame todo");
    act(() => s.empujar(...inicio(), { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: "Primera parte" }));
    expect(await screen.findByText("Primera parte")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Detener" }));
    await waitFor(() => expect(senal?.aborted).toBe(true));
    expect(await screen.findByRole("button", { name: "Enviar" })).toBeTruthy();
    expect(screen.getByText("Primera parte")).toBeTruthy();
    expect(screen.queryByText("Se interrumpió la respuesta")).toBeNull();
  });
});

describe("Chat: estados de error", () => {
  it("stream interrumpido → texto parcial + aviso + Reintentar", async () => {
    const s = streamControlado();
    colaChat.push(() => s.respuesta);
    colaChat.push(() => respuestaCompleta("Respuesta completa."));
    await montar();
    await preguntar("¿Qué son los evals?");
    act(() => {
      s.empujar(...inicio(), { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: "Los evals son" });
      s.empujar({ type: "error", errorText: "La respuesta se interrumpió. Intenta preguntar de nuevo." });
      s.cerrar();
    });
    expect(await screen.findByText("Se interrumpió la respuesta")).toBeTruthy();
    expect(screen.getByText("Los evals son")).toBeTruthy();
    // La respuesta incompleta no se copia ni se vota.
    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();
    // Nunca el texto técnico.
    expect(screen.queryByText(/Intenta preguntar de nuevo/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Respuesta completa.")).toBeTruthy();
    expect(screen.queryByText("Se interrumpió la respuesta")).toBeNull();
    expect(screen.queryByText("Los evals son")).toBeNull();
    expect(llamadasA("/api/chat")).toHaveLength(2);
  });

  it("423 mantenimiento → banner, composer deshabilitado y reintento automático hasta que vuelve", async () => {
    const pausa = () => json(423, { error: "mantenimiento", mensaje: "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto." });
    colaChat.push(pausa, pausa, () => respuestaCompleta("Ya volví."));
    await montar();
    await preguntar("¿Hola?");
    expect(await screen.findByText("El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.")).toBeTruthy();
    expect(caja().disabled).toBe(true);

    expect(await screen.findByText("Ya volví.", {}, { timeout: 2000 })).toBeTruthy();
    expect(llamadasA("/api/chat")).toHaveLength(3);
    expect(screen.queryByText(/en pausa/)).toBeNull();
    expect(caja().disabled).toBe(false);
    // La pregunta sigue una sola vez en pantalla.
    expect(screen.getAllByText("¿Hola?")).toHaveLength(1);
  });

  it("429 tope → mensaje del servidor y composer deshabilitado", async () => {
    colaChat.push(() => json(429, { error: "tope", mensaje: "Llegaste al límite de preguntas de esta charla." }));
    await montar();
    await preguntar("Una más");
    expect(await screen.findByText("Llegaste al límite de preguntas de esta charla.")).toBeTruthy();
    expect(caja().disabled).toBe(true);
    expect(botonEnviar().disabled).toBe(true);
  });

  it("429 frecuencia → toast y la pregunta vuelve al composer", async () => {
    colaChat.push(() => json(429, { error: "demasiados_mensajes", mensaje: "Vas muy rápido." }));
    await montar();
    await preguntar("Rápida");
    await waitFor(() => expect(toastSimulado).toHaveBeenCalledWith("Vas muy rápido, espera unos segundos"));
    expect(caja().value).toBe("Rápida");
    expect(within(screen.getByRole("log")).queryByText("Rápida")).toBeNull();
    expect(caja().disabled).toBe(false);
  });

  it("sin conexión → banner; al volver la conexión reenvía la pregunta", async () => {
    await montar();
    enLinea = false;
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(await screen.findByText("Sin conexión")).toBeTruthy();

    colaChat.push(() => {
      throw new TypeError("Failed to fetch");
    });
    colaChat.push(() => respuestaCompleta("Llegó al volver."));
    await preguntar("¿Sigues ahí?");
    await waitFor(() => expect(llamadasA("/api/chat")).toHaveLength(1));
    expect(screen.queryByText("Se interrumpió la respuesta")).toBeNull();

    enLinea = true;
    act(() => void window.dispatchEvent(new Event("online")));
    expect(await screen.findByText("Llegó al volver.")).toBeTruthy();
    expect(screen.queryByText("Sin conexión")).toBeNull();
    expect(llamadasA("/api/chat")).toHaveLength(2);
  });

  it("401 → vuelve a la pantalla de entrada", async () => {
    colaChat.push(() => json(401, { error: "no_autenticado", mensaje: "Tu sesión expiró. Vuelve a entrar con tu email." }));
    const { onSesionExpirada } = await montar();
    await preguntar("Hola");
    await waitFor(() => expect(onSesionExpirada).toHaveBeenCalled());
    expect(toastSimulado.error).toHaveBeenCalledWith("Tu sesión expiró. Vuelve a entrar con tu email.");
  });
});

describe("Chat: cabecera", () => {
  it("«Nueva conversación» crea un hilo nuevo y vuelve al estado vacío", async () => {
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Pregunta vieja" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Respuesta vieja" }] },
    ];
    await montar();
    expect(screen.getByText("Respuesta vieja")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Menú" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Nueva conversación" }));
    expect(await screen.findByRole("heading", { name: "Hola, Andrea." })).toBeTruthy();
    expect(screen.queryByText("Respuesta vieja")).toBeNull();
    expect(llamadasA("/api/chat/nuevo")).toHaveLength(1);
    expect(llamadasA("/api/chat/nuevo")[0][1].method).toBe("POST");
  });

  it("«Cómo funciona» abre un diálogo breve", async () => {
    await montar();
    await userEvent.click(screen.getByRole("button", { name: "Menú" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cómo funciona" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Puedo equivocarme/)).toBeTruthy();
    expect(within(dialogo).getByText(/email solo para personalizar/)).toBeTruthy();
  });

  it("título corto y cabecera de 56 px", async () => {
    await montar();
    const titulo = screen.getByText("Agentes en producción");
    expect(titulo.closest("header")?.className).toContain("h-14");
  });
});

// ---------- Arreglos post-T14: pausa larga, pregunta en espera y sugerencias vivas ----------

const PAUSA = "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.";
const FALLAS = "Estamos presentando fallas en este momento. Tu pregunta quedó en espera y se responderá apenas el asistente vuelva.";
const pausa = () => json(423, { error: "mantenimiento", mensaje: PAUSA });

describe("Chat: pausa (kill switch) prolongada", () => {
  it("tras 3 reintentos fallidos cambia el aviso, sigue reintentando y al volver responde sin reenviar", async () => {
    colaChat.push(pausa, pausa, pausa, pausa, pausa, () => respuestaCompleta("Ya volví."));
    await montar();
    await preguntar("¿Hola?");
    expect(await screen.findByText(PAUSA)).toBeTruthy();
    // La pregunta queda como mensaje del usuario, marcada «En espera».
    const log = screen.getByRole("log");
    expect(within(log).getByText("¿Hola?")).toBeTruthy();
    expect(within(log).getByText("En espera")).toBeTruthy();

    expect(await screen.findByText(FALLAS, {}, { timeout: 2000 })).toBeTruthy();
    expect(llamadasA("/api/chat").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(PAUSA)).toBeNull();

    expect(await screen.findByText("Ya volví.", {}, { timeout: 2000 })).toBeTruthy();
    expect(llamadasA("/api/chat")).toHaveLength(6);
    expect(screen.queryByText(FALLAS)).toBeNull();
    expect(screen.queryByText("En espera")).toBeNull();
    expect(screen.getAllByText("¿Hola?")).toHaveLength(1);
    expect(localStorage.getItem(CLAVE_PENDIENTE)).toBeNull();
  });

  it("guarda la pregunta en espera en localStorage mientras dura la pausa", async () => {
    colaChat.push(pausa, pausa, pausa, pausa, pausa, pausa, pausa, pausa, pausa, pausa);
    await montar({ intervaloReintentoMs: 60_000 });
    await preguntar("¿Me guardas?");
    await screen.findByText(PAUSA);
    expect(JSON.parse(localStorage.getItem(CLAVE_PENDIENTE)!)).toMatchObject({ texto: "¿Me guardas?" });
  });

  it("al recargar con una pregunta en espera, la muestra y la reenvía sola hasta que se responde", async () => {
    localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify({ texto: "¿Sigo en espera?", fallas: 4 }));
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Vieja" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Respuesta vieja" }] },
    ];
    colaChat.push(pausa, () => respuestaCompleta("Respondida tras recargar."));
    render(<Chat nombrePila="Andrea" onSesionExpirada={vi.fn()} intervaloReintentoMs={50} />);
    // Ya había pasado 3 reintentos: aviso de fallas directamente.
    expect(await screen.findByText(FALLAS)).toBeTruthy();
    expect(within(screen.getByRole("log")).getByText("¿Sigo en espera?")).toBeTruthy();
    expect(await screen.findByText("Respondida tras recargar.", {}, { timeout: 2000 })).toBeTruthy();
    const cuerpo = JSON.parse(llamadasA("/api/chat")[0][1].body);
    expect(cuerpo.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: "¿Sigo en espera?" }] });
    expect(screen.getAllByText("¿Sigo en espera?")).toHaveLength(1);
    expect(localStorage.getItem(CLAVE_PENDIENTE)).toBeNull();
  });

  it("si el historial ya tiene la pregunta respondida, no la reenvía", async () => {
    localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify({ texto: "Ya respondida", fallas: 1 }));
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Ya respondida" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Sí." }] },
    ];
    await montar();
    expect(llamadasA("/api/chat")).toHaveLength(0);
    expect(localStorage.getItem(CLAVE_PENDIENTE)).toBeNull();
  });

  it("localStorage que lanza no rompe el chat", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    colaChat.push(pausa, () => respuestaCompleta("Igual respondo."));
    await montar();
    await preguntar("¿Sin almacenamiento?");
    expect(await screen.findByText("Igual respondo.", {}, { timeout: 2000 })).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe("Chat: sugerencias vivas", () => {
  const OTRAS = ["¿Qué guardrails conviene poner?", "¿Cómo uso evals?", "¿Qué es la resiliencia?"];

  it("se vuelven a pedir cada cierto tiempo (no-store) y cambian en el estado vacío", async () => {
    await montar({ intervaloSugerenciasMs: 50 });
    expect(screen.getByRole("button", { name: SUGERENCIAS[0] })).toBeTruthy();
    fetchSimulado.mockImplementation(async (url: string) =>
      url === "/api/sugerencias" ? json(200, { sugerencias: OTRAS }) : json(200, { messages: [] }),
    );
    expect(await screen.findByRole("button", { name: OTRAS[0] }, { timeout: 2000 })).toBeTruthy();
    expect(llamadasA("/api/sugerencias").at(-1)![1]).toMatchObject({ cache: "no-store" });
  });

  it("se vuelven a pedir al volver a la pestaña (visibilitychange) y al enfocar", async () => {
    await montar();
    const antes = llamadasA("/api/sugerencias").length;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(llamadasA("/api/sugerencias").length).toBe(antes + 1));
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(llamadasA("/api/sugerencias").length).toBe(antes + 2));
  });

  it("con conversación: fila compacta sobre el composer; tocar una la envía", async () => {
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Vieja" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Respuesta vieja" }] },
    ];
    await montar();
    const fila = screen.getByRole("group", { name: "Preguntas sugeridas" });
    expect(fila.className).toContain("overflow-x-auto");
    const chips = within(fila).getAllByRole("button");
    expect(chips).toHaveLength(3);
    expect(chips[0].className).toContain("min-h-11");

    const s = streamControlado();
    colaChat.push(() => s.respuesta);
    await userEvent.click(chips[1]);
    // Oculta mientras responde.
    await waitFor(() => expect(screen.queryByRole("group", { name: "Preguntas sugeridas" })).toBeNull());
    s.empujar(...inicio(), ...texto("Listo."), ...fin());
    s.cerrar();
    expect(await screen.findByText("Listo.")).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Preguntas sugeridas" })).toBeTruthy();
    const cuerpo = JSON.parse(llamadasA("/api/chat")[0][1].body);
    expect(cuerpo.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: SUGERENCIAS[1] }] });
  });

  it("oculta la fila en pausa y con el tope", async () => {
    historial = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Vieja" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Respuesta vieja" }] },
    ];
    colaChat.push(pausa, pausa, pausa, pausa, pausa, pausa);
    await montar({ intervaloReintentoMs: 60_000 });
    await preguntar("¿Pausa?");
    await screen.findByText(PAUSA);
    expect(screen.queryByRole("group", { name: "Preguntas sugeridas" })).toBeNull();
  });

  it("en el estado vacío no se duplica la fila", async () => {
    await montar();
    expect(screen.queryByRole("group", { name: "Preguntas sugeridas" })).toBeNull();
    expect(screen.getAllByRole("button", { name: SUGERENCIAS[0] })).toHaveLength(1);
  });
});
