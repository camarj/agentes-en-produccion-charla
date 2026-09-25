"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LineaTarjeta, TarjetaJev, VistaJev } from "@/lib/jev/vista";

// «Jev · la sala en vivo» (/panel/jev), pensada para proyectarse a 1920 × 1080.
// Pide GET /api/panel/jev cada 3 s; ese mismo poll dispara el análisis de los
// turnos nuevos en el servidor. Si una petición falla, se conservan los datos.

export const REFRESCO_JEV_MS = 3000;
const NO_DISPONIBLE = "Jev no disponible por ahora";

function useJev() {
  const [vista, setVista] = useState<VistaJev | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const enCurso = useRef(false);

  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      if (enCurso.current) return;
      enCurso.current = true;
      try {
        const r = await fetch("/api/panel/jev", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const datos = (await r.json()) as VistaJev;
        if (vivo) {
          setVista(datos);
          setSinConexion(false);
        }
      } catch {
        if (vivo) setSinConexion(true);
      } finally {
        enCurso.current = false;
      }
    };
    void pedir();
    const id = setInterval(() => void pedir(), REFRESCO_JEV_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  return { vista, sinConexion };
}

export function emojiConfusion(c: number | null): string | null {
  if (c === null) return null;
  if (c < 0.2) return "😎";
  if (c < 0.4) return "🙂";
  if (c < 0.6) return "🤔";
  if (c < 0.8) return "😕";
  return "😵";
}

const porcentaje = (p: number) => `${Math.round(p * 100)} %`;

function Linea({ l }: { l: LineaTarjeta }) {
  switch (l.tipo) {
    case "respaldada":
      return <li className="text-emerald-300">✅ respaldada por las láminas</li>;
    case "no_respaldada":
      return (
        <li className="text-amber-300">
          ⚠️ dijo algo que no está en la charla{" "}
          <span className="font-mono text-base text-muted-foreground">({porcentaje(l.probabilidad)} respaldada)</span>
        </li>
      );
    case "sin_laminas":
      return <li className="text-muted-foreground">📄 respondió sin consultar las láminas</li>;
    case "bloqueada":
      return <li className="text-red-300">🛡 bloqueada: {l.motivo}</li>;
    case "herramienta_caida":
      return <li className="text-amber-300">🔧 herramienta caída</li>;
    case "respaldo":
      return <li className="text-amber-300">🔁 respondió el respaldo</li>;
    case "sin_modelo":
      return <li className="text-red-300">⛔ sin modelo</li>;
    case "falla":
      return <li className="text-red-300">⛔ no pudo responder</li>;
  }
}

function Tarjeta({ t }: { t: TarjetaJev }) {
  const emoji = emojiConfusion(t.confusion);
  return (
    <li
      className="flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-card px-5 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-4 motion-safe:duration-500"
      aria-label={`Pregunta: ${t.pregunta}`}
    >
      <p className="line-clamp-2 text-[1.375rem] leading-snug">«{t.pregunta}»</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg">
        <span className="rounded-full border border-border px-3 py-0.5">{t.tema}</span>
        <span className="rounded-full border border-border px-3 py-0.5 text-muted-foreground">{t.intencion}</span>
        {emoji ? (
          <span className="text-2xl leading-none" role="img" aria-label={`Confusión ${porcentaje(t.confusion!)}`}>
            {emoji}
          </span>
        ) : null}
        {t.lineas.length ? (
          <ul className="flex flex-wrap gap-x-4">
            {t.lineas.map((l, i) => (
              <Linea key={i} l={l} />
            ))}
          </ul>
        ) : null}
        <span className="ml-auto font-mono text-sm text-muted-foreground">Jev · {t.latenciaMs} ms</span>
      </div>
    </li>
  );
}

function Seccion({ titulo, detalle, children, className }: { titulo: string; detalle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={cn("flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card px-6 py-5", className)}>
      <h2 className="flex items-baseline gap-3 text-2xl font-semibold">
        {titulo}
        {detalle ? <span className="text-base font-normal text-muted-foreground">{detalle}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function Temas({ temas }: { temas: VistaJev["temas"] }) {
  const max = Math.max(1, ...temas.map((t) => t.turnos));
  if (temas.length === 0) return <p className="text-lg text-muted-foreground">Todavía sin preguntas en esta ventana.</p>;
  return (
    <ul className="flex flex-col gap-2 overflow-hidden">
      {temas.slice(0, 7).map((t) => (
        <li key={t.tema} className="grid grid-cols-[14rem_1fr_3rem] items-center gap-3 text-lg">
          <span className="truncate">{t.tema}</span>
          <span className="h-5 overflow-hidden rounded-sm bg-white/5">
            <span
              className="block h-full rounded-sm bg-white/80 transition-[width] duration-700 motion-reduce:transition-none"
              style={{ width: `${(t.turnos / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-mono tabular-nums">{t.turnos}</span>
        </li>
      ))}
    </ul>
  );
}

// Semicírculo de 0 a 100 %.
function Termometro({ t }: { t: VistaJev["termometro"] }) {
  const p = t.porcentaje;
  const color = p === null ? "text-muted-foreground" : p < 35 ? "text-emerald-300" : p < 60 ? "text-amber-300" : "text-red-300";
  const largo = Math.PI * 80;
  return (
    <div className="flex items-center gap-8">
      <svg viewBox="0 0 200 110" className={cn("h-32 w-56 shrink-0", color)} role="img" aria-label={p === null ? "Sin datos" : `Confusión ${p} %`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="18" strokeLinecap="round" />
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke="currentColor"
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={largo}
          strokeDashoffset={largo * (1 - (p ?? 0) / 100)}
          className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        />
        <text x="100" y="96" textAnchor="middle" className="fill-foreground font-mono text-[34px]">
          {p === null ? "—" : `${p}%`}
        </text>
      </svg>
      <div className="flex flex-col gap-2 text-lg">
        <p className="text-muted-foreground">Promedio de las últimas {t.turnos} preguntas</p>
        <p>
          Lo que más confunde: <strong className="font-semibold">{t.mas_confunde ?? "—"}</strong>
        </p>
      </div>
    </div>
  );
}

function Destacadas({ d }: { d: VistaJev["destacadas"] }) {
  if (d.length === 0) return <p className="text-lg text-muted-foreground">Aún no hay preguntas para destacar.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {d.map((x, i) => (
        <li key={x.traceId} className="flex gap-3 text-lg">
          <span className="font-mono text-muted-foreground">{i + 1}.</span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-xl">«{x.pregunta}»</p>
            <p className="text-base text-muted-foreground">
              {x.tema}
              {x.parecidas > 0 ? ` · ${x.parecidas} ${x.parecidas === 1 ? "pregunta parecida" : "preguntas parecidas"}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SalaEnVivo() {
  const { vista, sinConexion } = useJev();
  const disponible = vista?.jev_disponible ?? true;

  return (
    <main data-proyector className="flex h-dvh flex-col gap-5 overflow-hidden px-10 py-7">
      <header className="flex items-end gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-5xl font-semibold tracking-tight">Jev · la sala en vivo</h1>
          <p className="mt-2 font-mono text-lg text-muted-foreground">
            System One · TypeSafe · {vista?.total_analisis ?? 0} análisis · latencia media{" "}
            {vista?.latencia_media_ms != null ? `${vista.latencia_media_ms} ms` : "—"}
          </p>
        </div>
        <p role="status" className={cn("font-mono text-lg", !disponible || sinConexion ? "text-amber-300" : "text-muted-foreground")}>
          {sinConexion ? "Sin conexión · reintentando" : !disponible ? NO_DISPONIBLE : vista ? "En vivo" : "Cargando…"}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-5">
        <Seccion titulo="Últimas preguntas" className="overflow-hidden">
          {vista && vista.tarjetas.length > 0 ? (
            <ol className="flex min-h-0 flex-col gap-3 overflow-hidden" aria-live="polite">
              {vista.tarjetas.map((t) => (
                <Tarjeta key={t.traceId} t={t} />
              ))}
            </ol>
          ) : (
            <p className="m-auto text-3xl text-muted-foreground">{vista ? "Esperando preguntas de la sala…" : "Cargando…"}</p>
          )}
        </Seccion>

        <div className="flex min-h-0 flex-col gap-5">
          <Seccion titulo="De qué habla la sala" detalle="últimos 30 min" className="flex-[1.2]">
            <Temas temas={vista?.temas ?? []} />
          </Seccion>
          <Seccion titulo="Termómetro de confusión">
            <Termometro t={vista?.termometro ?? { porcentaje: null, turnos: 0, mas_confunde: null }} />
          </Seccion>
          <Seccion titulo="Para la sesión de preguntas" className="flex-1">
            <Destacadas d={vista?.destacadas ?? []} />
          </Seccion>
        </div>
      </div>
    </main>
  );
}
