import { NextResponse } from "next/server";

// Respuestas JSON del panel: nunca se guardan en caché (datos en vivo).
export function jsonPanel(cuerpo: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(cuerpo, { ...init, headers });
}
