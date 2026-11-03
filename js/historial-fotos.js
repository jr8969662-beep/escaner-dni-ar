/**
 * Fotos del historial (v49)
 *
 * Las fotos del frente y del reverso de cada registro se guardan en el celular, en IndexedDB (la base de datos del
 * navegador para archivos grandes; localStorage tiene ~5 MB en total y no alcanza para fotos). No salen del dispositivo.
 *
 *   await HistorialFotos.guardar(id, { frente: dataUrl, reverso: dataUrl })
 *   const f = await HistorialFotos.obtener(id)      // { frente: objectURL, reverso: objectURL, mini: dataURL } o null
 *   await HistorialFotos.borrar(id) / borrarTodo() / dejarSolo([ids])
 *   await HistorialFotos.descargar(src, 'nombre.jpg')  // guarda la foto en el celular (compartir / descargar)
 */
const HistorialFotos = (() => {
  'use strict';

  const DB = 'escaner-dni', STORE = 'fotos', VERSION = 1;
  const LADO_MAX = 1800, CALIDAD = 0.86, LADO_MINI = 260;
  let dbPromise = null;

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((ok, no) => {
      if (typeof indexedDB === 'undefined') { no(new Error('sin IndexedDB')); return; }
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => no(req.error);
    }).catch((e) => { dbPromise = null; throw e; });
    return dbPromise;
  }

  async function tx(modo, fn) {
    const db = await abrirDB();
    return new Promise((ok, no) => {
      const t = db.transaction(STORE, modo), st = t.objectStore(STORE);
      let res;
      Promise.resolve(fn(st)).then((r) => { res = r; }).catch(no);
      t.oncomplete = () => ok(res);
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error);
    });
  }
  const pedido = (req) => new Promise((ok, no) => { req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error); });

  function cargarImagen(src) {
    return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('imagen')); im.src = src; });
  }
  // foto -> JPEG achicado (lado mayor máximo) como Blob, y una miniatura chica como dataURL (para la lista)
  async function comprimir(src, ladoMax, calidad) {
    const im = await cargarImagen(src);
    const k = Math.min(1, ladoMax / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  const aBlob = (c, calidad) => new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', calidad));

  async function guardar(id, fotos) {
    if (!id || !fotos || (!fotos.frente && !fotos.reverso)) return false;
    const reg = { id: Number(id), fecha: Date.now() };
    for (const k of ['frente', 'reverso']) {
      if (!fotos[k]) continue;
      try {
        const c = await comprimir(fotos[k], LADO_MAX);
        reg[k] = await aBlob(c, CALIDAD);
        if (!reg.mini) { const m = await comprimir(fotos[k], LADO_MINI); reg.mini = m.toDataURL('image/jpeg', 0.75); }
      } catch (e) { /* esa foto no se pudo guardar: siguen las demás */ }
    }
    if (!reg.frente && !reg.reverso) return false;
    await tx('readwrite', (st) => pedido(st.put(reg)));
    return true;
  }

  const urls = new Map();   // objectURLs entregados (se liberan al borrar)
  async function obtener(id) {
    let reg = null;
    try { reg = await tx('readonly', (st) => pedido(st.get(Number(id)))); } catch (e) { return null; }
    if (!reg) return null;
    const out = { mini: reg.mini || null };
    for (const k of ['frente', 'reverso']) {
      if (!reg[k]) continue;
      const clave = id + ':' + k;
      if (!urls.has(clave)) urls.set(clave, URL.createObjectURL(reg[k]));
      out[k] = urls.get(clave);
    }
    return out;
  }
  async function miniaturas() {   // { id: dataURL } de todos los registros (para la lista)
    try {
      const todos = await tx('readonly', (st) => pedido(st.getAll()));
      const m = {}; (todos || []).forEach((r) => { if (r.mini) m[r.id] = r.mini; });
      return m;
    } catch (e) { return {}; }
  }
  function liberar(id) { ['frente', 'reverso'].forEach((k) => { const c = id + ':' + k; if (urls.has(c)) { URL.revokeObjectURL(urls.get(c)); urls.delete(c); } }); }
  async function borrar(id) { liberar(id); try { await tx('readwrite', (st) => pedido(st.delete(Number(id)))); } catch (e) { /* nada */ } }
  async function borrarTodo() { [...urls.keys()].forEach((c) => URL.revokeObjectURL(urls.get(c))); urls.clear(); try { await tx('readwrite', (st) => pedido(st.clear())); } catch (e) { /* nada */ } }
  // borra las fotos de los registros que ya no están en el historial (por ej. los que pasaron el máximo de 50)
  async function dejarSolo(ids) {
    const vale = new Set((ids || []).map(Number));
    try {
      const claves = await tx('readonly', (st) => pedido(st.getAllKeys()));
      for (const k of claves || []) if (!vale.has(Number(k))) await borrar(k);
    } catch (e) { /* nada */ }
  }

  // Guardar una foto en el celular: primero "Compartir" (en el celular deja elegir Galería, Drive, WhatsApp…);
  // si no se puede, descarga directa. Devuelve 'compartida' | 'descargada' | 'cancelada' | 'error'.
  async function descargar(src, nombre) {
    try {
      const blob = await (await fetch(src)).blob();
      const archivo = new File([blob], nombre || 'dni.jpg', { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] }) && navigator.share) {
        try { await navigator.share({ files: [archivo], title: nombre }); return 'compartida'; }
        catch (e) { if (e && e.name === 'AbortError') return 'cancelada'; /* si falla, se descarga */ }
      }
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = nombre || 'dni.jpg'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      return 'descargada';
    } catch (e) { return 'error'; }
  }

  return { guardar, obtener, miniaturas, borrar, borrarTodo, dejarSolo, descargar };
})();
