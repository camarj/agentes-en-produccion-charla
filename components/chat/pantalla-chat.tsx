import { Chat } from "./chat";

// Estado «chat» de la página principal (T10 → T11).
export function PantallaChat({ nombrePila, onSesionExpirada }: { nombrePila?: string; onSesionExpirada: () => void }) {
  return <Chat nombrePila={nombrePila} onSesionExpirada={onSesionExpirada} />;
}
