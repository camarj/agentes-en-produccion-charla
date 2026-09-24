"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Se sigue el stream solo si el usuario estaba a menos de 80 px del final.
export const UMBRAL_SEGUIR_PX = 80;

const TECLAS_SUBIR = new Set(["ArrowUp", "PageUp", "Home"]);

export function distanciaAlFinal(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

// Scroll inteligente de la lista de mensajes. `contenido` cambia con cada
// token (p. ej., el arreglo de mensajes):
// - si el usuario está siguiendo el final, la vista baja con el stream;
// - apenas sube (rueda, dedo, teclado o cualquier scroll hacia arriba), deja
//   de seguir, aunque esté a menos de 80 px: la distancia sola no basta,
//   porque un token puede llegar antes que el evento `scroll` y devolverlo abajo;
// - vuelve a seguir si baja hasta quedar a menos de 80 px del final, o con
//   `irAlFinal` (botón «↓» o al enviar).
export function useAutoScroll<T extends HTMLElement>(contenido: unknown) {
  const ref = useRef<T>(null);
  const seguir = useRef(true);
  const ultimaPosicion = useRef(0);
  const [mostrarBajar, setMostrarBajar] = useState(false);

  const dejarDeSeguir = useCallback(() => {
    seguir.current = false;
  }, []);

  const alDesplazar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const subio = el.scrollTop < ultimaPosicion.current - 1;
    ultimaPosicion.current = el.scrollTop;
    const lejos = distanciaAlFinal(el) >= UMBRAL_SEGUIR_PX;
    seguir.current = !subio && !lejos;
    setMostrarBajar(!seguir.current && lejos);
  }, []);

  const irAlFinal = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    seguir.current = true;
    setMostrarBajar(false);
    // Salto directo (sin animación): una animación larga durante el stream
    // dispararía eventos de scroll y la vista dejaría de seguir.
    el.scrollTop = el.scrollHeight;
    ultimaPosicion.current = el.scrollTop;
  }, []);

  // Intención del usuario, antes de que llegue el evento `scroll`.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inicioY: number | null = null;
    const rueda = (e: WheelEvent) => {
      if (e.deltaY < 0) dejarDeSeguir();
    };
    const tocar = (e: TouchEvent) => {
      inicioY = e.touches[0]?.clientY ?? null;
    };
    const arrastrar = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      // El dedo baja → el contenido sube.
      if (inicioY !== null && y !== undefined && y > inicioY) dejarDeSeguir();
    };
    const tecla = (e: KeyboardEvent) => {
      if (TECLAS_SUBIR.has(e.key)) dejarDeSeguir();
    };
    el.addEventListener("wheel", rueda, { passive: true });
    el.addEventListener("touchstart", tocar, { passive: true });
    el.addEventListener("touchmove", arrastrar, { passive: true });
    el.addEventListener("keydown", tecla);
    return () => {
      el.removeEventListener("wheel", rueda);
      el.removeEventListener("touchstart", tocar);
      el.removeEventListener("touchmove", arrastrar);
      el.removeEventListener("keydown", tecla);
    };
  }, [dejarDeSeguir]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (seguir.current) {
      el.scrollTop = el.scrollHeight;
      ultimaPosicion.current = el.scrollTop;
    } else if (distanciaAlFinal(el) >= UMBRAL_SEGUIR_PX) {
      setMostrarBajar(true);
    }
  }, [contenido]);

  return { ref, alDesplazar, irAlFinal, mostrarBajar };
}
