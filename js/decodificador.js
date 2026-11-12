/**
 * Puente con decodificador-worker.js: lee PDF417 / QR fuera del hilo principal para que la cámara no se trabe.
 *   const d = Decodificador.crear();            // un lector independiente (cada bucle de cámara usa el suyo)
 *   d.libre()                                   // true si no está ocupado (en vivo: si está ocupado, se saltea el cuadro)
 *   const r = await d.leer(canvas, ['pdf417'])  // { texto, formato, puntos } o null
 * Si el navegador no permite workers, disponible() es false y se usan los lectores de siempre.
 */
const Decodificador = (() => {
  'use strict';
  const RUTA = 'js/decodificador-worker.js';

  function crear() {
    let w = null, ok = false, seq = 0, bitmapOk = false, frameOk = false;
    const pend = new Map();
    try {
      w = new Worker(RUTA);
      ok = true;
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.pong) { if (!d.listo) apagar(); else { bitmapOk = !!d.bitmap && typeof createImageBitmap === 'function'; frameOk = bitmapOk && !!d.frame && typeof VideoFrame !== 'undefined'; } return; }
        const fn = pend.get(d.id);
        if (fn) { pend.delete(d.id); fn(d); }
      };
      w.onerror = () => apagar();
      w.postMessage({ id: 0, ping: true });
    } catch (e) { ok = false; }

    function apagar() {
      ok = false;
      pend.forEach((fn) => fn(null)); pend.clear();
      try { w && w.terminate(); } catch (e) { /* nada */ }
    }

    function leer(fuente, tipos, timeoutMs = 6000, mejorar = true) {
      if (!ok || !fuente) return Promise.resolve(null);
      let img;
      try {
        if (fuente.data && fuente.width) img = fuente;   // ImageData
        else img = fuente.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, fuente.width, fuente.height);
      } catch (e) { return Promise.resolve(null); }
      const id = ++seq;
      return new Promise((res) => {
        const t = setTimeout(() => { if (pend.has(id)) { pend.delete(id); res(null); } }, timeoutMs);
        pend.set(id, (d) => { clearTimeout(t); res(d && d.texto ? d : null); });
        try { w.postMessage({ id, w: img.width, h: img.height, buf: img.data.buffer, tipos, mejorar }, [img.data.buffer]); }
        catch (e) { pend.delete(id); clearTimeout(t); res(null); }
      });
    }

    // Lee una región de un <video> (o canvas) SIN pasar por la hoja principal: el navegador recorta y achica el cuadro
    // (ImageBitmap) y el hilo aparte lo convierte a píxeles. region = { sx, sy, sw, sh, w, h } (píxeles de la fuente y tamaño de salida).
    async function leerRegion(fuente, region, tipos, timeoutMs = 6000, mejorar = true) {
      if (!ok || !bitmapOk || !fuente) return null;
      // De la cámara: se pasa el cuadro tal cual (VideoFrame, sin copia) y el hilo aparte lo recorta y achica.
      // Así la hoja principal casi no trabaja y la imagen de la cámara no se traba.
      if (frameOk && typeof HTMLVideoElement !== 'undefined' && fuente instanceof HTMLVideoElement) {
        let fr = null;
        try { fr = new VideoFrame(fuente); } catch (e) { fr = null; }
        if (fr) {
          const id = ++seq;
          return new Promise((res) => {
            const t = setTimeout(() => { if (pend.has(id)) { pend.delete(id); res(null); } }, timeoutMs);
            pend.set(id, (d) => { clearTimeout(t); res(d && d.texto ? d : null); });
            try { w.postMessage({ id, frame: fr, region, tipos, mejorar }, [fr]); }
            catch (e) { pend.delete(id); clearTimeout(t); try { fr.close(); } catch (e2) {} res(null); }
          });
        }
      }
      let bmp;
      try {
        bmp = await createImageBitmap(fuente, Math.round(region.sx), Math.round(region.sy), Math.round(region.sw), Math.round(region.sh),
          { resizeWidth: Math.round(region.w), resizeHeight: Math.round(region.h), resizeQuality: 'medium' });
      } catch (e) { return null; }
      if (!ok) { try { bmp.close(); } catch (e2) {} return null; }
      const id = ++seq;
      return new Promise((res) => {
        const t = setTimeout(() => { if (pend.has(id)) { pend.delete(id); res(null); } }, timeoutMs);
        pend.set(id, (d) => { clearTimeout(t); res(d && d.texto ? d : null); });
        try { w.postMessage({ id, bmp, tipos, mejorar }, [bmp]); }
        catch (e) { pend.delete(id); clearTimeout(t); try { bmp.close(); } catch (e2) {} res(null); }
      });
    }

    return {
      disponible: () => ok,
      bitmapOk: () => ok && bitmapOk,
      leerRegion,
      libre: () => ok && pend.size === 0,
      leer,
      cerrar: apagar
    };
  }

  return { crear, soportado: typeof Worker !== 'undefined' };
})();
