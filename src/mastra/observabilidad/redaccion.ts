import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability";
import { NOMBRE_SPEAKER_NORMALIZADO, esNombreSpeaker } from "@/lib/speaker";

// Regla 6: ni emails ni nombres en trazas. Mastra guarda en los spans el
// requestContext completo (agent_run, model_generation, tool_call), las
// instrucciones con el bloque <perfil_asistente> y el texto del usuario. Este
// módulo los limpia antes de exportar (procesador de spans) y antes de puntuar
// (prepareRun de los scorers, cuyas filas guardan input, output y contexto).

// Únicas claves del requestContext que pueden llegar a una traza.
export const CLAVES_CONTEXTO_TRAZA = [
  "rol_anonimo",
  "lamina_actual",
  "interruptores_activos",
  "version_instrucciones",
] as const;

// Claves que se eliminan de cualquier objeto de una traza (comparadas en
// minúsculas y sin separadores: `nombrePila` = `nombre_pila`).
const CLAVES_PERSONALES = new Set(["nombrepila", "rol", "descripcion", "nombre", "email", "correo"]);

// Valores del requestContext que se buscan como texto en toda la traza.
const CLAVES_TERMINO = ["nombre_pila", "nombre", "rol", "descripcion", "email"] as const;

export const TOKEN_REDACTADO = "[redactado]";
export const TOKEN_EMAIL = "[email]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
// El bloque de perfil que arma construirInstrucciones (T05). Si el texto llegó
// cortado, se vacía hasta el final.
const BLOQUE_PERFIL = /<perfil_asistente\b[^>]*>[\s\S]*?(?:<\/perfil_asistente>|$)/g;
const PERFIL_VACIO = `<perfil_asistente>${TOKEN_REDACTADO}</perfil_asistente>`;
// Líneas del perfil sueltas (p. ej. dentro de un JSON escapado sin el bloque).
const LINEA_PERFIL =
  /(Nombre de pila|A qué se dedica|Qué construye o quiere construir con IA): (?!\[redactado\])[^\n\\]*/g;

const LARGO_MINIMO_TERMINO = 3;
const CONECTORES = new Set(["del", "las", "los", "dos", "das", "van", "von", "der"]);

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Cada letra acepta sus variantes con tilde, así «jose perez» encuentra «José Pérez».
const VARIANTES: Record<string, string> = {
  a: "aáàäâã",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöôõ",
  u: "uúùüû",
  n: "nñ",
  c: "cç",
};

const cacheRegex = new Map<string, RegExp>();
const MAX_CACHE_REGEX = 5000;

