import { describe, expect, it } from "vitest";
import { urlStudio, urlTrazaStudio } from "./studio";

describe("urlStudio", () => {
  it("devuelve la URL si es http(s)", () => {
    expect(urlStudio("https://studio.inteliside.com")).toBe("https://studio.inteliside.com/");
    expect(urlStudio(" http://localhost:4111 ")).toBe("http://localhost:4111/");
  });
  it("null si falta o no es una URL http(s): el enlace se oculta", () => {
    expect(urlStudio(undefined)).toBeNull();
    expect(urlStudio("")).toBeNull();
    expect(urlStudio("   ")).toBeNull();
    expect(urlStudio("javascript:alert(1)")).toBeNull();
    expect(urlStudio("no es url")).toBeNull();
  });
});

describe("urlTrazaStudio", () => {
  it("abre la traza en la vista de trazas de Studio", () => {
    expect(urlTrazaStudio("https://studio.inteliside.com/", "abc 1")).toBe("https://studio.inteliside.com/traces?traceId=abc%201");
    expect(urlTrazaStudio("http://localhost:4111/base/", "t1")).toBe("http://localhost:4111/base/traces?traceId=t1");
  });
  it("null sin Studio o sin trace id", () => {
    expect(urlTrazaStudio(null, "t1")).toBeNull();
    expect(urlTrazaStudio("https://studio.inteliside.com/", null)).toBeNull();
  });
});
