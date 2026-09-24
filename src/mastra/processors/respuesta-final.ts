import type { ProcessInputStepArgs, ProcessInputStepResult, Processor } from "@mastra/core/processors";

export const AVISO_RESPUESTA_FINAL =
  "Llegaste al último paso permitido. No llames más herramientas: responde ahora al asistente con la información que ya tienes. Si te falta algo, dilo con claridad.";

// Límite de pasos del agente: en el último paso permitido (stepNumber empieza
// en 0) prohíbe las herramientas (`toolChoice: 'none'`) y avisa al modelo con
// una señal transitoria (llega en este paso y no se guarda en la memoria).
export class RespuestaFinal implements Processor<"respuesta-final"> {
  readonly id = "respuesta-final" as const;
  readonly name = "Respuesta final";

  constructor(readonly maxSteps = 5) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new Error("maxSteps debe ser un entero mayor o igual a 1");
    }
  }

  esUltimoPaso(stepNumber: number): boolean {
    return stepNumber >= this.maxSteps - 1;
  }

  async processInputStep({
    stepNumber,
    sendSignal,
    tracingContext,
  }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined> {
    if (!this.esUltimoPaso(stepNumber)) return undefined;
    await sendSignal?.({ type: "system-reminder", contents: AVISO_RESPUESTA_FINAL, transient: true });
    tracingContext?.currentSpan?.update({ metadata: { respuesta_final_forzada: true } });
    return { toolChoice: "none" };
  }
}
