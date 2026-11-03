/**
 * Modo sin internet (v50)
 *
 * La primera vez que se abre la app con internet, deja guardado en el celular todo lo necesario para escanear sin
 * señal: la app (lo guarda el service worker al instalarse), los dos motores de OCR (texto en español y líneas <<<)
 * y el lector de códigos (ZXing-C++). Arriba se ve el estado:
 *   ⏳ Preparando sin internet…   ·   📴 Lista sin internet   ·   📴 Sin conexión · funciona igual   ·   ⚠ Falta preparar
 * Si cambian los motores en una versión nueva, se vuelve a preparar solo (LISTO_VERSION).
 */
(() => {
  'use strict';
  const LISTO_KEY = 'sin_internet_listo';
  const LISTO_VERSION = 'motores-1';           // subir si cambian los archivos de los motores (Tesseract / ZXing)
  const MOTORES = 'escaner-dni-motores-v1';   // misma caché que sw.js
  let chip = null, preparando = false;

  const listo = () => { try { return localStorage.getItem(LISTO_KEY) === LISTO_VERSION; } catch (e) { return false; } };
  const marcarListo = () => { try { localStorage.setItem(LISTO_KEY, LISTO_VERSION); } catch (e) { /* nada */ } };

  function estilos() {
    if (document.getElementById('sin-internet-css')) return;
    const st = document.createElement('style'); st.id = 'sin-internet-css';
    st.textContent = `
      .chip-offline { position: absolute; bottom: -10px; right: 58px; z-index: 5; display: inline-flex; align-items: center; gap: 5px; height: 19px; padding: 0 8px;
        border-radius: 999px; border: 1px solid var(--line, #2a3446); background: var(--panel, #0e182b); color: var(--text-secondary, #b8c2d3);
        font: 700 10px system-ui, sans-serif; letter-spacing: .02em; white-space: nowrap; cursor: pointer; }
      .chip-offline.ok { color: #22c55e; border-color: rgba(34,197,94,.45); }
      .chip-offline.sin-red { color: #f59e0b; border-color: rgba(245,158,11,.55); }
      .chip-offline.error { color: #ef4444; border-color: rgba(239,68,68,.5); }
      .chip-offline .barra { width: 34px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.15); overflow: hidden; }
      .chip-offline .barra i { display: block; height: 100%; width: 0; background: var(--accent, #c9a227); transition: width .3s; }
      @media (max-width: 380px) { .chip-offline .txt-largo { display: none; } }
    `;
    document.head.appendChild(st);
  }
  function crearChip() {
    if (chip) return chip;
    const h = document.querySelector('.app-header');
    if (!h) return null;
    estilos();
    chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'chip-offline'; chip.id = 'chip-offline';
    chip.addEventListener('click', alTocar);
    h.appendChild(chip);   // (abajo a la derecha de la barra, al lado del número de versión)
    return chip;
  }
  function mostrar(estado, texto, progreso) {
    const c = crearChip(); if (!c) return;
    c.className = 'chip-offline ' + (estado || '');
    c.innerHTML = '';
    const t = document.createElement('span'); t.textContent = texto; c.appendChild(t);
    if (progreso != null) { const b = document.createElement('span'); b.className = 'barra'; const i = document.createElement('i'); i.style.width = Math.round(progreso * 100) + '%'; b.appendChild(i); c.appendChild(b); }
    c.title = estado === 'ok' ? 'Todo guardado: la app escanea sin internet' : estado === 'sin-red' ? 'Sin conexión: la app sigue funcionando con lo guardado' : texto;
  }
  function actualizar() {
    if (preparando) return;
    if (!navigator.onLine) mostrar(listo() ? 'sin-red' : 'error', listo() ? '📴 Sin conexión · funciona igual' : '⚠ Sin conexión · falta preparar');
    else if (listo()) mostrar('ok', '📴 Lista sin internet');
    else mostrar('error', '⚠ Falta preparar sin internet');
  }
  function aviso(txt) {   // mismo aviso de abajo que usa la app
    const t = document.getElementById('toast'); if (!t) return;
    t.className = 'toast success'; t.textContent = txt; t.hidden = false;
    setTimeout(() => t.classList.add('visible'), 10);
    clearTimeout(aviso.tm); aviso.tm = setTimeout(() => { t.classList.remove('visible'); setTimeout(() => { t.hidden = true; }, 300); }, 3500);
  }
  function alTocar() {
    if (preparando) { aviso('Guardando los motores para usar la app sin internet… dejá la app abierta un momento.'); return; }
    if (listo()) { aviso(navigator.onLine ? '✓ Todo guardado: la app escanea aunque no tengas señal.' : '📴 Sin conexión: la app funciona con lo guardado en el celular.'); return; }
    if (!navigator.onLine) { aviso('Para preparar el uso sin internet, conectate una vez a internet (WiFi o datos).'); return; }
    preparar(true);
  }

  // el service worker tiene que estar controlando la página (si no, lo que se baja no queda guardado)
  async function controlador() {
    if (!('serviceWorker' in navigator)) return false;
    if (navigator.serviceWorker.controller) return true;
    try { await navigator.serviceWorker.ready; } catch (e) { return false; }
    if (navigator.serviceWorker.controller) return true;
    return new Promise((ok) => {
      const t = setTimeout(() => ok(!!navigator.serviceWorker.controller), 8000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); ok(true); }, { once: true });
    });
  }
  async function enCache(parecido) {
    try { const c = await caches.open(MOTORES); const ks = await c.keys(); return ks.some((r) => parecido.test(r.url)); } catch (e) { return false; }
  }

  async function preparar(manual) {
    if (preparando || !navigator.onLine) { actualizar(); return; }
    preparando = true;
    try {
      mostrar('', '⏳ Preparando sin internet', 0.05);
      if (!(await controlador())) { preparando = false; mostrar('error', '⚠ Falta preparar sin internet'); if (manual) aviso('Recargá la página una vez y volvé a intentar.'); return; }
      // 1) archivos del motor de OCR, pedidos por ./vendor/ (el service worker los guarda): el hilo, el núcleo —las 3
      //    variantes, cada celular usa la que soporta su procesador— y el modelo en español. Se piden explícitamente:
      //    el motor pudo haber arrancado antes, directo del CDN, y eso no queda guardado.
      const base = new URL('vendor/', location.href).href;
      const archivos = ['tesseract/worker.min.js', 'tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core/tesseract-core-simd-lstm.wasm.js',
        'tesseract-core/tesseract-core-lstm.wasm.js', 'lang/spa.traineddata.gz'];
      let bajados = 0;
      for (let i = 0; i < archivos.length; i++) {
        mostrar('', '⏳ Guardando el OCR', 0.1 + 0.65 * (i / archivos.length));
        try { const r = await fetch(base + archivos[i], { cache: 'no-store' }); if (r.ok) { await r.arrayBuffer(); bajados++; } } catch (e) { /* sigue con los demás */ }
      }
      // los dos motores arrancados (texto y líneas <<<): el modelo de las líneas <<< viene con la app
      mostrar('', '⏳ Probando el OCR', 0.78);
      let motores = { texto: false, mrz: false };
      if (typeof DomicilioOCR !== 'undefined' && DomicilioOCR.prepararSinInternet) motores = await DomicilioOCR.prepararSinInternet();
      // 2) lector de códigos (ZXing-C++, WebAssembly)
      mostrar('', '⏳ Guardando el lector de códigos', 0.8);
      try {
        if (typeof BarcodeDetectionAPI !== 'undefined' && BarcodeDetectionAPI.prepareZXingModule) await BarcodeDetectionAPI.prepareZXingModule({ fireImmediately: true });
      } catch (e) { /* si no está, quedan ZXing-js y jsQR (ya guardados con la app) */ }
      // 3) control: el núcleo y el hilo del OCR tienen que estar en la caché de motores
      const ok = bajados === archivos.length && motores.texto && await enCache(/tesseract\.js@7[^/]*\/dist\/worker/) && await enCache(/tesseract-core[^/]*\.wasm\.js/) && await enCache(/spa\.traineddata/);
      preparando = false;
      if (ok) { marcarListo(); mostrar('ok', '📴 Lista sin internet'); if (manual) aviso('✓ Listo: la app ya escanea sin internet.'); }
      else { mostrar('error', '⚠ Falta preparar sin internet'); if (manual) aviso('No se pudo guardar todo. Tocá el aviso de arriba para reintentar con buena señal.'); }
    } catch (e) {
      preparando = false; mostrar('error', '⚠ Falta preparar sin internet');
    }
  }

  function iniciar() {
    actualizar();
    window.addEventListener('online', () => { actualizar(); if (!listo()) setTimeout(() => preparar(false), 1500); });
    window.addEventListener('offline', actualizar);
    // la primera vez (o si cambiaron los motores), se prepara solo unos segundos después de abrir: no compite con la cámara
    if (!listo() && navigator.onLine) setTimeout(() => preparar(false), 3500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.SinInternet = { preparar: () => preparar(true), listo };
})();
