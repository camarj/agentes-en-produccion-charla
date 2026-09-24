import { VERSIONES_INSTRUCCIONES, esVersionInstrucciones } from "@/src/mastra/agents/instructions";

// Banderas de `pnpm evals -- …`:
//   --instrucciones 1.0.0     versión de instrucciones a probar (por defecto, la actual)
//   --casos L01,S02           solo esos casos
//   --ruta auto|standalone|dev|proceso|omitir   cómo probar R04 (POST /api/chat)
//   --concurrencia 6          casos del agente en paralelo
//   --simular-fuga            prueba de fallo: el «modelo» filtra datos de un señuelo
//   --sin-guardrail-salida    prueba de fallo: sin SinDatosPersonales
//   --laminas <archivo.html>  presentación a importar en la base temporal
//   --conservar-temp          no borrar la carpeta temporal al terminar

export interface Argumentos {
  instrucciones: string;
  casos: string[] | null;
  ruta: string;
  concurrencia: number;
  sinGuardrailSalida: boolean;
  simularFuga: boolean;
  laminas: string | null;
  conservarTemp: boolean;
}

export function parsearArgumentos(argv: string[], versionActual: string): Argumentos {
  const a: Argumentos = {
    instrucciones: versionActual,
    casos: null,
    ruta: "auto",
    concurrencia: 6,
    sinGuardrailSalida: false,
    simularFuga: false,
    laminas: null,
    conservarTemp: false,
  };
  const lista = argv.filter((x) => x !== "--");
  for (let i = 0; i < lista.length; i++) {
    const [bandera, enLinea] = lista[i].split("=", 2) as [string, string | undefined];
    const valor = () => {
      const v = enLinea ?? lista[++i];
      if (v === undefined) throw new Error(`Falta el valor de ${bandera}`);
      return v;
    };
    switch (bandera) {
      case "--instrucciones": {
        const v = valor();
        if (!esVersionInstrucciones(v)) throw new Error(`--instrucciones debe ser una de: ${VERSIONES_INSTRUCCIONES.join(", ")}`);
        a.instrucciones = v;
        break;
      }
      case "--casos":
        a.casos = valor()
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        break;
      case "--ruta":
        a.ruta = valor();
        break;
      case "--concurrencia": {
        const n = Number(valor());
        if (!Number.isInteger(n) || n < 1) throw new Error("--concurrencia debe ser un entero ≥ 1");
        a.concurrencia = n;
        break;
      }
      case "--sin-guardrail-salida":
        a.sinGuardrailSalida = true;
        break;
      case "--simular-fuga":
        a.simularFuga = true;
        break;
      case "--laminas":
        a.laminas = valor();
        break;
      case "--conservar-temp":
        a.conservarTemp = true;
        break;
      default:
        throw new Error(`Bandera desconocida: ${bandera}`);
    }
  }
  return a;
}
