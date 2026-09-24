"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  REFRESCO_MS,
  type ClaveActivable,
  type EstadoInterruptores,
  type FilaEscalamiento,
  type MetricasPanel,
  type ValorOnOff,
} from "@/lib/panel/tipos";
import { recargarSiHayVersionNueva } from "@/lib/version-app";

// Datos del panel: se piden al abrir y luego cada 5 s, sin recargar la página.
// Si una actualización falla, se conservan los últimos datos y se avisa.

async function leer<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, method: "POST" | "PATCH", cuerpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

const MENSAJE_NO_GUARDADO = "No se pudo guardar el cambio. Intenta de nuevo.";

// `seguroParaRecargar`: si hay una versión nueva desplegada, el panel recarga
// una vez, solo cuando esto devuelve true (sin diálogo abierto).
export function usePanel({
  seguroParaRecargar = () => true,
  alRecargar,
}: { seguroParaRecargar?: () => boolean; alRecargar?: () => void } = {}) {
  const [metricas, setMetricas] = useState<MetricasPanel | null>(null);
  const [interruptores, setInterruptores] = useState<EstadoInterruptores | null>(null);
  const [cola, setCola] = useState<FilaEscalamiento[] | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null);
  const enCurso = useRef(false);
  const recarga = useRef({ seguroParaRecargar, alRecargar });
  useEffect(() => {
    recarga.current = { seguroParaRecargar, alRecargar };
  });

  const refrescar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const [m, i, c] = await Promise.all([
        leer<MetricasPanel>("/api/panel/metricas"),
        leer<EstadoInterruptores>("/api/panel/interruptores"),
        leer<{ escalamientos: FilaEscalamiento[] }>("/api/panel/escalamientos"),
      ]);
      const { seguroParaRecargar: seguro, alRecargar: recargar } = recarga.current;
      if (recargarSiHayVersionNueva({ servidor: m.version, seguro: seguro(), recargar })) return;
      setMetricas(m);
      setInterruptores(i);
      setCola(c.escalamientos);
      setSinConexion(false);
      setActualizadoEn(new Date().toISOString());
    } catch {
      setSinConexion(true);
    } finally {
      enCurso.current = false;
    }
  }, []);

  useEffect(() => {
    const primera = setTimeout(() => void refrescar(), 0);
    const intervalo = setInterval(() => void refrescar(), REFRESCO_MS);
    return () => {
      clearTimeout(primera);
      clearInterval(intervalo);
    };
  }, [refrescar]);

  const cambiarInterruptor = useCallback(
    async (clave: ClaveActivable | "lamina_actual", valor: ValorOnOff | number) => {
      try {
        setInterruptores(await enviar<EstadoInterruptores>("/api/panel/interruptores", "POST", { clave, valor }));
        void refrescar();
      } catch {
        toast.error(MENSAJE_NO_GUARDADO);
      }
    },
    [refrescar],
  );

  const marcarEscalamiento = useCallback(
    async (id: number, estado: "respondida" | "descartada") => {
      try {
        await enviar("/api/panel/escalamientos", "PATCH", { id, estado });
        setCola((actual) => actual?.map((f) => (f.id === id ? { ...f, estado } : f)) ?? actual);
        void refrescar();
      } catch {
        toast.error(MENSAJE_NO_GUARDADO);
      }
    },
    [refrescar],
  );

  return { metricas, interruptores, cola, sinConexion, actualizadoEn, cambiarInterruptor, marcarEscalamiento };
}
