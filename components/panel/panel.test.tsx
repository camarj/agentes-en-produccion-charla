// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoInterruptores, FilaEscalamiento, MetricasPanel } from "@/lib/panel/tipos";
import { TRAMOS } from "@/lib/tramos";
import { CLAVE_RECARGA, VERSION_APP } from "@/lib/version-app";
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
      errores: 4,
      errores_por_tipo: { tiempo: 2, herramienta: 1, modelo: 1 },
      bloqueos: { total: 4, por_motivo: { fuera_de_alcance: 3, inyeccion: 1 } },
      turnos: 20,
      respaldo: { ultima_hora: 3, ultima_en: "2026-09-26T17:58:00.000Z" },
      modelo_en_uso: { estado: "principal", modelo: "gpt-6-luna", en: "2026-09-26T17:59:00.000Z" },
    },
    actualizado_en: "2026-09-26T18:00:00.000Z",
    version: VERSION_APP,
  };
}

function interruptoresBase(): EstadoInterruptores {
  return {
    valores: { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", modelos_caidos: "off", kill_switch: "off", lamina_actual: 12 },
    ultimas_activaciones: { herramienta_caida: "2026-09-26T17:40:00Z", latencia_alta: null, modelo_caido: null, modelos_caidos: null, kill_switch: null },
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
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const metrica = (nombre: string) => screen.getByRole("group", { name: nombre });

async function montar(studioUrl: string | null = "https://studio.ejemplo.com", alRecargar = vi.fn()) {
  render(<Panel studioUrl={studioUrl} alRecargar={alRecargar} />);
  await screen.findByText("42");
}

describe("Panel del speaker", () => {
  it("sin fallas ni respaldo: 0 y sin desglose", async () => {
    metricas.observabilidad = { ...(metricas.observabilidad as Extract<MetricasPanel["observabilidad"], { disponible: true }>), errores: 0, errores_por_tipo: {}, respaldo: { ultima_hora: 0, ultima_en: null } };
    await montar();
    expect(within(metrica("Fallas técnicas")).getByText("0")).toBeTruthy();
    expect(within(metrica("Fallas técnicas")).queryByText(/tiempo agotado/)).toBeNull();
    expect(within(metrica("Modelo en uso")).getByText("respaldo: 0 en la última hora")).toBeTruthy();
  });

  it("con «Modelo caído» encendido, su fila dice que responde el respaldo", async () => {
    estadoInt.valores.modelo_caido = "on";
    await montar();
    expect(screen.getByText("Responde el modelo de respaldo")).toBeTruthy();
  });

  it("con «Modelo caído» apagado no aparece el aviso", async () => {
    await montar();
    expect(screen.queryByText("Responde el modelo de respaldo")).toBeNull();
  });

  it("muestra las métricas y los votos (solo conteos)", async () => {
    await montar();
    expect(within(metrica("Asistentes activos")).getByText("7")).toBeTruthy();
    expect(within(metrica("Asistentes activos")).getByText("/ 26")).toBeTruthy();
    expect(within(metrica("Mensajes")).getByText("42")).toBeTruthy();
    expect(within(metrica("Latencia p50 (última hora)")).getByText("2,9 s")).toBeTruthy();
    expect(within(metrica("Latencia p95 (última hora)")).getByText("6,7 s")).toBeTruthy();
    const fallas = metrica("Fallas técnicas");
    expect(within(fallas).getByText("4")).toBeTruthy();
    expect(within(fallas).getByText("fallas de herramientas o modelos (12 h)")).toBeTruthy();
    expect(within(fallas).getByText("1 herramienta · 1 modelo · 2 tiempo agotado")).toBeTruthy();
    const modelo = metrica("Modelo en uso");
    expect(within(modelo).getByText("gpt-6-luna")).toBeTruthy();
    expect(within(modelo).getByText(/^última respuesta: gpt-6-luna a las \d{2}:\d{2}$/)).toBeTruthy();
    expect(within(modelo).getByText("respaldo: 3 en la última hora")).toBeTruthy();
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
    for (const nombre of ["Latencia p50 (última hora)", "Latencia p95 (última hora)", "Fallas técnicas", "Bloqueos de guardrails"]) {
      expect(within(metrica(nombre)).getByText("—")).toBeTruthy();
    }
    // «Modelo en uso» sale de los interruptores: no depende de las trazas.
    expect(within(metrica("Modelo en uso")).getByText("última respuesta: —")).toBeTruthy();
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

  describe("modelo en uso", () => {
    const obs = () => metricas.observabilidad as Extract<MetricasPanel["observabilidad"], { disponible: true }>;
    const tarjeta = () => metrica("Modelo en uso");
    const valor = () => within(tarjeta()).getByTestId("modelo-en-uso");

    it("interruptores apagados: el principal en blanco, aunque la última respuesta fuera del respaldo", async () => {
      obs().modelo_en_uso = { estado: "respaldo", modelo: "anthropic/claude-sonnet-5", en: "2026-09-26T17:59:00.000Z" };
      obs().respaldo = { ultima_hora: 1, ultima_en: "2026-09-26T17:59:00.000Z" };
      await montar();
      await waitFor(() => expect(valor().textContent).toBe("gpt-6-luna"));
      expect(valor().className).not.toMatch(/amber|red/);
      expect(within(tarjeta()).getByText(/^última respuesta: claude-sonnet-5 a las \d{2}:\d{2}$/)).toBeTruthy();
      expect(within(tarjeta()).getByText("respaldo: 1 en la última hora")).toBeTruthy();
    });

    it("«Modelo caído» encendido: «claude-sonnet-5 · respaldo» en ámbar antes de que nadie pregunte", async () => {
      estadoInt.valores.modelo_caido = "on";
      await montar();
      await waitFor(() => expect(valor().textContent).toBe("claude-sonnet-5 · respaldo"));
      expect(valor().className).toMatch(/amber/);
      expect(within(tarjeta()).getByText(/^última respuesta: gpt-6-luna a las \d{2}:\d{2}$/)).toBeTruthy();
    });

    it("«Modelos caídos» encendido: «Sin modelo · falla técnica» en rojo", async () => {
      estadoInt.valores.modelos_caidos = "on";
      estadoInt.valores.modelo_caido = "on";
      await montar();
      await waitFor(() => expect(valor().textContent).toBe("Sin modelo · falla técnica"));
      expect(valor().className).toMatch(/red/);
    });

    it("cambia apenas se toca el interruptor, sin esperar una respuesta del agente", async () => {
      const u = userEvent.setup();
      await montar();
      await waitFor(() => expect(valor().textContent).toBe("gpt-6-luna"));
      await u.click(screen.getByRole("switch", { name: "Modelo caído" }));
      await waitFor(() => expect(valor().textContent).toBe("claude-sonnet-5 · respaldo"));
      await u.click(screen.getByRole("switch", { name: "Modelo caído" }));
      await waitFor(() => expect(valor().textContent).toBe("gpt-6-luna"));
    });

    it("sin turnos todavía o sin trazas: la última respuesta dice «—»", async () => {
      obs().modelo_en_uso = null;
      await montar();
      expect(within(tarjeta()).getByText("última respuesta: —")).toBeTruthy();
      cleanup();
      metricas = metricasBase();
      metricas.observabilidad = { disponible: false };
      await montar();
      await waitFor(() => expect(valor().textContent).toBe("gpt-6-luna"));
      expect(within(tarjeta()).getByText("última respuesta: —")).toBeTruthy();
    });

    it("no hay tarjeta «Modelo de respaldo» (la reemplaza «Modelo en uso»)", async () => {
      await montar();
      expect(screen.queryByRole("group", { name: "Modelo de respaldo" })).toBeNull();
    });
  });

  describe("tramo de la presentación", () => {
    const boton = (i: number) => screen.getByRole("button", { name: `Láminas ${TRAMOS[i].desde}–${TRAMOS[i].hasta} · ${TRAMOS[i].nombre}` });

    it("3 botones, uno por tramo; la lámina guardada marca su tramo", async () => {
      estadoInt.valores.lamina_actual = 20;
      await montar();
      await waitFor(() => expect(boton(1).getAttribute("aria-pressed")).toBe("true"));
      expect(boton(0).getAttribute("aria-pressed")).toBe("false");
      expect(boton(2).getAttribute("aria-pressed")).toBe("false");
      expect(screen.queryByRole("button", { name: "Lámina siguiente" })).toBeNull();
    });

    it("elegir un tramo guarda su última lámina en lamina_actual", async () => {
      const u = userEvent.setup();
      await montar();
      await u.click(boton(2));
      expect(posts.at(-1)).toMatchObject({ url: "/api/panel/interruptores", cuerpo: { clave: "lamina_actual", valor: 40 } });
      await waitFor(() => expect(boton(2).getAttribute("aria-pressed")).toBe("true"));
      await u.click(boton(1));
      expect(posts.at(-1)?.cuerpo).toEqual({ clave: "lamina_actual", valor: 32 });
    });

    it("elegir el tramo que ya está elegido no guarda nada", async () => {
      const u = userEvent.setup();
      await montar();
      await u.click(boton(0));
      expect(posts).toHaveLength(0);
    });

    it("muestra las 3 preguntas que ven ahora los asistentes", async () => {
      const u = userEvent.setup();
      await montar();
      const vista = screen.getByRole("list", { name: "Preguntas sugeridas ahora" });
      expect(within(vista).getAllByRole("listitem").map((li) => li.textContent)).toEqual([...TRAMOS[0].preguntas]);
      await u.click(boton(1));
      await waitFor(() =>
        expect(within(screen.getByRole("list", { name: "Preguntas sugeridas ahora" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
          ...TRAMOS[1].preguntas,
        ]),
      );
    });
  });

  describe("interruptores de caos", () => {
    it("muestran estado y hora de la última activación; al tocar se guardan", async () => {
      const u = userEvent.setup();
      await montar();
      const sw = await screen.findByRole("switch", { name: "Herramienta caída" });
      expect(sw.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/Última activación: \d{2}:\d{2}/)).toBeTruthy();
      expect(screen.getAllByText("Nunca activado").length).toBe(3);
      expect(screen.getByRole("switch", { name: "Modelos caídos" })).toBeTruthy();
      expect(screen.getByText("Fallan el principal y el respaldo: falla técnica y escalamiento.")).toBeTruthy();
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

  describe("recarga tras un redespliegue", () => {
    const sondear = () =>
      act(async () => {
        vi.advanceTimersByTime(5000);
      });

    it("misma versión: no recarga", async () => {
      const alRecargar = vi.fn();
      await montar(null, alRecargar);
      await sondear();
      expect(alRecargar).not.toHaveBeenCalled();
    });

    it("versión nueva: recarga una sola vez y la recuerda en sessionStorage", async () => {
      const alRecargar = vi.fn();
      await montar(null, alRecargar);
      metricas = { ...metricasBase(), version: "build-nuevo" };
      await sondear();
      await waitFor(() => expect(alRecargar).toHaveBeenCalledTimes(1));
      expect(sessionStorage.getItem(CLAVE_RECARGA)).toBe("build-nuevo");
      await sondear();
      await sondear();
      expect(alRecargar).toHaveBeenCalledTimes(1);
    });

    it("con el diálogo de confirmación abierto no recarga; al cerrarlo, sí", async () => {
      const u = userEvent.setup();
      const alRecargar = vi.fn();
      await montar(null, alRecargar);
      await u.click(screen.getByRole("button", { name: "Pausar el asistente" }));
      const dialogo = await screen.findByRole("dialog");
      metricas = { ...metricasBase(), version: "build-nuevo" };
      await sondear();
      await sondear();
      expect(alRecargar).not.toHaveBeenCalled();
      await u.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await sondear();
      await waitFor(() => expect(alRecargar).toHaveBeenCalledTimes(1));
    });
  });
});
