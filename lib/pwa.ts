// Instalar el chat en el teléfono (PWA).
// - Android (Chrome, Edge, Samsung Internet): el navegador avisa con
//   `beforeinstallprompt` y la app ofrece «Instalar app», que abre su diálogo.
// - iPhone/iPad: no existe ese aviso. Se explica cómo agregarla a la pantalla
//   de inicio desde el menú Compartir (Safari, y desde iOS 16.4 también
//   Chrome, Firefox y Edge).
// - Escritorio: no se ofrece nada.

export type Plataforma = "ios-safari" | "ios-otro" | "otra";
export type Oferta = "instalar" | "ios-safari" | "ios-otro" | null;

export interface Entorno {
  userAgent: string;
  maxTouchPoints: number;
  // Abierta desde la pantalla de inicio (`display-mode: standalone` o `navigator.standalone`).
  standalone: boolean;
  // Hay un `beforeinstallprompt` guardado y sin usar.
  promptDisponible: boolean;
}

export const TEXTOS_PWA = {
  instalar: "Instalar app",
  agregarInicio: "Agregar a inicio",
  ofertaAndroid: "Tenla a mano durante la charla.",
  iosSafari: "Para tenerla a mano: toca Compartir y luego «Agregar a inicio».",
  iosOtro: "Para tenerla a mano: toca Compartir en tu navegador y luego «Agregar a inicio».",
  cerrar: "Ahora no",
  entendido: "Entendido",
} as const;

// Navegadores de iOS que pueden agregar a inicio desde su menú Compartir (iOS 16.4+).
const IOS_OTROS = /CriOS|FxiOS|EdgiOS/;

export function detectarPlataforma({ userAgent, maxTouchPoints }: Pick<Entorno, "userAgent" | "maxTouchPoints">): Plataforma {
  const iPhone = /iPhone|iPad|iPod/.test(userAgent);
  // iPadOS pide la versión de escritorio: se presenta como Mac, pero es táctil.
  const iPad = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (!iPhone && !iPad) return "otra";
  if (IOS_OTROS.test(userAgent)) return "ios-otro";
  // Safari trae «Version/x Safari/y». Las apps con navegador propio (Instagram,
  // Facebook, Google) no lo traen y no permiten agregar a inicio.
  if (/Version\/[\d.]+.*Safari\//.test(userAgent)) return "ios-safari";
  return "otra";
}

export function ofertaInstalacion(entorno: Entorno): Oferta {
  if (entorno.standalone) return null;
  const plataforma = detectarPlataforma(entorno);
  if (plataforma !== "otra") return plataforma;
  // En escritorio Chrome también ofrece instalar, pero ahí no aporta.
  if (entorno.promptDisponible && /Android/i.test(entorno.userAgent)) return "instalar";
  return null;
}

// ---------- Estado del navegador (solo cliente) ----------

// `BeforeInstallPromptEvent` no está en los tipos de TypeScript (no es estándar).
export interface EventoInstalacion extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let promptGuardado: EventoInstalacion | null = null;
let instalada = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((o) => o());

// Se llama una vez al cargar la página (componente del layout): el aviso puede
// llegar mientras la persona todavía está en la pantalla del correo.
export function capturarInstalacion(): () => void {
  const alAviso = (e: Event) => {
    e.preventDefault();
    promptGuardado = e as EventoInstalacion;
    avisar();
  };
  const alInstalar = () => {
    promptGuardado = null;
    instalada = true;
    avisar();
  };
  window.addEventListener("beforeinstallprompt", alAviso);
  window.addEventListener("appinstalled", alInstalar);
  return () => {
    window.removeEventListener("beforeinstallprompt", alAviso);
    window.removeEventListener("appinstalled", alInstalar);
  };
}

export function suscribirInstalacion(oyente: () => void): () => void {
  oyentes.add(oyente);
  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", oyente);
  return () => {
    oyentes.delete(oyente);
    mq?.removeEventListener?.("change", oyente);
  };
}

export function entornoActual(): Entorno {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: instalada || nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
    promptDisponible: promptGuardado !== null,
  };
}

// Abre el diálogo de instalación del navegador. El evento sirve una sola vez.
export async function pedirInstalacion(): Promise<boolean> {
  const evento = promptGuardado;
  if (!evento) return false;
  promptGuardado = null;
  avisar();
  try {
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

// ---------- «Ahora no» ----------

const CLAVE_DESCARTE = "pwa-oferta-descartada";

export function ofertaDescartada(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_DESCARTE) === "1";
  } catch {
    return false;
  }
}

export function descartarOferta(): void {
  try {
    window.localStorage.setItem(CLAVE_DESCARTE, "1");
  } catch {
    // Sin almacenamiento (modo privado): se oculta solo en esta visita.
  }
}

// Solo para pruebas.
export function reiniciarInstalacionParaPruebas(): void {
  promptGuardado = null;
  instalada = false;
  oyentes.clear();
}
