import { describe, expect, it } from "vitest";
import { EMAILS_SPEAKER, NOMBRE_SPEAKER, esEmailSpeaker, esNombreSpeaker } from "./speaker";

describe("speaker", () => {
  it("datos del speaker", () => {
    expect(EMAILS_SPEAKER).toEqual(["raulj.camacho@gmail.com", "raulj.camacho@inteliside.com"]);
    expect(NOMBRE_SPEAKER).toBe("Raúl Camacho");
  });

  it("reconoce su email sin importar mayúsculas ni espacios", () => {
    expect(esEmailSpeaker("  RaulJ.Camacho@Gmail.com ")).toBe(true);
    expect(esEmailSpeaker("raulj.camacho@INTELISIDE.com")).toBe(true);
    expect(esEmailSpeaker("otro@gmail.com")).toBe(false);
    expect(esEmailSpeaker(null)).toBe(false);
  });

  it("reconoce su nombre sin importar tildes, mayúsculas ni espacios", () => {
    expect(esNombreSpeaker("RAUL  camacho")).toBe(true);
    expect(esNombreSpeaker("Raúl Camacho")).toBe(true);
    expect(esNombreSpeaker("Raúl Pérez")).toBe(false);
    expect(esNombreSpeaker("Raúl")).toBe(false);
  });
});
