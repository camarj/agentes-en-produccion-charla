import { RequestContext } from "@mastra/core/request-context";
import { interruptoresActivos } from "./chat";
import type { Asistente } from "./db/asistentes";
import type { Interruptores } from "./db/interruptores";
import { rolAnonimo } from "./rol-anonimo";
import { nombrePila } from "./session";

// requestContext de un turno del agente `charla`. Lo usan la ruta de chat (T09)
// y el runner de evals (T13), para que los evals prueben exactamente el mismo
// contexto que ve el agente en producción. Vive fuera de lib/chat.ts porque
// ese módulo también lo importa la UI (cliente).
// En las trazas solo quedan las 4 claves permitidas (RedaccionTrazas, T07).
export function construirContextoTurno(
  asistente: Pick<Asistente, "id" | "nombre" | "rol" | "descripcion">,
  valores: Interruptores,
  versionInstrucciones: string,
): RequestContext {
  const rc = new RequestContext();
  rc.set("asistente_id", asistente.id);
  const nombre = nombrePila(asistente.nombre);
  if (nombre) rc.set("nombre_pila", nombre);
  if (asistente.rol) rc.set("rol", asistente.rol);
  if (asistente.descripcion) rc.set("descripcion", asistente.descripcion);
  rc.set("rol_anonimo", rolAnonimo(asistente.rol));
  const lamina = Number(valores.lamina_actual);
  rc.set("lamina_actual", Number.isInteger(lamina) ? lamina : valores.lamina_actual);
  rc.set("interruptores_activos", interruptoresActivos(valores));
  rc.set("version_instrucciones", versionInstrucciones);
  return rc;
}
