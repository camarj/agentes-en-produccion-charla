import type { EstadoEscalamiento, Escalamiento, MotivoEscalamiento } from "@/lib/db/escalamientos";
import type { PerfilPrivado } from "@/lib/db/asistentes";
import { isoDeSqlite } from "@/lib/db/tipos";
import { rolAnonimo, type RolAnonimo } from "@/lib/rol-anonimo";
import { redactarTexto, terminosDeNombres } from "@/src/mastra/observabilidad/redaccion";

// Fila de la cola de escalamientos tal como se proyecta en el panel: nunca
// lleva nombre, email, rol, descripción, id del asistente ni trace_id.
export interface FilaEscalamientoPanel {
  id: number;
  pregunta: string;
  motivo: MotivoEscalamiento;
  rol_anonimo: RolAnonimo;
  estado: EstadoEscalamiento;
  creado_en: string;
}

export const MAX_ATENDIDOS_EN_PANEL = 20;

// Pendientes primero (del más antiguo al más nuevo), luego los atendidos más
// recientes. La pregunta pasa por la misma redacción que las trazas (T07):
// emails y nombres de asistentes → [email] / [redactado].
export function colaDelPanel(
  lista: readonly Escalamiento[],
  perfiles: readonly Pick<PerfilPrivado, "id" | "nombre" | "rol">[],
  { maxAtendidos = MAX_ATENDIDOS_EN_PANEL }: { maxAtendidos?: number } = {},
): FilaEscalamientoPanel[] {
  const terminos = terminosDeNombres(perfiles.map((p) => p.nombre));
  const rolPorId = new Map(perfiles.map((p) => [p.id, p.rol]));
  const pendientes = lista.filter((e) => e.estado === "pendiente").sort((a, b) => a.id - b.id);
  const atendidos = lista
    .filter((e) => e.estado !== "pendiente")
    .sort((a, b) => b.id - a.id)
    .slice(0, maxAtendidos);
  return [...pendientes, ...atendidos].map((e) => ({
    id: e.id,
    pregunta: redactarTexto(e.pregunta, terminos),
    motivo: e.motivo,
    rol_anonimo: rolAnonimo(rolPorId.get(e.asistenteId)),
    estado: e.estado,
    creado_en: isoDeSqlite(e.creadoEn),
  }));
}
