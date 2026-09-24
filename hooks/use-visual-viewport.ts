"use client";

import { useEffect, useState } from "react";

export interface ViewportVisible {
  alto: number;
  desplazamiento: number;
}

// Alto y desplazamiento del área visible (window.visualViewport). Con el
// teclado abierto en iOS el layout no se achica: el chat usa este alto para
// que el composer quede pegado al teclado. null si el navegador no lo soporta.
export function useVisualViewport(): ViewportVisible | null {
  const [vista, setVista] = useState<ViewportVisible | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const actualizar = () =>
      setVista((previa) =>
        previa && previa.alto === vv.height && previa.desplazamiento === vv.offsetTop
          ? previa
          : { alto: vv.height, desplazamiento: vv.offsetTop },
      );
    actualizar();
    vv.addEventListener("resize", actualizar);
    vv.addEventListener("scroll", actualizar);
    return () => {
      vv.removeEventListener("resize", actualizar);
      vv.removeEventListener("scroll", actualizar);
    };
  }, []);

  return vista;
}
