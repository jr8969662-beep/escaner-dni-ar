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
        if (typeof jsQR === 'function') {
          const q = jsQR(rgba, w, h, { inversionAttempts: 'dontInvert' });
          if (q && q.data) {
            const L = q.location;
            res = { texto: q.data, formato: 'qr', puntos: L ? [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner] : [], esquinas: true };
            break;
          }
        }
        if (lectorQR) {
          res = conZXing(lectorQR, pistasQR, lum, w, h, 'hybrid');
          if (res) { res.formato = 'qr'; break; }
        }
      }
    }
  } catch (e) { res = null; }
  self.postMessage(Object.assign({ id, texto: null }, res || {}));
};
