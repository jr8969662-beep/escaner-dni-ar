/**
 * Nube: comparte el registro de lecturas entre el celular (APK) y la PC usando un repositorio PRIVADO de GitHub.
 *
 * Cada lectura guardada se sube como:
 *   lecturas/<id>.json            → datos de la persona + fecha + desde qué aparato
 *   fotos/<id>_frente.jpg / _reverso.jpg
 * Cualquier aparato con la misma clave ve todas las lecturas (pestaña "Todos los aparatos" del registro).
 *
 * La configuración (repositorio y clave) se guarda solo en este aparato (localStorage).
 * Si no hay internet, la lectura queda en "pendientes" y se sube sola cuando vuelve la conexión.
 */
'use strict';
const Nube = (() => {
  const K_CONF = 'nube_github', K_PEND = 'nube_pendientes', K_CACHE = 'nube_cache';
  const API = 'https://api.github.com';
  const leer = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno: sin caché */ } };

  function config() { return leer(K_CONF, null); }
  function activa() { const c = config(); return !!(c && c.repo && c.token); }
  function limpiarRepo(t) {
    let r = String(t || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : '';
  }
  function guardarConfig(repo, token, aparato) {
    const r = limpiarRepo(repo), t = String(token || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    if (!r) throw new Error('El repositorio tiene que ser "usuario/nombre".');
    if (t.length < 20) throw new Error('La clave parece incompleta.');
    escribir(K_CONF, { repo: r, token: t, aparato: String(aparato || '').trim().slice(0, 40) || nombreAparato() });
  }
  function desconectar() { try { localStorage.removeItem(K_CONF); localStorage.removeItem(K_CACHE); } catch (e) { /* nada */ } }
  function nombreAparato() { return /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Celular' : 'PC'; }

  async function api(ruta, opciones = {}) {
    const c = config(); if (!c) throw new Error('La nube no está configurada.');
    let r;
    try {
      r = await fetch(API + '/repos/' + c.repo + ruta, {
        ...opciones,
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + c.token, Accept: opciones.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) },
      });
    } catch (e) { const er = new Error('Sin conexión con GitHub.'); er.sinRed = true; throw er; }
    if (r.status === 401) throw new Error('La clave de GitHub no es válida o venció.');
    if (r.status === 403) throw new Error('La clave no tiene permiso para escribir en ese repositorio.');
    if (r.status === 404 && opciones.no404) return null;
    if (r.status === 404) throw new Error('No se encontró el repositorio (¿el nombre está bien? ¿la clave tiene acceso a él?).');
    if (!r.ok && r.status !== 422) throw new Error('GitHub respondió con error ' + r.status + '.');
    return r;
  }

  const base64Texto = (s) => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(t); };

  // la foto puede venir como data: o como blob: (las del registro del celular): se pasa a base64
  async function fotoBase64(u) {
    if (!u) return null;
    const m = /^data:image\/\w+;base64,(.+)$/.exec(u); if (m) return m[1];
    if (!/^blob:/.test(u)) return null;
    try {
      const blob = await (await fetch(u)).blob();
      const d = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
      const m2 = /^data:[^;]*;base64,(.+)$/.exec(d || ''); return m2 ? m2[1] : null;
    } catch (e) { return null; }
  }

  async function subirArchivo(ruta, contenido64, mensaje) {
    // si ya existe (se subió antes y se cortó), no se pisa: alcanza con que esté
    const r = await api('/contents/' + ruta, { method: 'PUT', body: JSON.stringify({ message: mensaje, content: contenido64 }) });
    if (r.status === 422) return true;   // ya estaba
    return true;
  }

  async function probar() {
    const r = await api('');
    const info = await r.json();
    if (!info.private) throw new Error('Ese repositorio es PÚBLICO: cualquiera vería los DNI. Ponelo como privado en GitHub (Settings → Change visibility).');
    if (info.permissions && !info.permissions.push) throw new Error('La clave no tiene permiso para escribir en ese repositorio.');
    return info;
  }

  // ---- subir ----
  function pendientes() { return leer(K_PEND, []); }
  function encolar(id) { const p = pendientes(); if (!p.includes(id)) { p.push(id); escribir(K_PEND, p); } }
  let subiendo = null;
  // obtenerItem(id) → { id, fecha, datos } | null ; obtenerFotos(id) → { frente, reverso } (data URLs) | null
  function procesar(obtenerItem, obtenerFotos, alTerminar) {
    if (!activa() || subiendo) return subiendo || Promise.resolve(0);
    subiendo = (async () => {
      let hechos = 0;
      for (const id of pendientes().slice()) {
        const item = obtenerItem(id);
        if (!item) { escribir(K_PEND, pendientes().filter((x) => x !== id)); continue; }
        try {
          const f = (obtenerFotos && await obtenerFotos(id)) || {};
          const fotos = {};
          for (const lado of ['frente', 'reverso']) {
            const b64 = await fotoBase64(f[lado]);
            if (!b64) continue;
            const ruta = `fotos/${id}_${lado}.jpg`;
            await subirArchivo(ruta, b64, `Foto ${lado} ${id}`);
            fotos[lado] = ruta;
          }
          const d = item.datos || {};
          const ficha = { id, fecha: item.fecha, aparato: (config() || {}).aparato || nombreAparato(), datos: d, fotos };
          await subirArchivo(`lecturas/${id}.json`, base64Texto(JSON.stringify(ficha, null, 1)), `Lectura DNI ${d.dni || d.numero || ''}`.trim());
          const cache = leer(K_CACHE, {}); cache[id] = ficha; escribir(K_CACHE, cache);
          escribir(K_PEND, pendientes().filter((x) => x !== id));
          hechos++;
        } catch (e) { if (alTerminar) alTerminar(hechos, e); return hechos; }
      }
      if (alTerminar) alTerminar(hechos, null);
      return hechos;
    })().finally(() => { subiendo = null; });
    return subiendo;
  }

  // ---- leer todas ----
  async function listar() {
    const r = await api('/contents/lecturas', { no404: true });
    const cache = leer(K_CACHE, {});
    if (!r) return [];
    const archivos = (await r.json()).filter((a) => /^\d+\.json$/.test(a.name));
    const faltan = archivos.filter((a) => !cache[a.name.replace('.json', '')]);
    for (let i = 0; i < faltan.length; i += 6) {
      await Promise.all(faltan.slice(i, i + 6).map(async (a) => {
        try { const x = await api('/contents/lecturas/' + a.name, { raw: true }); const j = await x.json(); if (j && j.id) cache[j.id] = j; } catch (e) { /* se reintenta la próxima */ }
      }));
    }
    const vivos = new Set(archivos.map((a) => a.name.replace('.json', '')));
    Object.keys(cache).forEach((k) => { if (!vivos.has(String(k))) delete cache[k]; });
    escribir(K_CACHE, cache);
    return Object.values(cache).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }
  function enCache() { return Object.values(leer(K_CACHE, {})).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))); }

  const fotosUrl = new Map();
  async function foto(ruta) {
    if (!ruta) return null;
    if (fotosUrl.has(ruta)) return fotosUrl.get(ruta);
    const r = await api('/contents/' + ruta, { raw: true, no404: true });
    if (!r) return null;
    const blob = await r.blob();
    const u = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob.type ? blob : new Blob([blob], { type: 'image/jpeg' })); });
    if (u) fotosUrl.set(ruta, u);
    return u;
  }

  async function borrar(id) {
    const c = leer(K_CACHE, {}), f = (c[id] && c[id].fotos) || {};
    for (const ruta of [`lecturas/${id}.json`, f.frente, f.reverso].filter(Boolean)) {
      const r = await api('/contents/' + ruta, { no404: true }); if (!r) continue;
      const { sha } = await r.json();
      await api('/contents/' + ruta, { method: 'DELETE', body: JSON.stringify({ message: 'Borrar ' + ruta, sha }) });
    }
    delete c[id]; escribir(K_CACHE, c);
  }

  return { config, activa, guardarConfig, desconectar, probar, encolar, pendientes, procesar, listar, enCache, foto, borrar, limpiarRepo };
})();
if (typeof window !== 'undefined') window.Nube = Nube;
