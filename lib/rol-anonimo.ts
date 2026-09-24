// Categoría anónima del rol del asistente para las trazas (el rol libre nunca
// va a la traza). Determinista, sin LLM.
export type RolAnonimo = "tecnico" | "negocio" | "educacion" | "salud" | "otro";

// En orden de prioridad: con varias coincidencias gana la primera (técnico).
// Palabras clave sin tildes y en minúsculas. Las de 3 letras o menos ("ia",
// "ai", "ceo") cuentan solo como palabra completa: "docencia" no es IA. Las
// demás son raíces: "ingenier" cubre ingeniero, ingeniera e ingeniería.
const CATEGORIAS: ReadonlyArray<[Exclude<RolAnonimo, "otro">, readonly string[]]> = [
  ["tecnico", ["desarrollador", "developer", "sistemas", "analista", "ia", "ai", "cyber", "seguridad", "tecnologia", "datos", "ingenier"]],
  ["negocio", ["ceo", "gerente", "consultor", "marketing", "market", "proyectos", "contador", "emprend", "ventas"]],
  ["educacion", ["docente", "docencia", "teacher", "profesor", "maestr", "educa"]],
  ["salud", ["terapeuta", "medic", "salud", "clinic"]],
];

const LARGO_PALABRA_COMPLETA = 3;

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function coincide(texto: string, palabras: string[], clave: string): boolean {
  return clave.length <= LARGO_PALABRA_COMPLETA ? palabras.includes(clave) : texto.includes(clave);
}

export function rolAnonimo(rol: string | null | undefined): RolAnonimo {
  if (typeof rol !== "string") return "otro";
  const texto = normalizar(rol).trim();
  if (!texto) return "otro";
  const palabras = texto.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const [categoria, claves] of CATEGORIAS) {
    if (claves.some((c) => coincide(texto, palabras, c))) return categoria;
  }
  return "otro";
}
