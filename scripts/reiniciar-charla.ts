import type { Client } from "@libsql/client";
import { abrirCliente, urlPorDefecto, type FuenteDb } from "../lib/db/client";
import { esTrazaDeEval } from "../lib/origen-eval";
import { urlArchivo } from "../lib/rutas";
import { crearAlmacenamiento } from "../src/mastra/storage";
import { abrirBaseMigrada, ejecutarCli } from "./comun";

// Reinicio para el día de la charla: deja en cero lo que muestran el panel del
// speaker y Jev, sin tocar lo que hace funcionar la app ni lo que se muestra
// en Studio como material de la charla.
//
// Borra: sesiones, votos, escalamientos, análisis de Jev, historial de los
// interruptores, asistentes «invitado» (se vuelven a crear al identificarse),
// conversaciones del agente (hilos `charla-*`) y las trazas de asistentes
// (entidad `charla`) con sus puntajes y votos en observabilidad.
// Reinicia: coste acumulado a 0, interruptores apagados y tramo en la lámina 1.
// Conserva: inscritos con su perfil, láminas, migraciones, datasets,
// experimentos, trazas y hilos de evals (`eval-*`).
//
// Sin `--si` solo cuenta lo que haría (no cambia nada).

export const ENTIDAD_AGENTE = "charla";
const PREFIJO_HILO = "charla-";
const POR_PAGINA = 100;
const LOTE_BORRADO = 200;

export const VALORES_INICIALES: Record<string, string> = {
  herramienta_caida: "off",
  latencia_alta: "off",
  modelo_caido: "off",
  modelos_caidos: "off",
  kill_switch: "off",
  lamina_actual: "1",
};

const numero = (v: unknown) => Number(v ?? 0);

// ─── charla.db ───────────────────────────────────────────────────────────────

export interface ResultadoCharlaDb {
  sesiones: number;
  votos: number;
  escalamientos: number;
  analisisJev: number;
  eventosInterruptor: number;
  invitados: number;
  costeUsd: number;
  interruptoresCambiados: number;
}

async function contarCharlaDb(c: Client): Promise<ResultadoCharlaDb> {
  const r = await c.execute(`SELECT
    (SELECT count(*) FROM sesiones) AS sesiones,
    (SELECT count(*) FROM feedback) AS votos,
    (SELECT count(*) FROM escalamientos) AS escalamientos,
    (SELECT count(*) FROM jev_analisis) AS analisis_jev,
    (SELECT count(*) FROM eventos_interruptor) AS eventos,
    (SELECT count(*) FROM asistentes WHERE origen = 'invitado') AS invitados,
    (SELECT coalesce(max(coste_usd), 0) FROM presupuesto) AS coste`);
  const f = r.rows[0];
  const actuales = await c.execute("SELECT clave, valor FROM interruptores");
  const cambiados = actuales.rows.filter(
    (x) => VALORES_INICIALES[String(x.clave)] !== undefined && VALORES_INICIALES[String(x.clave)] !== String(x.valor),
  ).length;
  return {
    sesiones: numero(f.sesiones),
    votos: numero(f.votos),
    escalamientos: numero(f.escalamientos),
    analisisJev: numero(f.analisis_jev),
    eventosInterruptor: numero(f.eventos),
    invitados: numero(f.invitados),
    costeUsd: numero(f.coste),
    interruptoresCambiados: cambiados,
  };
}

// Una sola transacción: o queda todo en cero o no cambia nada.
export async function reiniciarCharlaDb(fuente: FuenteDb, { aplicar }: { aplicar: boolean }): Promise<ResultadoCharlaDb> {
  const c = await fuente();
  const antes = await contarCharlaDb(c);
  if (!aplicar) return antes;
  await c.batch(
    [
      "DELETE FROM feedback",
      "DELETE FROM escalamientos",
      "DELETE FROM sesiones",
      "DELETE FROM jev_analisis",
      "DELETE FROM eventos_interruptor",
      "DELETE FROM asistentes WHERE origen = 'invitado'",
      "UPDATE presupuesto SET coste_usd = 0, actualizado_en = datetime('now') WHERE id = 1",
      ...Object.entries(VALORES_INICIALES).map(([clave, valor]) => ({
        sql: "UPDATE interruptores SET valor = ?, actualizado_en = datetime('now') WHERE clave = ?",
        args: [valor, clave],
      })),
    ],
    "write",
  );
  return antes;
}

// ─── mastra.db (memoria del agente y puntajes en vivo) ───────────────────────

export interface ResultadoMemoria {
  hilos: number;
  mensajes: number;
  recursos: number;
  puntajes: number;
}

