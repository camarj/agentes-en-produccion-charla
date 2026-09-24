import { describe, expect, it } from "vitest";
import { urlStudio } from "./studio";

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
