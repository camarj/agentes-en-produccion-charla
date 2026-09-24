import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReintentosAgotadosError,
  TiempoAgotadoError,
  ToolUnavailableError,
  conReintentos,
  esperar,
} from "./resiliencia";

const OPCIONES = { intentos: 3, timeoutMs: 5000, esperas: [300, 900] };

describe("conReintentos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devuelve el valor y cuántos intentos usó", async () => {
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new ToolUnavailableError())
      .mockResolvedValueOnce("ok");
    const promesa = conReintentos(fn, OPCIONES);
    await vi.advanceTimersByTimeAsync(300);
    await expect(promesa).resolves.toEqual({ valor: "ok", intentos: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("espera 300 y 900 ms entre intentos y falla tras el tercero", async () => {
    const fn = vi.fn(async () => {
      throw new ToolUnavailableError();
    });
    const promesa = conReintentos(fn, OPCIONES);
    const resultado = promesa.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(899);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);
    const error = await resultado;
    expect(error).toBeInstanceOf(ReintentosAgotadosError);
    expect((error as ReintentosAgotadosError).intentos).toBe(3);
    expect((error as ReintentosAgotadosError).cause).toBeInstanceOf(ToolUnavailableError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("corta cada intento a los 5 s y aborta su señal", async () => {
    const señales: AbortSignal[] = [];
    const fn = vi.fn(async (signal: AbortSignal) => {
      señales.push(signal);
      await esperar(8000, signal);
      return "tarde";
    });
    const resultado = conReintentos(fn, OPCIONES).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(señales[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(señales[0].aborted).toBe(true);
    expect(señales[0].reason).toBeInstanceOf(TiempoAgotadoError);
    // 5000 + 300 + 5000 + 900 + 5000 = 16 200 ms en total.
    await vi.advanceTimersByTimeAsync(16200 - 5000);
    const error = await resultado;
    expect(error).toBeInstanceOf(ReintentosAgotadosError);
    expect((error as ReintentosAgotadosError).intentos).toBe(3);
    expect((error as ReintentosAgotadosError).cause).toBeInstanceOf(TiempoAgotadoError);
    expect(señales.every((s) => s.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se detiene si la señal externa se aborta", async () => {
    const externa = new AbortController();
    const fn = vi.fn(async (signal: AbortSignal) => {
      await esperar(8000, signal);
      return "x";
    });
    const resultado = conReintentos(fn, { ...OPCIONES, signal: externa.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    externa.abort();
    await vi.advanceTimersByTimeAsync(0);
    const error = await resultado;
    expect(error).toBeInstanceOf(ReintentosAgotadosError);
    expect((error as ReintentosAgotadosError).intentos).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