function regexTermino(termino: string): RegExp {
  let r = cacheRegex.get(termino);
  if (r) return r;
  let patron = "";
  for (const ch of termino) {
    if (ch === " ") patron += "\\s+";
    else if (VARIANTES[ch]) patron += `[${VARIANTES[ch]}]`;
    // Con la bandera «u», escapar «-» fuera de una clase es un error: solo se escapan los caracteres de sintaxis.
    else patron += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  r = new RegExp(`(?<![\\p{L}\\p{N}])${patron}(?![\\p{L}\\p{N}])`, "giu");
  if (cacheRegex.size >= MAX_CACHE_REGEX) cacheRegex.clear();
  cacheRegex.set(termino, r);
  return r;
}

function terminoUtil(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const n = normalizar(valor);
  return n.length >= LARGO_MINIMO_TERMINO ? n : null;
}

// Términos a partir de nombres completos: el nombre entero y cada palabra de
// 3+ letras (sin conectores como «del» o «los»).
export function terminosDeNombres(nombres: readonly string[]): string[] {
  const salida = new Set<string>();
  for (const nombre of nombres) {
    // El nombre del speaker (Raúl Camacho) puede quedar en las trazas.
    if (esNombreSpeaker(nombre)) continue;
    const completo = terminoUtil(nombre);
    if (!completo) continue;
    salida.add(completo);
    for (const palabra of completo.split(" ")) {
      if (palabra.length >= LARGO_MINIMO_TERMINO && !CONECTORES.has(palabra)) salida.add(palabra);
    }
  }
  return [...salida];
}

export function redactarTexto(texto: string, terminos: readonly string[] = []): string {
  let r = texto.replace(BLOQUE_PERFIL, PERFIL_VACIO).replace(LINEA_PERFIL, `$1: ${TOKEN_REDACTADO}`);
  r = r.replace(EMAIL, TOKEN_EMAIL);
  if (terminos.length === 0) return r;
  // El nombre completo del speaker se protege antes de quitar términos: si otro
  // asistente se llama «Raúl», «Raúl Camacho» igual se conserva.
  const protegidos: string[] = [];
  r = r.replace(regexTermino(NOMBRE_SPEAKER_NORMALIZADO), (m) => `\u0000${protegidos.push(m) - 1}\u0000`);
  // Primero los términos más largos: «juan perez» antes que «juan».
  for (const t of [...terminos].sort((a, b) => b.length - a.length)) {
    r = r.replace(regexTermino(t), TOKEN_REDACTADO);
  }
  return protegidos.length > 0 ? r.replace(/\u0000(\d+)\u0000/g, (_, i: string) => protegidos[Number(i)]) : r;
}

function esClavePersonal(clave: string): boolean {
  return CLAVES_PERSONALES.has(clave.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Copia profunda sin emails, perfil ni términos, y sin claves personales.
// Otros objetos (Date, clases) se conservan tal cual.
export function redactarValor<T>(valor: T, terminos: readonly string[] = []): T {
  const vistos = new WeakMap<object, unknown>();
  const visitar = (v: unknown): unknown => {
    if (typeof v === "string") return redactarTexto(v, terminos);
    if (Array.isArray(v)) {
      if (vistos.has(v)) return vistos.get(v);
      const copia: unknown[] = [];
      vistos.set(v, copia);
      for (const x of v) copia.push(visitar(x));
      return copia;
    }
    if (esObjetoPlano(v)) {
      if (vistos.has(v)) return vistos.get(v);
      const copia: Record<string, unknown> = {};
      vistos.set(v, copia);
      for (const [k, x] of Object.entries(v)) {
        if (!esClavePersonal(k)) copia[k] = visitar(x);
      }
      return copia;
    }
    return v;
  };
  return visitar(valor) as T;
}

function entradas(contexto: unknown): Array<[string, unknown]> {
  if (!contexto || typeof contexto !== "object") return [];
  const c = contexto as { entries?: () => Iterable<[string, unknown]> };
  if (typeof c.entries === "function" && !Array.isArray(contexto)) return [...c.entries()];
  return Object.entries(contexto);
}

// Solo las claves permitidas (más `conservar`). undefined si no queda ninguna.
// Los valores pasan por la misma redacción que las trazas (emails y `terminos`).
export function filtrarContexto(
  contexto: unknown,
  conservar: readonly string[] = [],
  terminos: readonly string[] = [],
): Record<string, unknown> | undefined {
  const permitidas = new Set<string>([...CLAVES_CONTEXTO_TRAZA, ...conservar]);
  const salida: Record<string, unknown> = {};
  for (const [k, v] of entradas(contexto)) {
    if (permitidas.has(k)) salida[k] = redactarValor(v, terminos);
  }
  return Object.keys(salida).length > 0 ? salida : undefined;
}

// Nombre, rol, descripción (y email) del requestContext como términos a quitar.
export function terminosDelContexto(contexto: unknown, excepto: readonly string[] = []): string[] {
  const valores = new Map(entradas(contexto));
  const salida = new Set<string>();
  for (const clave of CLAVES_TERMINO) {
    if (excepto.includes(clave)) continue;
    const valor = valores.get(clave);
    if (clave === "nombre" || clave === "nombre_pila") {
      for (const t of terminosDeNombres(typeof valor === "string" ? [valor] : [])) salida.add(t);
    } else {
      const t = terminoUtil(valor);
      if (t) salida.add(t);
    }
  }
  return [...salida];
}

export type NombresConocidos = () => readonly string[];

// Nombres de todos los asistentes (lectura síncrona; se recargan en segundo
// plano cada `ttlMs`). La primera lectura puede venir vacía mientras carga.
export function crearNombresConocidos(
  listar: () => Promise<Array<{ nombre: string }>>,
  { ttlMs = 60_000, ahora = Date.now }: { ttlMs?: number; ahora?: () => number } = {},
) {
  let terminos: string[] = [];
  let vence = -Infinity;
  let cargando: Promise<void> | null = null;

  function refrescar(): void {
    if (cargando || ahora() < vence) return;
    cargando = listar()
      .then((perfiles) => {
        terminos = terminosDeNombres(perfiles.map((p) => p.nombre));
        vence = ahora() + ttlMs;
      })
      .catch(() => {
        // Se conserva lo último; se reintenta al vencer.
        vence = ahora() + ttlMs;
      })
      .finally(() => {
        cargando = null;
      });
  }

  return {
    obtener(): readonly string[] {
      refrescar();
      return terminos;
    },
    async cargar(): Promise<void> {
      refrescar();
      await cargando;
    },
  };
}

function leerSeguro(nombres: NombresConocidos): readonly string[] {
  try {
    return nombres();
  } catch {
    return [];
  }
}

export interface OpcionesRedaccion {
  nombresConocidos?: NombresConocidos;
  maxTrazas?: number;
}

// Procesador de spans: se ejecuta al iniciar y al terminar cada span, antes de
// exportarlo. Muta el span recibido y devuelve la misma instancia (contrato de
// SpanOutputProcessor en @mastra/observability 1.18).
export class RedaccionTrazas implements SpanOutputProcessor {
  name = "redaccion-trazas";
  readonly #nombres: NombresConocidos;
  readonly #maxTrazas: number;
  // traceId → términos del asistente (el span raíz trae el requestContext; los
  // hijos que no lo traen usan los términos de su traza).
  readonly #porTraza = new Map<string, string[]>();

  constructor({ nombresConocidos = () => [], maxTrazas = 1000 }: OpcionesRedaccion = {}) {
    this.#nombres = nombresConocidos;
    this.#maxTrazas = maxTrazas;
  }

  // Los scorers en vivo corren en otra traza que apunta a la del agente con
  // `metadata.targetTraceId`: heredan sus términos (el juez de personalización
  // recibe el rol, y su prompt queda en esa traza).
  #terminosDeTraza(traceId: string | undefined, contexto: unknown, trazaObjetivo: unknown): string[] {
    const heredados = typeof trazaObjetivo === "string" ? (this.#porTraza.get(trazaObjetivo) ?? []) : [];
    const propios = [...terminosDelContexto(contexto), ...heredados];
    const clave = traceId ?? "";
    const previos = this.#porTraza.get(clave) ?? [];
    const union = [...new Set([...previos, ...propios])];
    if (traceId && propios.length > 0) {
      this.#porTraza.delete(clave);
      this.#porTraza.set(clave, union);
      if (this.#porTraza.size > this.#maxTrazas) {
        const masViejo = this.#porTraza.keys().next().value;
        if (masViejo !== undefined) this.#porTraza.delete(masViejo);
      }
    }
    return [...union, ...leerSeguro(this.#nombres)];
  }

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return span;
    const s = span as unknown as Record<string, unknown> & { traceId?: string };
    let terminos: string[] = [];
    try {
      const metadata = s.metadata as { targetTraceId?: unknown } | undefined;
      terminos = this.#terminosDeTraza(s.traceId, s.requestContext, metadata?.targetTraceId);
    } catch {
      terminos = [];
    }
    s.requestContext = filtrarContexto(s.requestContext);
    for (const campo of ["input", "output", "attributes", "metadata", "errorInfo"] as const) {
      if (s[campo] === undefined) continue;
      try {
        s[campo] = redactarValor(s[campo], terminos);
      } catch {
        s[campo] = campo === "attributes" || campo === "metadata" ? {} : TOKEN_REDACTADO;
      }
    }
    return span;
  }

  async shutdown(): Promise<void> {
    this.#porTraza.clear();
  }
}

export interface OpcionesPrepararEjecucion {
  // Claves del requestContext que el scorer necesita además de las permitidas
  // (personalización: `rol` y `descripcion`). No se buscan como texto a quitar,
  // pero sus valores pasan por la misma redacción (sin emails ni nombres).
  conservar?: readonly string[];
  nombresConocidos?: NombresConocidos;
}

interface EjecucionScorer {
  input?: unknown;
  output: unknown;
  requestContext?: unknown;
}

// `prepareRun` de los scorers: corre antes del span del scorer, del juez y de
// guardar la fila de puntaje (que guarda input, output y requestContext).
export function prepararEjecucion({ conservar = [], nombresConocidos = () => [] }: OpcionesPrepararEjecucion = {}) {
  return <R extends EjecucionScorer>(run: R): R => {
    const terminos = [...terminosDelContexto(run.requestContext, conservar), ...leerSeguro(nombresConocidos)];
    return {
      ...run,
      input: redactarValor(run.input, terminos),
      output: redactarValor(run.output, terminos),
      requestContext: filtrarContexto(run.requestContext, conservar, terminos),
    };
  };
}
