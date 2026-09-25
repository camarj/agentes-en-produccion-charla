import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Dataset `charla-v1` (evals/charla-v1.json): lectura, validación y paso a
// items de un Dataset de Mastra (Studio → Datasets). Ver evals/README.md.

export const CATEGORIAS = ["laminas", "personalizacion", "fuera_de_alcance", "escalamiento", "seguridad", "resiliencia"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

const esquemaEsperadoBase = z.object({
  laminas: z.array(z.number().int()).optional(),
  debe_llamar: z.array(z.string()).optional(),
  no_debe_llamar: z.array(z.string()).optional(),
  escalar: z.boolean().optional(),
  motivo_escalamiento: z.string().optional(),
  bloqueado: z.boolean().optional(),
  // v1.5.0 (S02, S03): pasa tanto si un guardrail bloquea (con un motivo de
  // motivo_bloqueo y su mensaje fijo) como si el agente responde con una
  // negativa. Los gates de privacidad y de criterios revisan que no haya datos.
  bloqueo_opcional: z.boolean().optional(),
  // Texto, o lista de motivos aceptados (basta con que coincida uno; S06).
  motivo_bloqueo: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  gate: z.boolean().optional(),
  cita_lamina: z.boolean().optional(),
  criterios: z.array(z.string().min(1)).min(1),
  personalizacion: z.boolean().optional(),
  modelo_esperado: z.string().optional(),
  http_status: z.number().int().optional(),
});

const esquemaEsperado = esquemaEsperadoBase.refine((e) => !(e.bloqueado === true && e.bloqueo_opcional === true), {
  message: "bloqueado y bloqueo_opcional no pueden ir juntos: bloqueo_opcional ya acepta el bloqueo",
});

export const esquemaCaso = z.object({
  id: z.string().regex(/^[A-Z]\d{2}$/),
  categoria: z.enum(CATEGORIAS),
  rf: z.array(z.string()),
  nivel: z.enum(["agente", "ruta"]),
  input: z.string().min(1),
  perfil: z.object({ nombre_pila: z.string().min(1), rol: z.string().min(1), descripcion: z.string().min(1) }),
  interruptores: z.record(z.string(), z.enum(["on", "off"])),
  esperado: esquemaEsperado,
  groundTruth: z.string().optional(),
});

export const esquemaDataset = z.object({
  meta: z.object({
    dataset: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    descripcion: z.string(),
    umbrales: z.object({ fidelidad: z.number(), relevancia: z.number(), personalizacion: z.number() }),
    gates: z.array(z.string()),
    conteo: z.record(z.string(), z.number()),
    notas: z.string(),
  }),
  casos: z.array(esquemaCaso).min(1),
});

export type Caso = z.infer<typeof esquemaCaso>;
export type Esperado = Caso["esperado"];
export type DatasetCharla = z.infer<typeof esquemaDataset>;

export const RUTA_DATASET = path.join(__dirname, "charla-v1.json");

export function cargarDataset(ruta = RUTA_DATASET): DatasetCharla {
  const datos = esquemaDataset.parse(JSON.parse(fs.readFileSync(ruta, "utf8")));
  const ids = new Set<string>();
  for (const c of datos.casos) {
    if (ids.has(c.id)) throw new Error(`Caso duplicado en el dataset: ${c.id}`);
    ids.add(c.id);
  }
  for (const [categoria, n] of Object.entries(datos.meta.conteo)) {
    const real = datos.casos.filter((c) => c.categoria === categoria).length;
    if (real !== n) throw new Error(`meta.conteo.${categoria} dice ${n}, pero hay ${real} casos`);
  }
  return datos;
}

// Motivos de bloqueo aceptados (texto o lista).
export function motivosBloqueo(esperado: Esperado): string[] {
  const m = esperado.motivo_bloqueo;
  if (m === undefined) return [];
  return Array.isArray(m) ? m : [m];
}

// Ids de los gates (deben dar 1,0) y de los scorers con umbral.
export const GATES = {
  bloqueo: "gate_bloqueo",
  escalamiento: "gate_escalamiento",
  noDebeLlamar: "gate_no_debe_llamar",
  privacidad: "gate_privacidad",
  criterios: "gate_criterios",
  ruta: "gate_ruta",
} as const;
export type IdGate = (typeof GATES)[keyof typeof GATES];

// Qué gates aplican a un caso (los demás lo declaran `notScorable`).
export function gatesAplicables(caso: Caso): IdGate[] {
  if (caso.nivel === "ruta") return [GATES.ruta];
  const e = caso.esperado;
  const gates: IdGate[] = [];
  if (e.bloqueado === true || e.bloqueo_opcional === true) gates.push(GATES.bloqueo);
  if (e.escalar === true) gates.push(GATES.escalamiento);
  if ((e.no_debe_llamar ?? []).length > 0) gates.push(GATES.noDebeLlamar);
  gates.push(GATES.privacidad);
  if (e.gate === true) gates.push(GATES.criterios);
  return gates;
}

// Motivo esperado, para leer y filtrar en Studio.
export function motivoEsperado(caso: Caso): string | null {
  const bloqueo = motivosBloqueo(caso.esperado);
  if (bloqueo.length > 0) return `${caso.esperado.bloqueo_opcional ? "bloqueo opcional" : "bloqueo"}: ${bloqueo.join(" o ")}`;
  if (caso.esperado.escalar && caso.esperado.motivo_escalamiento) return `escalamiento: ${caso.esperado.motivo_escalamiento}`;
  if (caso.esperado.http_status !== undefined) return `http ${caso.esperado.http_status}`;
  return null;
}

export interface ItemDataset {
  externalId: string;
  input: string;
  groundTruth: Record<string, unknown>;
  requestContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// Un caso → item del Dataset de Mastra.
// - groundTruth: los criterios de aceptación y todo lo esperado (lo que ven
//   los gates y scorers), más la respuesta de referencia si existe.
// - requestContext: el perfil ficticio del caso (el runner arma el contexto
//   completo como la ruta de chat) y los interruptores de caos.
// - metadata: datos para leer y filtrar en Studio.
export function aItemDataset(caso: Caso): ItemDataset {
  const { criterios, ...resto } = caso.esperado;
  return {
    externalId: caso.id,
    input: caso.input,
    groundTruth: {
      criterios,
      ...(caso.groundTruth ? { respuesta_referencia: caso.groundTruth } : {}),
      ...resto,
    },
    requestContext: {
      caso_id: caso.id,
      categoria: caso.categoria,
      ...caso.perfil,
      ...(Object.keys(caso.interruptores).length > 0 ? { interruptores: caso.interruptores } : {}),
    },
    metadata: {
      caso_id: caso.id,
      categoria: caso.categoria,
      nivel: caso.nivel,
      rf: caso.rf,
      es_gate: caso.esperado.gate === true,
      gates_aplicables: gatesAplicables(caso),
      motivo_esperado: motivoEsperado(caso),
      interruptores: caso.interruptores,
    },
  };
}

// Lo mínimo del API de datasets de Mastra que usa la sincronización
// (`mastra.datasets`), para poder probarla sin almacenamiento real.
export interface ItemGuardado {
  id: string;
  externalId?: string | null;
  input: unknown;
  groundTruth?: unknown;
  requestContext?: unknown;
  metadata?: unknown;
}
export interface DatasetMastra {
  id: string;
  getDetails(): Promise<{ metadata?: Record<string, unknown> | null; description?: string | null }>;
  update(args: { description?: string; metadata?: Record<string, unknown> }): Promise<unknown>;
  listItems(args: { page: number; perPage: number }): Promise<unknown>;
  addItem(args: ItemDataset): Promise<{ id: string }>;
  updateItem(args: { itemId: string } & Omit<ItemDataset, "externalId">): Promise<unknown>;
  deleteItem(args: { itemId: string }): Promise<void>;
}
export interface DatasetsMastra {
  get(args: { id: string }): Promise<DatasetMastra>;
  create(args: { id: string; name: string; description?: string; metadata?: Record<string, unknown> }): Promise<DatasetMastra>;
}

export const ID_DATASET_STUDIO = "charla-v1";

export interface Sincronizacion {
  dataset: DatasetMastra;
  creado: boolean;
  agregados: string[];
  actualizados: string[];
  eliminados: string[];
  // caso_id → id del item en Mastra
  itemPorCaso: Map<string, string>;
}

// JSON estable (claves ordenadas) para comparar payloads sin falsos cambios.
export function jsonEstable(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function mismoContenido(guardado: ItemGuardado, item: ItemDataset): boolean {
  const campos = (x: { input: unknown; groundTruth?: unknown; requestContext?: unknown; metadata?: unknown }) =>
    jsonEstable({ input: x.input, groundTruth: x.groundTruth ?? null, requestContext: x.requestContext ?? null, metadata: x.metadata ?? null });
  return campos(guardado) === campos(item);
}

async function todosLosItems(dataset: DatasetMastra): Promise<ItemGuardado[]> {
  const salida: ItemGuardado[] = [];
  for (let page = 0; page < 100; page++) {
    const r = (await dataset.listItems({ page, perPage: 100 })) as
      | ItemGuardado[]
      | { items: ItemGuardado[]; pagination?: { hasMore?: boolean } };
    if (Array.isArray(r)) return r;
    salida.push(...r.items);
    if (!r.pagination?.hasMore) break;
  }
  return salida;
}

async function obtenerOCrear(datasets: DatasetsMastra, datos: DatasetCharla): Promise<{ dataset: DatasetMastra; creado: boolean }> {
  try {
    return { dataset: await datasets.get({ id: ID_DATASET_STUDIO }), creado: false };
  } catch {
    const dataset = await datasets.create({
      id: ID_DATASET_STUDIO,
      name: ID_DATASET_STUDIO,
      description: datos.meta.descripcion,
      metadata: metadataDataset(datos),
    });
    return { dataset, creado: true };
  }
}

export function metadataDataset(datos: DatasetCharla): Record<string, unknown> {
  return {
    version: datos.meta.version,
    umbrales: datos.meta.umbrales,
    gates: datos.meta.gates,
    conteo: datos.meta.conteo,
    notas: datos.meta.notas,
    archivo: "evals/charla-v1.json",
  };
}

// Crea o actualiza el dataset de Studio sin duplicarlo: un item por caso
// (`externalId` = id del caso). Solo escribe lo que cambió, así el dataset
// no sube de versión si el JSON no cambió.
export async function sincronizarDataset(datasets: DatasetsMastra, datos: DatasetCharla): Promise<Sincronizacion> {
  const { dataset, creado } = await obtenerOCrear(datasets, datos);
  const detalles = await dataset.getDetails();
  const meta = metadataDataset(datos);
  if (jsonEstable(detalles.metadata ?? {}) !== jsonEstable(meta) || detalles.description !== datos.meta.descripcion) {
    await dataset.update({ description: datos.meta.descripcion, metadata: meta });
  }

  const guardados = await todosLosItems(dataset);
  const porCaso = new Map(guardados.filter((g) => g.externalId).map((g) => [g.externalId as string, g]));
  const resultado: Sincronizacion = { dataset, creado, agregados: [], actualizados: [], eliminados: [], itemPorCaso: new Map() };

  for (const caso of datos.casos) {
    const item = aItemDataset(caso);
    const previo = porCaso.get(caso.id);
    if (!previo) {
      const nuevo = await dataset.addItem(item);
      resultado.agregados.push(caso.id);
      resultado.itemPorCaso.set(caso.id, nuevo.id);
      continue;
    }
    if (!mismoContenido(previo, item)) {
      const { externalId: _e, ...cambios } = item;
      void _e;
      await dataset.updateItem({ itemId: previo.id, ...cambios });
      resultado.actualizados.push(caso.id);
    }
    resultado.itemPorCaso.set(caso.id, previo.id);
  }

  const vigentes = new Set(datos.casos.map((c) => c.id));
  for (const g of guardados) {
    if (!g.externalId || !vigentes.has(g.externalId)) {
      await dataset.deleteItem({ itemId: g.id });
      resultado.eliminados.push(g.externalId ?? g.id);
    }
  }
  return resultado;
}
