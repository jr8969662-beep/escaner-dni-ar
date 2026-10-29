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
    let w = null, ok = false, seq = 0;
    const pend = new Map();
    try {
      w = new Worker(RUTA);
      ok = true;
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.pong) { if (!d.listo) apagar(); return; }
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

    function leer(fuente, tipos, timeoutMs = 6000) {
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
        try { w.postMessage({ id, w: img.width, h: img.height, buf: img.data.buffer, tipos }, [img.data.buffer]); }
        catch (e) { pend.delete(id); clearTimeout(t); res(null); }
      });
    }

    return {
      disponible: () => ok,
      libre: () => ok && pend.size === 0,
      leer,
      cerrar: apagar
    };
  }

  return { crear, soportado: typeof Worker !== 'undefined' };
})();
