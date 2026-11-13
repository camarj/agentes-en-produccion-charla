import { AGENTE } from "@/lib/panel/metricas-trazas";
import { eventosSalud } from "@/lib/db/eventos-salud";
import { mastra } from "@/src/mastra";

// Sonda del semáforo «Trazas / observabilidad» (PRD §15 G7): una lectura
// mínima del store de observabilidad (1 traza) con tope de 3 s, como mucho
// cada 30 s aunque haya varias pestañas del panel abiertas. Si falla, deja el
// evento «Sin conexión con la observabilidad» (rojo). Nunca lanza.

const CADA_MS = 30_000;
const TOPE_MS = 3000;

export type LeerUnaTraza = () => Promise<unknown>;

async function leerUnaTrazaDeMastra(): Promise<unknown> {
  const store = await mastra.getStorage()?.getStore("observability");
  if (!store) throw new Error("sin_store");
  return store.listTracesLight({
    filters: { entityId: AGENTE, startedAt: { start: new Date(Date.now() - 60_000) } },
    pagination: { page: 0, perPage: 1 },
  });
}

function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new Error("tiempo_agotado")), ms);
  });
  return Promise.race([promesa, tope]).finally(() => clearTimeout(t));
}

export function crearSondaObservabilidad({
  leer = leerUnaTrazaDeMastra,
  anotar = () => eventosSalud.registrar("observabilidad_sin_conexion"),
  ahora = Date.now,
}: { leer?: LeerUnaTraza; anotar?: () => Promise<void>; ahora?: () => number } = {}) {
  let ultima = Number.NEGATIVE_INFINITY;
  let enCurso: Promise<void> | null = null;
  return function sondear(): Promise<void> {
    if (enCurso || ahora() - ultima < CADA_MS) return enCurso ?? Promise.resolve();
    ultima = ahora();
    enCurso = conTope(leer(), TOPE_MS)
      .then(() => undefined)
      .catch(async (error: unknown) => {
        console.error("[salud] la observabilidad no responde", { tipo: error instanceof Error ? error.name : typeof error });
        await anotar().catch(() => undefined);
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  };
}

export const sondearObservabilidad = crearSondaObservabilidad();
