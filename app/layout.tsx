import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { RegistroPwa } from "@/components/pwa/registro-pwa";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cómo lograr que tus agentes sobrevivan a producción",
  description:
    "Asistente de la charla de Raúl Camacho (Inteliside). Pregúntale cualquier cosa de la presentación.",
  applicationName: "Agentes",
  // iPhone/iPad: nombre bajo el ícono y barra de estado negra sólida (el
  // contenido empieza debajo de ella, así la cabecera no queda bajo la hora).
  appleWebApp: { capable: true, title: "Agentes", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`dark ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        <RegistroPwa />
      </body>
    </html>
  );
}