// Tablas de Mastra que pueden no existir según la versión: se omiten.
async function existe(c: Client, tabla: string): Promise<boolean> {
  const r = await c.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [tabla] });
  return r.rows.length > 0;
}

// Borra los hilos `charla-*` (conversaciones de asistentes), sus mensajes,
// estado, memoria de trabajo y los puntajes en vivo de esas conversaciones.
// Los hilos `eval-*`, datasets y experimentos no se tocan.
export async function limpiarMemoria(c: Client, { aplicar }: { aplicar: boolean }): Promise<ResultadoMemoria> {
  const patron = `${PREFIJO_HILO}%`;
  const recursosDeHilos = `SELECT DISTINCT resourceId FROM mastra_threads WHERE id LIKE ?`;
  const conteos: ResultadoMemoria = { hilos: 0, mensajes: 0, recursos: 0, puntajes: 0 };
  const sentencias: { sql: string; args: string[] }[] = [];

  if (await existe(c, "mastra_threads")) {
    conteos.hilos = numero((await c.execute({ sql: "SELECT count(*) AS n FROM mastra_threads WHERE id LIKE ?", args: [patron] })).rows[0].n);
    if (await existe(c, "mastra_resources")) {
      conteos.recursos = numero(
        (await c.execute({ sql: `SELECT count(*) AS n FROM mastra_resources WHERE id IN (${recursosDeHilos})`, args: [patron] })).rows[0].n,
      );
      // Antes de borrar los hilos: la lista de recursos sale de ellos.
      sentencias.push({ sql: `DELETE FROM mastra_resources WHERE id IN (${recursosDeHilos})`, args: [patron] });
    }
    if (await existe(c, "mastra_observational_memory")) {
      sentencias.push({
        sql: `DELETE FROM mastra_observational_memory WHERE threadId LIKE ? OR resourceId IN (${recursosDeHilos})`,
        args: [patron, patron],
      });
    }
  }
  if (await existe(c, "mastra_messages")) {
    conteos.mensajes = numero((await c.execute({ sql: "SELECT count(*) AS n FROM mastra_messages WHERE thread_id LIKE ?", args: [patron] })).rows[0].n);
    sentencias.push({ sql: "DELETE FROM mastra_messages WHERE thread_id LIKE ?", args: [patron] });
  }
  if (await existe(c, "mastra_thread_state")) sentencias.push({ sql: "DELETE FROM mastra_thread_state WHERE threadId LIKE ?", args: [patron] });
  if (await existe(c, "mastra_scorers")) {
    conteos.puntajes = numero((await c.execute({ sql: "SELECT count(*) AS n FROM mastra_scorers WHERE threadId LIKE ?", args: [patron] })).rows[0].n);
    sentencias.push({ sql: "DELETE FROM mastra_scorers WHERE threadId LIKE ?", args: [patron] });
  }
  if (await existe(c, "mastra_threads")) sentencias.push({ sql: "DELETE FROM mastra_threads WHERE id LIKE ?", args: [patron] });

  if (aplicar && sentencias.length > 0) await c.batch(sentencias, "write");
  return conteos;
}

// ─── Observabilidad (Neon) ───────────────────────────────────────────────────

export interface RaizLigera {
  traceId: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Trazas de asistentes (entidad `charla`, sin marca de eval) y las de sus
// jueces en vivo (metadata.targetTraceId apunta a una de ellas). Todo lo
// demás (evals, sus jueces, otras entidades) se conserva.
export function trazasABorrar(raices: readonly RaizLigera[]): string[] {
  const deAsistentes = new Set(
    raices.filter((r) => r.entityId === ENTIDAD_AGENTE && !esTrazaDeEval(r.metadata)).map((r) => r.traceId),
  );
  const salida = new Set(deAsistentes);
  for (const r of raices) {
    const objetivo = r.metadata?.targetTraceId;
    if (!esTrazaDeEval(r.metadata) && typeof objetivo === "string" && deAsistentes.has(objetivo)) salida.add(r.traceId);
  }
  return [...salida];
}

export interface StoreObservabilidad {
  listTracesLight(args: {
    filters?: Record<string, unknown>;
    pagination: { page: number; perPage: number };
  }): Promise<{ spans: RaizLigera[]; pagination?: { hasMore: boolean } | null }>;
  batchDeleteTraces(args: { traceIds: string[] }): Promise<void>;
}

export interface ResultadoTrazas {
  total: number;
  aBorrar: number;
  evals: number;
}

export async function limpiarTrazas(store: StoreObservabilidad, { aplicar }: { aplicar: boolean }): Promise<ResultadoTrazas> {
  const raices: RaizLigera[] = [];
  for (let page = 0; ; page++) {
    const r = await store.listTracesLight({ pagination: { page, perPage: POR_PAGINA } });
    raices.push(...r.spans);
    if (!r.pagination?.hasMore || r.spans.length === 0) break;
  }
  const ids = trazasABorrar(raices);
  if (aplicar) {
    for (let i = 0; i < ids.length; i += LOTE_BORRADO) await store.batchDeleteTraces({ traceIds: ids.slice(i, i + LOTE_BORRADO) });
  }
  return { total: raices.length, aBorrar: ids.length, evals: raices.filter((r) => esTrazaDeEval(r.metadata)).length };
}

// ─── Respaldo ────────────────────────────────────────────────────────────────

// Copia consistente de una base SQLite junto al original (VACUUM INTO funciona
// con la app abierta). Devuelve la ruta del respaldo, o null si no es un archivo.
export async function respaldar(c: Client, url: string, marca: string): Promise<string | null> {
  if (!url.startsWith("file:")) return null;
  const destino = url.slice("file:".length).replace(/(\.db)?$/, `.respaldo-${marca}.db`);
  await c.execute({ sql: "VACUUM INTO ?", args: [destino] });
  return destino;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(URL no válida)";
  }
}

