import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ObservacionRuta } from "./checks";

// R04 (`nivel: ruta`): la prueba pasa por la ruta real POST /api/chat, con una
// sesión válida, contra las bases temporales de la corrida.
// Modos:
// - standalone: el build de producción (`node .next/standalone/server.js`).
// - dev: `next dev` (código actual, local).
// - proceso: el handler de la ruta dentro del mismo proceso, sin servidor
//   (para un contenedor sin build ni fuentes de Next).
// - omitir: no se prueba; el gate de la ruta queda omitido y el reporte lo dice.

export type ModoRuta = "standalone" | "dev" | "proceso" | "omitir";
const MODOS = ["standalone", "dev", "proceso", "omitir"] as const;

export function elegirModoRuta(pedido: string | undefined, raiz: string): ModoRuta {
  if (pedido && pedido !== "auto") {
    if (!(MODOS as readonly string[]).includes(pedido)) throw new Error(`--ruta debe ser auto, ${MODOS.join(", ")}`);
    return pedido as ModoRuta;
  }
  return fs.existsSync(path.join(raiz, ".next", "standalone", "server.js")) ? "standalone" : "dev";
}

export function cuerpoChat(pregunta: string) {
  return { messages: [{ id: "eval-u1", role: "user", parts: [{ type: "text", text: pregunta }] }] };
}

export function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer();
    s.unref();
    s.on("error", rechazar);
    s.listen(0, "127.0.0.1", () => {
      const puerto = (s.address() as net.AddressInfo).port;
      s.close(() => resolver(puerto));
    });
  });
}

export interface AppLevantada {
  url: string;
  detener(): Promise<void>;
}

// Levanta la app en un puerto libre con el entorno de la corrida (bases
// temporales). La salida de Next se descarta: podría traer rutas o valores.
export async function levantarApp({
  modo,
  raiz,
  entorno,
  tiempoMaximoMs = 120_000,
}: {
  modo: "standalone" | "dev";
  raiz: string;
  entorno: NodeJS.ProcessEnv;
  tiempoMaximoMs?: number;
}): Promise<AppLevantada> {
  const puerto = await puertoLibre();
  const env = { ...entorno, PORT: String(puerto), HOSTNAME: "127.0.0.1", PROYECTO_RAIZ: raiz };
  const hijo: ChildProcess =
    modo === "standalone"
      ? spawn(process.execPath, [path.join(raiz, ".next", "standalone", "server.js")], { cwd: raiz, env, stdio: "ignore", detached: true })
      : spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [raiz] }), "dev", "-p", String(puerto), "-H", "127.0.0.1"], {
          cwd: raiz,
          env: { ...env, NODE_ENV: "development" },
          stdio: "ignore",
          detached: true,
        });
  let salio = false;
  hijo.once("exit", () => (salio = true));

  const url = `http://127.0.0.1:${puerto}`;
  const detener = async () => {
    if (salio || !hijo.pid) return;
    try {
      process.kill(-hijo.pid, "SIGTERM");
    } catch {
      hijo.kill("SIGTERM");
    }
    const fin = Date.now() + 8000;
    while (!salio && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
    if (!salio) {
      try {
        process.kill(-hijo.pid, "SIGKILL");
      } catch {
        hijo.kill("SIGKILL");
      }
    }
  };

  const limite = Date.now() + tiempoMaximoMs;
  while (Date.now() < limite) {
    if (salio) throw new Error("la app terminó al arrancar");
    try {
      await fetch(`${url}/api/sesion`, { signal: AbortSignal.timeout(30_000) });
      return { url, detener };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await detener();
  throw new Error("la app no respondió a tiempo");
}

export async function llamarChatHttp(url: string, cookie: string, pregunta: string): Promise<{ status: number; mensaje: string | null }> {
  const r = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(cuerpoChat(pregunta)),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  let mensaje: string | null = null;
  try {
    mensaje = (JSON.parse(texto) as { mensaje?: string }).mensaje ?? null;
  } catch {
    mensaje = null;
  }
  return { status: r.status, mensaje };
}

// Modo «proceso»: el handler real de la ruta, sin servidor HTTP.
export async function llamarChatEnProceso(cookie: string, pregunta: string): Promise<{ status: number; mensaje: string | null }> {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/chat/route");
  const r = await POST(
    new NextRequest(new URL("/api/chat", "http://localhost:3000"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(cuerpoChat(pregunta)),
    }),
  );
  let mensaje: string | null = null;
  try {
    mensaje = ((await r.clone().json()) as { mensaje?: string }).mensaje ?? null;
  } catch {
    mensaje = null;
  }
  return { status: r.status, mensaje };
}

export type { ObservacionRuta };
