import {
  SERVICIOS,
  TIPOS_EVENTO,
  VENTANA_AGRUPAR_MS,
  VENTANA_SALUD_MS,
  esTipoEvento,
  semaforoDeServicio,
  semaforoPresupuesto,
  textoEvento,
  type EventoPanel,
  type EventoReciente,
  type NivelEvento,
  type SaludPanel,
  type TipoEvento,
} from "@/lib/salud/catalogo";
import { db, type FuenteDb } from "./client";
import { numero, texto, textoONulo } from "./tipos";

// Eventos de salud del sistema (PRD §15 G7): cada falla, simulada o real, deja
// un evento; el panel muestra un semáforo por servicio y el registro en vivo.
// Solo datos técnicos: tipo, servicio, nivel, tiempos y trace id.

export const EVENTOS_EN_REGISTRO = 30;

interface Opciones {
  traceId?: string | null;
  ahora?: number;
}

export function crearEventosSalud(fuente: FuenteDb = db) {
  // Suma al grupo del mismo tipo abierto hace menos de 1 minuto, o abre uno nuevo.
  async function registrar(tipo: TipoEvento, { traceId = null, ahora = Date.now() }: Opciones = {}): Promise<void> {
    const c = await fuente();
    const { servicio, nivel } = TIPOS_EVENTO[tipo];
    const grupo = await c.execute({
      sql: "SELECT id FROM eventos_salud WHERE tipo = ? AND primero_ms >= ? ORDER BY primero_ms DESC LIMIT 1",
      args: [tipo, ahora - VENTANA_AGRUPAR_MS],
    });
    if (grupo.rows[0]) {
      await c.execute({
        sql: "UPDATE eventos_salud SET cantidad = cantidad + 1, ultimo_ms = ?, trace_id = COALESCE(?, trace_id) WHERE id = ?",
        args: [ahora, traceId, numero(grupo.rows[0], "id")],
      });
      return;
    }
    await c.execute({
      sql: `INSERT INTO eventos_salud (tipo, servicio, nivel, cantidad, primero_ms, ultimo_ms, trace_id)
        VALUES (?, ?, ?, 1, ?, ?, ?)`,
      args: [tipo, servicio, nivel, ahora, ahora, traceId],
    });
  }

  // Un evento «ok» (p. ej. «Gemini se recuperó») solo si el último evento de
  // ese servicio en la ventana fue un aviso o una falla.
  async function registrarRecuperacion(tipo: TipoEvento, { traceId = null, ahora = Date.now() }: Opciones = {}): Promise<void> {
    const c = await fuente();
    const r = await c.execute({
      sql: "SELECT nivel FROM eventos_salud WHERE servicio = ? AND ultimo_ms >= ? ORDER BY ultimo_ms DESC, id DESC LIMIT 1",
      args: [TIPOS_EVENTO[tipo].servicio, ahora - VENTANA_SALUD_MS],
    });
    const nivel = r.rows[0] ? (texto(r.rows[0], "nivel") as NivelEvento) : "ok";
    if (nivel !== "ok") await registrar(tipo, { traceId, ahora });
  }

  async function salud({
    ahora = Date.now(),
    presupuesto,
  }: {
    ahora?: number;
    presupuesto: { acumuladoUsd: number; maximoUsd: number | null };
  }): Promise<SaludPanel> {
    const c = await fuente();
    const [ventana, ultimos] = await c.batch(
      [
        { sql: "SELECT tipo, ultimo_ms FROM eventos_salud WHERE ultimo_ms >= ?", args: [ahora - VENTANA_SALUD_MS] },
        {
          sql: "SELECT id, tipo, nivel, cantidad, primero_ms, ultimo_ms, trace_id FROM eventos_salud ORDER BY ultimo_ms DESC, id DESC LIMIT ?",
          args: [EVENTOS_EN_REGISTRO],
        },
      ],
      "read",
    );
    const recientes: EventoReciente[] = ventana.rows
      .map((f) => ({ tipo: texto(f, "tipo"), ultimoMs: numero(f, "ultimo_ms") }))
      .filter((e): e is EventoReciente => esTipoEvento(e.tipo));
    const servicios = SERVICIOS.map((s) =>
      s === "presupuesto" ? semaforoPresupuesto(presupuesto.acumuladoUsd, presupuesto.maximoUsd) : semaforoDeServicio(s, recientes),
    );
    const eventos: EventoPanel[] = [];
    for (const f of ultimos.rows) {
      const tipo = texto(f, "tipo");
      if (!esTipoEvento(tipo)) continue;
      eventos.push({
        id: numero(f, "id"),
        hora: new Date(numero(f, "ultimo_ms")).toISOString(),
        nivel: texto(f, "nivel") as NivelEvento,
        texto: textoEvento(tipo, numero(f, "cantidad"), numero(f, "primero_ms"), numero(f, "ultimo_ms")),
        trace_id: textoONulo(f, "trace_id"),
      });
    }
    return { servicios, eventos };
  }

  return { registrar, registrarRecuperacion, salud };
}

export const eventosSalud = crearEventosSalud();
