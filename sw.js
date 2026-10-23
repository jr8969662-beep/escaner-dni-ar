// Service worker - Escáner de Documentos
// Subilo al repo con el nombre sw.js. Subí el número de CACHE_NAME en cada cambio grande.
const CACHE_NAME = 'escaner-dni-v22';
const ASSETS = [
  './', './index.html', './manifest.json', './css/styles.css',
  './js/validators.js', './js/parsers-mundo.js', './js/parser.js',
  './js/scanner.js', './js/domicilio-ocr.js', './js/qr-dni-nuevo.js', './js/main.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // allSettled: si un archivo falla, igual se guardan los demás
      .then((cache) => Promise.allSettled(ASSETS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function guardar(request, response) {
  if (response && response.status === 200) {
    const copia = response.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copia)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Archivos de la app: RED PRIMERO, así cada cambio que subas se ve enseguida.
  // Sin internet usa la copia guardada.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((resp) => guardar(request, resp))
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Librerías externas (jsQR, ZXing, Tesseract): CACHÉ PRIMERO
  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((resp) => guardar(request, resp)).catch(() => cached)
    )
  );
});
