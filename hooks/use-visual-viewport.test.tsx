// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisualViewport } from "./use-visual-viewport";

afterEach(() => vi.unstubAllGlobals());

function viewportFalso(height: number, offsetTop = 0) {
  const vv = Object.assign(new EventTarget(), { height, offsetTop });
  vi.stubGlobal("visualViewport", vv);
  return vv;
}

describe("useVisualViewport", () => {
  it("sin visualViewport devuelve null (se usa 100dvh)", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toBeNull();
  });

  it("sigue el alto y el desplazamiento del viewport visible (teclado abierto)", () => {
    const vv = viewportFalso(640);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ alto: 640, desplazamiento: 0 });
    act(() => {
      vv.height = 330;
      vv.offsetTop = 40;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ alto: 330, desplazamiento: 40 });
    act(() => {
      vv.offsetTop = 0;
      vv.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toEqual({ alto: 330, desplazamiento: 0 });
  });

  it("deja de escuchar al desmontar", () => {
    const vv = viewportFalso(640);
    const quitar = vi.spyOn(vv, "removeEventListener");
    const { unmount } = renderHook(() => useVisualViewport());
    unmount();
    expect(quitar).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(quitar).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
