// Service worker del chat de la charla. Mínimo y seguro:
// - NUNCA toca /api/* (el chat, la sesión, el perfil) ni /panel: van directo a la red.
// - Las páginas siempre vienen de la red. Sin conexión se muestra /offline.html.
// - Solo guarda archivos estáticos con hash (/_next/static/*) y los íconos.
// Cambiar VERSION borra la caché anterior al activarse.
const VERSION = "agentes-v1";
const OFFLINE = "/offline.html";
const PRECARGA = [OFFLINE, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECARGA))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => n.startsWith("agentes-") && n !== VERSION).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

function esEstatico(ruta) {
  return ruta.startsWith("/_next/static/") || ruta.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Datos de sesión y panel: sin intervenir, nunca desde caché.
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") return;
  if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return;

  if (request.mode === "navigate") {
    // Páginas: red siempre; sin conexión, la página de aviso. No se guardan.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }

  if (esEstatico(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (guardada) =>
          guardada ||
          fetch(request).then((respuesta) => {
            if (respuesta.ok) {
              const copia = respuesta.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copia));
            }
            return respuesta;
          }),
      ),
    );
  }
  // Todo lo demás: el navegador lo pide normalmente.
});
