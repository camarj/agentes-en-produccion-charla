// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UMBRAL_SEGUIR_PX, useAutoScroll } from "./use-auto-scroll";

// jsdom no calcula layout: se fijan a mano las medidas del contenedor.
function medir(el: HTMLElement, m: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: m.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: m.clientHeight });
  el.scrollTop = m.scrollTop;
}

function Lista({ contenido }: { contenido: number }) {
  const { ref, alDesplazar, mostrarBajar, irAlFinal } = useAutoScroll<HTMLDivElement>(contenido);
  return (
    <div>
      <div data-testid="lista" ref={ref} onScroll={alDesplazar} />
      {mostrarBajar && <button onClick={() => irAlFinal()}>bajar</button>}
    </div>
  );
}

afterEach(cleanup);

describe("useAutoScroll", () => {
  it("el umbral es 80 px", () => {
    expect(UMBRAL_SEGUIR_PX).toBe(80);
  });

  it("sigue el stream si el usuario está a menos de 80 px del final", () => {
    const { rerender } = render(<Lista contenido={1} />);
    const lista = screen.getByTestId("lista");
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 530 }); // 70 px del final
    fireEvent.scroll(lista);
    medir(lista, { scrollHeight: 1200, clientHeight: 400, scrollTop: 530 });
    rerender(<Lista contenido={2} />);
    expect(lista.scrollTop).toBe(1200);
    expect(screen.queryByRole("button", { name: "bajar" })).toBeNull();
  });

  it("si el usuario subió, no lo arrastra y muestra el botón para bajar", () => {
    const { rerender } = render(<Lista contenido={1} />);
    const lista = screen.getByTestId("lista");
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 400 }); // 200 px del final
    fireEvent.scroll(lista);
    medir(lista, { scrollHeight: 1200, clientHeight: 400, scrollTop: 400 });
    rerender(<Lista contenido={2} />);
    expect(lista.scrollTop).toBe(400);
    expect(screen.getByRole("button", { name: "bajar" })).toBeTruthy();
  });

  it("el botón lleva al final y vuelve a seguir el stream", () => {
    const { rerender } = render(<Lista contenido={1} />);
    const lista = screen.getByTestId("lista");
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    fireEvent.scroll(lista);
    act(() => screen.getByRole("button", { name: "bajar" }).click());
    expect(lista.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "bajar" })).toBeNull();
    medir(lista, { scrollHeight: 1500, clientHeight: 400, scrollTop: 1000 });
    rerender(<Lista contenido={2} />);
    expect(lista.scrollTop).toBe(1500);
  });

  it("subir aunque sea poco (dentro de los 80 px) deja de seguir; el botón aparece cuando el final se aleja", () => {
    const { rerender } = render(<Lista contenido={1} />);
    const lista = screen.getByTestId("lista");
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(lista); // en el final
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 590 });
    fireEvent.scroll(lista); // sube 10 px
    medir(lista, { scrollHeight: 1300, clientHeight: 400, scrollTop: 590 });
    rerender(<Lista contenido={2} />);
    expect(lista.scrollTop).toBe(590);
    expect(screen.getByRole("button", { name: "bajar" })).toBeTruthy();
  });

  it("la rueda o el dedo hacia arriba dejan de seguir antes de que llegue el evento de scroll", () => {
    for (const gesto of ["rueda", "dedo"] as const) {
      const { rerender, unmount } = render(<Lista contenido={1} />);
      const lista = screen.getByTestId("lista");
      medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
      fireEvent.scroll(lista);
      if (gesto === "rueda") {
        fireEvent.wheel(lista, { deltaY: -100 });
      } else {
        fireEvent.touchStart(lista, { touches: [{ clientY: 100 }] });
        fireEvent.touchMove(lista, { touches: [{ clientY: 160 }] });
      }
      lista.scrollTop = 500; // el navegador aún no avisó con `scroll`
      medir(lista, { scrollHeight: 1300, clientHeight: 400, scrollTop: 500 });
      rerender(<Lista contenido={2} />);
      expect(lista.scrollTop).toBe(500);
      unmount();
    }
  });

  it("volver a bajar hasta menos de 80 px del final reanuda el seguimiento", () => {
    const { rerender } = render(<Lista contenido={1} />);
    const lista = screen.getByTestId("lista");
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(lista);
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 300 });
    fireEvent.scroll(lista);
    medir(lista, { scrollHeight: 1000, clientHeight: 400, scrollTop: 560 });
    fireEvent.scroll(lista);
    medir(lista, { scrollHeight: 1300, clientHeight: 400, scrollTop: 560 });
    rerender(<Lista contenido={2} />);
    expect(lista.scrollTop).toBe(1300);
  });
});
