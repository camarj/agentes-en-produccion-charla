// Runner de evals (T13): `pnpm evals` · `pnpm evals -- --instrucciones 1.0.0`.
//
// Cómo se hace «a la Mastra» (docs de evals de @mastra/core 1.69):
// 1. El dataset `evals/charla-v1.json` se sincroniza como un Dataset de Mastra
//    (Studio → Datasets → charla-v1), sin duplicarlo.
// 2. `runEvals` ejecuta los casos contra el agente `charla` registrado, con
//    `gates` (deben dar 1,0) y scorers `{ scorer, threshold }`, y da el
//    veredicto `passed | scored | failed`.
// 3. Cada caso se sube a un Experiment del dataset (entrada, salida, traza y
//    el score + la razón de cada gate y scorer), así la corrida queda en
//    Studio y «Compare» funciona entre corridas.
//
// Aislamiento (Raúl, 2026-09-23): SIEMPRE una charla.db temporal, también en
// producción. Las trazas de eval llevan `origen: eval` y el panel las excluye.
// Sale con código 1 si el veredicto no es `passed`.

import fs from "node:fs";
import path from "node:path";
import { parsearArgumentos } from "./argumentos";
import { cargarDataset } from "./dataset";
import { prepararDirectorio, variablesDeEntorno } from "./entorno";

const RAIZ = path.resolve(__dirname, "..");
const HTML_LAMINAS = path.join(RAIZ, "agentes-produccion-taller-v43-before-slide14-v2.html");

