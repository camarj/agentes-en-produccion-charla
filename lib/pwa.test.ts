import { describe, expect, it } from "vitest";
import { detectarPlataforma, ofertaInstalacion, TEXTOS_PWA } from "./pwa";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0",
  // iPadOS se presenta como Mac; lo delata la pantalla táctil.
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  escritorio:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const base = { maxTouchPoints: 0, standalone: false, promptDisponible: false };

describe("detectarPlataforma", () => {
  it("iPhone con Safari", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.iphoneSafari, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("iPad (se presenta como Mac, pero es táctil) con Safari", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.ipadSafari, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("Mac con Safari no es iOS", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.macSafari })).toBe("otra");
  });

  it("Chrome y Firefox en iPhone también pueden agregar a inicio", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.iphoneChrome, maxTouchPoints: 5 })).toBe("ios-otro");
    expect(detectarPlataforma({ ...base, userAgent: UA.iphoneFirefox, maxTouchPoints: 5 })).toBe("ios-otro");
  });

  it("navegadores dentro de otras apps (Instagram) no ofrecen nada", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.iphoneInstagram, maxTouchPoints: 5 })).toBe("otra");
  });

  it("Android y escritorio son «otra»: dependen del aviso del navegador", () => {
    expect(detectarPlataforma({ ...base, userAgent: UA.android, maxTouchPoints: 5 })).toBe("otra");
    expect(detectarPlataforma({ ...base, userAgent: UA.escritorio })).toBe("otra");
  });
});

describe("ofertaInstalacion", () => {
  it("Android con el aviso de instalación disponible → botón «Instalar app»", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.android, maxTouchPoints: 5, promptDisponible: true })).toBe(
      "instalar",
    );
  });

  it("Android sin aviso (aún no instalable o ya instalada) → nada", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.android, maxTouchPoints: 5 })).toBeNull();
  });

  it("iPhone Safari fuera de la app → instrucciones de Safari", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.iphoneSafari, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("iPhone Chrome fuera de la app → instrucciones genéricas", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.iphoneChrome, maxTouchPoints: 5 })).toBe("ios-otro");
  });

  it("ya abierta desde la pantalla de inicio (standalone) → nada, en iOS y Android", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.iphoneSafari, maxTouchPoints: 5, standalone: true })).toBeNull();
    expect(
      ofertaInstalacion({ ...base, userAgent: UA.android, maxTouchPoints: 5, standalone: true, promptDisponible: true }),
    ).toBeNull();
  });

  it("escritorio → nada, aunque Chrome ofrezca instalar", () => {
    expect(ofertaInstalacion({ ...base, userAgent: UA.escritorio })).toBeNull();
    expect(ofertaInstalacion({ ...base, userAgent: UA.escritorio, promptDisponible: true })).toBeNull();
    expect(ofertaInstalacion({ ...base, userAgent: UA.macSafari })).toBeNull();
  });
});

describe("TEXTOS_PWA", () => {
  it("usa el nombre del menú de iOS en español", () => {
    expect(TEXTOS_PWA.iosSafari).toContain("«Agregar a inicio»");
    expect(TEXTOS_PWA.iosOtro).toContain("«Agregar a inicio»");
  });
});
