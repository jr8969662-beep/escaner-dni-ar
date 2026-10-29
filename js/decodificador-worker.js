/**
 * Lector de códigos (PDF417 del DNI viejo y QR del DNI nuevo) en un hilo aparte (Web Worker).
 * Decodificar es pesado: hecho en el hilo principal trababa la cámara. Acá corre sin afectar la pantalla.
 *
 * Mensaje de entrada:  { id, w, h, buf (RGBA, transferido), tipos: ['pdf417'] | ['qr'] | ['pdf417','qr'] }
 * Respuesta:           { id, texto, formato, puntos: [{x,y}...] } o { id, texto: null }
 */
/* global ZXing, jsQR */
'use strict';
let listo = false, errorCarga = null;
try {
  importScripts(
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
    'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js'
  );
  listo = typeof ZXing !== 'undefined';
} catch (e) { errorCarga = String(e && e.message || e); }

let lectorPDF = null, lectorQR = null, pistasPDF = null, pistasQR = null;
if (listo) {
  try {
    lectorPDF = new ZXing.PDF417Reader();
    pistasPDF = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
    lectorQR = new ZXing.QRCodeReader();
    pistasQR = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
  } catch (e) { errorCarga = String(e && e.message || e); }
}

// RGBA -> luminancia (una sola vez por imagen)
function luminancia(rgba, n) {
  const l = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) l[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return l;
}

function conZXing(lector, pistas, lum, w, h, binarizador) {
  try {
    const src = new ZXing.RGBLuminanceSource(lum, w, h);
    const bin = binarizador === 'global' ? new ZXing.GlobalHistogramBinarizer(src) : new ZXing.HybridBinarizer(src);
    const r = lector.decode(new ZXing.BinaryBitmap(bin), pistas);
    if (r && r.getText()) {
      const pts = (r.getResultPoints() || []).filter(Boolean).map((p) => ({ x: p.getX(), y: p.getY() }));
      return { texto: r.getText(), puntos: pts };
    }
  } catch (e) { /* no encontrado */ } finally { try { lector.reset(); } catch (e) {} }
  return null;
}

// Foto movida o desenfocada: se realza el borde (máscara de enfoque) y, si no alcanza, se pasa a blanco y negro (Otsu).
// Con fotos reales de un DNI nuevo, el QR solo se leyó así.
function enfocar(lum, w, h) {
  const tmp = new Float32Array(w * h), out = new Uint8ClampedArray(w * h), r = 2;
  for (let y = 0; y < h; y++) {   // desenfoque horizontal (caja)
    let acc = 0; const o = y * w;
    for (let x = -r; x <= r; x++) acc += lum[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc / (2 * r + 1); acc += lum[o + Math.min(w - 1, x + r + 1)] - lum[o + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {   // vertical + máscara
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      const i = y * w + x, b = acc / (2 * r + 1);
      out[i] = 2 * lum[i] - b;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function otsu(lum) {
  const hist = new Uint32Array(256); for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, max = 0, umbral = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = lum.length - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > max) { max = v; umbral = t; }
  }
  const out = new Uint8ClampedArray(lum.length); for (let i = 0; i < lum.length; i++) out[i] = lum[i] > umbral ? 255 : 0;
  return out;
}
function aRGBA(lum) { const o = new Uint8ClampedArray(lum.length * 4); for (let i = 0, j = 0; i < lum.length; i++, j += 4) { o[j] = o[j + 1] = o[j + 2] = lum[i]; o[j + 3] = 255; } return o; }
function leerQR(rgba, lum, w, h) {
  if (typeof jsQR === 'function') {
    const q = jsQR(rgba, w, h, { inversionAttempts: 'dontInvert' });
    if (q && q.data) { const L = q.location; return { texto: q.data, formato: 'qr', puntos: L ? [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner] : [], esquinas: true }; }
  }
  if (lectorQR) { const r = conZXing(lectorQR, pistasQR, lum, w, h, 'hybrid'); if (r) { r.formato = 'qr'; return r; } }
  return null;
}

self.onmessage = (ev) => {
  const { id, w, h, buf, tipos } = ev.data || {};
  if (ev.data && ev.data.ping) { self.postMessage({ id, pong: true, listo, errorCarga }); return; }
  let res = null;
  try {
    const rgba = new Uint8ClampedArray(buf);
    const lum = luminancia(rgba, w * h);
    for (const t of tipos || []) {
      if (t === 'pdf417' && lectorPDF) {
        res = conZXing(lectorPDF, pistasPDF, lum, w, h, 'hybrid') || conZXing(lectorPDF, pistasPDF, lum, w, h, 'global');
        if (res) { res.formato = 'pdf417'; break; }
      }
      if (t === 'qr') {
        res = leerQR(rgba, lum, w, h);
        if (!res && w * h <= 6e6) {
          const e = enfocar(lum, w, h);
          res = leerQR(aRGBA(e), e, w, h);
          if (!res) { const b = otsu(e); res = leerQR(aRGBA(b), b, w, h); }
          if (!res) { const b = otsu(lum); res = leerQR(aRGBA(b), b, w, h); }
        }
        if (res) break;
      }
    }
  } catch (e) { res = null; }
  self.postMessage(Object.assign({ id, texto: null }, res || {}));
};
