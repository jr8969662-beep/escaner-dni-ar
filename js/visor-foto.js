/**
 * Visor de fotos a pantalla completa con zoom (v48)
 *
 * - Se abre tocando la foto del frente (#scan-img), la del reverso (#domicilio-preview) o las miniaturas de la ficha.
 * - Zoom: pellizcando con dos dedos, doble toque (acerca donde se tocó), rueda del mouse o los botones + / −.
 * - Con la foto ampliada se arrastra con un dedo para recorrerla.
 * - Se cierra con ✕, con la tecla Esc o con el botón "atrás" del celular.
 *
 * Uso desde otros archivos:
 *   VisorFoto.abrir(src, 'Reverso del DNI')
 *   VisorFoto.actualizarFicha({ frente: dataUrl, reverso: dataUrl })   // miniaturas en la ficha
 */
const VisorFoto = (() => {
  'use strict';

  const ZOOM_MAX = 6;
  let raiz = null, lienzo = null, imagen = null, titulo = null, nivel = null;
  let escala = 1, tx = 0, ty = 0;          // transformación actual de la imagen
  let base = { w: 0, h: 0 };                // tamaño de la imagen a escala 1 (entera en pantalla)
  const punteros = new Map();
  let gesto = null, ultimoToque = 0, abiertoConHistorial = false;

  function estilos() {
    if (document.getElementById('visor-foto-css')) return;
    const st = document.createElement('style');
    st.id = 'visor-foto-css';
    st.textContent = `
      .visor-foto { position: fixed; inset: 0; z-index: 9999; background: #05080f; display: flex; flex-direction: column;
        padding: env(safe-area-inset-top, 0) 0 env(safe-area-inset-bottom, 0); touch-action: none; user-select: none; -webkit-user-select: none; }
      .visor-foto[hidden] { display: none; }
      .visor-barra { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: #fff; font: 600 14px system-ui, sans-serif; }
      .visor-barra .visor-titulo { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .visor-btn { width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08);
        color: #fff; font: 600 20px system-ui, sans-serif; display: grid; place-items: center; cursor: pointer; }
      .visor-btn:active { background: rgba(255,255,255,.2); }
      .visor-nivel { min-width: 52px; text-align: center; font: 600 13px system-ui, sans-serif; color: #c9a227; }
      .visor-galeria { display: flex; justify-content: center; gap: 8px; padding: 0 12px 8px; }
      .visor-galeria[hidden] { display: none; }
      .visor-galeria button { padding: 7px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff;
        font: 600 13px system-ui, sans-serif; cursor: pointer; }
      .visor-galeria button.activo { background: #c9a227; border-color: #c9a227; color: #0a1220; }
      .visor-lienzo { position: relative; flex: 1; overflow: hidden; cursor: grab; }
      .visor-lienzo.arrastrando { cursor: grabbing; }
      .visor-lienzo img { position: absolute; left: 50%; top: 50%; max-width: none; transform-origin: 0 0; will-change: transform;
        image-rendering: auto; -webkit-user-drag: none; pointer-events: none; }
      .visor-ayuda { text-align: center; color: rgba(255,255,255,.6); font: 12px system-ui, sans-serif; padding: 6px 12px 10px; }
      .foto-ampliable { cursor: zoom-in; }
      .visor-aviso { position: absolute; left: 50%; bottom: calc(44px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: rgba(201,162,39,.95);
        color: #0a1220; font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; opacity: 0; transition: opacity .2s; pointer-events: none; }
      .fotos-ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
      .foto-mini { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--border, rgba(255,255,255,.15));
        background: #000; aspect-ratio: 1.586; padding: 0; cursor: zoom-in; }
      .foto-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .foto-mini span { position: absolute; left: 6px; bottom: 6px; background: rgba(0,0,0,.65); color: #fff; font: 600 11px system-ui, sans-serif;
        padding: 3px 8px; border-radius: 10px; }
      .foto-mini.vacia { display: grid; place-items: center; color: var(--text-muted, #8a94a6); font: 12px system-ui, sans-serif; cursor: default; background: transparent; }
    `;
    document.head.appendChild(st);
  }

  function crear() {
    if (raiz) return;
    estilos();
    raiz = document.createElement('div');
    raiz.className = 'visor-foto'; raiz.hidden = true;
    raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-label', 'Foto ampliada');
    raiz.innerHTML = `
      <div class="visor-barra">
        <span class="visor-titulo">Foto</span>
        <button type="button" class="visor-btn" data-accion="menos" aria-label="Alejar">−</button>
        <span class="visor-nivel">100%</span>
        <button type="button" class="visor-btn" data-accion="mas" aria-label="Acercar">+</button>
        <button type="button" class="visor-btn" data-accion="guardar" aria-label="Guardar foto" title="Guardar foto en el celular">⬇</button>
        <button type="button" class="visor-btn" data-accion="cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="visor-galeria" hidden></div>
      <div class="visor-lienzo"><img alt="Foto ampliada"></div>
      <div class="visor-ayuda">Pellizcá o tocá dos veces para ampliar · arrastrá para moverte</div>`;
    document.body.appendChild(raiz);
    lienzo = raiz.querySelector('.visor-lienzo');
    imagen = lienzo.querySelector('img');
    titulo = raiz.querySelector('.visor-titulo');
    nivel = raiz.querySelector('.visor-nivel');

    raiz.querySelector('.visor-barra').addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]'); if (!b) return;
      const r = lienzo.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
      if (b.dataset.accion === 'cerrar') cerrar();
      else if (b.dataset.accion === 'guardar') guardarActual(b);
      else if (b.dataset.accion === 'mas') zoomEn(escala * 1.6, cx, cy, true);
      else if (b.dataset.accion === 'menos') zoomEn(escala / 1.6, cx, cy, true);
    });

    lienzo.addEventListener('pointerdown', alApoyar);
    lienzo.addEventListener('pointermove', alMover);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => lienzo.addEventListener(ev, alLevantar));
    lienzo.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = lienzo.getBoundingClientRect();
      zoomEn(escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    imagen.addEventListener('load', ajustarBase);
    window.addEventListener('resize', () => { if (!raiz.hidden) ajustarBase(); });
    document.addEventListener('keydown', (e) => {
      if (raiz.hidden) return;
      if (e.key === 'Escape') cerrar();
      if (e.key === '+' || e.key === '=') { const r = lienzo.getBoundingClientRect(); zoomEn(escala * 1.6, r.width / 2, r.height / 2, true); }
      if (e.key === '-') { const r = lienzo.getBoundingClientRect(); zoomEn(escala / 1.6, r.width / 2, r.height / 2, true); }
    });
    // botón "atrás" del celular: cierra el visor en vez de salir de la app
    window.addEventListener('popstate', () => { if (!raiz.hidden && abiertoConHistorial) { abiertoConHistorial = false; cerrar(true); } });
  }

  // tamaño de la imagen entera en pantalla (escala 1) y vuelta al centro
  function ajustarBase() {
    const r = lienzo.getBoundingClientRect();
    const nw = imagen.naturalWidth || 1, nh = imagen.naturalHeight || 1;
    const k = Math.min(r.width / nw, r.height / nh);
    base = { w: nw * k, h: nh * k };
    imagen.style.width = base.w + 'px'; imagen.style.height = base.h + 'px';
    escala = 1; tx = 0; ty = 0; aplicar(false);
  }

  // que la imagen no se escape de la pantalla (centrada si es más chica, con borde si es más grande)
  function limitar() {
    const r = lienzo.getBoundingClientRect();
    const w = base.w * escala, h = base.h * escala;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    tx = Math.max(-mx, Math.min(mx, tx));
    ty = Math.max(-my, Math.min(my, ty));
  }

  function aplicar(animado) {
    limitar();
    imagen.style.transition = animado ? 'transform .18s ease-out' : 'none';
    // (la imagen está anclada al centro del lienzo; tx/ty mueven el centro de la imagen)
    imagen.style.transform = `translate(${-base.w * escala / 2 + tx}px, ${-base.h * escala / 2 + ty}px) scale(${escala})`;
    if (nivel) nivel.textContent = Math.round(escala * 100) + '%';
  }

  // zoom manteniendo fijo el punto (px, py) del lienzo
  function zoomEn(nueva, px, py, animado) {
    const r = lienzo.getBoundingClientRect();
    nueva = Math.max(1, Math.min(ZOOM_MAX, nueva));
    const cx = px - r.width / 2, cy = py - r.height / 2;   // punto respecto del centro del lienzo
    const f = nueva / escala;
    tx = cx - (cx - tx) * f; ty = cy - (cy - ty) * f;
    escala = nueva;
    aplicar(animado);
  }

  function posLocal(e) { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function alApoyar(e) {
    lienzo.setPointerCapture && lienzo.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, posLocal(e));
    if (punteros.size === 1) {
      const p = posLocal(e), ahora = Date.now();
      // doble toque: acerca donde se tocó (o vuelve al tamaño entero)
      if (ahora - ultimoToque < 300) { zoomEn(escala > 1.2 ? 1 : 2.5, p.x, p.y, true); ultimoToque = 0; gesto = null; return; }
      ultimoToque = ahora;
      gesto = { tipo: 'mover', x: p.x, y: p.y, tx, ty };
      lienzo.classList.add('arrastrando');
    } else if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      gesto = { tipo: 'pellizco', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, escala, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx, ty };
    }
  }

  function alMover(e) {
    if (!punteros.has(e.pointerId) || !gesto) return;
    punteros.set(e.pointerId, posLocal(e));
    if (gesto.tipo === 'mover' && punteros.size === 1) {
      const p = posLocal(e);
      tx = gesto.tx + (p.x - gesto.x); ty = gesto.ty + (p.y - gesto.y);
      aplicar(false);
    } else if (gesto.tipo === 'pellizco' && punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      // se parte del estado al empezar el pellizco: zoom alrededor del centro de los dedos + lo que se movieron
      escala = gesto.escala; tx = gesto.tx; ty = gesto.ty;
      zoomEn(gesto.escala * d / gesto.d, gesto.cx, gesto.cy, false);
      tx += cx - gesto.cx; ty += cy - gesto.cy;
      aplicar(false);
    }
  }

  function alLevantar(e) {
    if (!punteros.has(e.pointerId)) return;
    punteros.delete(e.pointerId);
    if (punteros.size === 1) {   // de pellizco a arrastre con el dedo que queda
      const p = [...punteros.values()][0];
      gesto = { tipo: 'mover', x: p.x, y: p.y, tx, ty };
    } else if (!punteros.size) { gesto = null; lienzo.classList.remove('arrastrando'); }
  }

  // nombre del archivo al guardar: "DNI_25122169_reverso_2026-11-03.jpg" (el prefijo lo pone la app con el DNI)
  let prefijo = 'DNI', actual = { src: null, nombre: 'Foto' };
  function setPrefijo(p) { prefijo = String(p || 'DNI').replace(/[^\w\-]+/g, '_'); }
  async function guardarActual(btn) {
    if (!actual.src) return;
    const parte = /reverso/i.test(actual.nombre) ? 'reverso' : /frente/i.test(actual.nombre) ? 'frente' : 'foto';
    const nombre = prefijo + '_' + parte + '_' + new Date().toISOString().slice(0, 10) + '.jpg';
    if (typeof HistorialFotos === 'undefined') return;
    if (btn) btn.disabled = true;
    const r = await HistorialFotos.descargar(actual.src, nombre);
    if (btn) btn.disabled = false;
    avisar(r === 'compartida' ? '✓ Foto lista para guardar' : r === 'descargada' ? '✓ Foto guardada en Descargas' : r === 'cancelada' ? 'Cancelado' : 'No se pudo guardar la foto');
  }
  function avisar(txt) {
    let t = raiz.querySelector('.visor-aviso');
    if (!t) { t = document.createElement('div'); t.className = 'visor-aviso'; raiz.appendChild(t); }
    t.textContent = txt; t.style.opacity = '1';
    clearTimeout(avisar.tm); avisar.tm = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  // galeria (opcional): [{ src, nombre }, …] -> botones para pasar de una foto a otra (frente / reverso)
  function mostrar(src, nombre) {
    actual = { src, nombre: nombre || 'Foto' };
    titulo.textContent = nombre || 'Foto';
    punteros.clear(); gesto = null;
    if (imagen.src === src && imagen.complete) ajustarBase(); else imagen.src = src;
    const gal = raiz.querySelector('.visor-galeria');
    gal.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.src === src));
  }
  function abrir(src, nombre, galeria) {
    if (!src) return;
    crear();
    const gal = raiz.querySelector('.visor-galeria');
    gal.innerHTML = '';
    const lista = Array.isArray(galeria) ? galeria.filter((g) => g && g.src) : [];
    gal.hidden = lista.length < 2;
    lista.forEach((g) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.src = g.src;
      b.textContent = String(g.nombre || '').replace(/ del DNI$/, '');
      b.addEventListener('click', () => mostrar(g.src, g.nombre));
      gal.appendChild(b);
    });
    raiz.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    mostrar(src, nombre);
    try { history.pushState({ visorFoto: true }, ''); abiertoConHistorial = true; } catch (e) { abiertoConHistorial = false; }
  }

  function cerrar(desdeHistorial) {
    if (!raiz || raiz.hidden) return;
    raiz.hidden = true;
    document.documentElement.style.overflow = '';
    if (!desdeHistorial && abiertoConHistorial) { abiertoConHistorial = false; try { history.back(); } catch (e) { /* nada */ } }
  }

  // ---- fotos que se abren tocándolas ----
  const AMPLIABLES = { 'scan-img': 'Frente del DNI', 'domicilio-preview': 'Reverso del DNI' };
  function marcarAmpliables() {
    Object.keys(AMPLIABLES).forEach((id) => { const el = document.getElementById(id); if (el) { el.classList.add('foto-ampliable'); el.title = 'Tocá para ampliar'; } });
  }
  document.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img');
    if (img && AMPLIABLES[img.id] && !img.hidden && img.src) { e.preventDefault(); e.stopPropagation(); abrir(img.src, AMPLIABLES[img.id]); return; }
    const mini = e.target.closest && e.target.closest('.foto-mini[data-src]');
    if (mini) {
      e.preventDefault();
      const todas = [...document.querySelectorAll('#grupo-fotos .foto-mini[data-src]')].map((m) => ({ src: m.dataset.src, nombre: m.dataset.titulo }));
      abrir(mini.dataset.src, mini.dataset.titulo, todas);
    }
  }, true);

  // ---- miniaturas en la ficha ----
  function actualizarFicha(fotos) {
    const ficha = document.getElementById('resultado');
    if (!ficha) return;
    let grupo = document.getElementById('grupo-fotos');
    const hay = fotos && (fotos.frente || fotos.reverso);
    if (!hay) { if (grupo) grupo.hidden = true; return; }
    if (!grupo) {
      estilos();
      grupo = document.createElement('div');
      grupo.className = 'group'; grupo.id = 'grupo-fotos';
      grupo.innerHTML = `<div class="group-title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg><span>Fotos del documento</span></div><div class="fotos-ficha"></div>`;
      const dom = document.getElementById('grupo-domicilio');
      if (dom && dom.parentNode === ficha) ficha.insertBefore(grupo, dom.nextSibling); else ficha.appendChild(grupo);
    }
    grupo.hidden = false;
    const caja = grupo.querySelector('.fotos-ficha');
    caja.innerHTML = '';
    [['frente', 'Frente'], ['reverso', 'Reverso']].forEach(([k, nombre]) => {
      const src = fotos[k];
      const b = document.createElement('button');
      b.type = 'button';
      if (src) {
        b.className = 'foto-mini'; b.dataset.src = src; b.dataset.titulo = nombre + ' del DNI';
        b.setAttribute('aria-label', 'Ampliar foto del ' + nombre.toLowerCase());
        const im = document.createElement('img'); im.src = src; im.alt = nombre;
        const et = document.createElement('span'); et.textContent = '🔍 ' + nombre;
        b.append(im, et);
      } else {
        b.className = 'foto-mini vacia'; b.disabled = true; b.textContent = nombre + ': sin foto';
      }
      caja.appendChild(b);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', marcarAmpliables); else marcarAmpliables();

  return { abrir, cerrar, actualizarFicha, setPrefijo };
})();
