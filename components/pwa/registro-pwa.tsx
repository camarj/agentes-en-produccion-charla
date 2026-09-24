"use client";

import { useEffect } from "react";
import { capturarInstalacion } from "@/lib/pwa";

// Va en el layout: guarda el aviso de instalación de Android desde que carga
// la página (puede llegar en la pantalla del correo) y registra el service
// worker. En desarrollo no se registra, para no servir archivos viejos.
export function RegistroPwa({ registrarSW = process.env.NODE_ENV === "production" }: { registrarSW?: boolean }) {
  useEffect(() => capturarInstalacion(), []);

  useEffect(() => {
    if (!registrarSW || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin service worker la app funciona igual (solo no hay página sin conexión).
    });
  }, [registrarSW]);

  return null;
}
