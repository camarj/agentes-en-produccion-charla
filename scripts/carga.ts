import { parseArgs } from "node:util";
import { abrirBaseMigrada, ejecutarCli } from "./comun";

// Prueba de carga (T14): N asistentes de prueba (`carga+<n>@carga.example.com`)
// se identifican contra la URL pública, completan su perfil y envían P
// preguntas cada uno; los N van en paralelo y cada uno envía sus preguntas en
// serie. Reporta primer token p50/p95, duración total p95 y errores por estado.
//
// Limpieza: los asistentes de prueba viven en charla.db. `--limpiar` los borra
// al final (sesiones, escalamientos y votos caen en cascada) y `--solo-limpiar`
// solo borra. Ambas necesitan la base, así que solo sirven dentro del
// contenedor (o en local con la misma DATABASE_PATH que la app).
// Nunca imprime emails ni nombres.

export const PREFIJO_EMAIL = "carga+";
export const DOMINIO_EMAIL = "carga.example.com";

const PREGUNTAS = [
  "¿Qué es el loop agéntico?",
  "¿Para qué sirven los guardrails en un agente?",
  "¿Qué se mide con los evals?",
  "¿Cómo ayuda la observabilidad a mejorar un agente?",
  "¿Qué es un harness?",
];

export interface Turno {
  estado: number | "red";
  primerTokenMs: number | null;
  totalMs: number;
  errorStream: boolean;
}

export function emailPrueba(n: number): string {
  return `${PREFIJO_EMAIL}${n}@${DOMINIO_EMAIL}`;
}

// Percentil por el método del rango más cercano; null si no hay datos.
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return orden[idx];
}

// Busca en un trozo del stream SSE de AI SDK UI si ya llegó texto o un error.
export function analizarTrozo(texto: string): { texto: boolean; error: boolean } {
  let hayTexto = false;
  let hayError = false;
  for (const linea of texto.split("\n")) {
    if (!linea.startsWith("data:")) continue;
    const dato = linea.slice(5).trim();
    if (dato.includes('"type":"text-delta"')) hayTexto = true;
    if (dato.includes('"type":"error"')) hayError = true;
  }
  return { texto: hayTexto, error: hayError };
}

function cookieDe(respuesta: Response): string | null {
  const valor = respuesta.headers.getSetCookie().find((c) => c.startsWith("sesion="));
  return valor ? valor.split(";")[0] : null;
}

async function enviarPregunta(url: string, cookie: string, pregunta: string, n: number): Promise<Turno> {
  const inicio = performance.now();
  let primerTokenMs: number | null = null;
  let errorStream = false;
  try {
    const r = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        messages: [{ id: `carga-${n}-${Date.now()}`, role: "user", parts: [{ type: "text", text: pregunta }] }],
      }),
    });
    if (r.ok && r.body) {
      const decoder = new TextDecoder();
      let resto = "";
      const lector = r.body.getReader();
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        resto += decoder.decode(value, { stream: true });
        const corte = resto.lastIndexOf("\n");
        if (corte < 0) continue;
        const { texto, error } = analizarTrozo(resto.slice(0, corte));
        resto = resto.slice(corte + 1);
        if (texto && primerTokenMs === null) primerTokenMs = performance.now() - inicio;
        if (error) errorStream = true;
      }
    } else {
      await r.body?.cancel();
    }
    return { estado: r.status, primerTokenMs, totalMs: performance.now() - inicio, errorStream };
  } catch {
    return { estado: "red", primerTokenMs, totalMs: performance.now() - inicio, errorStream };
  }
}

async function asistente(url: string, n: number, preguntas: number): Promise<Turno[]> {
  const id = await fetch(`${url}/api/identificar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailPrueba(n) }),
  }).catch(() => null);
  const cookie = id?.ok ? cookieDe(id) : null;
  if (!id || !cookie) return [{ estado: id ? id.status : "red", primerTokenMs: null, totalMs: 0, errorStream: false }];

  const perfil = await fetch(`${url}/api/perfil`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ nombre: `Carga ${n}`, rol: "Prueba de carga", descripcion: "Asistente de prueba" }),
  }).catch(() => null);
  if (!perfil?.ok) return [{ estado: perfil ? perfil.status : "red", primerTokenMs: null, totalMs: 0, errorStream: false }];

  const turnos: Turno[] = [];
  for (let i = 0; i < preguntas; i++) {
    turnos.push(await enviarPregunta(url, cookie, PREGUNTAS[(n + i) % PREGUNTAS.length], n));
  }
  return turnos;
}

export async function borrarAsistentesPrueba(): Promise<number> {
  const cliente = await abrirBaseMigrada();
  try {
    const r = await cliente.execute({
      sql: "DELETE FROM asistentes WHERE email LIKE ? ESCAPE '\\'",
      args: [`carga\\+%@${DOMINIO_EMAIL}`],
    });
    return r.rowsAffected;
  } finally {
    cliente.close();
  }
}

const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(2)} s`);

async function principal() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:3000" },
      asistentes: { type: "string", default: "30" },
      preguntas: { type: "string", default: "3" },
      limpiar: { type: "boolean", default: false },
      "solo-limpiar": { type: "boolean", default: false },
    },
    // `pnpm carga -- --url …` deja un `--` suelto que cortaría las opciones.
    args: process.argv.slice(2).filter((a) => a !== "--"),
  });

  if (values["solo-limpiar"]) {
    console.log(`Asistentes de prueba borrados: ${await borrarAsistentesPrueba()}`);
    return;
  }

  const url = values.url.replace(/\/+$/, "");
  const n = Number(values.asistentes);
  const p = Number(values.preguntas);
  console.log(`Carga: ${n} asistentes × ${p} preguntas contra ${url}`);

  const inicio = performance.now();
  const resultados = (await Promise.all(Array.from({ length: n }, (_, i) => asistente(url, i + 1, p)))).flat();
  const duracion = performance.now() - inicio;

  const chats = resultados.filter((t) => t.totalMs > 0);
  const primeros = chats.flatMap((t) => (t.primerTokenMs === null ? [] : [t.primerTokenMs]));
  const totales = chats.filter((t) => t.estado === 200).map((t) => t.totalMs);
  const porEstado = new Map<string, number>();
  for (const t of resultados) porEstado.set(String(t.estado), (porEstado.get(String(t.estado)) ?? 0) + 1);
  const erroresStream = resultados.filter((t) => t.errorStream).length;
  const cincoxx = resultados.filter((t) => typeof t.estado === "number" && t.estado >= 500).length;

  console.log(`Turnos de chat: ${chats.length} (con texto: ${primeros.length}) en ${ms(duracion)}`);
  console.log(`Primer token  p50 ${ms(percentil(primeros, 50))} · p95 ${ms(percentil(primeros, 95))}`);
  console.log(`Duración total p95 ${ms(percentil(totales, 95))}`);
  console.log(`Por estado: ${[...porEstado].map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`Errores 5xx: ${cincoxx} · errores dentro del stream: ${erroresStream}`);

  if (values.limpiar) console.log(`Asistentes de prueba borrados: ${await borrarAsistentesPrueba()}`);
  else console.log("Para borrar los asistentes de prueba: pnpm carga --solo-limpiar (dentro del contenedor).");

  const p95 = percentil(primeros, 95);
  if (cincoxx > 0 || p95 === null || p95 > 3000) process.exitCode = 1;
}

ejecutarCli(import.meta.url, principal, "La prueba de carga falló");
