import { describe, expect, it, vi } from "vitest";
import type { TokenPayload } from "google-auth-library";
import { crearVerificadorGoogle, type VerificadorTokens } from "./google";

const AUDIENCIA = "cliente-prueba.apps.googleusercontent.com";

function clienteQueDevuelve(payload: Partial<TokenPayload> | Error): VerificadorTokens & { verifyIdToken: ReturnType<typeof vi.fn> } {
  return {
    verifyIdToken: vi.fn(async () => {
      if (payload instanceof Error) throw payload;
      return { getPayload: () => payload as TokenPayload };
    }),
  };
}

const base = { sub: "123", email: "Ana@Gmail.com", email_verified: true, name: " Ana Pérez " } as const;

describe("crearVerificadorGoogle", () => {
  it("token válido → identidad con email en minúsculas y nombre limpio, verificado contra nuestro client id", async () => {
    const cliente = clienteQueDevuelve(base);
    const verificar = crearVerificadorGoogle({ cliente, audiencia: () => AUDIENCIA });
    expect(await verificar("tok")).toEqual({ cuenta: "123", email: "ana@gmail.com", nombre: "Ana Pérez" });
    expect(cliente.verifyIdToken).toHaveBeenCalledWith({ idToken: "tok", audience: AUDIENCIA });
  });

  it("email sin verificar → null", async () => {
    const verificar = crearVerificadorGoogle({ cliente: clienteQueDevuelve({ ...base, email_verified: false }), audiencia: () => AUDIENCIA });
    expect(await verificar("tok")).toBeNull();
  });

  it("sin email o sin sub → null", async () => {
    for (const payload of [{ ...base, email: undefined }, { ...base, sub: "" }]) {
      const verificar = crearVerificadorGoogle({ cliente: clienteQueDevuelve(payload), audiencia: () => AUDIENCIA });
      expect(await verificar("tok")).toBeNull();
    }
  });

  it("Google rechaza el token (firma, vencido u otra audiencia) → null", async () => {
    const verificar = crearVerificadorGoogle({ cliente: clienteQueDevuelve(new Error("Wrong recipient")), audiencia: () => AUDIENCIA });
    expect(await verificar("tok")).toBeNull();
  });

  it("sin nombre → nombre null", async () => {
    const verificar = crearVerificadorGoogle({ cliente: clienteQueDevuelve({ ...base, name: undefined }), audiencia: () => AUDIENCIA });
    expect((await verificar("tok"))?.nombre).toBeNull();
  });

  it("sin NEXT_PUBLIC_GOOGLE_CLIENT_ID → error de configuración, no null", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    const verificar = crearVerificadorGoogle({ cliente: clienteQueDevuelve(base) });
    await expect(verificar("tok")).rejects.toThrow(/NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
    vi.unstubAllEnvs();
  });
});