async function principal(): Promise<number> {
  const inicio = new Date();
  // Las instrucciones no abren conexiones: se pueden leer antes de fijar el entorno.
  const { VERSION_INSTRUCCIONES } = await import("@/src/mastra/agents/instructions");
  const args = parsearArgumentos(process.argv.slice(2), VERSION_INSTRUCCIONES);
  const datos = cargarDataset();
  const casosCorrida = datos.casos.filter((c) => !args.casos || args.casos.includes(c.id));
  if (casosCorrida.length === 0) throw new Error("Ningún caso coincide con --casos");

  // 1) Entorno aislado ANTES de cargar cualquier módulo que abra una base.
  const dir = prepararDirectorio();
  Object.assign(process.env, variablesDeEntorno({ dir }, process.env));
  const conservar = args.conservarTemp;

  const { db } = await import("@/lib/db/client");
  const { poblarBase, SENUELOS } = await import("./entorno");
  const html = fs.readFileSync(args.laminas ?? process.env.EVALS_LAMINAS_HTML ?? HTML_LAMINAS, "utf8");
  const base = await poblarBase({ fuente: db, datos, laminasHtml: html });

  const { mastra } = await import("@/src/mastra");
  const { runEvals } = await import("@mastra/core/evals");
  const { interruptores } = await import("@/lib/db/interruptores");
  const { sesiones } = await import("@/lib/db/sesiones");
  const { firmarToken, NOMBRE_COOKIE } = await import("@/lib/session");
  const { ERRORES_CHAT } = await import("@/lib/chat");
  const { construirContextoTurno } = await import("@/lib/contexto-turno");
  const { CLAVE_ORIGEN, ETIQUETA_EVAL, ORIGEN_EVAL, esTrazaDeEval } = await import("@/lib/origen-eval");
  const { construirTerminos, SinDatosPersonales } = await import("@/src/mastra/processors/sin-datos-personales");
  const { GuardiaEntrada } = await import("@/src/mastra/processors/guardia-entrada");
  const { MODELO_PRINCIPAL, MODELO_RESPALDO, MODELO_LIGERO } = await import("@/src/mastra/modelos");
  const { sincronizarDataset, aItemDataset, ID_DATASET_STUDIO } = await import("./dataset");
  const { Bitacora } = await import("./checks");
  const { crearScorersEvals } = await import("./scorers");
  const { crearObjetivo } = await import("./objetivo");
  const { crearExperimento, subirCaso, cerrarExperimento, nombreExperimento } = await import("./experimento");
  const { leerEvidenciaTraza } = await import("./evidencia");
  const { FugaSimulada } = await import("./fuga-simulada");
  const { elegirModoRuta, levantarApp, llamarChatHttp, llamarChatEnProceso } = await import("./ruta");
  const reporte = await import("./reporte");

  const version = args.instrucciones;
  const pruebaFallo = args.simularFuga || args.sinGuardrailSalida;
  const etiquetaCorrida = `${version.replaceAll(".", "")}-${inicio.getTime().toString(36)}`;
  const log = (m: string) => console.log(m);

  log(`Evals charla-v${datos.meta.version} · instrucciones ${version} · ${casosCorrida.length} casos`);
  log(`Base temporal lista (${base.laminas} láminas, ${base.asistentePorCaso.size} asistentes de prueba + ${SENUELOS.length} señuelos).`);

  // 2) Dataset y experimento en Studio.
  const sinc = await sincronizarDataset(mastra.datasets as never, datos);
  const dataset = await mastra.datasets.get({ id: ID_DATASET_STUDIO });
  log(
    `Dataset ${ID_DATASET_STUDIO}: ${sinc.creado ? "creado" : "reutilizado"} (${sinc.agregados.length} agregados, ${sinc.actualizados.length} actualizados, ${sinc.eliminados.length} eliminados).`,
  );
  const nombre = nombreExperimento({
    versionDataset: datos.meta.version,
    versionInstrucciones: version,
    fecha: inicio,
    sufijo: pruebaFallo ? `prueba de fallo${args.sinGuardrailSalida ? " sin guardrail de salida" : ""}` : args.casos ? `casos ${args.casos.join(",")}` : undefined,
  });
  const { experimentId } = await crearExperimento(dataset, {
    nombre,
    descripcion: `Agente charla con instrucciones ${version}, guardrails activos, en una base temporal. Veredicto de runEvals en la metadata.`,
    metadata: {
      [CLAVE_ORIGEN]: ORIGEN_EVAL,
      version_dataset: datos.meta.version,
      version_instrucciones: version,
      modelo_principal: MODELO_PRINCIPAL,
      modelo_respaldo: MODELO_RESPALDO,
      jueces: MODELO_LIGERO,
      prueba_de_fallo: pruebaFallo ? { simular_fuga: args.simularFuga, sin_guardrail_salida: args.sinGuardrailSalida } : false,
      casos: casosCorrida.map((c) => c.id),
    },
    variante: `instrucciones-${version}${pruebaFallo ? "-prueba-fallo" : ""}`,
  });
  log(`Experimento: ${nombre}`);

  // 3) Contexto compartido por el objetivo y los scorers.
  const casos = new Map(casosCorrida.map((c) => [c.id, c]));
  const observaciones = new Map();
  const rutas = new Map();
  const bitacora = new Bitacora();
  const ctx = {
    casos,
    observaciones,
    rutas,
    bitacora,
    terminosPrivacidad: (casoId: string) =>
      construirTerminos(base.perfiles, { asistenteId: base.asistentePorCaso.get(casoId)?.id, rol: casos.get(casoId)?.perfil.rol }),
  };
  const { gates, scorers } = crearScorersEvals(datos, ctx, {
    registrados: (id) => {
      try {
        return mastra.getScorerById(id) as never;
      } catch {
        return undefined;
      }
    },
    mensajeMantenimiento: ERRORES_CHAT.mantenimiento,
  });

  // R04: la app se levanta en paralelo con los demás casos.
  const hayRuta = casosCorrida.some((c) => c.nivel === "ruta");
  const modoRuta = hayRuta ? elegirModoRuta(args.ruta, RAIZ) : "omitir";
  const app =
    hayRuta && (modoRuta === "standalone" || modoRuta === "dev")
      ? levantarApp({ modo: modoRuta, raiz: RAIZ, entorno: process.env }).catch((e: unknown) => e as Error)
      : null;
  const almacenTrazas = await mastra.getStorage()?.getStore("observability");

  const contarTrazasAgente = async (desde: Date) => {
    if (!almacenTrazas) return null;
    await new Promise((r) => setTimeout(r, 6000)); // el exportador guarda por lotes
    const r = await almacenTrazas.listTracesLight({ filters: { entityId: "charla", startedAt: { start: desde } }, pagination: { page: 0, perPage: 100 } });
    return r.spans.filter((s) => !esTrazaDeEval(s.metadata as Record<string, unknown> | null)).length;
  };

  const probarRuta =
    modoRuta === "omitir"
      ? undefined
      : async (caso: (typeof casosCorrida)[number]) => {
          const asistente = base.asistentePorCaso.get(caso.id)!;
          const sesion = await sesiones.crear(asistente.id);
          const cookie = `${NOMBRE_COOKIE}=${firmarToken(sesion.token)}`;
          const desde = new Date();
          let r: { status: number; mensaje: string | null };
          if (modoRuta === "proceso") r = await llamarChatEnProceso(cookie, caso.input);
          else {
            const levantada = await app!;
            if (levantada instanceof Error) return { status: null, mensaje: null, trazasAgente: null, error: `no arrancó la app (${levantada.message})`, modo: modoRuta };
            r = await llamarChatHttp(levantada.url, cookie, caso.input);
          }
          return { ...r, trazasAgente: await contarTrazasAgente(desde), modo: modoRuta };
        };

  const senuelo = SENUELOS[0];
  const procesadoresSalida = pruebaFallo
    ? [new GuardiaEntrada(), ...(args.simularFuga ? [new FugaSimulada(senuelo)] : []), ...(args.sinGuardrailSalida ? [] : [new SinDatosPersonales()])]
    : undefined;

  const objetivo = crearObjetivo(mastra.getAgent("charla"), {
    casos,
    observaciones,
    rutas,
    interruptores,
    memoria: (casoId) => ({ thread: `eval-${etiquetaCorrida}-${casoId}`, resource: `eval-${etiquetaCorrida}-${casoId}` }),
    trazado: (caso) => ({
      metadata: {
        [CLAVE_ORIGEN]: ORIGEN_EVAL,
        caso_id: caso.id,
        categoria: caso.categoria,
        version_instrucciones: version,
        version_dataset: datos.meta.version,
        experimento_id: experimentId,
      },
      tags: [ETIQUETA_EVAL, `charla-v${datos.meta.version}`, `instrucciones-${version}`],
    }),
    opcionesExtra: procesadoresSalida ? { outputProcessors: procesadoresSalida } : undefined,
    leerEvidencia:
      almacenTrazas && "getTrace" in almacenTrazas
        ? async (traceId, caso) => {
            if (caso.categoria !== "resiliencia") return undefined;
            const evidencia = await leerEvidenciaTraza(almacenTrazas as never, traceId);
            if (!evidencia) console.warn(`  Sin evidencia de la traza para ${caso.id}: el juez solo verá la respuesta y los datos del turno.`);
            return evidencia;
          }
        : undefined,
    probarRuta,
  });

  // 4) Items de runEvals: requestContext como la ruta de chat + el id del caso.
  const valoresIniciales = await interruptores.obtenerTodos();
  const data = casosCorrida.map((caso) => {
    const asistente = base.asistentePorCaso.get(caso.id)!;
    const rc = construirContextoTurno(
      { id: asistente.id, nombre: asistente.nombre, rol: caso.perfil.rol, descripcion: caso.perfil.descripcion },
      valoresIniciales,
      version,
    );
    rc.set("caso_id", caso.id);
    return { input: caso.input, groundTruth: aItemDataset(caso).groundTruth, requestContext: rc };
  });

  let hechos = 0;
  const resultado = await runEvals({
    target: objetivo,
    data,
    gates,
    scorers,
    concurrency: args.concurrencia,
    onItemComplete: async ({ item }) => {
      const casoId = String(item.requestContext?.get("caso_id"));
      const caso = casos.get(casoId)!;
      const obs = observaciones.get(casoId);
      const resultados = bitacora.de(casoId);
      const resumen = reporte.resumirCaso(caso, resultados, obs);
      hechos++;
      log(`  [${hechos}/${casosCorrida.length}] ${casoId} ${resumen.estado === "pasa" ? "pasa" : "FALLA"} (${((obs?.duracionMs ?? 0) / 1000).toFixed(1)} s)`);
      const itemId = sinc.itemPorCaso.get(casoId);
      if (!itemId || !obs) return;
      const fin = new Date();
      try {
        await subirCaso(dataset, experimentId, itemId, { caso, obs, resultados, ruta: rutas.get(casoId), inicio: new Date(fin.getTime() - obs.duracionMs), fin });
      } catch (error) {
        console.warn(`  No se pudo subir ${casoId} a Studio (${error instanceof Error ? error.name : "error"}).`);
      }
    },
  });

  const levantada = app ? await app : null;
  if (levantada && !(levantada instanceof Error)) await levantada.detener();

  // 5) Reporte, archivo y cierre del experimento.
  const resumenes = casosCorrida.map((c) => reporte.resumirCaso(c, bitacora.de(c.id), observaciones.get(c.id)));
  const todas = casosCorrida.flatMap((c) => bitacora.de(c.id));
  const coste = reporte.costeCorrida([...observaciones.values()], reporte.llamadasDeJuez(todas));
  const duracionS = (Date.now() - inicio.getTime()) / 1000;
  const notas: string[] = [];
  const rutaR04 = rutas.get("R04");
  if (hayRuta && (modoRuta === "omitir" || rutaR04?.omitida)) notas.push("R04 (ruta /api/chat) se omitió: su gate no cuenta en el veredicto.");
  else if (hayRuta) notas.push(`R04 se probó con la app en modo ${modoRuta}.`);
  if (pruebaFallo) notas.push("Prueba de fallo: esta corrida no sirve como gate de despliegue.");
  const urlStudio = `${process.env.STUDIO_URL?.trim() || "http://localhost:4111"} → Datasets → ${ID_DATASET_STUDIO} → Experiments → «${nombre}»`;

  log(reporte.formatearReporte({ titulo: nombre, resumenes, resultado, coste, duracionS, urlStudio, notas }));

  const archivo = reporte.guardarResultados(
    {
      experimento: { id: experimentId, nombre },
      dataset: { id: ID_DATASET_STUDIO, version: datos.meta.version },
      version_instrucciones: version,
      prueba_de_fallo: pruebaFallo,
      veredicto: resultado.verdict ?? null,
      gates: resultado.gateResults ?? [],
      umbrales: resultado.thresholdResults ?? [],
      promedios: resultado.scores,
      no_puntuables: resultado.summary.notScorable ?? {},
      tabla: reporte.tablaPorCategoria(resumenes),
      casos: casosCorrida.map((c) => ({
        ...resumenes.find((r) => r.id === c.id),
        respuesta: observaciones.get(c.id)?.texto ?? null,
        duracion_s: (observaciones.get(c.id)?.duracionMs ?? 0) / 1000,
        resultados: bitacora.de(c.id),
      })),
      coste,
      duracion_s: duracionS,
      notas,
    },
    inicio,
  );
  log(`Resultados: ${path.relative(RAIZ, archivo)}`);

  await cerrarExperimento(dataset, experimentId, {
    veredicto: resultado.verdict ?? null,
    explicacion: reporte.explicarVeredicto(resultado),
    gates: resultado.gateResults ?? [],
    umbrales: resultado.thresholdResults ?? [],
    pasados: resumenes.filter((r) => r.estado === "pasa").length,
    total: resumenes.length,
    coste_usd: Number(coste.totalUsd.toFixed(4)),
    duracion_s: Math.round(duracionS),
  });

  // Vacía los lotes de trazas pendientes antes de cerrar el almacenamiento.
  await mastra.observability.flush().catch(() => undefined);
  await mastra.shutdown().catch(() => undefined);
  if (!conservar) fs.rmSync(dir, { recursive: true, force: true });
  else log(`Carpeta temporal conservada: ${dir}`);
  return reporte.codigoSalida(resultado.verdict);
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    // Solo el tipo y el mensaje propio del runner; nunca datos de asistentes.
    console.error(`Los evals no pudieron completarse: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
