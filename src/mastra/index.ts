import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { charla } from "./agents/charla";
import { crearObservabilidad, SERVICIO } from "./observabilidad/config";
import { nombresAsistentes, obtenerNombresAsistentes } from "./observabilidad/nombres";
import { scorers } from "./scorers";
import { almacenamiento } from "./storage";

export const mastra = new Mastra({
  storage: almacenamiento,
  agents: { charla },
  // Registrados también aquí para Studio y el runner de evals (T13).
  scorers,
  observability: crearObservabilidad({ nombresConocidos: obtenerNombresAsistentes }),
  logger: new PinoLogger({ name: SERVICIO, level: "info" }),
});

// Precarga los nombres de asistentes para que la primera traza ya los quite.
void nombresAsistentes.cargar();
