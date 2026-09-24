import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const m = manifest();

describe("manifest", () => {
  it("nombre, inicio y modo app", () => {
    expect(m.name).toBe("Agentes en producción · Charla");
    expect(m.short_name).toBe("Agentes");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("es");
  });

  it("fondo y color del tema negros (identidad de la presentación)", () => {
    expect(m.background_color).toBe("#000000");
    expect(m.theme_color).toBe("#000000");
  });

  it("íconos 192 y 512 normales y un 512 maskable, y todos existen en public/", () => {
    const iconos = m.icons ?? [];
    const de = (tam: string, uso: string) => iconos.find((i) => i.sizes === tam && (i.purpose ?? "any") === uso);
    expect(de("192x192", "any")).toBeTruthy();
    expect(de("512x512", "any")).toBeTruthy();
    expect(de("512x512", "maskable")).toBeTruthy();
    for (const i of iconos) {
      expect(i.type).toBe("image/png");
      expect(fs.existsSync(path.join(process.cwd(), "public", i.src))).toBe(true);
    }
  });

  it("no pide abrir una app nativa en su lugar (bloquearía la instalación)", () => {
    expect(m.prefer_related_applications ?? false).toBe(false);
  });
});
