import readline from "node:readline/promises";
import type { FuenteDb } from "../lib/db/client";
import { abrirBaseMigrada, ejecutarCli } from "./comun";

export interface ResultadoPurga {
  asistentes: number;
  sesiones: number;
  escalamientos: number;
  feedback: number;
}

// Borra los datos personales de charla.db en una sola transacción; hijos antes que padres.
// No toca data/mastra.db.
export async function purgarPersonales(fuente: FuenteDb): Promise<ResultadoPurga> {
  const c = await fuente();
  const [feedback, escalamientos, sesiones, asistentes] = await c.batch(
    ["DELETE FROM feedback", "DELETE FROM escalamientos", "DELETE FROM sesiones", "DELETE FROM asistentes"],
    "write",
  );
  return {
    asistentes: asistentes.rowsAffected,
    sesiones: sesiones.rowsAffected,
    escalamientos: escalamientos.rowsAffected,
    feedback: feedback.rowsAffected,
  };
}

export function esConfirmacion(respuesta: string): boolean {
  return ["s", "si", "sí"].includes(respuesta.trim().toLowerCase());
}

async function principal() {
  if (!process.argv.includes("--si")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const respuesta = await rl.question(
      "Esto borra asistentes, sesiones, escalamientos y votos de charla.db. ¿Continuar? (si/no) ",
    );
    rl.close();
    if (!esConfirmacion(respuesta)) {
      console.log("Cancelado: no se borró nada.");
      return;
    }
  }
  const cliente = await abrirBaseMigrada();
  try {
    const r = await purgarPersonales(async () => cliente);
    console.log(
      `Borrados: ${r.asistentes} asistentes, ${r.sesiones} sesiones, ${r.escalamientos} escalamientos, ${r.feedback} votos.`,
    );
  } finally {
    cliente.close();
  }
}

ejecutarCli(import.meta.url, principal, "No se pudo purgar la base");
