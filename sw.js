// Service worker - Escáner de Documentos
// Subilo al repo con el nombre sw.js. Subí el número de CACHE_NAME en cada cambio grande.
const CACHE_NAME = 'escaner-dni-v53';
const ASSETS = [
  './', './index.html', './manifest.json', './css/styles.css', './icons/icon-192.png', './icons/icon-512.png',
  './tessdata/ocrb_int.traineddata', './js/version.js', './js/validators.js', './js/parsers-mundo.js', './js/parser.js', './js/parser-dni-nuevo.js',
  './js/decodificador.js', './js/decodificador-worker.js', './js/scanner.js', './js/domicilio-ocr.js', './js/qr-dni-nuevo.js', './js/frente-dni.js', './js/historial-fotos.js', './js/encuadre.js', './js/nube.js', './js/visor-foto.js', './js/sin-internet.js', './js/main.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/iife/index.min.js'
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== MOTORES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// v50 — MOTORES SIN INTERNET: la app pide los archivos pesados de los motores (Tesseract 7: worker, núcleo y modelo en
// español) a una ruta propia, ./vendor/... Acá se atienden: la primera vez se bajan del CDN y se guardan, y después se
// entregan desde el celular aunque no haya señal. (Pedidos desde la propia web: el service worker los ve siempre,
// también los que hace el hilo del OCR.)
const MOTORES = 'escaner-dni-motores-v1';   // caché aparte: no se borra en cada versión de la app (son varios MB)
const VENDOR = [
  ['vendor/tesseract/', 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/'],
  ['vendor/tesseract-core/', 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/'],
  ['vendor/lang/', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/']
];
function urlVendor(url) {
  const base = new URL('./', self.location.href).href;
  if (!url.startsWith(base + 'vendor/')) return null;
  const resto = url.slice(base.length).split('?')[0];
  for (const [local, cdn] of VENDOR) if (resto.startsWith(local)) return cdn + resto.slice(local.length);
  return null;
}
async function servirVendor(request, cdnUrl) {
  const cache = await caches.open(MOTORES);
  const guardado = await cache.match(cdnUrl);
  if (guardado) return guardado;
  const resp = await fetch(cdnUrl, { mode: 'cors', credentials: 'omit' });
  if (!resp.ok) return resp;
  // se arma una respuesta "propia" (mismo origen) con el tipo correcto: importScripts exige JavaScript
  const tipo = resp.headers.get('content-type') || (cdnUrl.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
  const cuerpo = await resp.blob();
  const propia = new Response(cuerpo, { status: 200, headers: { 'Content-Type': tipo } });
  cache.put(cdnUrl, propia.clone()).catch(() => {});
  return propia;
}

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

  // motores (./vendor/...): caché propia, guardados para usar sin internet
  const cdnVendor = urlVendor(request.url);
  if (cdnVendor) { event.respondWith(servirVendor(request, cdnVendor).catch(() => new Response('', { status: 504 }))); return; }

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
