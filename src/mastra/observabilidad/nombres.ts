import { asistentes } from "@/lib/db/asistentes";
import { crearNombresConocidos } from "./redaccion";

// Nombres de los asistentes registrados, para quitarlos de trazas y de las
// ejecuciones que reciben los scorers. Se leen de charla.db cada 60 s.
// El nombre del speaker (lib/speaker.ts) se permite aunque su fila esté en la
// base: `terminosDeNombres` lo excluye y `redactarTexto` lo protege.
export const nombresAsistentes = crearNombresConocidos(() => asistentes.listarPerfiles());

export const obtenerNombresAsistentes = () => nombresAsistentes.obtener();
