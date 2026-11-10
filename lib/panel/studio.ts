// URL de Mastra Studio para el enlace del panel (STUDIO_URL). Solo http(s);
// si falta o no es válida, el enlace no se muestra.
export function urlStudio(valor: string | undefined): string | null {
  const texto = valor?.trim();
  if (!texto) return null;
  try {
    const url = new URL(texto);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Enlace «ver traza» del registro de eventos: la vista de trazas de Studio
// filtrada por ese trace id. null si no hay Studio o la línea no tiene traza.
export function urlTrazaStudio(studioUrl: string | null, traceId: string | null): string | null {
  if (!studioUrl || !traceId) return null;
  const base = studioUrl.endsWith("/") ? studioUrl : `${studioUrl}/`;
  return `${base}traces?traceId=${encodeURIComponent(traceId)}`;
}
