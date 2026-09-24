// Cerrojo lector/escritor en orden de llegada (FIFO).
// Los casos normales corren en paralelo (compartido). Los de resiliencia
// cambian interruptores de caos que son globales en la base temporal, así que
// corren solos (exclusivo): esperan a que terminen los que estaban en curso y
// nadie empieza mientras tanto.

type Modo = "compartido" | "exclusivo";

export function crearCerrojo() {
  const cola: { modo: Modo; entrar: () => void }[] = [];
  let lectores = 0;
  let escritor = false;

  function despachar() {
    while (cola.length > 0) {
      const primero = cola[0];
      if (primero.modo === "exclusivo") {
        if (escritor || lectores > 0) return;
        cola.shift();
        escritor = true;
        primero.entrar();
        return;
      }
      if (escritor) return;
      cola.shift();
      lectores++;
      primero.entrar();
    }
  }

  async function con<T>(modo: Modo, tarea: () => Promise<T>): Promise<T> {
    await new Promise<void>((entrar) => {
      cola.push({ modo, entrar });
      despachar();
    });
    try {
      return await tarea();
    } finally {
      if (modo === "exclusivo") escritor = false;
      else lectores--;
      despachar();
    }
  }

  return {
    compartido: <T>(tarea: () => Promise<T>) => con("compartido", tarea),
    exclusivo: <T>(tarea: () => Promise<T>) => con("exclusivo", tarea),
  };
}
