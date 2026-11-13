import type { Cliente } from "../db/client";

// Interruptor «Base de datos lenta» y semáforo «Base de datos» (PRD §15 G7).
// Envuelve el cliente de charla.db de la app: con el interruptor encendido,
// cada consulta (execute, batch, transaccion) espera `retrasoMs` antes de
// ejecutarse; toda consulta que tarda más de `umbralMs` (simulada o real)
// avisa con `alLenta`. El resto del cliente no cambia.

export const RETRASO_DB_LENTA_MS = 1500;
export const UMBRAL_DB_LENTA_MS = 1000;

const METODOS = new Set(["execute", "batch", "transaccion"]);

export function crearBaseLenta({
  retrasoMs = RETRASO_DB_LENTA_MS,
  umbralMs = UMBRAL_DB_LENTA_MS,
  alLenta,
}: {
  retrasoMs?: number;
  umbralMs?: number;
  alLenta: (ms: number) => void;
}) {
  let activa = false;

  function fijar(valor: boolean) {
    activa = valor;
  }

  function envolver(cliente: Cliente): Cliente {
    return new Proxy(cliente, {
      get(objetivo, propiedad) {
        const valor = Reflect.get(objetivo, propiedad, objetivo);
        if (typeof valor !== "function") return valor;
        if (typeof propiedad !== "string" || !METODOS.has(propiedad)) return valor.bind(objetivo);
        return async (...args: unknown[]) => {
          const inicio = performance.now();
          if (activa) await new Promise((r) => setTimeout(r, retrasoMs));
          const resultado = await valor.apply(objetivo, args);
          const ms = performance.now() - inicio;
          if (ms > umbralMs) alLenta(ms);
          return resultado;
        };
      },
    });
  }

  return { fijar, envolver, activa: () => activa };
}
