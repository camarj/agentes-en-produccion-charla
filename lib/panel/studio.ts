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
