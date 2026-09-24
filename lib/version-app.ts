// Versión del build y recarga automática de clientes viejos.
//
// Tras un redespliegue, los teléfonos (o la PWA) con la app abierta siguen
// corriendo el JS anterior. `/api/sugerencias` (chat) y `/api/panel/metricas`
// (panel) devuelven la versión del servidor en cada sondeo; si no coincide con
// la del bundle, el cliente recarga UNA vez, y solo cuando es seguro.
//
// `VERSION_APP` la fija `next.config.ts` (`env`) al compilar: Next la escribe
// tal cual en el bundle del cliente y en el del servidor, así que es la misma
// para todo un build. Este módulo va también al navegador: sin imports de servidor.

export const VERSION_APP: string = process.env.VERSION_APP ?? "desarrollo";

// sessionStorage: versión a la que ya se intentó recargar (evita bucles).
export const CLAVE_RECARGA = "charla:version-recarga";

// Versión que reporta el servidor. `VERSION_APP_FORZADA` (variable de entorno
// en tiempo de ejecución) solo sirve para probar la recarga sin redesplegar.
export function versionServidor(forzada = process.env.VERSION_APP_FORZADA, delBuild = VERSION_APP): string {
  return forzada?.trim() || delBuild;
}

export function debeRecargar(p: { local: string; servidor: unknown; yaIntentada: string | null; seguro: boolean }): boolean {
  if (typeof p.servidor !== "string" || p.servidor === "") return false;
  return p.seguro && p.servidor !== p.local && p.servidor !== p.yaIntentada;
}

// Chat: sin respuesta en curso, sin texto en el composer y sin dictado. Una
// pregunta en pausa (423) ya está guardada en localStorage: recargar no la pierde.
export function chatSeguroParaRecargar(p: { ocupado: boolean; texto: string; dictando: boolean }): boolean {
  return !p.ocupado && p.texto.trim() === "" && !p.dictando;
}

interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

// Recarga si hace falta. Devuelve true si pidió la recarga. Sin sessionStorage
// no recarga: sin memoria no hay cómo evitar un bucle.
export function recargarSiHayVersionNueva(p: {
  servidor: unknown;
  seguro: boolean;
  local?: string;
  almacen?: Almacen;
  recargar?: () => void;
}): boolean {
  const local = p.local ?? VERSION_APP;
  if (!p.seguro || typeof p.servidor !== "string" || p.servidor === local) return false;
  try {
    const almacen = p.almacen ?? window.sessionStorage;
    const yaIntentada = almacen.getItem(CLAVE_RECARGA);
    if (!debeRecargar({ local, servidor: p.servidor, yaIntentada, seguro: p.seguro })) return false;
    almacen.setItem(CLAVE_RECARGA, p.servidor);
  } catch {
    return false;
  }
  (p.recargar ?? (() => window.location.reload()))();
  return true;
}
