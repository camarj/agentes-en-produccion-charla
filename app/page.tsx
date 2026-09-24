"use client";

import { useEffect, useState } from "react";
import { Marco } from "@/components/acceso/marco";
import { PantallaEntrada } from "@/components/acceso/pantalla-entrada";
import { PantallaPerfil } from "@/components/acceso/pantalla-perfil";
import { PantallaChat } from "@/components/chat/pantalla-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { obtenerSesion, pantallaPara, type EstadoPerfil, type EstadoSesion } from "@/lib/acceso";

// Qué se ve en cada momento. Todo cambia en el cliente, sin recargar.
type Vista =
  | { pantalla: "cargando" }
  | { pantalla: "entrada" }
  | { pantalla: "perfil"; estado: EstadoPerfil; nombrePila?: string }
  | { pantalla: "chat"; nombrePila?: string };

function vistaPara(estado: EstadoSesion, nombrePila?: string): Vista {
  switch (pantallaPara(estado)) {
    case "chat":
      return { pantalla: "chat", nombrePila };
    case "perfil":
      return { pantalla: "perfil", estado: estado as EstadoPerfil, nombrePila };
    default:
      return { pantalla: "entrada" };
  }
}

export default function Home() {
  const [vista, setVista] = useState<Vista>({ pantalla: "cargando" });

  // Al abrir (o recargar) la página: con sesión válida va directo a su pantalla.
  useEffect(() => {
    let vigente = true;
    obtenerSesion().then((resultado) => {
      if (!vigente) return;
      setVista(resultado.ok ? vistaPara(resultado.datos.estado, resultado.datos.nombre_pila) : { pantalla: "entrada" });
    });
    return () => {
      vigente = false;
    };
  }, []);

  switch (vista.pantalla) {
    case "cargando":
      return <Cargando />;
    case "entrada":
      return <PantallaEntrada onIdentificado={(r) => setVista(vistaPara(r.estado, r.nombre_pila))} />;
    case "perfil":
      return (
        <PantallaPerfil
          key={vista.estado}
          estado={vista.estado}
          nombrePila={vista.nombrePila}
          onCompletado={(nombrePila) => setVista({ pantalla: "chat", nombrePila: nombrePila || undefined })}
          onSesionExpirada={() => setVista({ pantalla: "entrada" })}
        />
      );
    case "chat":
      return <PantallaChat nombrePila={vista.nombrePila} onSesionExpirada={() => setVista({ pantalla: "entrada" })} />;
  }
}

function Cargando() {
  return (
    <Marco role="status" aria-label="Cargando" aria-busy="true">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-4 h-8 w-full" />
      <Skeleton className="mt-2 h-8 w-3/4" />
      <Skeleton className="mt-8 h-12 w-full" />
      <Skeleton className="mt-3 h-12 w-full" />
    </Marco>
  );
}
