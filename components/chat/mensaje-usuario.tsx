// Burbuja del usuario: a la derecha, superficie con borde, radio 18 px, máx. 85 %.
export function MensajeUsuario({ texto }: { texto: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-[18px] border border-border bg-card px-4 py-2.5 text-base leading-6 whitespace-pre-wrap break-words">
        {texto}
      </p>
    </div>
  );
}
