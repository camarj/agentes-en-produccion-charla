// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoInterruptores, FilaEscalamiento, MetricasPanel } from "@/lib/panel/tipos";
import { Panel } from "./panel";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

function metricasBase(): MetricasPanel {
  return {
    asistentes: { con_mensajes: 7, registrados: 26, inscritos: 25 },
    mensajes: 42,
    escalamientos_pendientes: 2,
    votos: { positivos: 9, negativos: 3 },
    presupuesto: { acumulado_usd: 0.0345, maximo_usd: 10 },
    observabilidad: {
      disponible: true,
      latencia_p50_ms: 2900,
      latencia_p95_ms: 6700,
      muestras_latencia: 10,
      errores: 1,
      bloqueos: { total: 4, por_motivo: { fuera_de_alcance: 3, inyeccion: 1 } },
      turnos: 20,
    },
    actualizado_en: "2026-09-26T18:00:00.000Z",
  };
}

function interruptoresBase(): EstadoInterruptores {
  return {
    valores: { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", kill_switch: "off", lamina_actual: 12 },
    ultimas_activaciones: { herramienta_caida: "2026-09-26T17:40:00Z", latencia_alta: null, modelo_caido: null, kill_switch: null },
  };
}

let metricas: MetricasPanel;
let estadoInt: EstadoInterruptores;
let cola: FilaEscalamiento[];
let fetchSimulado: ReturnType<typeof vi.fn>;
const posts: Array<{ url: string; metodo: string; cuerpo: unknown }> = [];

beforeEach(() => {
  metricas = metricasBase();
  estadoInt = interruptoresBase();
  cola = [
    { id: 3, pregunta: "¿Qué pasó con [redactado]?", motivo: "falla_tecnica", rol_anonimo: "tecnico", estado: "pendiente", creado_en: "2026-09-26T17:50:00Z" },
    { id: 1, pregunta: "¿Cuánto cobras por una consultoría?", motivo: "comercial", rol_anonimo: "negocio", estado: "respondida", creado_en: "2026-09-26T17:30:00Z" },
  ];
  posts.length = 0;
  fetchSimulado = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    if (metodo !== "GET") {
      const cuerpo = JSON.parse(String(init?.body));
      posts.push({ url, metodo, cuerpo });
      if (url === "/api/panel/interruptores") {
        if (cuerpo.clave === "lamina_actual") estadoInt.valores.lamina_actual = cuerpo.valor;
        else (estadoInt.valores as Record<string, unknown>)[cuerpo.clave] = cuerpo.valor;
        return json(estadoInt);
      }
      cola = cola.map((f) => (f.id === cuerpo.id ? { ...f, estado: cuerpo.estado } : f));
      return json({ ok: true });
    }
    if (url === "/api/panel/metricas") return json(metricas);
    if (url === "/api/panel/interruptores") return json(estadoInt);
    if (url === "/api/panel/escalamientos") return json({ escalamientos: cola });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchSimulado);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const metrica = (nombre: string) => screen.getByRole("group", { name: nombre });

async function montar(studioUrl: string | null = "https://studio.ejemplo.com") {
  render(<Panel studioUrl={studioUrl} />);
  await screen.findByText("42");
}

describe("Panel del speaker", () => {
  it("muestra las métricas y los votos (solo conteos)", async () => {
    await montar();
    expect(within(metrica("Asistentes activos")).getByText("7")).toBeTruthy();
    expect(within(metrica("Asistentes activos")).getByText("/ 26")).toBeTruthy();
    expect(within(metrica("Mensajes")).getByText("42")).toBeTruthy();
    expect(within(metrica("Latencia p50 (última hora)")).getByText("2,9 s")).toBeTruthy();
    expect(within(metrica("Latencia p95 (última hora)")).getByText("6,7 s")).toBeTruthy();
    expect(within(metrica("Errores")).getByText("1")).toBeTruthy();
    const bloqueos = metrica("Bloqueos de guardrails");
    expect(within(bloqueos).getByText("4")).toBeTruthy();
    expect(within(bloqueos).getByText(/Fuera de alcance 3/)).toBeTruthy();
    expect(within(bloqueos).getByText(/Inyección 1/)).toBeTruthy();
    expect(within(metrica("Escalamientos pendientes")).getByText("2")).toBeTruthy();
    expect(within(metrica("Coste estimado")).getByText("$0,035")).toBeTruthy();
    expect(within(metrica("Coste estimado")).getByText("de $10,00")).toBeTruthy();
    expect(within(metrica("Votos")).getByLabelText("9 votos positivos")).toBeTruthy();
    expect(within(metrica("Votos")).getByLabelText("3 votos negativos")).toBeTruthy();
  });

  it("sin tope de presupuesto muestra «sin tope»", async () => {
    metricas.presupuesto.maximo_usd = null;
    await montar();
    expect(within(metrica("Coste estimado")).getByText("sin tope")).toBeTruthy();
  });

  it("observabilidad no disponible: «—» en latencia, errores y bloqueos; el resto se ve", async () => {
    metricas.observabilidad = { disponible: false };
    await montar();
    for (const nombre of ["Latencia p50 (última hora)", "Latencia p95 (última hora)", "Errores", "Bloqueos de guardrails"]) {
      expect(within(metrica(nombre)).getByText("—")).toBeTruthy();
    }
    expect(screen.getByText(/Trazas no disponibles por ahora/)).toBeTruthy();
    expect(within(metrica("Mensajes")).getByText("42")).toBeTruthy();
  });

  it("se actualiza cada 5 s sin recargar", async () => {
    await montar();
    metricas = { ...metricasBase(), mensajes: 43 };
    cola = [...cola, { id: 4, pregunta: "¿Nueva?", motivo: "desacuerdo", rol_anonimo: "salud", estado: "pendiente", creado_en: "2026-09-26T18:01:00Z" }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await screen.findByText("43");
    expect(screen.getByText("¿Nueva?")).toBeTruthy();
  });

  it("si falla una actualización conserva los datos y avisa", async () => {
    await montar();
    fetchSimulado.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await screen.findByText(/Sin conexión con el servidor/);
    expect(within(metrica("Mensajes")).getByText("42")).toBeTruthy();
  });

  describe("lámina actual", () => {
    it("stepper − / + guarda la lámina", async () => {
      const u = userEvent.setup();
      await montar();
      await u.click(screen.getByRole("button", { name: "Lámina siguiente" }));
      expect(posts.at(-1)).toMatchObject({ url: "/api/panel/interruptores", cuerpo: { clave: "lamina_actual", valor: 13 } });
      await waitFor(() => expect((screen.getByLabelText("Número de lámina") as HTMLInputElement).value).toBe("13"));
      await u.click(screen.getByRole("button", { name: "Lámina anterior" }));
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "lamina_actual", valor: 12 });
    });

    it("campo numérico: Enter guarda, y lo lleva al rango 1–39", async () => {
      const u = userEvent.setup();
      await montar();
      const campo = screen.getByLabelText("Número de lámina");
      await u.clear(campo);
      await u.type(campo, "45{Enter}");
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "lamina_actual", valor: 39 });
      await u.clear(campo);
      await u.type(campo, "0{Enter}");
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "lamina_actual", valor: 1 });
    });

    it("en los límites se deshabilita el botón correspondiente", async () => {
      estadoInt.valores.lamina_actual = 39;
      await montar();
      await waitFor(() => expect((screen.getByRole("button", { name: "Lámina siguiente" }) as HTMLButtonElement).disabled).toBe(true));
      expect((screen.getByRole("button", { name: "Lámina anterior" }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("interruptores de caos", () => {
    it("muestran estado y hora de la última activación; al tocar se guardan", async () => {
      const u = userEvent.setup();
      await montar();
      const sw = await screen.findByRole("switch", { name: "Herramienta caída" });
      expect(sw.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/Última activación: \d{2}:\d{2}/)).toBeTruthy();
      expect(screen.getAllByText("Nunca activado").length).toBe(2);
      await u.click(sw);
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "herramienta_caida", valor: "on" });
      await waitFor(() => expect(screen.getByRole("switch", { name: "Herramienta caída" }).getAttribute("aria-checked")).toBe("true"));
    });
  });

  describe("kill switch", () => {
    it("pide confirmación: cancelar no cambia nada", async () => {
      const u = userEvent.setup();
      await montar();
      await u.click(screen.getByRole("button", { name: "Pausar el asistente" }));
      const dialogo = await screen.findByRole("dialog");
      expect(within(dialogo).getByText(/¿Pausar el asistente para todos\?/)).toBeTruthy();
      await u.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(posts.some((p) => (p.cuerpo as { clave?: string }).clave === "kill_switch")).toBe(false);
    });

    it("confirmar pausa el asistente; reanudar lo apaga sin diálogo", async () => {
      const u = userEvent.setup();
      await montar();
      await u.click(screen.getByRole("button", { name: "Pausar el asistente" }));
      const dialogo = await screen.findByRole("dialog");
      await u.click(within(dialogo).getByRole("button", { name: "Sí, pausar" }));
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "kill_switch", valor: "on" });
      await screen.findByText("Asistente en pausa");
      await u.click(screen.getByRole("button", { name: "Reanudar el asistente" }));
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "kill_switch", valor: "off" });
      await screen.findByRole("button", { name: "Pausar el asistente" });
    });
  });

  describe("cola de escalamientos", () => {
    it("muestra pregunta, motivo, rol anónimo y hora; pendientes con acciones", async () => {
      await montar();
      const fila = screen.getByText("¿Qué pasó con [redactado]?").closest("li")!;
      expect(within(fila).getByText("Falla técnica")).toBeTruthy();
      expect(screen.getByText("· 1 pendiente")).toBeTruthy();
      expect(within(fila).getByText("Técnico")).toBeTruthy();
      expect(within(fila).getByText(/\d{2}:\d{2}/)).toBeTruthy();
      expect(within(fila).getByRole("button", { name: "Respondida" })).toBeTruthy();
      expect(within(fila).getByRole("button", { name: "Descartar" })).toBeTruthy();
      const atendida = screen.getByText("¿Cuánto cobras por una consultoría?").closest("li")!;
      expect(within(atendida).queryByRole("button", { name: "Respondida" })).toBeNull();
      expect(within(atendida).getByText("Respondida")).toBeTruthy();
    });

    it("«Respondida» y «Descartar» actualizan la cola", async () => {
      const u = userEvent.setup();
      await montar();
      const fila = screen.getByText("¿Qué pasó con [redactado]?").closest("li")!;
      await u.click(within(fila).getByRole("button", { name: "Respondida" }));
      expect(posts.at(-1)).toMatchObject({ url: "/api/panel/escalamientos", metodo: "PATCH", cuerpo: { id: 3, estado: "respondida" } });
      await waitFor(() => expect(within(screen.getByText("¿Qué pasó con [redactado]?").closest("li")!).queryByRole("button", { name: "Respondida" })).toBeNull());
    });

    it("sin escalamientos muestra un estado vacío", async () => {
      cola = [];
      await montar();
      expect(screen.getByText("No hay preguntas en la cola.")).toBeTruthy();
    });
  });

  it("enlace a Mastra Studio solo si hay URL", async () => {
    await montar();
    const enlace = screen.getByRole("link", { name: /Abrir Mastra Studio/ });
    expect(enlace.getAttribute("href")).toBe("https://studio.ejemplo.com");
    expect(enlace.getAttribute("target")).toBe("_blank");
    cleanup();
    await montar(null);
    expect(screen.queryByRole("link", { name: /Abrir Mastra Studio/ })).toBeNull();
  });
});