async function principal() {
  const aplicar = process.argv.includes("--si");
  const urlMastra = urlArchivo(process.env.MASTRA_DB_URL ?? "file:./data/mastra.db");
  const urlObs = process.env.OBSERVABILIDAD_DATABASE_URL?.trim();
  // Destinos, para confirmar antes de aplicar (del Postgres solo el host, nunca la contraseña).
  console.log(`Bases: charla.db → ${urlPorDefecto()} · mastra.db → ${urlMastra} · trazas → ${urlObs ? hostDe(urlObs) : "sin Postgres"}`);
  console.log(aplicar ? "Reiniciando datos para la charla…" : "Simulación (sin --si no se cambia nada):");

  // 0. Respaldo de las dos bases SQLite antes de cambiar nada (las trazas de Neon no se respaldan).
  if (aplicar) {
    const marca = new Date().toISOString().replace(/[:.]/g, "-");
    const respaldoCharla = await abrirBaseMigrada();
    const respaldoMastra = await abrirCliente(urlMastra);
    try {
      console.log(`  Respaldo: ${await respaldar(respaldoCharla, urlPorDefecto(), marca)} · ${await respaldar(respaldoMastra, urlMastra, marca)}`);
    } finally {
      respaldoCharla.close();
      respaldoMastra.close();
    }
  }

  // 1. Trazas primero: si Jev consulta entre medio, no encuentra turnos que re-analizar.
  if (urlObs) {
    const almacen = crearAlmacenamiento();
    const store = (await almacen.getStore("observability")) as unknown as StoreObservabilidad | undefined;
    if (!store) throw new Error("No hay store de observabilidad");
    const t = await limpiarTrazas(store, { aplicar });
    console.log(`  Trazas: ${t.aBorrar} de asistentes ${aplicar ? "borradas" : "a borrar"} · ${t.evals} de evals conservadas · ${t.total} en total`);
  } else {
    console.log("  Trazas: OBSERVABILIDAD_DATABASE_URL no está configurada; se omiten.");
  }

  // 2. Memoria del agente (mastra.db).
  const mastraDb = await abrirCliente(urlMastra);
  try {
    const m = await limpiarMemoria(mastraDb, { aplicar });
    console.log(`  Memoria: ${m.hilos} conversaciones, ${m.mensajes} mensajes, ${m.recursos} perfiles de memoria, ${m.puntajes} puntajes en vivo`);
  } finally {
    mastraDb.close();
  }

  // 3. charla.db (una transacción).
  const cliente = await abrirBaseMigrada();
  try {
    const r = await reiniciarCharlaDb(async () => cliente, { aplicar });
    console.log(
      `  charla.db: ${r.sesiones} sesiones, ${r.votos} votos, ${r.escalamientos} escalamientos, ${r.analisisJev} análisis de Jev, ` +
        `${r.eventosInterruptor} eventos de interruptores, ${r.invitados} invitados, coste $${r.costeUsd.toFixed(4)}, ` +
        `${r.interruptoresCambiados} interruptores fuera de su valor inicial`,
    );
  } finally {
    cliente.close();
  }

  console.log(aplicar ? "Listo: paneles en cero." : "Para aplicarlo: pnpm reiniciar:charla --si");
  process.exit(0);
}

ejecutarCli(import.meta.url, principal, "No se pudo reiniciar");
