import { NextResponse, type NextRequest } from "next/server";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";

// Next 16: `proxy.ts` reemplaza a `middleware.ts` y corre en Node.js.
// Protege con Basic Auth el panel del speaker y su API (T12). Las rutas de
// /api/panel vuelven a comprobarlo por su cuenta (defensa en profundidad).
export function proxy(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/api/panel/:path*"],
};
