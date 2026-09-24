// Apagado ordenado del servicio web (T14). Se precarga con
// `node --import ./scripts/apagado-ordenado.mjs server.js` junto con
// NEXT_MANUAL_SIG_HANDLE=true (así Next no instala su propio manejador, que
// sale al instante). Al recibir SIGTERM/SIGINT espera APAGADO_ESPERA_MS
// (8 s por defecto) antes de salir: los streams en curso terminan y el
// exportador de Mastra alcanza a enviar el último lote de trazas a Neon.
// Dokploy/Docker debe dar un periodo de gracia mayor (p. ej. 15 s).
const espera = Number(process.env.APAGADO_ESPERA_MS) || 8000;
let saliendo = false;

function apagar(senal) {
  if (saliendo) return;
  saliendo = true;
  console.log(`[apagado] ${senal} recibido; saliendo en ${espera} ms`);
  setTimeout(() => process.exit(0), espera);
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
