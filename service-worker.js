// Service Worker de Planea.
// Sube este número cada vez que cambies app.js o styles.css para forzar
// que los usuarios reciban la versión nueva en vez de la cacheada.
const VERSION = 'planea-v1';

const ARCHIVOS_APP = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ARCHIVOS_APP))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Estrategia: intenta ir a internet primero (para traer datos frescos de Google Sheets
// y la versión más nueva de la app); si no hay conexión, usa lo que haya en caché.
// Las llamadas a la API de Google Apps Script nunca se guardan en caché (siempre deben
// ir en vivo), solo el "cascarón" de la app (html/js/css/íconos).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const esArchivoDeLaApp = url.origin === self.location.origin;

  if (!esArchivoDeLaApp) return; // deja pasar las llamadas a Google Sheets/Apps Script tal cual

  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});
