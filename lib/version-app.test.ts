import { describe, expect, it, vi } from "vitest";
import {
  CLAVE_RECARGA,
  chatSeguroParaRecargar,
  debeRecargar,
  recargarSiHayVersionNueva,
  versionServidor,
} from "./version-app";

describe("debeRecargar", () => {
  const base = { local: "v1", servidor: "v2", yaIntentada: null, seguro: true };

  it("recarga si el servidor tiene otra versión y es seguro", () => {
    expect(debeRecargar(base)).toBe(true);
  });

  it("misma versión, versión del servidor ausente o no es seguro → no", () => {
    expect(debeRecargar({ ...base, servidor: "v1" })).toBe(false);
    expect(debeRecargar({ ...base, servidor: undefined })).toBe(false);
    expect(debeRecargar({ ...base, servidor: "" })).toBe(false);
    expect(debeRecargar({ ...base, servidor: 42 })).toBe(false);
    expect(debeRecargar({ ...base, seguro: false })).toBe(false);
  });

  it("no recarga dos veces por la misma versión (evita bucles)", () => {
    expect(debeRecargar({ ...base, yaIntentada: "v2" })).toBe(false);
    // Un despliegue posterior sí vuelve a recargar.
    expect(debeRecargar({ ...base, servidor: "v3", yaIntentada: "v2" })).toBe(true);
  });
});

describe("chatSeguroParaRecargar", () => {
  const quieto = { ocupado: false, texto: "", dictando: false };
  it("solo con el chat quieto: sin respuesta en curso, composer vacío y sin dictado", () => {
    expect(chatSeguroParaRecargar(quieto)).toBe(true);
    expect(chatSeguroParaRecargar({ ...quieto, texto: "   " })).toBe(true);
    expect(chatSeguroParaRecargar({ ...quieto, ocupado: true })).toBe(false);
    expect(chatSeguroParaRecargar({ ...quieto, texto: "¿Qué es" })).toBe(false);
    expect(chatSeguroParaRecargar({ ...quieto, dictando: true })).toBe(false);
  });
});

function memoria(inicial: Record<string, string> = {}) {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k: string) => datos[k] ?? null,
    setItem: (k: string, v: string) => {
      datos[k] = v;
    },
  };
}

describe("recargarSiHayVersionNueva", () => {
  it("recarga una vez y recuerda la versión objetivo en sessionStorage", () => {
    const almacen = memoria();
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva({ servidor: "v2", seguro: true, local: "v1", almacen, recargar })).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(almacen.datos[CLAVE_RECARGA]).toBe("v2");
    // Tras recargar, si el bundle sigue siendo viejo (caché), no vuelve a recargar.
    expect(recargarSiHayVersionNueva({ servidor: "v2", seguro: true, local: "v1", almacen, recargar })).toBe(false);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("no recarga si no es seguro ni si la versión coincide", () => {
    const recargar = vi.fn();
    recargarSiHayVersionNueva({ servidor: "v2", seguro: false, local: "v1", almacen: memoria(), recargar });
    recargarSiHayVersionNueva({ servidor: "v1", seguro: true, local: "v1", almacen: memoria(), recargar });
    expect(recargar).not.toHaveBeenCalled();
  });

  it("sessionStorage bloqueado: no recarga (sin memoria no hay forma de evitar un bucle)", () => {
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva({ servidor: "v2", seguro: true, local: "v1", almacen: roto, recargar })).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });
});

describe("versionServidor", () => {
  it("la del build, salvo que se fuerce otra (solo para probar la recarga)", () => {
    expect(versionServidor(undefined, "b1")).toBe("b1");
    expect(versionServidor("  ", "b1")).toBe("b1");
    expect(versionServidor("forzada", "b1")).toBe("forzada");
  });
});
