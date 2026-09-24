// Genera los íconos de la app instalable (PWA) a partir de un solo dibujo SVG:
// fondo negro y un «loop de agente» (flecha circular + punto) en el acento.
//   pnpm iconos
// Escribe public/icons/*.png, app/apple-icon.png (180×180) y app/icon.svg (favicon).
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";

// oklch(84% .16 215) en sRGB (satori no entiende oklch).
const ACENTO = "#00e3ff";
const FONDO = "#000000";

// Dibujo en un lienzo de 100×100. `escala` achica el glifo alrededor del centro
// (los íconos maskable necesitan margen: Android los recorta en círculo).
export function svgIcono(escala = 1, fondoRedondeado = false): string {
  const r = 24;
  const inicio = 25; // grados desde arriba, en sentido horario
  const fin = 305;
  const punto = (g: number) => {
    const t = (g * Math.PI) / 180;
    return { x: 50 + r * Math.sin(t), y: 50 - r * Math.cos(t) };
  };
  const a = punto(inicio);
  const b = punto(fin);
  // Punta de flecha al final del arco, en la dirección del giro.
  const t = (fin * Math.PI) / 180;
  const dir = { x: Math.cos(t), y: Math.sin(t) };
  const normal = { x: -dir.y, y: dir.x };
  const punta = { x: b.x + dir.x * 11, y: b.y + dir.y * 11 };
  const ala1 = { x: b.x + normal.x * 9.5 - dir.x * 1, y: b.y + normal.y * 9.5 - dir.y * 1 };
  const ala2 = { x: b.x - normal.x * 9.5 - dir.x * 1, y: b.y - normal.y * 9.5 - dir.y * 1 };
  const f = (n: number) => n.toFixed(2);
  const fondo = fondoRedondeado
    ? `<rect width="100" height="100" rx="22" fill="${FONDO}"/>`
    : `<rect width="100" height="100" fill="${FONDO}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">`,
    fondo,
    `<g transform="translate(50 50) scale(${escala}) translate(-50 -50)">`,
    `<path d="M ${f(a.x)} ${f(a.y)} A ${r} ${r} 0 1 1 ${f(b.x)} ${f(b.y)}" fill="none" stroke="${ACENTO}" stroke-width="9" stroke-linecap="round"/>`,
    `<polygon points="${f(punta.x)},${f(punta.y)} ${f(ala1.x)},${f(ala1.y)} ${f(ala2.x)},${f(ala2.y)}" fill="${ACENTO}" stroke="${ACENTO}" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="50" cy="50" r="7" fill="${ACENTO}"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

async function png(tam: number, svg: string): Promise<Buffer> {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const img = createElement("img", { src, width: tam, height: tam });
  const cuerpo = createElement("div", { style: { display: "flex", width: "100%", height: "100%", background: FONDO } }, img);
  const respuesta = new ImageResponse(cuerpo, { width: tam, height: tam });
  return Buffer.from(await respuesta.arrayBuffer());
}

async function main() {
  const raiz = process.cwd();
  const carpeta = path.join(raiz, "public", "icons");
  fs.mkdirSync(carpeta, { recursive: true });
  const salidas: [string, Buffer | string][] = [
    [path.join(carpeta, "icon-192.png"), await png(192, svgIcono(1.15))],
    [path.join(carpeta, "icon-512.png"), await png(512, svgIcono(1.15))],
    [path.join(carpeta, "icon-maskable-512.png"), await png(512, svgIcono(0.9))],
    [path.join(raiz, "app", "apple-icon.png"), await png(180, svgIcono(1.1))],
    [path.join(raiz, "app", "icon.svg"), svgIcono(1.15, true)],
  ];
  for (const [archivo, datos] of salidas) {
    fs.writeFileSync(archivo, datos);
    console.log(`✓ ${path.relative(raiz, archivo)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
