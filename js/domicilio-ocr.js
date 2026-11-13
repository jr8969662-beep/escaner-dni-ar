/**
 * OCR del reverso del DNI argentino (Tesseract.js v5)
 *
 * - Texto (domicilio, lugar de nacimiento, CUIL): pasada 1 sobre la imagen completa.
 * - MRZ (vencimiento, nacionalidad): pasada 2 sobre el borde inferior, solo A-Z 0-9 <
 *   (se hace únicamente si la pasada 1 no encontró una MRZ verificada).
 *
 * Uso:
 *   const r = await DomicilioOCR.leer(canvasOImagen, 'arg', (p) => { ... }, { dni: '12345678' });
 *   // r = { raw, domicilio, lugarNacimiento, cuil, fechaVencimiento, nacionalidad, mrzVerificada }
 *
 * Para ver el texto crudo que lee el OCR: DomicilioOCR.setDebug(true)
 */

const DomicilioOCR = (() => {
  'use strict';

  let DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log(...args); };

  // ============================================
  // CONFIGURACIÓN
  // ============================================
  const ANCHO_MAX = 2200;              // si la imagen es más ancha (fotos 4K), se reduce: más rápido y sin perder legibilidad
  const ANCHO_MIN = 1500;              // si la imagen es más angosta, se agranda hasta este ancho (más alto = más lento)
  const FRACCIONES_MRZ = [0.4];        // porción inferior que se recorta para buscar la MRZ (cada una es una pasada más)

  const PARAMS_TEXTO = {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyzáéíóúñ0123456789 .,-°ºª/()<>:',
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: '6'
  };

  const PARAMS_MRZ = {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    preserve_interword_spaces: '0',
    tessedit_pageseg_mode: '6'
  };

  // Zona superior (domicilio / lugar): sin whitelist, para no filtrar caracteres reales (° , ( ) etc.)
  const PARAMS_ZONA = {
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: '6'
  };
  const PARAMS_ZONA_DISPERSA = Object.assign({}, PARAMS_ZONA, { tessedit_pageseg_mode: '11' });

  // ============================================
  // WORKER (una sola instancia, progreso por etapas)
  // ============================================
  let workerPromise = null;
  let progresoCb = null;
  let etapaDesde = 0;
  let etapaHasta = 1;

  function etapa(desde, hasta) { etapaDesde = desde; etapaHasta = hasta; }

  // Si Tesseract.js 7 no carga o no arranca en este celular, se carga la 5.1.1 (la de antes) y se reintenta una vez
  const TESSERACT_RESPALDO = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let respaldoUsado = false;
  function cargarScript(url) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => no(new Error('no cargó ' + url)); document.head.appendChild(s); });
  }
  async function conRespaldo(crear) {
    try {
      if (typeof Tesseract === 'undefined') throw new Error('Tesseract no está');
      return await crear();
    } catch (e) {
      if (respaldoUsado) throw e;
      respaldoUsado = true;
      log('⚠ Tesseract nuevo no arrancó (' + e + '): se usa la versión 5.1.1');
      await cargarScript(TESSERACT_RESPALDO);
      return crear();
    }
  }

  // v50: con el service worker activo, los archivos del motor se piden a ./vendor/... (los guarda para usar sin
  // internet). Si así no arranca, se prueba como antes, directo del CDN. (Solo para la v7: las rutas son de esa versión.)
  function rutasLocales() {
    try {
      if (respaldoUsado || !(navigator.serviceWorker && navigator.serviceWorker.controller)) return null;
      if (Tesseract.version && !/^v?7\./.test(String(Tesseract.version))) return null;
      const base = new URL('vendor/', location.href).href;
      return { workerPath: base + 'tesseract/worker.min.js', corePath: base + 'tesseract-core', langPath: base + 'lang', workerBlobURL: false };
    } catch (e) { return null; }
  }
  async function crearMotor(lang, opciones = {}) {
    const loc = rutasLocales();
    if (loc) {
      try { return await Tesseract.createWorker(lang, 1, Object.assign({}, loc, opciones)); }
      catch (e) { log('motor desde ./vendor no arrancó (' + e + '): directo del CDN'); }
    }
    return Tesseract.createWorker(lang, 1, opciones);
  }

  function initWorker() {
    if (!workerPromise) {
      workerPromise = conRespaldo(() => crearMotor('spa', {
        logger: (m) => {
          if (progresoCb && m.status === 'recognizing text') {
            progresoCb(etapaDesde + m.progress * (etapaHasta - etapaDesde));
          }
        }
      })).then(async (w) => {
        // primera lectura de calentamiento (chiquita): la primera de verdad tardaba 1-2 s de más inicializando el motor
        try {
          const c = document.createElement('canvas'); c.width = 160; c.height = 40;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 160, 40); x.fillStyle = '#000'; x.font = '24px sans-serif'; x.fillText('DNI 123', 8, 30);
          await w.recognize(c);
        } catch (e) { /* nada */ }
        return w;
      }).catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // Segundo motor, solo para las líneas <<< (MRZ): modelo entrenado con la letra OCR-B de los documentos
  // (tessdata/ocrb_int.traineddata, 1,4 MB). Lee mucho mejor los números que el modelo en español y, como es otro
  // motor, trabaja AL MISMO TIEMPO que la lectura del domicilio (el reverso tarda menos). Si no carga, se usa el de siempre.
  let workerMRZPromise = null;
  function initWorkerMRZ() {
    if (!workerMRZPromise) {
      workerMRZPromise = (async () => {
        const langPath = new URL('tessdata', location.href).href;
        const wm = await conRespaldo(() => crearMotor('ocrb_int', { langPath, gzip: false }));
        await wm.setParameters(PARAMS_MRZ);
        return wm;
      })().catch((e) => { log('MRZ: sin modelo OCR-B (' + e + ')'); return null; });
    }
    return workerMRZPromise;
  }

  // el motor de la MRZ se usa de a uno (lo comparten la lectura del reverso y la detección rápida)
  let colaMRZ = Promise.resolve();
  function enColaMRZ(fn) { const p = colaMRZ.then(fn, fn); colaMRZ = p.catch(() => {}); return p; }

  // ¿La cámara está mostrando el REVERSO? Lectura rápida (menos de 1 s) solo de la franja de abajo, con el motor OCR-B:
  // si aparecen las líneas <<< se pasa directo a leer el reverso, sin esperar la lectura del frente.
  async function pareceReverso(fuente) {
    const wm = await initWorkerMRZ();
    if (!wm || !fuente || !fuente.width) return null;
    return enColaMRZ(async () => {
      // franja de las líneas <<< (con el margen del recorte de la cámara) y con la luz normalizada, que es como mejor lee el OCR-B
      const c = await preprocesar(recortarRel(fuente, 0, 0.55, 1, 0.97, 1, 1500, 8), 'fondo');
      const { data: { text } } = await wm.recognize(c);
      const U = String(text || '').toUpperCase().replace(/\s/g, '');
      const es = /[I1][D0O]ARG\d/.test(U) || (U.match(/</g) || []).length >= 12;
      log('👀 ¿reverso? ' + (es ? 'sí' : 'no') + ' · ' + U.slice(0, 60));
      return es;
    });
  }

  // Carga el motor y el idioma en segundo plano (llamarlo al abrir el modal, antes de capturar)
  async function precargar() {
    // (el motor OCR-B se carga recién al leer un reverso: cargarlo antes le quitaba velocidad a la lectura del frente)
    const w = await initWorker();
    await w.setParameters(PARAMS_TEXTO);
  }

  // Solo texto, para leer el FRENTE del DNI nuevo: dos pasadas (párrafo y texto disperso), sin whitelist
  async function leerTexto(fuente, onProgress) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    const gris = await preprocesar(await aElemento(fuente));
    const textos = [];
    const modos = ['6', '11'];
    for (let i = 0; i < modos.length; i++) {
      etapa(i / modos.length, (i + 1) / modos.length);
      await w.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1', tessedit_pageseg_mode: modos[i] });
      const { data: { text } } = await w.recognize(gris);
      textos.push(text);
      log('📄 OCR frente (psm ' + modos[i] + '):\n' + text);
    }
    await w.setParameters(PARAMS_TEXTO);
    if (progresoCb) progresoCb(1);
    return textos;
  }

  // Palabras con su posición, sea cual sea el formato que devuelva Tesseract.js (words, blocks o TSV)
  function palabrasDe(data) {
    if (!data) return [];
    if (Array.isArray(data.words) && data.words.length) return data.words.map((w) => ({ t: w.text, b: w.bbox }));
    const out = [];
    (data.blocks || []).forEach((bl) => (bl.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => out.push({ t: w.text, b: w.bbox })))));
    if (out.length || typeof data.tsv !== 'string') return out;
    data.tsv.split('\n').forEach((fila) => {
      const c = fila.split('\t');
      if (c[0] === '5' && c[11] && c[11].trim()) out.push({ t: c[11], b: { x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] } });
    });
    return out;
  }

  const sinT = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  // ¿La palabra es la etiqueta Apellido/Surname o Nombre/Name? Devuelve cuánto correr la zona a la izquierda (en alturas de letra)
  // ¿La palabra es una etiqueta del frente? Devuelve qué dato hay debajo y dónde (en alturas de letra respecto de la palabra)
  function tipoEtiqueta(t) {
    const U = sinT(t);
    if (/APELL|PELLID/.test(U)) return { k: 'apellido', izq: 1.5, ancho: 40 };
    if (/SURNAM|URNAME/.test(U)) return { k: 'apellido', izq: 6.5, ancho: 40 };
    if (/NOMBR|OMBRE/.test(U) && !/SUR/.test(U)) return { k: 'nombre', izq: 1.5, ancho: 40 };
    if (/^\W*\/?NAME\W*$/.test(U) || (/\/NAME/.test(U) && !/SUR/.test(U))) return { k: 'nombre', izq: 5, ancho: 40 };
    if (/NACIM|ACIMIEN/.test(U)) return { k: 'nac', izq: 8.5, ancho: 23, alto: 2.9 };
    if (/BIRTH/.test(U)) return { k: 'nac', izq: 14, ancho: 22 };
    if (/EMISI|MISION/.test(U)) return { k: 'emi', izq: 8.5, ancho: 22, alto: 2.9 };
    if (/ISSUE/.test(U)) return { k: 'emi', izq: 12, ancho: 20 };
    if (/VENCIM|ENCIMI/.test(U)) return { k: 'ven', izq: 8.5, ancho: 22, alto: 2.9 };
    if (/EXPIR/.test(U)) return { k: 'ven', izq: 13, ancho: 20 };
    if (/ocumento/.test(t)) return { k: 'doc', izq: 0.4, ancho: 20, alto: 3 };      // "Documento" (no el título en mayúsculas)
    if (/ocument\b/.test(t)) return { k: 'doc', izq: 6.5, ancho: 16, alto: 3 };
    if (/TRAMIT|RAMITE/.test(U)) return { k: 'tramite', izq: 0.4, ancho: 16, alto: 2.6 };
    // ejemplar: una letra sola no la lee bien nadie; se lee el renglón entero "ARGENTINA  B" (hacia la izquierda de la etiqueta)
    // renglón "M   ARGENTINA   B" (sexo, nacionalidad, ejemplar) leído entero desde la etiqueta "Sexo": letras sueltas
    // que la pasada general suele perder
    if (/^\W*SEXO?\W*$/.test(U)) return { k: 'fila', izq: 0.6, ancho: 44, alto: 3.0 };
    if (/EJEMPL|JEMPLA/.test(U)) return { k: 'ejemplar', izq: 22, ancho: 27, alto: 3.0 };
    return null;
  }

  // Etiquetas del frente (Apellido, Nombre, Fecha de nacimiento…) a partir de las palabras con su posición
  function armarEtiquetas(palabrasF) {
    const etiquetas = [];
    palabrasF.forEach((p) => {
      const e = p.b && tipoEtiqueta(p.t);
      if (!e) return;
      // etiqueta en dos renglones ("Fecha de emisión/" + "Date of issue"): el dato está debajo del renglón de más abajo
      const prev = etiquetas.find((x) => x.k === e.k);
      if (!prev) etiquetas.push(Object.assign({ b: p.b }, e));
      else if (p.b.y0 > prev.b.y1 && p.b.y0 - prev.b.y1 < 2 * (prev.b.y1 - prev.b.y0) && Math.abs((p.b.x0 - e.izq * (p.b.y1 - p.b.y0)) - (prev.b.x0 - prev.izq * (prev.b.y1 - prev.b.y0))) < 8 * (prev.b.y1 - prev.b.y0)) {
        Object.assign(prev, { b: p.b }, e);
      }
    });
    // sin la etiqueta "Apellido" (mal leída) pero con "Nombre": el apellido es el renglón justo encima de "Nombre"
    const eNom = etiquetas.find((x) => x.k === 'nombre');
    if (eNom && !etiquetas.some((x) => x.k === 'apellido')) {
      const hN = Math.max(8, eNom.b.y1 - eNom.b.y0);
      etiquetas.push({ k: 'apellido', izq: eNom.izq, ancho: eNom.ancho, b: eNom.b, yAbs: [eNom.b.y0 - 2.6 * hN, eNom.b.y0 - 0.15 * hN] });
    }
    // el renglón "M  ARGENTINA  B" llega hasta la etiqueta "Ejemplar" (si se leyó): así la letra del ejemplar no queda afuera
    const eFila = etiquetas.find((x) => x.k === 'fila'), eEj = etiquetas.find((x) => x.k === 'ejemplar');
    if (eFila) {
      const hF = Math.max(8, eFila.b.y1 - eFila.b.y0);
      eFila.x1Abs = eEj ? eEj.b.x1 + 1.2 * Math.max(8, eEj.b.y1 - eEj.b.y0) : eFila.b.x0 + 60 * hF;
      // con el DNI apenas girado, el extremo derecho del renglón queda más arriba o más abajo: se toma el alto de las dos etiquetas
      if (eEj) eFila.yAbs = [Math.min(eFila.b.y1, eEj.b.y1) + 0.15 * hF, Math.max(eFila.b.y1, eEj.b.y1) + 3.0 * hF];
    }
    return etiquetas;
  }

  // ===== Lectura NATIVA (solo en la APK): el reconocimiento de texto de Google (ML Kit) corre en el celular y lee una
  // tarjeta en una fracción de segundo; Tesseract en el navegador tarda varios. Si no está (navegador / PWA) o falla, se usa Tesseract. =====
  const pendientesNativo = {};
  if (typeof window !== 'undefined') window.__ocrNativo = (id, json) => { const f = pendientesNativo[id]; if (f) { delete pendientesNativo[id]; f(json); } };
  function ocrNativoDisponible() {
    try { return typeof window !== 'undefined' && !!window.AndroidOCR && typeof window.AndroidOCR.leer === 'function' && !window.__sinOCRNativo; } catch (e) { return false; }
  }
  function ocrNativo(canvas, timeoutMs) {
    return new Promise((resolve) => {
      const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const t = setTimeout(() => { delete pendientesNativo[id]; resolve(null); }, timeoutMs || 8000);
      pendientesNativo[id] = (json) => {
        clearTimeout(t);
        try { const o = JSON.parse(json); resolve(o && Array.isArray(o.words) ? o : null); } catch (e) { resolve(null); }
      };
      try { window.AndroidOCR.leer(id, canvas.toDataURL('image/jpeg', 0.9).split(',')[1]); }
      catch (e) { clearTimeout(t); delete pendientesNativo[id]; resolve(null); }
    });
  }
  // Texto de las palabras cuyo centro cae dentro del rectángulo, ordenado por renglones
  // Inclinación de los renglones (pendiente dy/dx), medida entre palabras vecinas del mismo renglón (mediana)
  function inclinacionPalabras(palabras) {
    const ps = palabras.filter((p) => p.b && p.b.x1 > p.b.x0 && p.b.y1 > p.b.y0);
    const pend = [];
    ps.forEach((p) => {
      const h = p.b.y1 - p.b.y0, cy = (p.b.y0 + p.b.y1) / 2;
      let mejor = null;
      ps.forEach((q) => {
        if (q === p) return;
        const hq = q.b.y1 - q.b.y0, gap = q.b.x0 - p.b.x1;
        if (gap < -0.3 * h || gap > 2.5 * h || Math.abs(hq - h) > 0.4 * h) return;
        if (Math.abs((q.b.y0 + q.b.y1) / 2 - cy) > 0.45 * h) return;
        if (!mejor || q.b.x0 < mejor.b.x0) mejor = q;
      });
      if (mejor) { const dx = (mejor.b.x0 + mejor.b.x1 - p.b.x0 - p.b.x1) / 2; if (dx > h) pend.push(((mejor.b.y0 + mejor.b.y1) / 2 - cy) / dx); }
    });
    if (pend.length < 3) return 0;
    pend.sort((a, b) => a - b);
    const m = pend[pend.length >> 1];
    return Math.abs(m) > 0.15 ? 0 : m;
  }
  function textoEnRect(palabras, x0, y0, x1, y1) {
    const dentro0 = palabras.filter((p) => {
      if (!p.b) return false;
      const cx = (p.b.x0 + p.b.x1) / 2, cy = (p.b.y0 + p.b.y1) / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    });
    // con el DNI inclinado, el final de un renglón queda a la altura del principio del siguiente: se endereza
    // (alto corregido = alto - pendiente · x) antes de agrupar, y el umbral es más estricto
    const k = inclinacionPalabras(dentro0);
    // un recuadro anormalmente alto (agarró dos renglones) se ubica por su borde de abajo, con el alto típico
    const altos = dentro0.map((p) => p.b.y1 - p.b.y0).sort((a, b) => a - b), hMed = altos.length ? altos[altos.length >> 1] : 0;
    const alto = (p) => { const h = p.b.y1 - p.b.y0; return hMed && h > 1.45 * hMed ? hMed : h; };
    const yc = (p) => (alto(p) === p.b.y1 - p.b.y0 ? (p.b.y0 + p.b.y1) / 2 : p.b.y1 - hMed / 2) - k * ((p.b.x0 + p.b.x1) / 2 - x0);
    const dentro = dentro0.sort((a, b) => yc(a) - yc(b));
    const lineas = [];
    dentro.forEach((p) => {
      const cy = yc(p), h = alto(p);
      const l = lineas.find((q) => Math.abs(q.cy - cy) < 0.5 * Math.min(Math.max(h, q.h), 1.6 * Math.min(h, q.h)));
      if (l) { l.ps.push(p); l.cy = (l.cy * (l.ps.length - 1) + cy) / l.ps.length; l.h = Math.max(l.h, h); }
      else lineas.push({ cy, h, ps: [p] });
    });
    return lineas.map((l) => l.ps.sort((a, b) => a.b.x0 - b.b.x0).map((p) => p.t).join(' ')).join('\n');
  }
  async function leerFrenteNativo(fuente, onProgress) {
    const origen = await aElemento(fuente);
    const ow = origen.naturalWidth || origen.width, oh = origen.naturalHeight || origen.height;
    const k = Math.min(1, 1800 / ow);   // 1800 px de ancho alcanzan para la letra de la tarjeta
    const c = document.createElement('canvas'); c.width = Math.round(ow * k); c.height = Math.round(oh * k);
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(origen, 0, 0, c.width, c.height);
    if (onProgress) onProgress(0.15);
    const t0 = performance.now();
    const nat = await ocrNativo(c);
    if (!nat || !nat.words.length) return null;
    log('⚡ lectura nativa ' + Math.round(performance.now() - t0) + ' ms · ' + nat.words.length + ' palabras');
    if (onProgress) onProgress(0.85);
    const sx = nat.w ? c.width / nat.w : 1;
    const palabras = nat.words.map((w) => ({ t: String(w.t), b: { x0: w.x0 * sx, y0: w.y0 * sx, x1: w.x1 * sx, y1: w.y1 * sx } }));
    const textos = [];
    textos.nombres = { apellido: [], nombre: [] };
    textos.zonas = { nac: [], emi: [], ven: [], doc: [], tramite: [], ejemplar: [], fila: [], ejcombo: [] };
    textos.nativo = true;
    textos.push(nat.text || palabras.map((p) => p.t).join(' '));
    if (/[I1][D0O]ARG|<<<</.test(String(textos[0]).toUpperCase().replace(/\s/g, ''))) { textos.esReverso = true; return textos; }
    // zonas debajo de cada etiqueta (misma geometría que con Tesseract), pero con el texto que ya leyó el motor nativo
    const etiquetas = armarEtiquetas(palabras);
    etiquetas.forEach((e) => {
      const h = Math.max(8, e.b.y1 - e.b.y0);
      const x0 = Math.max(0, Math.round(e.b.x0 - e.izq * h)), x1 = Math.min(c.width, Math.round(e.x1Abs || (x0 + e.ancho * h)));
      const y0 = Math.max(0, Math.round(e.yAbs ? e.yAbs[0] : e.b.y1 + (e.k === 'ejemplar' || e.k === 'fila' ? 0.15 : 0.1) * h)),
        y1 = Math.min(c.height, Math.round(e.yAbs ? e.yAbs[1] : e.b.y1 + (e.alto || 2.4) * h));
      if (x1 - x0 < 20 || y1 - y0 < 8) return;
      const destino = textos.nombres[e.k] || textos.zonas[e.k];
      const t = textoEnRect(palabras, x0, y0, x1, y1);
      if (t) { destino.push(t); log('⚡ zona ' + e.k + ': ' + t.replace(/\n/g, ' | ')); }
    });
    if (onProgress) onProgress(1);
    return textos;
  }

  // FRENTE del DNI (viejo y nuevo). 1) texto disperso de la imagen completa + posición de las etiquetas;
  // 2) se relee AMPLIADA la línea que está debajo de "Apellido" y de "Nombre" (ahí falla más el OCR);
  // 3) una pasada más de párrafo. Corta apenas tiene todo. Devuelve los textos (+ .nombres) para votar.
  // Un solo motor de OCR: las lecturas se hacen de a una (en cola). Si dos lecturas se mezclaban, una le cambiaba
  // los parámetros a la otra a mitad de camino y las dos salían mal (frente automático + reverso al mismo tiempo).
  const ANCHO_GENERAL = 1500;   // ancho de la pasada general del frente (menos píxeles = más rápido; las etiquetas son grandes)
  let cola = Promise.resolve(), generacionFrente = 0;
  function enCola(fn) { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; }
  // Corta la lectura del frente en curso (por ej. porque apareció el QR del reverso): devuelve lo que tenga hasta ahí
  function cancelarFrente() { generacionFrente++; }
  // Corta YA la lectura del frente (aunque esté a mitad de una pasada): se apaga ese motor y se arranca otro.
  // Para el reverso es mucho más rápido que esperar que termine (en el celular, una pasada del frente tarda varios segundos).
  let frenteEnCurso = 0, cortarFrente = null;
  function abortarFrente() {
    generacionFrente++;
    if (!frenteEnCurso || !workerPromise || !cortarFrente) return false;
    const wp = workerPromise; workerPromise = null;
    cortarFrente(new Error('frente cortado'));   // libera la cola ya (la tarea vieja queda colgada en el motor apagado)
    wp.then((w) => w.terminate()).catch(() => {});
    initWorker().catch(() => {});   // el nuevo se va cargando ya
    return true;
  }

  async function leerFrente(fuente, onProgress, suficiente, opciones = {}) {
    frenteEnCurso++;
    const corte = new Promise((_, rej) => { cortarFrente = rej; });
    const tarea = leerFrenteInterno(fuente, onProgress, suficiente, opciones);
    tarea.catch(() => {});
    try { return await Promise.race([tarea, corte]); } finally { frenteEnCurso--; cortarFrente = null; }
  }
  async function leerFrenteInterno(fuente, onProgress, suficiente, opciones = {}) {
    const gen = generacionFrente;
    const cancelado = () => gen !== generacionFrente;
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    // APK: lectura nativa (ML Kit). Si no está o falla, sigue con Tesseract
    if (ocrNativoDisponible()) {
      try {
        const rn = await leerFrenteNativo(fuente, onProgress);
        if (rn && cancelado()) { rn.cancelado = true; return rn; }
        // si el motor nativo leyó todo (o es el reverso) se termina acá; si quedó algo sin leer, se sigue con Tesseract (más lento, pero revisa zona por zona)
        if (rn && (rn.esReverso || typeof suficiente !== 'function' || suficiente(rn))) return rn;
        // v47: con lo esencial (DNI, apellido, nombre y nacimiento) se usa la lectura nativa igual: lo que falte
        // (emisión / vencimiento) sale del reverso (QR y líneas <<<). Antes se rehacía TODO con Tesseract (varios segundos).
        if (rn && typeof FrenteDNI !== 'undefined') {
          const d = FrenteDNI.parsearVarios(rn);
          if (d && d.dni && d.apellido && d.nombre && d.fechaNacimiento) { log('⚡ nativo con lo esencial: se usa'); rn.parcial = true; return rn; }
        }
        if (rn) log('⚡ nativo incompleto: se sigue con Tesseract');
      } catch (e) { log('nativo: ' + e); }
    }
    const tI = performance.now(), dt = () => Math.round(performance.now() - tI) + 'ms';
    const w = await initWorker();
    log('⏱ motor listo ' + dt());
    const origen = await aElemento(fuente);
    const [gris, grisF] = await Promise.all([preprocesar(origen), preprocesar(origen, 'fondo')]);   // contraste estirado / luz normalizada
    log('⏱ imagen preparada ' + dt() + ' (' + gris.width + 'x' + gris.height + ')');
    const textos = [];
    textos.nombres = { apellido: [], nombre: [] };
    const listo = () => typeof suficiente === 'function' && suficiente(textos);
    const setPsm = (psm) => w.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1', tessedit_pageseg_mode: psm });

    // 1) imagen completa, texto disperso, con posiciones
    // 0) ¿es el REVERSO? Vistazo rápido (una fracción de la pasada completa) a la franja de abajo, donde van las líneas <<<:
    //    si se apuntó el reverso, se avisa ya en vez de leer toda la tarjeta como frente (ahorraba varios segundos)
    const relF = fuente && fuente.marcoRel;
    if (relF) {
      const H = relF[3] - relF[1];
      const b0 = recortarRel(origen, relF[0], Math.max(0, relF[1] + 0.66 * H), relF[2], Math.min(1, relF[1] + 1.02 * H), 1, 4000, 8);
      const kb = Math.min(1, 640 / b0.width), banda = document.createElement('canvas');   // (achicada: basta para ver los <<<)
      banda.width = Math.round(b0.width * kb); banda.height = Math.round(b0.height * kb);
      const bc = banda.getContext('2d'); bc.imageSmoothingQuality = 'high'; bc.drawImage(b0, 0, 0, banda.width, banda.height);
      await w.setParameters(PARAMS_MRZ);
      const tR = (await w.recognize(banda)).data.text || '';
      if (/[I1][D0O]ARG|<<<<|ARG<</.test(tR.toUpperCase().replace(/\s/g, ''))) {
        log('📄 vistazo: es el reverso\n' + tR);
        await w.setParameters(PARAMS_TEXTO); textos.push(tR); textos.esReverso = true; return textos;
      }
    }
    etapa(0, 0.3);
    await setPsm('11');
    // (a menor resolución: las etiquetas son grandes y la pasada tarda la mitad; los datos se releen ampliados más abajo)
    // (se probó leer solo la zona de los datos del DNI nuevo: con el DNI no justo en el marco salían peor las zonas
    //  y terminaba en más pasadas; se lee la tarjeta entera)
    const rec = null;
    // (misma escala que si se leyera la tarjeta entera a ANCHO_GENERAL: el tamaño de letra no cambia)
    const kDesc = Math.min(1, ANCHO_GENERAL / (rec ? (relF[2] - relF[0]) * grisF.width : grisF.width));
    let entradaDesc = grisF;
    if (kDesc < 0.97 || rec) {
      const sx = rec ? rec.x : 0, sy = rec ? rec.y : 0, sw = rec ? rec.w : grisF.width, sh = rec ? rec.h : grisF.height;
      entradaDesc = document.createElement('canvas');
      entradaDesc.width = Math.round(sw * kDesc); entradaDesc.height = Math.round(sh * kDesc);
      const dc = entradaDesc.getContext('2d'); dc.imageSmoothingQuality = 'high';
      dc.drawImage(grisF, sx, sy, sw, sh, 0, 0, entradaDesc.width, entradaDesc.height);
    }
    const r1 = await w.recognize(entradaDesc, {}, { text: true, blocks: true });
    log('⏱ pasada general ' + dt() + ' (' + entradaDesc.width + 'x' + entradaDesc.height + (rec ? ', solo la zona de datos' : '') + ')');
    textos.push(r1.data.text || '');
    log('📄 OCR frente (disperso):\n' + r1.data.text);
    if (cancelado()) { await w.setParameters(PARAMS_TEXTO); textos.cancelado = true; return textos; }
    // ¿Es el REVERSO (líneas IDARG / <<<)? No se sigue leyendo como frente: se avisa enseguida (ahorra varios segundos)
    if (/[I1][D0O]ARG|<<<</.test(String(r1.data.text || '').toUpperCase().replace(/\s/g, ''))) {
      await w.setParameters(PARAMS_TEXTO); textos.esReverso = true; return textos;
    }

    // 2) zonas debajo de las etiquetas: nombres, fechas, número y trámite, releídos ampliados
    textos.zonas = { nac: [], emi: [], ven: [], doc: [], tramite: [], ejemplar: [], fila: [] };
    const ox = rec ? rec.x : 0, oy = rec ? rec.y : 0;
    const palabrasF = palabrasDe(r1.data).map((p) => (p.b && (kDesc < 0.97 || rec))
      ? { t: p.t, b: { x0: p.b.x0 / kDesc + ox, y0: p.b.y0 / kDesc + oy, x1: p.b.x1 / kDesc + ox, y1: p.b.y1 / kDesc + oy } } : p);
    let etiquetas = armarEtiquetas(palabrasF);
    if (rec && new Set(etiquetas.map((e) => e.k)).size < 4 && !cancelado()) {
      log('⚠ con el recorte se vieron pocas etiquetas: se lee la tarjeta entera');
      const k2 = Math.min(1, ANCHO_GENERAL / grisF.width), ent = k2 < 0.97 ? escalarA(grisF, Math.round(grisF.width * k2)) : grisF;
      const r2 = await w.recognize(ent, {}, { text: true, blocks: true });
      textos.push(r2.data.text || '');
      palabrasF.length = 0;
      palabrasDe(r2.data).forEach((p) => palabrasF.push(p.b && k2 < 0.97 ? { t: p.t, b: { x0: p.b.x0 / k2, y0: p.b.y0 / k2, x1: p.b.x1 / k2, y1: p.b.y1 / k2 } } : p));
      etiquetas = armarEtiquetas(palabrasF);
    }
    if (etiquetas.length) {
      await setPsm('7');
      // nombres y ejemplar (una letra suelta que la pasada general casi nunca ve) siempre se releen
      const prio = (e) => (e.k === 'apellido' ? 0 : e.k === 'nombre' ? 1 : e.k === 'fila' ? 1.2 : e.k === 'ejemplar' ? 1.5 : 2);
      etiquetas.sort((a, b) => prio(a) - prio(b));
      const nNombres = etiquetas.filter((e) => prio(e) < 2).length;
      for (let i = 0; i < etiquetas.length; i++) {
        // con los nombres ya releídos y todo lo demás coherente, no hace falta seguir (escaneo más corto)
        if (i >= nNombres && i > 0 && listo()) { log('⏩ datos completos: se omiten las zonas restantes'); break; }
        if (cancelado()) break;
        etapa(0.3 + i * (0.2 / etiquetas.length), 0.3 + (i + 1) * (0.2 / etiquetas.length));
        const e = etiquetas[i], h = Math.max(8, e.b.y1 - e.b.y0);
        const x0 = Math.max(0, Math.round(e.b.x0 - e.izq * h));
        let x1 = Math.min(gris.width, Math.round(e.x1Abs || (x0 + e.ancho * h)));
        const esNombre = e.k === 'apellido' || e.k === 'nombre';
        // (apellido / nombre: el renglón empieza pegado a la etiqueta; con +0,1 se cortaba la parte de arriba de las letras)
        const y0 = Math.max(0, Math.round(e.yAbs ? e.yAbs[0] : e.b.y1 + (e.k === 'ejemplar' || e.k === 'fila' ? 0.15 : esNombre ? -0.2 : 0.1) * h)),
          y1 = Math.min(gris.height, Math.round(e.yAbs ? e.yAbs[1] : e.b.y1 + (e.alto || 2.4) * h));
        // apellido / nombre: la zona termina donde termina el texto (palabras de la pasada general en ese renglón) y no
        // agarra el holograma, la foto ni el mapa de la derecha, que el OCR confunde con letras
        if (esNombre && !e.x1Abs) {
          const enFila = palabrasF.filter((p) => p.b && (p.b.y0 + p.b.y1) / 2 > y0 && (p.b.y0 + p.b.y1) / 2 < y1 && p.b.x1 > x0 && p.b.x0 < x1 && /[A-ZÁÉÍÓÚÑ]{2,}/.test(p.t))
            .sort((a, b) => a.b.x0 - b.b.x0);
          let fin = null;
          for (const p of enFila) { if (fin === null ? p.b.x0 - x0 < 8 * h : p.b.x0 - fin < 3 * h) fin = Math.max(fin || 0, p.b.x1); }
          if (fin) x1 = Math.min(x1, Math.round(fin + 4 * h));
        }
        if (x1 - x0 < 20 || y1 - y0 < 8) continue;
        const esc = Math.max(1, Math.min(4, 48 / h));
        const recorte = (base) => {   // con borde blanco: Tesseract lee peor las letras pegadas al borde
          const z = document.createElement('canvas'), pad = 12;
          z.width = Math.round((x1 - x0) * esc) + 2 * pad; z.height = Math.round((y1 - y0) * esc) + 2 * pad;
          const zc = z.getContext('2d'); zc.fillStyle = '#fff'; zc.fillRect(0, 0, z.width, z.height); zc.imageSmoothingQuality = 'high';
          zc.drawImage(base, x0, y0, x1 - x0, y1 - y0, pad, pad, z.width - 2 * pad, z.height - 2 * pad);
          return z;
        };
        const destino = textos.nombres[e.k] || textos.zonas[e.k];
        const rcz = recorte(gris);
        if (e.k === 'ejemplar' || e.k === 'fila') await setPsm('6');   // renglón con algo del de arriba: se lee como bloque
        const { data: { text } } = await w.recognize(rcz);
        if (e.k === 'ejemplar' || e.k === 'fila') await setPsm('7');
        destino.push(text || '');
        log('📄 zona ' + e.k + ': ' + text);
        // fechas / números que no salieron legibles: otra vez con la luz normalizada
        // (apellido / nombre: si no salió una palabra de 3 letras o más, otra vez con la luz normalizada)
        const pareceDato = esNombre ? /[A-ZÁÉÍÓÚÑ]{3,}/.test(text || '') : e.k === 'ejemplar' || e.k === 'fila' ? true
          : (e.k === 'doc' ? /\d{2}[.\s]?\d{3}[.\s]?\d{3}/.test(text) : e.k === 'tramite' ? /\d{11}/.test(text) : /\d{1,2}\s*[.\/A-Z]{1,4}[^\n]*(19|20)\d{2}/i.test(text));
        if (!pareceDato) {
          const { data: { text: t2 } } = await w.recognize(recorte(grisF));
          destino.push(t2 || '');
          log('📄 zona ' + e.k + ' (luz normalizada): ' + t2);
        }
        // v57: el trámite (11 números) y el ejemplar (una letra) se releen con el OCR limitado a números / letras:
        // así no confunde un 3 con una B ni lee basura del fondo. Cada lectura suma un voto; gana la que más se repite.
        if (e.k === 'tramite' || e.k === 'ejemplar') {
          const soloNum = e.k === 'tramite';
          await w.setParameters({ tessedit_char_whitelist: soloNum ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', preserve_interword_spaces: '0', tessedit_pageseg_mode: soloNum ? '7' : '6' });
          for (const base of [gris, grisF]) {
            if (cancelado()) break;
            const { data: { text: t3 } } = await w.recognize(recorte(base));
            const v = String(t3 || '').replace(/\s+/g, soloNum ? '' : ' ').trim();
            if (soloNum) { const m = /(\d{11})/.exec(v); if (m) destino.push(m[1]); }
            else {
              // una letra sola en su renglón, o al final del renglón "ARGENTINA  C" (a veces sale doble: "CC")
              const ls = v.split(/\n/).map((x) => x.trim()).filter(Boolean), letras = [];
              ls.forEach((x) => { const tk = x.split(/\s+/), u = tk[tk.length - 1], m = /^([A-Z])\1?$/.exec(u);
                if (m && (tk.length === 1 || /GENTIN|RGENT|ARGEN|NTINA/.test(x))) letras.push(m[1]); });
              if (new Set(letras).size === 1) destino.push(letras[0]);
            }
            log('📄 zona ' + e.k + ' (solo ' + (soloNum ? 'números' : 'letras') + '): ' + v);
          }
          await setPsm('7');
        }
      }
    }

    // 2b) ejemplar: la letra sola casi nunca se lee, ni con el renglón (si el DNI está apenas girado). Se arma un renglón
    //     artificial "ARGENTINA  B" pegando la palabra ARGENTINA y el recorte de la letra: con contexto, el OCR la lee.
    textos.zonas.ejcombo = [];
    const eEj2 = etiquetas.find((x) => x.k === 'ejemplar');
    const pArg = palabrasF.find((p) => p.b && /ARGENTIN/.test(sinT(p.t)) && eEj2 && p.b.y0 > eEj2.b.y0 - 3 * (eEj2.b.y1 - eEj2.b.y0) && p.b.y0 < eEj2.b.y1 + 4 * (eEj2.b.y1 - eEj2.b.y0));
    if (eEj2 && pArg && !cancelado()) {
      const hE = Math.max(8, eEj2.b.y1 - eEj2.b.y0), hA = Math.max(8, pArg.b.y1 - pArg.b.y0);
      const wR = { x0: pArg.b.x0 - 0.3 * hA, y0: pArg.b.y0 - 0.3 * hA, x1: pArg.b.x1 + 0.3 * hA, y1: pArg.b.y1 + 0.3 * hA };
      const lR = { x0: eEj2.b.x0 - 0.6 * hE, y0: eEj2.b.y1 + 0.05 * hE, x1: eEj2.b.x0 + 2.6 * hE, y1: eEj2.b.y1 + 2.9 * hE };
      const alto = 64, pad = 16, gap = 40;
      const ka = alto / (wR.y1 - wR.y0), kl = (alto * 1.25) / (lR.y1 - lR.y0);
      const z = document.createElement('canvas');
      z.width = Math.round((wR.x1 - wR.x0) * ka + gap + (lR.x1 - lR.x0) * kl + 2 * pad); z.height = Math.round(alto * 1.25 + 2 * pad);
      const zc = z.getContext('2d'); zc.fillStyle = '#fff'; zc.fillRect(0, 0, z.width, z.height); zc.imageSmoothingQuality = 'high';
      zc.drawImage(gris, wR.x0, wR.y0, wR.x1 - wR.x0, wR.y1 - wR.y0, pad, pad + alto * 0.125, (wR.x1 - wR.x0) * ka, alto);
      zc.drawImage(gris, lR.x0, lR.y0, lR.x1 - lR.x0, lR.y1 - lR.y0, pad + (wR.x1 - wR.x0) * ka + gap, pad, (lR.x1 - lR.x0) * kl, alto * 1.25);
      await setPsm('7');
      const { data: { text } } = await w.recognize(z);
      textos.zonas.ejcombo.push(text || '');
      log('📄 zona ejemplar (renglón armado): ' + text);
    }

    // 2c) v57: el número de trámite (11 cifras) se relee en el lugar exacto donde la pasada general vio un número largo,
    //     con el OCR limitado a números y con dos tratamientos de imagen (aunque no se haya visto la etiqueta "Trámite")
    if (!cancelado()) {
      const largos = palabrasF.filter((p) => p.b && /^[\dOQDIl|]{9,13}$/.test(String(p.t).replace(/[^\dOQDIl|]/g, '')) && (String(p.t).match(/\d/g) || []).length >= 8);
      if (largos.length) {
        await w.setParameters({ tessedit_char_whitelist: '0123456789', preserve_interword_spaces: '0', tessedit_pageseg_mode: '7' });
        for (const p of largos.slice(0, 2)) {
          const h = Math.max(8, p.b.y1 - p.b.y0), x0 = Math.max(0, p.b.x0 - 0.8 * h), x1 = Math.min(gris.width, p.b.x1 + 0.8 * h);
          const y0 = Math.max(0, p.b.y0 - 0.35 * h), y1 = Math.min(gris.height, p.b.y1 + 0.35 * h), esc = Math.max(1, Math.min(4, 48 / h));
          for (const base of [gris, grisF]) {
            const z = document.createElement('canvas'), pad = 14;
            z.width = Math.round((x1 - x0) * esc) + 2 * pad; z.height = Math.round((y1 - y0) * esc) + 2 * pad;
            const zc = z.getContext('2d'); zc.fillStyle = '#fff'; zc.fillRect(0, 0, z.width, z.height); zc.imageSmoothingQuality = 'high';
            zc.drawImage(base, x0, y0, x1 - x0, y1 - y0, pad, pad, z.width - 2 * pad, z.height - 2 * pad);
            const t = String((await w.recognize(z)).data.text || '').replace(/\s+/g, '');
            const m = /(\d{11})/.exec(t); if (m) textos.zonas.tramite.push(m[1]);
            log('📄 número largo (solo números): ' + t);
          }
        }
        await setPsm('6');
      }
    }

    // 3) más pasadas de la imagen completa, solo mientras falte algo
    const extra = [[gris, '6', 'párrafo'], [grisF, '6', 'párrafo, luz normalizada'], [gris, '11', 'disperso']];
    for (let i = 0; i < extra.length && !listo() && !cancelado(); i++) {
      etapa(0.5 + i * 0.16, 0.66 + i * 0.16);
      await setPsm(extra[i][1]);
      const { data: { text } } = await w.recognize(extra[i][0]);
      textos.push(text || '');
      log('📄 OCR frente (' + extra[i][2] + '):\n' + text);
    }
    await w.setParameters(PARAMS_TEXTO);
    if (progresoCb) progresoCb(1);
    if (cancelado()) textos.cancelado = true;
    return textos;
  }

  async function liberar() {
    if (!workerPromise) return;
    const p = workerPromise;
    workerPromise = null;
    try { const w = await p; await w.terminate(); } catch (e) { /* nada */ }
  }

  // ============================================
  // IMAGEN: agrandar, gris y estirar contraste
  // ============================================
  function aElemento(fuente) {
    if (typeof fuente !== 'string') return Promise.resolve(fuente);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      im.src = fuente;
    });
  }

  // Gris + (opcional) luz normalizada + contraste estirado, sobre los píxeles RGBA (se modifican en el lugar).
  // Es la parte pesada: corre en un hilo aparte (Web Worker) para no trabar la cámara; esta misma función se usa
  // dentro del worker y, si no hay workers, acá.
  function procesarPixeles(d, w, h, modo) {
    const n = w * h, g = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) | 0; g[i] = v; hist[v]++; }
    // Modo "fondo": divide cada píxel por el brillo del fondo de su zona (promedio de bloques, interpolado).
    // Saca sombras, reflejos suaves y el fondo de color del documento: el texto queda negro sobre blanco.
    if (modo === 'fondo') {
      const sw = Math.max(8, Math.round(w / 24)), sh = Math.max(8, Math.round(h * sw / w));
      const suma = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
      for (let y = 0; y < h; y++) {
        const by = Math.min(sh - 1, (y * sh / h) | 0), fila = by * sw, o = y * w;
        for (let x = 0; x < w; x++) { const k = fila + Math.min(sw - 1, (x * sw / w) | 0); suma[k] += g[o + x]; cnt[k]++; }
      }
      for (let k = 0; k < suma.length; k++) suma[k] = cnt[k] ? suma[k] / cnt[k] : 255;
      hist.fill(0);
      for (let y = 0; y < h; y++) {
        let fy = (y + 0.5) * sh / h - 0.5; if (fy < 0) fy = 0; if (fy > sh - 1) fy = sh - 1;
        const y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0, o = y * w;
        for (let x = 0; x < w; x++) {
          let fx = (x + 0.5) * sw / w - 0.5; if (fx < 0) fx = 0; if (fx > sw - 1) fx = sw - 1;
          const x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
          const a = suma[y0 * sw + x0] * (1 - tx) + suma[y0 * sw + x1] * tx, b = suma[y1 * sw + x0] * (1 - tx) + suma[y1 * sw + x1] * tx;
          const bg = a * (1 - ty) + b * ty;
          const v = Math.min(255, (g[o + x] / Math.max(1, bg)) * 200) | 0;
          g[o + x] = v; hist[v]++;
        }
      }
    }
    // Estirar contraste entre los percentiles 1 % y 99 % (se adapta a la luz de cada foto)
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
    if (hi - lo < 30) { lo = 0; hi = 255; } // imagen casi plana: no estirar
    const k = 255 / (hi - lo);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = Math.max(0, Math.min(255, (g[i] - lo) * k)); d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
  }

  let hiloImagen = null, hiloSeq = 0;
  const hiloPend = new Map();
  function hiloDeImagen() {
    if (hiloImagen !== null) return hiloImagen;
    try {
      const src = 'const procesarPixeles = ' + procesarPixeles.toString() + ';\n' +
        'self.onmessage = (e) => { const { id, w, h, buf, modo } = e.data; const d = new Uint8ClampedArray(buf); procesarPixeles(d, w, h, modo); self.postMessage({ id, buf: d.buffer }, [d.buffer]); };';
      hiloImagen = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      hiloImagen.onmessage = (e) => { const fn = hiloPend.get(e.data.id); if (fn) { hiloPend.delete(e.data.id); fn(e.data.buf); } };
      hiloImagen.onerror = () => { hiloPend.forEach((fn) => fn(null)); hiloPend.clear(); try { hiloImagen.terminate(); } catch (e) {} hiloImagen = false; };
    } catch (e) { hiloImagen = false; }
    return hiloImagen;
  }

  async function procesarEnHilo(imgData, modo) {
    const h = hiloDeImagen();
    if (h) {
      const id = ++hiloSeq;
      const copia = new Uint8ClampedArray(imgData.data);   // si el hilo falla, queda el original para hacerlo acá
      const buf = await new Promise((res) => {
        hiloPend.set(id, res);
        try { h.postMessage({ id, w: imgData.width, h: imgData.height, buf: copia.buffer, modo }, [copia.buffer]); }
        catch (e) { hiloPend.delete(id); res(null); }
      });
      if (buf) { imgData.data.set(new Uint8ClampedArray(buf)); return; }
    }
    procesarPixeles(imgData.data, imgData.width, imgData.height, modo);
  }

  async function preprocesar(el, modo) {
    const w0 = el.videoWidth || el.naturalWidth || el.width;
    const h0 = el.videoHeight || el.naturalHeight || el.height;
    const escala = w0 < ANCHO_MIN ? Math.min(ANCHO_MIN / w0, 3) : (w0 > ANCHO_MAX ? ANCHO_MAX / w0 : 1);
    const w = Math.round(w0 * escala);
    const h = Math.round(h0 * escala);

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    await procesarEnHilo(imgData, modo);
    ctx.putImageData(imgData, 0, 0);
    return c;
  }

  function rotar(el, ang) {
    const w0 = el.videoWidth || el.naturalWidth || el.width, h0 = el.videoHeight || el.naturalHeight || el.height;
    const c = document.createElement('canvas'); c.width = h0; c.height = w0;
    const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(ang * Math.PI / 180); x.drawImage(el, -w0 / 2, -h0 / 2);
    return c;
  }
  function escalarA(el, ancho) {
    const k = Math.min(1, ancho / el.width), c = document.createElement('canvas');
    c.width = Math.round(el.width * k); c.height = Math.round(el.height * k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(el, 0, 0, c.width, c.height);
    return c;
  }

  // Recorte relativo (fracciones de la imagen) y ampliado, para releer letra chica
  function recortarRel(c, x0, y0, x1, y1, esc, anchoMax = 2400, pad = 16) {
    const sx = Math.max(0, Math.round(c.width * x0)), sy = Math.max(0, Math.round(c.height * y0));
    const sw = Math.min(c.width - sx, Math.round(c.width * (x1 - x0))), sh = Math.min(c.height - sy, Math.round(c.height * (y1 - y0)));
    const e = Math.max(1, Math.min(esc, anchoMax / Math.max(1, sw)));
    const r = document.createElement('canvas');
    r.width = Math.round(sw * e) + 2 * pad; r.height = Math.round(sh * e) + 2 * pad;
    const x = r.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, sx, sy, sw, sh, pad, pad, r.width - 2 * pad, r.height - 2 * pad);
    return r;
  }

  function recortarInferior(c, fraccion) {
    const h = Math.round(c.height * fraccion);
    const r = document.createElement('canvas');
    r.width = c.width;
    r.height = h;
    r.getContext('2d').drawImage(c, 0, c.height - h, c.width, h, 0, 0, c.width, h);
    return r;
  }

  function recortarSuperior(c, fraccion) {
    const h = Math.round(c.height * fraccion);
    const r = document.createElement('canvas');
    r.width = c.width;
    r.height = h;
    r.getContext('2d').drawImage(c, 0, 0, c.width, h, 0, 0, c.width, h);
    return r;
  }

  // Umbral local (media en ventana, con imagen integral): separa tinta fina y clara
  // de un fondo con dibujos. gris = Uint8ClampedArray de 1 canal; devuelve 0/255.
  function umbralLocal(gris, w, h, radio, k) {
    const ancho = w + 1;
    const integral = new Float64Array(ancho * (h + 1));
    for (let y = 0; y < h; y++) {
      let fila = 0;
      for (let x = 0; x < w; x++) {
        fila += gris[y * w + x];
        integral[(y + 1) * ancho + (x + 1)] = integral[y * ancho + (x + 1)] + fila;
      }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radio), y1 = Math.min(h, y + radio + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radio), x1 = Math.min(w, x + radio + 1);
        const area = (x1 - x0) * (y1 - y0);
        const suma = integral[y1 * ancho + x1] - integral[y0 * ancho + x1]
                   - integral[y1 * ancho + x0] + integral[y0 * ancho + x0];
        out[y * w + x] = gris[y * w + x] < (suma / area) * k ? 0 : 255;
      }
    }
    return out;
  }

  function binarizarCanvas(c) {
    const w = c.width, h = c.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const gris = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) gris[p] = d[i];
    const bin = umbralLocal(gris, w, h, Math.max(15, Math.round(w / 60)), 0.85);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) d[i] = d[i + 1] = d[i + 2] = bin[p];
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ============================================
  // TEXTO: etiquetas tolerantes a errores de OCR
  // ============================================
  // Cada letra acepta sus confusiones típicas (O/0, I/1/L, A/4, E/3, S/5, B/8, G/6, Z/2) y acentos.
  const CLASES = {
    A: '[A4ÁÀ]', E: '[E3ÉÈ]', I: '[I1LÍÌ]', L: '[L1I]', O: '[O0ÓÒ]',
    U: '[UÚÜ]', S: '[S5]', B: '[B8]', G: '[G6]', Z: '[Z2]'
  };
  const tol = (palabras) =>
    palabras.split(' ').map(p => [...p].map(ch => CLASES[ch] || ch).join('')).join('\\s*');
  const unir = (lista) => lista.map(x => tol(x)).join('|');

  const L_DOMICILIO = tol('DOMICILIO');
  const L_LUGAR_NAC = tol('LUGAR DE NACIMIENTO');
  const L_CUIL = tol('CUIL');

  // Palabras donde corta cada campo (la siguiente etiqueta o el inicio de la MRZ)
  const STOPS_DOMICILIO = unir(['LUGAR', 'NACIMIENTO', 'TRAMITE', 'EJEMPLAR', 'CUIL', 'FECHA', 'NACIONALIDAD', 'IDARG']);
  const STOPS_LUGAR = unir(['DOMICILIO', 'TRAMITE', 'EJEMPLAR', 'CUIL', 'FECHA', 'NACIONALIDAD', 'IDARG']);

  function normalizar(texto) {
    return (texto || '')
      .toUpperCase()
      .replace(/[|_=~`]+/g, ' ')
      .replace(/\s+/g, ' ')   // colapsa saltos de línea: así el valor puede ocupar varias líneas
      .trim();
  }

  function limpiarValor(v) {
    return v
      .replace(/^(?:ADDRESS|PLACE OF BIRTH)\b[\s:./-]*/i, '') // etiqueta bilingüe
      .replace(/\s+/g, ' ')
      .replace(/^[\s:./-]+|[\s:.,/-]+$/g, '')
      .trim();
  }

  function valorValido(v) {
    if (!v || v.length < 4 || v.length > 150 || v.includes('<')) return false;
    return (v.match(/[A-ZÁÉÍÓÚÑ0-9]/gi) || []).length >= 3;
  }

  // Se copia tal como figura en el DNI: en mayúsculas
  function titulo(s) {
    return String(s).toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function extraerCampo(texto, etiqueta, stops) {
    const t = normalizar(texto);
    const re = new RegExp(`${etiqueta}[:\\s./-]*(.*?)(?=\\s(?:${stops})|<|$)`, 'i');
    const m = re.exec(t);
    if (!m) return null;
    const v = limpiarValor(m[1]);
    return valorValido(v) ? titulo(v) : null;
  }

  function extraerDomicilio(texto) {
    return extraerCampo(texto, L_DOMICILIO, STOPS_DOMICILIO);
  }

  function extraerLugarNacimiento(texto) {
    return extraerCampo(texto, L_LUGAR_NAC, STOPS_LUGAR);
  }

  // Distancia de edición (para reconocer etiquetas mal leídas: "Dormer." ~ "DOMICILIO")
  function parecido(a, b) {
    a = a.toUpperCase().replace(/[^A-Z]/g, ''); b = b.toUpperCase().replace(/[^A-Z]/g, '');
    if (!a || !b) return 0;
    const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return 1 - prev[n] / Math.max(m, n);
  }
  const lineasDe = (t) => String(t || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const esLineaEtiqueta = (l, palabras) => l.split(/[\s:./]+/).some((w) => w.length >= 4 && palabras.some((p) => parecido(w, p) >= 0.55));
  // Símbolos que el OCR confunde: "B*" / "Bº" / "B'" -> "B°" (barrio), "N*" -> "N°", "V*" -> "Vª"
  function arreglarSimbolos(v) {
    if (!v) return v;
    let s = String(v).toUpperCase();
    s = s.replace(/^.*?\bDOMICILIO\b\s*[:.;]?\s*/, '');                         // etiqueta (o basura antes de ella)
    { const t0 = s.split(' ')[0] || '', l0 = t0.replace(/[^A-Z]/g, '');                 // etiqueta mal leída: "DOMO", "MICI", "DOMACIO"
      if (l0.length >= 4 && l0.length <= 9 && parecido(l0, 'DOMICILIO') >= 0.4 && !/^(DOMINGO|DOMINICANA|DOMINGUEZ)$/.test(l0) && s.split(' ').length > 2) s = s.slice(t0.length).trim(); }
    // si se coló el renglón siguiente ("LUGAR DE NACIMIENTO: ..."), se corta ahí (aunque esté mal leído: "HIGADR NE NACIMIENTA")
    { const t = s.split(' '), i = t.findIndex((w, k) => k >= 3 && w.length >= 6 && parecido(w, 'NACIMIENTO') >= 0.6);
      if (i >= 0) s = t.slice(0, Math.max(1, i - 2)).join(' '); }
    { const t = s.split(' '), i = t.findIndex((w, k) => k >= 3 && w.replace(/\W/g, '').length >= 5 && parecido(w, 'LUGAR') >= 0.6);
      if (i >= 0) s = t.slice(0, i).join(' '); }
    { const t = s.split(' ');   // cola de ruido: "SALTA LS, -"
      while (t.length > 3 && (/^[^A-Z0-9ÁÉÍÓÚÑ]*$/.test(t[t.length - 1]) || (/^[A-Z]{1,2}[,.;:]?$/.test(t[t.length - 1]) && !VOCAB_DIR.has(t[t.length - 1].replace(/\W/g, ''))))) t.pop();
      s = t.join(' '); }
    s = s.replace(/^A[VY][,.;:]?\s+(?=[A-Z0-9])/, 'AV. ');                          // "AY," / "AV," -> "AV."
    s = s.replace(/([A-Z0-9])\s?[.,]\s?B[:;*º°'"´`.”“’‘]?\s(?=[A-Z]{3})/g, '$1 - B° ');  // "DPTO B .B: TRES" -> "DPTO B - B° TRES"
    s = s.replace(/(\d)\s?-\s?8\s(?=[A-Z]{3})/g, '$1 - B° ');                      // "7-8 JUAN" -> "7 - B° JUAN"
    s = s.replace(/(\d)\s?[.,]\s?8\s?(?:-\s?)?(?=[A-Z]{3})/g, '$1 - B° ');          // "245. 8 - SAN", "245. 8- SAN", "7. 8 JUAN"
    s = s.replace(/\s-\s?8\s(?=[A-Z]{2,}\s)/g, ' - B° ');                              // "DPTO B - 8 TRES", "455 -8 EL"
    s = s.replace(/\bB\s?[*º°'"´`:;”“’‘](?=\s|[A-Z])/g, 'B° ');                         // "B*", "Bº", "B:" -> "B°"
    s = s.replace(/(^|\s-\s)B\s(?=[A-Z]{3}|[A-Z]{2}\s)/g, '$1B° ');                // "- B JUAN", "- B EL TRIBUNO" -> "B°"
    s = s.replace(/\bB8[*°º"”']?(?=\s)/g, 'B°').replace(/(\d\s)8[*"”](?=\s[A-Z])/g, '$1B°');   // "B8*", "401 8” CIUDAD"
    s = s.replace(/(\d{2,}\s)B\s(?=[A-Z]{3,}\s)/g, '$1B° ');                            // "401 B CIUDAD" (el ° no se leyó)
    s = s.replace(/(^|\s-\s)V\s(?=[A-Z]{3})/g, '$1Vª ');                              // "V BEBA" (Villa) -> "Vª BEBA"
    s = s.replace(/\bN\s?[*º°'"´`](?=\s|\d)/g, 'N° ').replace(/\bV\s?[*°º](?=\s|[A-Z])/g, 'Vª ');
    s = s.replace(/\b[TIOD0]?[OD0Q]PT[O0Q]\b/g, 'DPTO');                                  // "TOPTO", "OPTO", "D0PTO" -> "DPTO"
    s = s.replace(/\b(?:LI|IL|L1|1L|I1|1I)(?=\s*-|\s*$)/g, 'II');                     // "PABLO LI -" -> "PABLO II -"
    s = s.replace(/\bPA\s(?=BLO\b)/g, 'PA');                                         // "PA BLO" -> "PABLO"
    s = s.replace(/\b(PABLO)\s(?:MU|NU|LU|LL|LI|IL|L1|1L|I1|1I|11|UH|NI|IN|LT|TI|U|H|M|N|I|L)(?=\s*[-(]|\s*$)/g, '$1 II');   // "PABLO LL (ZONA" -> "PABLO II (ZONA"
    s = s.replace(/([A-Z0-9])\s?:\s?(?=[A-ZÁÉÍÓÚÑ]{3})/g, '$1 - ');                     // "NORT :SALTA" -> "NORT - SALTA"
    // "JUAN PABLO 11 -" -> "JUAN PABLO II -" (número romano después de un nombre, no después de CALLE, MZA, LOTE...)
    s = s.replace(/\b([A-ZÁÉÍÓÚÑ]{3,})\s(11|111)(?=\s*-|\s*$)/g, (m, w, n) => /^(CALLE|PASAJE|PJE|MZA|MANZANA|LOTE|CASA|PISO|DPTO|DEPTO|AV|AVDA|AVENIDA|RUTA|KM|BLOCK|TORRE|SECTOR|GRUPO|ETAPA|MONOBLOCK)$/.test(w) ? m : w + ' ' + n.replace(/1/g, 'I'));
    // basura antes del domicilio ("O AV. JUJUY", "RA. AV. BELGRANO"): pedazos de 1-2 letras que no son AV, B°, etc.
    s = s.replace(/^(?:(?!AV\b|B°|Vª|V\s[A-Z]{3}|PJE\b|DR\b|SN\b)[A-Z]{1,2}[.,:;]?\s)+(?=[A-Z0-9])/, '');
    s = s.replace(/^V\s(?=[A-Z]{3})/, 'Vª ');
    // resto de la etiqueta de 3-5 letras pegado antes de una palabra que siempre abre un domicilio ("ICI AV. JUJUY", "MECA AV.")
    s = s.replace(/^(?!AV\b|MZA\b|PJE\b|BV\b|DR\b)[A-Z]{3,5}[.,:;]?\s+(?=(?:AV\.?|AVENIDA|CALLE|MZA|MANZANA|PJE|PASAJE|BV|BOULEVARD|RUTA|B°)\s)/, '');
    // "JUAN PABLO L -" / "JUAN PABLO I -": el número romano II con una sola raya leída
    s = s.replace(/\bPABLO\s(?:L|I|1)(?=\s*-|\s*$)/g, 'PABLO II');
    s = s.replace(/\s[.,]\s(?=[A-Z]{3})/g, ' - ');                                  // "CARLOS . SALTA" -> "CARLOS - SALTA"
    s = s.replace(/(\s-)+\s-\s/g, ' - ').replace(/\s-\s(?!DE\b|LA\b|EL\b)[A-Z]{1,2}\s(?=[A-ZÁÉÍÓÚÑ]{4,}$)/, ' - ');   // "SALTA - - MO SALTA"
    s = s.replace(/\s*-\s*/g, ' - ').replace(/\s{2,}/g, ' ').replace(/^[\s\-.,:]+|[\s\-.,:]+$/g, '');
    return s;
  }
  // Provincias: se corrigen letras confundidas ("SALIA", "SAITA" -> SALTA) y se corta el ruido que queda después
  // de la provincia final ("SALTA MALA", "SALTA (A) DE NETA 1(M)").
  const PROVINCIAS = ['SALTA', 'JUJUY', 'TUCUMAN', 'CATAMARCA', 'CORDOBA', 'MENDOZA', 'MISIONES', 'CORRIENTES', 'FORMOSA', 'CHACO',
    'NEUQUEN', 'CHUBUT', 'RIOJA', 'SANTIAGO', 'ESTERO', 'ENTRE', 'RIOS', 'PAMPA', 'BUENOS', 'AIRES', 'SANTA', 'CRUZ', 'FE', 'LUIS', 'JUAN',
    'NEGRO', 'TIERRA', 'FUEGO', 'CABA'];
  const PROV_FINAL = /^(SALTA|JUJUY|TUCUMAN|CATAMARCA|CORDOBA|MENDOZA|MISIONES|CORRIENTES|FORMOSA|CHACO|NEUQUEN|CHUBUT|RIOJA|ESTERO|RIOS|PAMPA|AIRES|CRUZ|FE|LUIS|JUAN|NEGRO|FUEGO|CABA|FEDERAL|ARGENTINA)$/;
  function arreglarProvincias(v, esDomicilio) {
    if (!v) return v;
    const t = String(v).split(' ').map((w) => {
      const x = w.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
      if (x.length < 5 || PROVINCIAS.includes(x)) return w;
      const p = PROVINCIAS.find((q) => q.length === x.length && q.length >= 5 && parecido(x, q) >= 0.79);
      return p ? w.replace(x, p) : w;
    });
    // en el domicilio, solo la provincia del tramo final ("... - SALTA - SALTA"), no una calle "AV. SALTA"
    let ult = -1; t.forEach((w, i) => { if (PROV_FINAL.test(w.replace(/[^A-ZÁÉÍÓÚÑ]/g, '')) && (!esDomicilio || (t[i - 1] === '-' && i >= t.length * 0.5))) ult = i; });
    const resto = ult >= 0 ? t.slice(ult + 1) : [];
    if (ult >= 0 && resto.length && !resto.some((w) => /^[A-ZÁÉÍÓÚÑ]{4,}$/.test(w) && VOCAB_DIR.has(w))) t.splice(ult + 1);
    let out = t.join(' ').replace(/[\s,.\-]+$/, '');
    // "... SALTA CAPITAL SALTA": entre la localidad y la provincia final siempre va " - " (a veces no se lee el guion)
    if (esDomicilio) out = out.replace(/\b(CAPITAL)\s(?=(?:SALTA|JUJUY|TUCUMAN|CATAMARCA|CORDOBA|MENDOZA|FORMOSA|CHACO|CORRIENTES|MISIONES)$)/, '$1 - ');
    if (esDomicilio) out = out.replace(/\b([A-ZÁÉÍÓÚÑ]{4,})[.,]\s(?=[A-ZÁÉÍÓÚÑ]{4,}$)/, '$1 - ');   // "SALTA. SALTA" -> "SALTA - SALTA"
    return out;
  }
  function limpiarTextoDato(v) {
    return v.toUpperCase().replace(/\bV[*°º]/g, 'Vª').replace(/[^A-Z0-9ÁÉÍÓÚÜÑªº°.,\-/() ]/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s:.,\-/]+|[\s:.,\-/]+$/g, '').replace(/\s+([,.])/g, '$1').replace(/\s*-\s*/g, ' - ').trim();
  }
  // Domicilio: zona de 2 líneas arriba del reverso. La 1.ª empieza con la etiqueta (a veces mal leída): se saca.
  function domicilioDeZona(t) {
    const ls = String(t || '').split(/\r?\n/).map((l) => l.replace(/\s{3,}\S{1,2}\s*$/, '').replace(/^\s*\S{1,2}\s{3,}/, '')).join('\n');
    let lineas = lineasDe(ls);
    // se arranca en el renglón de la etiqueta "DOMICILIO" (aunque esté mal leída: "pomMicino:"); lo de arriba es
    // el borde de la foto (mesa, teclado, dedos). Sin etiqueta: se saltean los renglones de puro ruido del principio.
    const esEtiqueta = (w) => { const x = w.replace(/[^A-Za-z]/g, '').toUpperCase(); return x.length >= 4 && (parecido(x, 'DOMICILIO') >= 0.5 || 'DOMICILIO'.includes(x)); };
    const iEt = lineas.findIndex((l, i) => i < 4 && l.split(/\s+/).slice(0, 3).some(esEtiqueta));
    if (iEt > 0) lineas = lineas.slice(iEt);
    else if (iEt < 0) {
      const ruido = (l) => l.split(/\s+/).filter((w) => /^[A-ZÁÉÍÓÚÑ]{3,}[.,:]?$|^\d{1,5}[A-Z]?$/.test(w)).length < 2;
      while (lineas.length > 1 && ruido(lineas[0])) lineas.shift();
    }
    return domicilioDeLineas(lineas);
  }
  function domicilioDeLineas(lineas) {
    // el domicilio termina donde empieza "Lugar de nacimiento" (lo de abajo es el lugar, no un 2.º renglón del domicilio)
    const corte = lineas.findIndex((l, i) => i > 0 && esLineaEtiqueta(l, ['LUGAR', 'NACIMIENTO']));
    const ls = (corte > 0 ? lineas.slice(0, corte) : lineas).filter((l) => !esLineaEtiqueta(l, ['LUGAR', 'NACIMIENTO']));
    if (!ls.length) return null;
    let l1 = ls[0];
    const m = /^\W*([A-Za-zÁÉÍÓÚáéíóú]{3,12})[.:,]?\s+(.*)$/.exec(l1);
    if (m && (parecido(m[1], 'DOMICILIO') >= 0.4 || /[a-z]/.test(m[1]))) l1 = m[2];
    // pedazos de la etiqueta mal leída que quedaron adelante ("j ILIO;. MANZANA", "D0M ICILIO MANZANA")
    { const tk = l1.split(/\s+/).filter(Boolean); let k = 0;
      while (k < 3 && tk.length - k > 2) {
        const x = tk[k].replace(/[^A-Za-z]/g, '').toUpperCase();
        if (!x || (x.length <= 2 && !/^(AV|B|N|V)$/.test(x) && /[^A-Z0-9]|^[a-z]/.test(tk[k] + (x.length === 1 ? '!' : ''))) || (x.length >= 3 && (/[a-z]/.test(tk[k]) || 'DOMICILIO'.includes(x) || parecido(x, 'DOMICILIO') >= 0.5))) k++;
        else break;
      }
      if (k) l1 = tk.slice(k).join(' '); }
    // la 2.ª línea (si el domicilio no entra en una) solo si parece dirección y no ruido del fondo ("MIZI A - D CALLE FAL")
    const segunda = ls.slice(1, 2).filter((l) => {
      if ((l.match(/[A-Z]/g) || []).length < 4) return false;
      // (los signos pegados a una palabra no la hacen basura: "(ZONA NORT", ":SAETA" son palabras reales)
      const toks = l.toUpperCase().split(/[\s,.\-]+/).map((t) => t.replace(/^[(:;"'“”]+|[):;"'“”]+$/g, '')).filter(Boolean);
      const malos = toks.filter((t) => !VOCAB_DIR.has(t) && !/^\d{1,5}[A-Z]?$/.test(t) && !/^[A-ZÁÉÍÓÚÑ]{4,}$/.test(t)).length;
      return malos <= Math.floor(toks.length / 4) && puntajeDireccion(l) >= 2;
    });
    const partes = [l1].concat(segunda);
    const v = limpiarTextoDato(partes.join(' '));
    return (v.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length >= 6 ? titulo(v) : null;
  }
  function lugarDeZona(t) {
    for (const l of lineasDe(t)) {
      let l2 = l;
      if (esLineaEtiqueta(l, ['LUGAR', 'NACIMIENTO'])) {
        const m = /NAC[A-Z]*I?M[A-Z]*[\s:.\/]*(?:PLACE OF BIRTH)?[\s:.\/]*(.*)$/i.exec(l);
        l2 = m ? m[1] : '';
        if (!l2) continue;
      }
      // fuera la basura del principio: palabras con minúsculas, de 1-2 letras o sin letras ("fl. itl PROV. DE SALTA")
      const toks = l2.split(/\s+/).filter(Boolean);
      while (toks.length && (/[a-z]/.test(toks[0]) || !/[A-Z]/.test(toks[0]) || (toks[0].replace(/[^A-Z]/g, '').length <= 2 && !/^(DE|LA|EL)$/.test(toks[0])))) toks.shift();
      if (!toks.length || toks.some((w) => /[a-z]{2}/.test(w))) continue;
      const v = limpiarTextoDato(toks.join(' ')).replace(/^PROV[,.]?\s/, 'PROV. ');
      if ((v.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length >= 4) return titulo(v);
    }
    return null;
  }
  // "Lugar de nacimento" (etiqueta con errores) y en la línea siguiente el valor
  function lugarTrasEtiqueta(t) {
    const ls = lineasDe(t);
    for (let i = 0; i < ls.length; i++) {
      if (!esLineaEtiqueta(ls[i], ['LUGAR', 'NACIMIENTO'])) continue;
      const r = lugarDeZona(ls.slice(i, i + 2).join('\n'));
      if (r) return r;
    }
    return null;
  }
  // Qué tan "limpia" parece una dirección leída por OCR: palabras reales suman, basura resta
  const VOCAB_DIR = new Set(('DE LA EL LOS LAS DEL Y CALLE AV AVDA AVENIDA PJE PASAJE BARRIO Bº B° MANZANA MZA LOTE CASA DPTO DEPTO PISO ' +
    'BLOCK MONOBLOCK TORRE SECTOR GRUPO ETAPA SALTA CAPITAL PROV PROVINCIA ZONA NORTE SUR ESTE OESTE SAN SANTA VILLA Vª REP RUTA KM ' +
    'II III IV S/N SN FRONTERA ROSARIO GENERAL GRAL DOCTOR DR PRESIDENTE INGENIERO JUJUY TUCUMAN CORDOBA BUENOS AIRES ORAN TARTAGAL METAN CERRILLOS').split(' '));
  function puntajeDireccion(v) {
    const toks = String(v || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    let p = 0;
    toks.forEach((t) => {
      const w = t.replace(/[.\-()]/g, '');
      if (!w) return;
      if (VOCAB_DIR.has(w)) p += 3;
      else if (/^\d{1,5}[A-Z]?$/.test(w)) p += 1;                 // número de casa / manzana
      else if (/^[A-ZÁÉÍÓÚÑ]{3,}$/.test(w)) p += 1;
      else p -= 2;                                                  // "QP", "IF", "Dt", mezclas raras
      if (/^[A-ZÁÉÍÓÚÑ]{1,2}$/.test(w) && !VOCAB_DIR.has(w)) p -= 1;
    });
    return p;
  }

  function tramiteDeTexto(t) {
    const T = String(t || '').toUpperCase();
    const i = T.search(/TR[AÁ](?:M|RN|NN|N)[I1L]?TE|RAMITE|TRAMIT/);
    if (i < 0) return null;
    // el primer número de 9 a 11 cifras después de la etiqueta, que no sea el CUIL (en el DNI nuevo van uno al lado del otro)
    for (const m of T.slice(i, i + 120).replace(/(\d)[OQD]|[OQD](\d)/g, (x) => x.replace(/[OQD]/, '0')).matchAll(/(?<!\d)(\d{9,11})(?!\d)/g)) {
      if (m[1].length === 11 && cuilValido(m[1])) continue;
      if (/^(20|23|24|27)\d{9}$/.test(m[1])) continue;
      return m[1];
    }
    return null;
  }

  // ============================================
  // CUIL: se valida prefijo + dígito verificador (y se cruza con el DNI si lo tenemos)
  // ============================================
  const PREFIJOS_CUIL = ['20', '23', '24', '27', '30', '33', '34'];
  const PESOS_CUIL = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

  function cuilValido(c) {
    const d = String(c).replace(/\D/g, '');
    if (d.length !== 11 || !PREFIJOS_CUIL.includes(d.slice(0, 2))) return false;
    const suma = PESOS_CUIL.reduce((a, p, i) => a + p * Number(d[i]), 0);
    let v = 11 - (suma % 11);
    if (v === 11) v = 0;
    return v === Number(d[10]); // v === 10 nunca coincide: ese caso lo resuelve el prefijo 23
  }

  const A_DIGITO_CUIL = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8', G: '6' };

  function extraerCUIL(texto, contexto = {}) {
    if (!texto) return null;
    const dni = String(contexto.dni || '').replace(/\D/g, '');
    const dniPad = dni ? dni.padStart(8, '0') : '';
    const t = texto.toUpperCase();

    const buscar = (segmento, exigirDni) => {
      for (const m of segmento.matchAll(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/g)) {
        const c = `${m[1]}-${m[2]}-${m[3]}`;
        if (!cuilValido(c)) continue;
        if (exigirDni && dniPad && m[2] !== dniPad) continue;
        return c;
      }
      return null;
    };

    // Segmento justo después de la etiqueta "CUIL", con letras confundidas pasadas a dígitos
    // (el dígito verificador protege de falsos positivos)
    const i = t.search(new RegExp(L_CUIL, 'i'));
    const cercano = i >= 0
      ? t.slice(i, i + 40).replace(/[OQDIL|ZSBG]/g, ch => A_DIGITO_CUIL[ch] || ch)
      : '';

    if (contexto.estricto) return (cercano && buscar(cercano, true)) || buscar(t, true) || (!dniPad && cercano && buscar(cercano, false)) || null;

    // Personas: prefijos 20 (varón), 27 (mujer), 23/24 (casos especiales). 30/33/34 son de empresas: nunca en un DNI.
    const PERSONAS = contexto.sexo === 'F' ? ['27', '23', '24'] : contexto.sexo === 'M' ? ['20', '23', '24'] : ['20', '27', '23', '24'];
    const reparado = () => {   // "90-25122169-4": prefijo mal leído; se prueba con los prefijos de personas
      for (const seg of [cercano, t]) {
        if (!seg) continue;
        for (const m of seg.matchAll(/(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)(?!\d)/g)) {
          if (dniPad && m[2] !== dniPad) continue;
          for (const p of PERSONAS) { const c = `${p}-${m[2]}-${m[3]}`; if (cuilValido(c)) return c; }
        }
      }
      return null;
    };
    // último recurso: prefijo de persona y DNI coinciden con lo leído, pero el dígito final se leyó mal: se recalcula
    const recalculado = () => {
      if (!dniPad) return null;
      for (const seg of [cercano, t]) {
        if (!seg) continue;
        for (const m of seg.matchAll(/(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)?(?!\d)/g)) {
          if (m[2] !== dniPad || !['20', '23', '24', '27'].includes(m[1])) continue;
          for (let v = 0; v <= 9; v++) { const c = `${m[1]}-${m[2]}-${v}`; if (cuilValido(c)) return c; }
        }
      }
      return null;
    };
    // DNI conocido (QR / MRZ / código de barras) y prefijo de persona leído, pero algún número del medio mal leído:
    // con el DNI verificado el CUIL queda determinado (prefijo + DNI + dígito verificador)
    const conDNI = () => {
      if (!dniPad) return null;
      for (const seg of [cercano, t]) {
        if (!seg) continue;
        for (const m of seg.matchAll(/(\d{2})[-\s.]?(\d{8})[-\s.]?\d?(?!\d)/g)) {
          if (!['20', '23', '24', '27'].includes(m[1])) continue;
          let iguales = 0; for (let k = 0; k < 8; k++) if (m[2][k] === dniPad[k]) iguales++;
          if (iguales < 6) continue;
          for (let v = 0; v <= 9; v++) { const c = `${m[1]}-${dniPad}-${v}`; if (cuilValido(c)) return c; }
        }
      }
      return null;
    };
    return (cercano && buscar(cercano, true))
      || buscar(t, true)
      || (!dniPad && cercano && buscar(cercano, false))
      || reparado()
      || recalculado()
      || conDNI()
      || null;
  }

  // ============================================
  // MRZ (formato TD1, 3 líneas de 30): vencimiento y nacionalidad de la línea 2
  // Línea 2: nacimiento(6) ctrl(1) sexo(1) vencimiento(6) ctrl(1) nacionalidad(3) ...
  // ============================================
  const NACIONALIDADES = {
    ARG: 'ARGENTINA', CHL: 'CHILENA', URY: 'URUGUAYA', PRY: 'PARAGUAYA',
    PER: 'PERUANA', BOL: 'BOLIVIANA', COL: 'COLOMBIANA', ECU: 'ECUATORIANA',
    VEN: 'VENEZOLANA', BRA: 'BRASILEÑA'
  };

  const A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };
  const A_LETRA = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 8: 'B', 6: 'G' };
  const RE_MRZ = /(\d{6})([0-9<?])([MF<])(\d{2})(\d{2})(\d{2})([0-9<?])([A-Z]{3})/;

  // Dígito de control ICAO 9303: pesos 7-3-1, letras A=10..Z=35, '<'=0
  function digitoControl(s) {
    const pesos = [7, 3, 1];
    let suma = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const v = ch === '<' ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55;
      suma += v * pesos[i % 3];
    }
    return suma % 10;
  }

  // Repara un campo numérico de la MRZ usando su dígito de control: cada letra dudosa se prueba con los dígitos
  // que suele confundir el OCR ("L9" -> "69", "B" -> "8" o "6") y se queda con la variante cuyo control cierra.
  const OPCIONES_DIGITO = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '16', T: '17', J: '1', Z: '2', S: '5', B: '86', G: '6', E: '68', A: '4', H: '4' };
  function repararCampo(campo, dc) {
    const opciones = [...campo].map((ch) => /[0-9<]/.test(ch) ? [ch] : (OPCIONES_DIGITO[ch] || '').split(''));
    if (opciones.some((o) => !o.length)) return null;
    let combos = [''];
    for (const o of opciones) { combos = combos.flatMap((c) => o.map((x) => c + x)); if (combos.length > 512) return null; }
    if (!/\d/.test(dc)) return combos.length === 1 ? { valor: combos[0], ok: null } : null;
    const buenos = combos.filter((c) => String(digitoControl(c)) === dc);
    return buenos.length ? { valor: buenos[0], ok: true, unico: buenos.length === 1 } : { valor: combos[0], ok: false };
  }

  // Si la línea tiene el largo de una línea 2, corrige confusiones letra/dígito por posición
  function repararLinea2(l) {
    if (l.length < 28 || l.length > 32) return null;
    const a = [...l];
    for (let i = 0; i <= 14; i++) if (i !== 7) a[i] = A_DIGITO[a[i]] || a[i];
    for (let i = 15; i <= 17; i++) a[i] = A_LETRA[a[i]] || a[i];
    // dígito de control ilegible ("EARG", "bARG"): se marca con '?' y se valida con el resto de los datos
    if (!/[0-9<]/.test(a[6])) a[6] = '?';
    if (!/[0-9<]/.test(a[14])) a[14] = '?';
    return a.join('');
  }

  function leerLineaMRZ(l) {
    const m = RE_MRZ.exec(l);
    if (!m) return null;
    const [, nacim, dcNacim, , yy, mm, dd, dcVenc, pais] = m;
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    return {
      fechaVencimiento: `20${yy}-${mm}-${dd}`, // el vencimiento siempre es 20xx
      nacionalidad: NACIONALIDADES[pais] || pais,
      mrzVerificada:
        String(digitoControl(nacim)) === dcNacim &&
        String(digitoControl(yy + mm + dd)) === dcVenc
    };
  }

  function extraerDesdeMRZ(texto) {
    const vacio = { fechaVencimiento: null, nacionalidad: null, mrzVerificada: null };
    if (!texto) return vacio;

    const lineas = texto.toUpperCase().split(/[\r\n]+/)
      .map(l => l.replace(/[^A-Z0-9<]/g, ''))
      .filter(l => l.length >= 20);

    const hallazgos = [];
    for (const l of lineas) {
      for (const cand of [l, repararLinea2(l)]) {
        const h = cand && leerLineaMRZ(cand);
        if (h) hallazgos.push(h);
      }
    }
    // Preferimos el hallazgo cuyos dígitos de control cierran
    return hallazgos.find(h => h.mrzVerificada) || hallazgos[0] || vacio;
  }

  // ============================================
  // MRZ COMPLETA (ICAO 9303 TD1): sirve para el DNI nuevo, que no trae el PDF417 con los datos
  // Línea 1: I D ARG + nº documento(9) + control + opcional
  // Línea 2: nacimiento(6) ctrl sexo vencimiento(6) ctrl nacionalidad(3) opcional ... ctrl final
  // Línea 3: APELLIDO<<NOMBRES
  // ============================================
  const A_LETRA_NOMBRE = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 8: 'B', 6: 'G' };

  function anioCompleto(yy) { // si 20yy sería futuro, es 19yy
    return (yy > new Date().getFullYear() % 100 ? 1900 : 2000) + yy;
  }

    // apellido y nombres: votación entre todas las lecturas (la primera letra se pierde a veces: "NCHEZ" / "SANCHEZ")
  function votarNombresMRZ(ident, textosMRZ, nombresL3 = []) {
    if (ident) {
      // (el renglón leído solo vale doble: ahí no se pierde la primera letra)
      const cands = textosMRZ.concat(nombresL3.flatMap((t) => ['X\n' + t, 'X\n' + t])).map((t) => {
        const l = String(t || '').toUpperCase().split(/[\r\n]+/).map(espaciosANombre).map((x) => x.replace(/[^A-Z0-9<]/g, '')).find((x) => /^[A-Z<]{3,}<<[A-Z<]+$/.test(x.replace(/[0-9]/g, '')) && (x.match(/\d/g) || []).length <= 2 && !/^[I1][D0O]ARG/.test(x));
        if (!l || /ARG</.test(l)) return null;
        // (relleno '<' mal leído al final: "<<<<S"; sin comerse la última letra de un nombre como CARLOS o JOSE)
        const p = l.replace(/<<[<SKCE]*$/, '').replace(/<+$/, '').split('<<');
        const letras = (x) => [...x].map((ch) => A_LETRA_NOMBRE[ch] || ch).join('');   // "RI0S" → "RIOS"
        return p.length >= 2 ? { a: letras(p[0].replace(/^[0-9]+/, '')).replace(/</g, ' ').trim(), n: letras(p.slice(1).join(' ')).replace(/</g, ' ').replace(/\s+/g, ' ').trim() } : null;
      }).filter((c) => c && c.a.length >= 2);
      const votar = (vals) => {
        const c = new Map(); vals.filter(Boolean).forEach((v) => c.set(v, (c.get(v) || 0) + 1));
        // una lectura que es otra con letras de más al principio ("SANCHEZ" ⊃ "NCHEZ") suma esos votos
        [...c.keys()].forEach((v) => [...c.keys()].forEach((x) => { if (x !== v && x.length > v.length && x.endsWith(v) && x.length - v.length <= 2) c.set(x, c.get(x) + c.get(v) + 0.5); }));
        // "RAMIRO" ⊂ "RAMIRO ERNESTO": la lectura con el segundo nombre suma los votos de la que lo perdió
        [...c.keys()].forEach((v) => [...c.keys()].forEach((x) => { if (x !== v && x.startsWith(v + ' ') && x.slice(v.length + 1).split(' ').every((t) => t.length >= 3)) c.set(x, c.get(x) + c.get(v) + 0.5); }));
        return [...c.entries()].sort((p, q) => q[1] - p[1] || q[0].length - p[0].length)[0];
      };
      const va = votar(cands.map((c) => c.a)), vn = votar(cands.map((c) => c.n));
      if (va && va[0] !== ident.apellido) { log('🗳 apellido por votación: ' + ident.apellido + ' → ' + va[0]); ident.apellido = va[0]; }
      if (vn && vn[0] !== ident.nombre && vn[0].length >= (ident.nombre || '').length) ident.nombre = vn[0];
    }
    return ident;
  }

  // renglón de nombres: un espacio entre dos palabras es un '<' que el OCR no vio ("RAMIRO ERNESTO" → RAMIRO<ERNESTO);
  // sin esto los dos nombres quedaban pegados en uno solo
  const espaciosANombre = (l) => (/<</.test(l) && (l.match(/\d/g) || []).length <= 2 && !/[I1][D0O]ARG/.test(l.replace(/\s/g, '')))
    ? l.trim().replace(/([A-Z])\s+(?=[A-Z])/g, '$1<') : l;
  function extraerMRZCompleta(texto) {
    const lineas = (texto || '').toUpperCase().split(/[\r\n]+/).map(espaciosANombre)
      .map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 15);

    // Línea 2
    let l2 = null, m2 = null, l2orig = null;
    for (const l of lineas) {
      for (const cand of [l, repararLinea2(l)]) {
        const m = cand && RE_MRZ.exec(cand);
        if (m && +m[5] >= 1 && +m[5] <= 12 && +m[6] >= 1 && +m[6] <= 31) {
          if (!m2 || (cand.length === 30 && m.index === 0)) { l2 = cand; m2 = m; l2orig = l; }
        }
      }
    }
    if (!m2) return null;
    const [, nacim, dcNacim, sexoRaw, yy, mm, dd, dcVenc, pais] = m2;
    const nac6 = l2.slice(m2.index, m2.index + 6);
    const yyN = +nac6.slice(0, 2);

    // Línea 1 (documento)
    let dni = null, docOk = null, dcDocOut = null;
    let l1orig = lineas.find(l => l !== l2orig && /^[I1][D0O<]ARG/.test(l));
    if (!l1orig) { const c = lineas.find(l => l !== l2orig && /[I1][D0O]ARG[0-9OQDILZSBG]{7}/.test(l)); if (c) l1orig = c.slice(c.search(/[I1][D0O]ARG/)); }
    if (l1orig) {
      const a = [...l1orig];
      const dcDoc = A_DIGITO[a[14]] || a[14]; dcDocOut = /\d/.test(dcDoc || '') ? dcDoc : null;
      const rep = repararCampo(a.slice(5, 14).join(''), dcDoc || '?');
      for (let i = 5; i <= 14 && i < a.length; i++) a[i] = A_DIGITO[a[i]] || a[i];
      const campo = rep ? rep.valor : a.slice(5, 14).join('');
      dni = campo.replace(/</g, '').replace(/\D/g, '') || null;
      docOk = rep && rep.ok !== null ? rep.ok : String(digitoControl(campo)) === a[14];
    }

    // Línea 3 (nombres)
    let apellido = null, nombre = null, truncado = false;
    let l3 = lineas.find(l => l !== l2orig && l !== l1orig && l.includes('<<') && (l.match(/\d/g) || []).length <= 2);
    if (l3) {
      // (un dígito suelto al principio es ruido del borde: "1LOPEZ<<LUCIA")
      if (/^[0-9][A-Z]{2}/.test(l3)) l3 = l3.replace(/^[0-9]+/, '');
      // el relleno '<' a veces se lee como S, K o C al final: "ERNESTO<<<<<<S" -> "ERNESTO"
      const limpio = [...l3].map(ch => A_LETRA_NOMBRE[ch] || ch).join('').replace(/<<[<SKCE]*$/, '<<').replace(/<{2,}[SKCE]{1,2}$/, '');
      const partes = limpio.split('<<');
      apellido = partes[0].replace(/</g, ' ').trim() || null;
      nombre = partes.slice(1).join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim() || null;
      truncado = limpio.length >= 30 && !limpio.endsWith('<');
    }

    let nacOk = dcNacim === '?' ? null : String(digitoControl(nac6)) === dcNacim;
    let vencOk = dcVenc === '?' ? null : String(digitoControl(yy + mm + dd)) === dcVenc;
    let compOk = null;
    if (l1orig && l1orig.length === 30 && l2.length === 30 && m2.index === 0) {
      const comp = l1orig.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);
      compOk = String(digitoControl(comp)) === l2[29];
    }
    return {
      dni, apellido, nombre, truncado,
      sexo: sexoRaw === 'M' ? 'Masculino' : sexoRaw === 'F' ? 'Femenino' : 'X',
      fechaNacimiento: `${anioCompleto(yyN)}-${nac6.slice(2, 4)}-${nac6.slice(4, 6)}`,
      fechaVencimiento: `20${yy}-${mm}-${dd}`,
      nacionalidad: NACIONALIDADES[pais] || pais,
      verificada: nacOk && vencOk && docOk !== false,
      checks: { documento: docOk, nacimiento: nacOk, vencimiento: vencOk, compuesto: compOk }, dcDoc: dcDocOut
    };
  }

  function puntajeIdentidad(i) {
    if (!i) return -1;
    const c = i.checks || {};
    return (i.verificada ? 100 : 0) + ['documento', 'nacimiento', 'vencimiento', 'compuesto'].filter((k) => c[k] === true).length * 20 +
      (i.dni ? 10 : 0) + (i.apellido ? 10 : 0) + (i.nombre ? 5 : 0);
  }
  function mejorIdentidad(a, b) { return puntajeIdentidad(b) > puntajeIdentidad(a) ? b : a; }

  // ============================================
  // LECTURA RÁPIDA DEL REVERSO: solo domicilio, lugar de nacimiento y CUIL
  // (cuando el frente ya se leyó: no hace falta la MRZ ni el QR). La tarjeta está donde está el marco de la
  // cámara, así que se leen directamente dos franjas: arriba (domicilio y lugar) y al medio (CUIL).
  // Sirve igual para el DNI viejo y el nuevo (las dos franjas cubren las posiciones de ambos).
  // ============================================
  async function leerReversoRapido(fuente, contexto = {}, onProgress) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    let origen = await aElemento(fuente);
    let rel = contexto.marcoRel || [0, 0, 1, 1];
    // v57: se ubica la tarjeta por sus bordes y se endereza: así cada franja cae justo sobre su renglón
    // (antes se tomaba el marco de la pantalla, y si el DNI no estaba justo, el domicilio salía cortado: "SAN CARL")
    let enderezada = false;
    if (typeof Encuadre !== 'undefined' && !contexto.sinEncuadre) {
      try {
        const cv = aCanvas(origen), W0 = cv.width, H0 = cv.height;
        const z = contexto.marcoRel ? { x: rel[0] * W0, y: rel[1] * H0, w: (rel[2] - rel[0]) * W0, h: (rel[3] - rel[1]) * H0 } : null;
        const e = Encuadre.enderezar(cv, z);
        if (e && e.prop > 1.42 && e.prop < 1.78) { origen = e.canvas; rel = [0, 0, 1, 1]; enderezada = true; log('⚡ tarjeta ubicada por sus bordes'); }
      } catch (er) { /* sigue con el marco */ }
    }
    const anchoO = origen.videoWidth || origen.naturalWidth || origen.width;
    const ancho = anchoO * (rel[2] - rel[0]);
    // franja en coordenadas de la TARJETA (0-1, puede salirse un poco del marco: el DNI no siempre queda justo)
    const franja = (xa, ya, xb, yb, esc, max) => {
      const W = rel[2] - rel[0], H = rel[3] - rel[1];
      const x0 = Math.max(0, rel[0] + xa * W), x1 = Math.min(1, rel[0] + xb * W), y0 = Math.max(0, rel[1] + ya * H), y1 = Math.min(1, rel[1] + yb * H);
      return recortarRel(origen, x0, y0, x1, y1, esc, max, 14);
    };
    let raw = '';
    const leerZona = async (canvas, nombre, desde, hasta) => {
      etapa(desde, hasta);
      const { data: { text } } = await w.recognize(canvas);
      raw += `\n--- ${nombre} ---\n` + (text || ''); log('⚡ ' + nombre + ':\n' + text);
      return text || '';
    };
    // (opcional) las líneas <<< en el otro motor, al mismo tiempo: sexo y vencimiento cuando no vino el frente
    let pMRZ = null;
    if (contexto.conMRZ) {
      const wm = await initWorkerMRZ();
      if (wm) pMRZ = enColaMRZ(async () => {
        // reverso solo (esperarMRZ): si los dígitos de control no cierran, otra variante de la imagen (hasta 3)
        const variantes = contexto.esperarMRZ ? [['fondo', 1900], [undefined, 1900], ['fondo', 2400]] : [['fondo', 1900]];
        const todos = [];
        for (const [modo, an] of variantes) {
          const img = await preprocesar(franja(-0.03, 0.58, 1.03, 1.05, an > 1900 ? 1.4 : 1, an), modo);
          const { data: { text } } = await wm.recognize(img);
          raw += '\n--- MRZ (OCR-B) ---\n' + (text || ''); log('⚡ MRZ:\n' + text);
          todos.push(text || '');
          const id = extraerMRZCompleta(text || '');
          if (id && id.verificada) break;
        }
        return todos;
      });
    }
    await w.setParameters(PARAMS_ZONA);
    // franja de arriba (domicilio en 1-2 renglones + lugar de nacimiento), ampliada: letra de unos 30 px
    // (tamaño justo: letra de unos 24 px. Más grande no lee mejor y en el celular tarda el doble)
    // (si el 1.er intento no alcanzó, los siguientes más grandes: más lentos pero aguantan mejor una foto borrosa)
    const extra = (contexto.intento || 1) > 1, AT = extra ? 2300 : 1800, AC = extra ? 1700 : 1300;
    // (hasta el borde derecho: el 1.er renglón del domicilio llega casi al final de la tarjeta, arriba del QR)
    const BT = enderezada ? [-0.01, -0.02, 1.0, 0.30] : [-0.02, -0.07, 0.98, 0.33];
    const top = franja(BT[0], BT[1], BT[2], BT[3], Math.min(3, AT / (ancho * (BT[2] - BT[0]))), AT);
    const tTop = await leerZona(await preprocesar(top), 'franja domicilio y lugar', 0, 0.45);
    // franja del CUIL
    const cu = franja(-0.02, 0.40, 0.66, 0.70, Math.min(3, AC / (ancho * 0.68)), AC);
    const tCuil = await leerZona(await preprocesar(cu), 'franja CUIL', 0.45, 0.7);

    const dniPad = String(contexto.dni || '').replace(/\D/g, '');
    const ctx = { dni: dniPad || null, sexo: contexto.sexo || null };
    const cuilDe = (ts) => ts.map((t) => extraerCUIL(t, Object.assign({ estricto: true }, ctx))).find(Boolean) || ts.map((t) => extraerCUIL(t, ctx)).find(Boolean) || null;
    const domDe = (ts) => {
      const c = ts.flatMap((t) => [extraerDomicilio(t), domicilioDeZona(t)]).filter(Boolean).map((v) => arreglarProvincias(arreglarSimbolos(v), true)).filter(Boolean);
      const acuerdo = (v) => c.filter((x) => x !== v && parecido(x, v) >= 0.85).length;
      const r = c.map((v) => ({ v, p: puntajeDireccion(v) + 2 * acuerdo(v) })).sort((a, b) => b.p - a.p)[0];
      return r ? r.v : null;
    };
    const lugDe = (ts, dom) => {
      const c = ts.flatMap((t) => [extraerLugarNacimiento(t), lugarTrasEtiqueta(t)]).filter(Boolean)
        .map((v) => arreglarProvincias(String(v).toUpperCase().split(' ').filter((x) => !/^[A-ZÁÉÍÓÚÑ0-9]$/.test(x) || x === 'Y').join(' ').replace(/^(?:Y\s+)+/, '').replace(/[\s,.\-]+$/, '')))
        .filter((v) => v && v.length >= 3 && !/DOMICILIO/.test(v) && !(dom && dom.includes(v) && v.length > 8));
      if (c.length) return c.sort((a, b) => puntajeDireccion(b) - puntajeDireccion(a))[0];
      // sin la etiqueta (en el DNI nuevo es chiquita y gris): el último renglón limpio de la franja, debajo del domicilio
      const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const t of ts) {
        const ls = lineasDe(t).map((l) => l.replace(/^[^A-ZÁÉÍÓÚÑ0-9]+/, '').trim()).filter((l) => (l.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length >= 3);
        // renglones que forman el domicilio (el primero que coincide y, si está, el siguiente)
        const nd = norm(dom);
        let i = ls.findIndex((l) => nd && norm(l).length >= 6 && nd.includes(norm(l).slice(-12)));
        if (i < 0) continue;
        if (ls[i + 1] && nd.endsWith(norm(ls[i + 1])) && norm(ls[i + 1]).length >= 4) i++;
        const cand = ls[i + 1];
        if (cand && /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,\-]{2,}$/.test(cand) && puntajeDireccion(cand) >= 1 && !/DOMICILIO|LUGAR|NACIM/.test(cand)) return arreglarProvincias(cand.replace(/[\s,.\-]+$/, ''));
      }
      return null;
    };
    const limpia = (v) => { if (!v) return false; const t = v.split(/[\s,]+/).filter(Boolean); return t.length >= 3 && puntajeDireccion(v) >= t.length + 2; };

    const textosTop = [tTop], textosCuil = [tCuil, tTop];
    let domicilio = domDe(textosTop), cuil = cuilDe(textosCuil);
    // si algo quedó dudoso, la misma franja en blanco y negro (umbral local): con fotos reales suele leer más limpio
    // (en el 1.er intento solo si no salió nada: suele convenir más otro cuadro de la cámara)
    if (extra ? !limpia(domicilio) : !domicilio) {
      textosTop.push(await leerZona(binarizarCanvas(franja(BT[0], BT[1], BT[2], BT[3], Math.min(3, AT / (ancho * (BT[2] - BT[0]))), AT)), 'franja domicilio (blanco y negro)', 0.7, 0.88));
      domicilio = domDe(textosTop);
    }
    if (!cuil) {
      textosCuil.push(await leerZona(binarizarCanvas(franja(-0.02, 0.40, 0.66, 0.70, Math.min(3, AC / (ancho * 0.68)), AC)), 'franja CUIL (blanco y negro)', 0.88, 1));
      cuil = cuilDe(textosCuil);
    }
    const lugar = lugDe(textosTop, domicilio);
    let mrz = null, identidad = null;
    if (contexto.conMRZ) {
      // (no frena: si las líneas <<< no terminaron poco después que el resto, se sigue sin ellas)
      // (con contexto.esperarMRZ —reverso solo, sin frente— se espera: de ahí salen DNI, sexo y vencimiento)
      let tMs = !pMRZ ? [] : contexto.esperarMRZ ? await pMRZ : await Promise.race([pMRZ, new Promise((ok) => setTimeout(() => ok([]), 1500))]);
      if (!pMRZ && contexto.esperarMRZ) {   // sin el motor OCR-B: con el de siempre
        await w.setParameters(PARAMS_MRZ);
        const t = (await w.recognize(await preprocesar(franja(-0.03, 0.58, 1.03, 1.05, 1, 1900), 'fondo'))).data.text || '';
        raw += '\n--- MRZ ---\n' + t; tMs = [t];
      }
      // (más las lecturas que ya se tenían, por ej. el vistazo que detectó el reverso): la mejor, y los nombres por votación
      const tTodos = (tMs || []).concat(contexto.mrzTextos || []).filter(Boolean);
      if (tTodos.length) {
        const ms = tTodos.map(extraerDesdeMRZ);
        mrz = ms.find((x) => x.mrzVerificada) || ms.find((x) => x.fechaVencimiento) || ms[0];
        identidad = votarNombresMRZ(tTodos.map(extraerMRZCompleta).reduce(mejorIdentidad, null), tTodos);
      }
      // sin DNI conocido, el CUIL se valida con el de la MRZ
      if (!cuil && !ctx.dni && identidad && identidad.dni && identidad.checks && identidad.checks.documento) { ctx.dni = identidad.dni; cuil = cuilDe(textosCuil); }
    }
    await w.setParameters(PARAMS_TEXTO);
    if (progresoCb) progresoCb(1);
    return { domicilio, lugarNacimiento: lugar, cuil, raw, limpio: limpia(domicilio), identidad,
      fechaVencimiento: mrz && mrz.mrzVerificada ? mrz.fechaVencimiento : null, nacionalidad: mrz && mrz.nacionalidad, mrzVerificada: mrz ? mrz.mrzVerificada : null };
  }

  // ============================================
  // REVERSO DESDE UNA SOLA FOTO (v44): el DNI ya no tiene que quedar quieto dentro del marco.
  // Se saca UNA foto en alta resolución y la cámara se apaga (el DNI se puede soltar). Acá se ubica la tarjeta
  // dentro de la foto por las líneas <<< (siempre en el mismo lugar del reverso) y se leen solo las dos franjas
  // que hacen falta: domicilio y CUIL. En la APK, primero con el lector nativo (ML Kit: menos de 1 s).
  // ============================================

  // Dónde está la tarjeta en la foto, a partir de las palabras de la MRZ: [x0, y0, x1, y1] en fracciones (puede
  // salirse un poco de 0-1: las franjas se recortan después). La MRZ ocupa el 88,5 % del ancho desde el 6,6 %
  // y termina al 93,5 % del alto de la tarjeta (mismo cálculo que la lectura completa).
  function tarjetaPorMRZ(palabras, W, H) {
    const mrzPal = palabras.filter((p) => p.b && (/<</.test(p.t) || /[I1][D0O][A4]RG/.test(sinT(p.t)) || /\d{6}[0-9<]?[MF]/.test(p.t)));
    if (mrzPal.length < 2) return null;
    const bx0 = Math.min(...mrzPal.map((p) => p.b.x0)), bx1 = Math.max(...mrzPal.map((p) => p.b.x1)), by1 = Math.max(...mrzPal.map((p) => p.b.y1));
    const Wc = (bx1 - bx0) / 0.885, Hc = Wc / 1.586, x0 = bx0 - 0.066 * Wc, y0 = by1 - 0.935 * Hc;
    if (Wc < W * 0.2 || Wc > W * 1.4 || x0 < -0.2 * Wc || y0 < -0.2 * Hc) return null;
    return [x0 / W, y0 / H, (x0 + Wc) / W, (y0 + Hc) / H];
  }

  // Deja en negro solo la tinta (lo más oscuro): saca el mapa gris de Argentina que hay debajo de "PABLO II" y los
  // dibujos del fondo. El umbral sale de la propia imagen (2 % más oscuro + margen), así se adapta a la luz.
  function soloTinta(c, extra = 0) {
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const x = o.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
    const img = x.getImageData(0, 0, o.width, o.height), d = img.data, W = o.width, H = o.height;
    // se mide en la zona del texto (no en los bordes, donde puede asomar la mesa o el teclado)
    const hist = new Uint32Array(256);
    for (let y = Math.round(H * 0.2); y < Math.round(H * 0.8); y++) for (let xx = Math.round(W * 0.03); xx < Math.round(W * 0.97); xx++) hist[d[(y * W + xx) * 4]]++;
    const pct = (f, hasta = 255) => { let tot = 0; for (let v = 0; v <= hasta; v++) tot += hist[v]; let acc = 0; for (let v = 0; v <= hasta; v++) { acc += hist[v]; if (acc >= tot * f) return v; } return hasta; };
    const papel = pct(0.7);
    // tinta = lo típico de los píxeles oscuros (menos de la mitad del papel); el gris del mapa queda arriba del umbral
    const tinta = pct(0.1, Math.max(20, Math.round(papel * 0.5)));
    const T = Math.max(26, Math.min(44 + extra, tinta + 16 + extra));
    for (let i = 0; i < d.length; i += 4) { const v = d[i] < T ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    return o;
  }
  // franja del domicilio (en fracciones de la tarjeta), ya en gris y con contraste
  async function franjaDomicilio(base, rel, modo) {
    const W = rel[2] - rel[0], H = rel[3] - rel[1];
    // (ajustada a los renglones del domicilio y el lugar de nacimiento: en el DNI viejo van del 6 % al 20 % del
    //  alto y en el nuevo del 3 % al 22 %; con la tarjeta ubicada por las líneas <<< no hace falta más margen,
    //  y una franja con mucho dibujo de seguridad o borde de la foto el OCR la lee mucho peor)
    const x0 = Math.max(0, rel[0] - 0.01 * W), x1 = Math.min(1, rel[0] + 0.86 * W), y0 = Math.max(0, rel[1] - 0.01 * H), y1 = Math.min(1, rel[1] + 0.25 * H);
    const ancho = (base.width) * (rel[2] - rel[0]);
    return preprocesar(recortarRel(base, x0, y0, x1, y1, Math.min(3, 1800 / (ancho * 0.9)), 1800, 14), modo);
  }

  // Gira la imagen un ángulo cualquiera (radianes, sentido de las agujas del reloj) sin cortar las esquinas.
  // .mapear(x, y) pasa un punto de la imagen original a la girada.
  function rotarLibre(el, rad) {
    const w = el.width, h = el.height, co = Math.cos(rad), si = Math.sin(rad);
    const W = Math.round(w * Math.abs(co) + h * Math.abs(si)), H = Math.round(w * Math.abs(si) + h * Math.abs(co));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    x.imageSmoothingQuality = 'high'; x.translate(W / 2, H / 2); x.rotate(rad); x.drawImage(el, -w / 2, -h / 2);
    c.mapear = (px, py) => { const dx = px - w / 2, dy = py - h / 2; return [W / 2 + dx * co - dy * si, H / 2 + dx * si + dy * co]; };
    return c;
  }
  // DNI inclinado en la foto (más de medio grado): ángulo para enderezarlo, medido en los renglones de texto
  function anguloEnderezar(palabras) {
    const k = inclinacionPalabras(palabras);
    const a = Math.atan(k);
    return Math.abs(a) > 0.5 * Math.PI / 180 && Math.abs(a) < 12 * Math.PI / 180 ? -a : 0;
  }
  // las palabras (con su recuadro) llevadas a la imagen girada
  function palabrasGiradas(palabras, girada) {
    return palabras.map((p) => {
      const [cx, cy] = girada.mapear((p.b.x0 + p.b.x1) / 2, (p.b.y0 + p.b.y1) / 2), hw = (p.b.x1 - p.b.x0) / 2, hh = (p.b.y1 - p.b.y0) / 2;
      return { t: p.t, b: { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh } };
    });
  }

  // Pinta de blanco todo lo que está fuera de la tarjeta (con un margen chico): el fondo oscuro de la foto
  // (mesa, borde negro) dentro de una franja hace que el OCR no lea nada aunque el texto esté nítido
  function blanquearFuera(el, rel, margen = 0.015) {
    const c = document.createElement('canvas'); c.width = el.width; c.height = el.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    const W = rel[2] - rel[0], H = rel[3] - rel[1];
    const x0 = Math.max(0, (rel[0] - margen * W) * c.width), y0 = Math.max(0, (rel[1] - margen * H) * c.height);
    const x1 = Math.min(c.width, (rel[2] + margen * W) * c.width), y1 = Math.min(c.height, (rel[3] + margen * H) * c.height);
    if (x1 - x0 > 20 && y1 - y0 > 20) x.drawImage(el, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    return c;
  }

  function aCanvas(el) {
    if (el instanceof HTMLCanvasElement) return el;
    const c = document.createElement('canvas');
    c.width = el.videoWidth || el.naturalWidth || el.width; c.height = el.videoHeight || el.naturalHeight || el.height;
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    return c;
  }

  function elegirCUIL(textos, ctx) {
    return textos.map((t) => extraerCUIL(t, Object.assign({ estricto: true }, ctx))).find(Boolean)
      || textos.map((t) => extraerCUIL(t, ctx)).find(Boolean) || null;
  }

  // Candidatos de domicilio de un texto (zona: también sin etiqueta; texto completo: solo lo que sigue a "DOMICILIO")
  // ("PABLO |", "PABLO ll", "PABLO !1": las dos rayas del II de Juan Pablo II, antes de que se descarten los signos)
  // ("Y” BEBA", "V* BEBA", "V' BEBA": es Vª —villa—, como se imprime en el DNI)
  const conRomanos = (t) => String(t || '').replace(/\b(PABLO)\s*[|lI1!]{1,2}(?=\s|$|-|\()/gi, '$1 II')
    .replace(/(^|[\s:])[VY]\s?[”“"*°º'ª´`’‘]\s?(?=[A-ZÁÉÍÓÚÑ]{3})/g, '$1Vª ');
  const candidatosDom = (t, esZona) => { t = conRomanos(t); return (esZona ? [extraerDomicilio(t), domicilioDeZona(t)] : [extraerDomicilio(t)]).filter(Boolean); };
  // (en un domicilio nunca hay < > « »: es un guion mal leído)
  const sinFlechas = (v) => String(v).replace(/\s*[<>«»]+\s*/g, ' - ').replace(/(\s-)+\s/g, ' - ').replace(/\s+/g, ' ').replace(/[\s\-]+$/, '').trim();
  // Entre todas las lecturas, la más completa y limpia: palabras de dirección reales suman, basura resta, y suma
  // si otra lectura dice casi lo mismo. A igual puntaje, la más larga (la que no cortó "PABLO II" ni el 2.º renglón).
  // v57: CONSENSO entre varias lecturas de un mismo renglón (domicilio, lugar): se toma la lectura que más se parece
  // a las demás y, palabra por palabra, se corrige con lo que dice la mayoría (alineando las palabras). Así un error
  // que aparece en una sola lectura ("950" por "PISO", un "B°" perdido) se corrige con las otras.
  function consensoTexto(cands) {
    const c = cands.filter(Boolean).map((v) => String(v).replace(/\s+/g, ' ').trim()).filter((v) => v.length >= 3);
    if (c.length < 3) return null;
    // (para alinear, las letras que el OCR confunde cuentan como iguales: 8/B, 0/O/D, 1/I/L, 5/S, 2/Z, 6/G)
    const canon = (x) => x.toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÚÑ]/g, '').replace(/8/g, 'B').replace(/[0D]/g, 'O').replace(/[1L]/g, 'I').replace(/5/g, 'S').replace(/2/g, 'Z').replace(/6/g, 'G');
    const simT = (a, b) => { if (a === b) return 1; const A = canon(a), B = canon(b); if (!A || !B) return A === B ? 0.9 : 0; return 1 - lev(A, B) / Math.max(A.length, B.length); };
    const sim = (a, b) => { const A = a.toUpperCase(), B = b.toUpperCase(); return A === B ? 1 : (1 - lev(A, B) / Math.max(A.length, B.length)); };
    const base = c.map((v) => ({ v, p: c.reduce((t, o) => t + sim(v, o), 0) })).sort((x, y) => y.p - x.p)[0].v;
    const B = base.split(' ');
    const votos = B.map((t) => new Map([[t, 1]]));   // para cada palabra de la base: qué dicen las otras lecturas
    const inserciones = new Map();                     // palabras que la base no tiene: "pos|palabra" -> lecturas
    c.forEach((o) => {
      if (o === base) return;
      const O = o.split(' '), n = B.length, m = O.length;
      // alineación de palabras (como una distancia de edición, con costo según cuánto se parecen)
      const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
      for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
      for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        const st = simT(B[i - 1], O[j - 1]);
        D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (st >= 0.5 ? 1 - st : 1.6));
      }
      // (si la otra lectura está CORTADA —le falta el final— el final de la base no cuesta: se alinea solo lo que tiene)
      let i = n, j = m;
      for (let k = 0; k <= n; k++) if (D[k][m] < D[i][m] - 1e-4) i = k;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0) { const st = simT(B[i - 1], O[j - 1]); if (Math.abs(D[i][j] - (D[i - 1][j - 1] + (st >= 0.5 ? 1 - st : 1.6))) < 1e-4 && st >= 0.5) { const mm = votos[i - 1]; mm.set(O[j - 1], (mm.get(O[j - 1]) || 0) + 1); i--; j--; continue; } }
        // (a igual costo, primero "falta esta palabra en la otra lectura": así una lectura cortada no desalinea el final)
        if (i > 0 && Math.abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-4) { i--; continue; }
        if (j > 0 && (i === 0 || Math.abs(D[i][j] - (D[i][j - 1] + 1)) < 1e-4)) { const k = i + '|' + O[j - 1]; inserciones.set(k, (inserciones.get(k) || 0) + 1); j--; continue; }
        if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + 1.6)) < 1e-4) { i--; j--; continue; }
        i--;
      }
    });
    const mitad = c.length / 2;
    const out = [];
    for (let i = 0; i <= B.length; i++) {
      // palabra que falta en la base pero está en la mayoría de las lecturas, en este lugar
      inserciones.forEach((n, k) => { const [pos, w] = k.split('|'); if (+pos === i && n + 1 > mitad && !out.includes(w)) out.push(w); });
      if (i === B.length) break;
      // (empate: queda la palabra de la lectura base, que es la que más coincide con todas)
      const mm = [...votos[i].entries()].sort((x, y) => y[1] - x[1] || (y[0] === B[i]) - (x[0] === B[i]) || puntajeDireccion(y[0]) - puntajeDireccion(x[0]));
      // palabra de la base que casi ninguna otra lectura tiene (ruido de una sola lectura): afuera
      const total = [...votos[i].values()].reduce((t, x) => t + x, 0);
      if (total === 1 && c.length >= 4) continue;
      out.push(mm[0][0]);
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }

  // Lugar de nacimiento entre varias lecturas: si una es la otra con palabras perdidas ("SAN JUJUY" / "SAN SALVADOR
  // DE JUJUY"), vale la más completa; con 3 o más, consenso; si no, la de mejor puntaje.
  function mejorLugar(cands) {
    const c = [...new Set(cands.filter(Boolean))];
    if (!c.length) return null;
    if (c.length === 1) return c[0];
    const toks = (x) => x.toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/g, ' ').split(/\s+/).filter(Boolean);
    const contiene = (largo, corto) => { const L = toks(largo), C = toks(corto); let i = 0; for (const t of L) if (i < C.length && t === C[i]) i++; return i === C.length && L.length > C.length; };
    const amplia = c.find((x) => c.every((y) => y === x || contiene(x, y)));
    if (amplia) return amplia;
    if (c.length >= 3) { const cs = consensoTexto(cands.filter(Boolean)); if (cs) return cs; }
    return c.sort((a, b) => puntajeDireccion(b) - puntajeDireccion(a))[0];
  }

  function mejorDomicilio(cands) {
    const c = [...new Set(cands.filter(Boolean).map((v) => sinFlechas(arreglarProvincias(arreglarSimbolos(v), true))).filter((v) => v && v.length >= 6))];
    if (!c.length) return null;
    const pts = (v) => puntajeDireccion(v) + 2 * c.filter((o) => o !== v && parecido(o, v) >= 0.85).length;
    let mejor = c.slice().sort((a, b) => pts(b) - pts(a) || b.length - a.length)[0];
    // con 3 lecturas o más: consenso palabra por palabra (si no queda peor que la mejor lectura sola)
    const cons = c.length >= 3 ? consensoTexto(c) : null;
    // (el puntaje castiga las letras sueltas: "DPTO B" puntúa menos que "DPTO 8"; por eso el margen es amplio)
    if (cons && puntajeDireccion(cons) >= puntajeDireccion(mejor) - 4) mejor = cons;
    // punto suelto pegado a una palabra ("MILAGRO. SALTA", "SALTA. CAPITAL"): en el DNI no está; sí en abreviaturas
    const ABREV = new Set(['PROV', 'AVDA', 'GRAL', 'PRES', 'PROF', 'DPTO', 'DEPTO', 'MZNA', 'BARR', 'CNEL', 'TTE', 'SGTO', 'ING', 'GOB', 'PJE', 'DOCT']);
    return mejor.replace(/\b([A-ZÁÉÍÓÚÑ]{3,})\.(?=\s|$)/g, (m, w) => (ABREV.has(w) ? m : w)).replace(/\s+/g, ' ').trim();
  }

  // APK: el lector nativo lee la foto entera con la posición de cada palabra; se toma el texto de las franjas.
  // Además se le pasa la franja del domicilio "solo tinta" (sin el mapa de fondo): ahí lee "PABLO II" entero.
  async function reversoNativo(origen, ctx) {
    const ow = origen.naturalWidth || origen.width, oh = origen.naturalHeight || origen.height;
    const k = Math.min(1, 1800 / ow);
    let c = document.createElement('canvas'); c.width = Math.round(ow * k); c.height = Math.round(oh * k);
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(origen, 0, 0, c.width, c.height);
    let nat = await ocrNativo(c);
    if (!nat || !nat.words.length) return null;
    const escala = (n, ancho) => { const f = n.w ? ancho / n.w : 1; return n.words.map((w) => ({ t: String(w.t), b: { x0: w.x0 * f, y0: w.y0 * f, x1: w.x1 * f, y1: w.y1 * f } })); };
    let palabras = escala(nat, c.width);
    // DNI inclinado: se endereza la foto y se lee de nuevo (con los renglones derechos no se mezclan)
    const ang = anguloEnderezar(palabras);
    if (ang) {
      const g = rotarLibre(c, ang);
      const n2 = await ocrNativo(g);
      if (n2 && n2.words.length) { nat = n2; c = g; palabras = escala(nat, c.width); log('📐 foto enderezada ' + (ang * 180 / Math.PI).toFixed(1) + '°'); }
    }
    const texto = nat.text || palabras.map((p) => p.t).join(' ');
    const rel = tarjetaPorMRZ(palabras, c.width, c.height);
    const zona = (xa, ya, xb, yb) => {
      if (!rel) return '';
      const X = rel[0] * c.width, Y = rel[1] * c.height, W = (rel[2] - rel[0]) * c.width, H = (rel[3] - rel[1]) * c.height;
      return textoEnRect(palabras, X + xa * W, Y + ya * H, X + xb * W, Y + yb * H);
    };
    // por la etiqueta "DOMICILIO" (medida en alturas de letra), sirva o no la ubicación por la MRZ
    const aDom = palabras.find((p) => /OMICIL|DOMICI/.test(sinT(p.t)));
    let zDom = '';
    if (aDom) { const h = Math.max(6, aDom.b.y1 - aDom.b.y0); zDom = textoEnRect(palabras, aDom.b.x0 - 0.6 * h, aDom.b.y0 - 0.5 * h, aDom.b.x0 + 48 * h, aDom.b.y0 + 2.9 * h); }
    // dos clases de lecturas: las del propio lector (su texto ya viene por renglones, bien ordenado aunque el DNI esté
    // torcido) y las armadas acá con la posición de cada palabra (respaldo: con letra rara pueden mezclar renglones)
    const candTexto = candidatosDom(texto, false);
    const candRect = [zona(-0.02, -0.07, 0.88, 0.33), zDom].filter(Boolean).flatMap((t) => candidatosDom(t, true));
    let raw = '\n--- lector nativo ---\n' + texto;
    if (rel) {
      try {
        const fD = await franjaDomicilio(blanquearFuera(c, rel), rel);
        for (const extra of [0, 10]) {
          const tinta = soloTinta(fD, extra);
          const nt = await ocrNativo(tinta);
          if (!nt || !nt.words.length) continue;
          const tT = nt.text || '', pal = escala(nt, tinta.width);
          const tR = textoEnRect(pal, 0, 0, tinta.width, tinta.height);
          raw += '\n--- lector nativo (franja domicilio, solo tinta ' + (extra ? 'suave' : 'estricta') + ') ---\n' + tT;
          candTexto.push(...candidatosDom(tT, true)); candRect.push(...candidatosDom(tR, true));
        }
      } catch (e) { /* sigue con lo que hay */ }
    }
    // (imagen: la que se leyó —enderezada si hizo falta—, para que Tesseract use la misma si tiene que seguir)
    // si las lecturas del propio lector dan un domicilio limpio, se usan solas
    const dT = mejorDomicilio(candTexto), tokT = dT ? dT.split(/[\s,]+/).filter((x) => x && x !== '-').length : 0;
    const cands = dT && puntajeDireccion(dT) >= tokT + 2 ? candTexto : candTexto.concat(candRect);
    return { rel, imagen: c, candidatos: cands, cuil: elegirCUIL([zona(-0.02, 0.40, 0.66, 0.70), texto].filter(Boolean), ctx), raw };
  }

  async function leerReversoFoto(fuente, contexto = {}, onProgress) {
    const prog = typeof onProgress === 'function' ? onProgress : () => {};
    const t0 = performance.now();
    let origen = aCanvas(await aElemento(fuente));
    const dni = String(contexto.dni || '').replace(/\D/g, '');
    const sx = String(contexto.sexo || '');
    const ctx = { dni: dni || null, sexo: /^F/i.test(sx) ? 'F' : /^M/i.test(sx) ? 'M' : null };
    let raw = '', rel = null, cuil = null, lugar = null, via = 'tesseract';
    const cands = [], candLugar = [];
    const fin = () => {
      // (tal como está impreso en el DNI: "Bº", con el ordinal, no el signo de grados)
      const domicilio = (mejorDomicilio(cands) || '').replace(/\b([BN])°/g, '$1º') || null; log('🏠 candidatos: ' + JSON.stringify(cands));
      prog(1); const ms = Math.round(performance.now() - t0); log('⏱ reverso desde foto: ' + ms + ' ms (' + via + ')');
      return { domicilio, cuil, lugarNacimiento: lugar, raw, via, ms };
    };

    // 1) APK: lector nativo
    if (ocrNativoDisponible()) {
      prog(0.1);
      let n = null;
      try { n = await reversoNativo(origen, ctx); } catch (e) { n = null; }
      if (n) { raw += n.raw; rel = n.rel; cands.push(...n.candidatos); cuil = n.cuil; if (n.rel && n.imagen) origen = n.imagen; }
      // se da por terminado solo si el domicilio quedó limpio (todas palabras reales); si no, Tesseract suma lecturas
      const dN = mejorDomicilio(cands), tokN = dN ? dN.split(/[\s,]+/).filter((x) => x && x !== '-').length : 0;
      if (dN && cuil && puntajeDireccion(dN) >= tokN + 2 && !/\b(?!AV|B°|N°|Vª|II|DE|LA|EL|Y)[A-Z]{1,2}\b/.test(dN)) { via = 'nativo'; return fin(); }
    }

    // 2) Tesseract: una pasada rápida a baja resolución, solo para ubicar la tarjeta (líneas <<<)
    const w = await initWorker();
    if (!rel) {
      progresoCb = (p) => prog(p * 0.25); etapa(0, 1);
      await w.setParameters(PARAMS_TEXTO);
      const chica = escalarA(await preprocesar(origen), 1200);
      const r = await w.recognize(chica, {}, { text: true, blocks: true });
      const textoUbic = r.data.text || '';
      raw += '\n--- ubicación de la tarjeta ---\n' + textoUbic;
      let pal = palabrasDe(r.data).filter((p) => p.b), anchoC = chica.width, altoC = chica.height;
      // DNI inclinado: se endereza la foto (y las posiciones de las palabras) antes de recortar las franjas
      const ang = anguloEnderezar(pal);
      if (ang) {
        const gc = rotarLibre(chica, ang);
        pal = palabrasGiradas(pal, gc); anchoC = gc.width; altoC = gc.height;
        origen = rotarLibre(origen, ang);
        log('📐 foto enderezada ' + (ang * 180 / Math.PI).toFixed(1) + '°');
      }
      rel = tarjetaPorMRZ(pal, anchoC, altoC);
      // muy torcida, las líneas <<< no se vieron bien: se vuelven a buscar en la foto ya derecha
      if (!rel && ang) {
        const chica2 = escalarA(await preprocesar(origen), 1200);
        const r2 = await w.recognize(chica2, {}, { text: true, blocks: true });
        raw += '\n--- ubicación de la tarjeta (enderezada) ---\n' + (r2.data.text || '');
        rel = tarjetaPorMRZ(palabrasDe(r2.data).filter((p) => p.b), chica2.width, chica2.height);
        cands.push(...candidatosDom(r2.data.text || '', false));
        if (!cuil) cuil = elegirCUIL([r2.data.text || ''], Object.assign({}, ctx, { estricto: true })) || null;
      }
      log(rel ? '📐 tarjeta ubicada por la MRZ' : '📐 no se ubicó la tarjeta por la MRZ');
      // las líneas <<< no salieron en la pasada general (a veces el texto de arriba la desordena): se buscan
      // solas, en la mitad de abajo de la foto, con el motor de la MRZ (es una pasada chica y rápida)
      if (!rel) {
        const fondo = escalarA(await preprocesar(origen, 'fondo'), 1400);
        const yIni = 0.45, abajo = recortarRel(fondo, 0, yIni, 1, 1, 1, 1400, 0);
        const wm = await initWorkerMRZ();
        const motor = wm || w;
        const leerM = async () => { if (!wm) await w.setParameters(PARAMS_MRZ); const rr = await motor.recognize(abajo, {}, { text: true, blocks: true }); if (!wm) await w.setParameters(PARAMS_TEXTO); return rr; };
        const rm = wm ? await enColaMRZ(leerM) : await leerM();
        const palM = palabrasDe(rm.data).filter((p) => p.b).map((p) => ({ t: p.t, b: { x0: p.b.x0, x1: p.b.x1, y0: p.b.y0 + yIni * fondo.height, y1: p.b.y1 + yIni * fondo.height } }));
        rel = tarjetaPorMRZ(palM, fondo.width, fondo.height);
        raw += '\n--- líneas <<< (para ubicar la tarjeta) ---\n' + (rm.data.text || '');
        log(rel ? '📐 tarjeta ubicada por la franja de abajo' : '📐 tampoco en la franja de abajo');
      }
      // la foto vino de la cámara con el marco y no se vio la MRZ: se prueba donde estaba el marco
      if (!rel && contexto.marcoRel) rel = contexto.marcoRel;
      // ya que se leyó: el domicilio entero (no lo corta ninguna franja) y el CUIL
      cands.push(...candidatosDom(textoUbic, false));
      if (!cuil) cuil = elegirCUIL([textoUbic], Object.assign({}, ctx, { estricto: true })) || null;
    }

    if (rel) {
      // la tarjeta a unos 1500 px de ancho: tamaño justo de letra para el OCR (una foto 4K no lee mejor y tarda mucho más)
      const anchoT = (rel[2] - rel[0]) * origen.width;
      const base = blanquearFuera(anchoT > 1600 ? escalarA(origen, Math.round(origen.width * 1500 / anchoT)) : origen, rel);
      const zonas = async (intento, desde, hasta) => leerReversoRapido(base, { dni: ctx.dni, sexo: ctx.sexo, marcoRel: rel, conMRZ: false, intento }, (p) => prog(desde + p * (hasta - desde)));
      const r = await zonas(1, 0.25, 0.6);
      raw += r.raw || '';
      cands.push(r.domicilio); cuil = cuil || r.cuil; lugar = r.lugarNacimiento; if (lugar) candLugar.push(lugar);
      // franja del domicilio "solo tinta": la letra que cae sobre el mapa de Argentina ("PABLO II") y los dibujos del fondo
      progresoCb = (p) => prog(0.6 + p * 0.2); etapa(0, 1);
      // (con dos umbrales: uno estricto, que saca bien el mapa, y otro más suave, que no come letra fina o borrosa)
      // (en el DNI nuevo la letra no es negra sobre blanco: ahí solo si la lectura normal no quedó limpia)
      const dR = mejorDomicilio(cands), tokR = dR ? dR.split(/[\s,]+/).filter((x) => x && x !== '-').length : 0;
      const limpioR = dR && puntajeDireccion(dR) >= tokR + 2 && !/\b(?!AV|B°|N°|Vª|II|DE|LA|EL|Y)[A-Z]{1,2}\b/.test(dR);
      await w.setParameters(PARAMS_ZONA);
      const fD = await franjaDomicilio(base, rel);
      // con la luz normalizada (cada píxel dividido por el brillo del papel alrededor): letra gris, DNI gastado,
      // luz despareja de un lado al otro de la foto
      { const tA = (await w.recognize(await franjaDomicilio(base, rel, 'fondo'))).data.text || '';
        raw += '\n--- franja domicilio (ajustada, luz normalizada) ---\n' + tA;
        cands.push(...candidatosDom(tA, true)); }
      for (const extra of (contexto.tipo === 'nuevo' && limpioR ? [] : [0, 10])) {
        const tT = (await w.recognize(soloTinta(fD, extra))).data.text || '';
        raw += '\n--- franja domicilio (solo tinta ' + (extra ? 'suave' : 'estricta') + ') ---\n' + tT;
        cands.push(...candidatosDom(tT, true));
      }
      await w.setParameters(PARAMS_TEXTO);
      // faltó algo, o las lecturas del domicilio no coinciden entre sí: la misma foto, con las franjas más ampliadas
      // (v57: precisión antes que velocidad: con una lectura más, el consenso palabra por palabra corrige los errores sueltos)
      const nD = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const coinciden = () => { const l = cands.filter(Boolean).map((x) => nD(arreglarProvincias(arreglarSimbolos(x), true))).filter((x) => x.length >= 6); return l.some((x, i) => l.indexOf(x) !== i); };
      if (!mejorDomicilio(cands) || !cuil || !coinciden() || !lugar) {
        const r2 = await zonas(2, 0.8, 0.98);
        raw += r2.raw || '';
        cands.push(r2.domicilio); cuil = cuil || r2.cuil; if (r2.lugarNacimiento) candLugar.push(r2.lugarNacimiento);
        lugar = mejorLugar(candLugar);
      }
      if (mejorDomicilio(cands) || cuil) return fin();
    }

    // 3) no se encontró la tarjeta: lectura completa (gira la foto si hace falta y se ubica por las etiquetas)
    const r = await leer(origen, 'arg', (p) => prog(0.3 + p * 0.7), { dni: ctx.dni });
    raw += r.raw || '';
    cands.push(r.domicilio); cuil = cuil || r.cuil; lugar = lugar || r.lugarNacimiento;
    via = 'completa';
    return fin();
  }

  // CUIL a partir del DNI y el sexo (para cuando no se pudo leer). Prefijo 20 (varón) / 27 (mujer); si el dígito
  // da 10 se usa el 23. OJO: hay casos (CUIL asignados de otra forma) en que no coincide: hay que confirmarlo.
  function calcularCUIL(dni, sexo) {
    const d = String(dni || '').replace(/\D/g, '');
    if (d.length < 7 || d.length > 8) return null;
    const pad = d.padStart(8, '0');
    let pref = /^F/i.test(String(sexo || '')) ? '27' : /^M/i.test(String(sexo || '')) ? '20' : null;
    if (!pref) return null;
    const dv = (p) => { const s = (p + pad).split('').reduce((a, ch, i) => a + PESOS_CUIL[i] * Number(ch), 0); const v = 11 - (s % 11); return v === 11 ? 0 : v; };
    let v = dv(pref);
    if (v === 10) { pref = '23'; v = dv(pref); }
    const c = `${pref}-${pad}-${v}`;
    return cuilValido(c) ? c : null;
  }

  // ============================================
  // LECTURA COMPLETA
  // ============================================
  async function leer(fuente, pais = 'arg', onProgress, contexto = {}) {
    void pais; // reservado para otros países
    progresoCb = typeof onProgress === 'function' ? onProgress : null;

    const w = await initWorker();
    let origen = await aElemento(fuente);
    let gris = await preprocesar(origen);
    let raw = '';
    const ocr = async (img, params, desde, hasta, nombre) => {
      etapa(desde, hasta);
      await w.setParameters(params);
      const { data: { text } } = await w.recognize(img);
      raw += `\n--- ${nombre} ---\n` + (text || '');
      log('📄 OCR ' + nombre + ':\n' + text);
      return text || '';
    };

    // 1) imagen completa (con la posición de cada palabra, para ubicar las etiquetas aunque el DNI no esté justo en el marco)
    etapa(0, 0.25);
    await w.setParameters(PARAMS_TEXTO);
    const wMRZp = initWorkerMRZ();   // se va cargando mientras tanto
    // (a menor resolución: alcanza para ubicar etiquetas y líneas <<<, y tarda la mitad; los datos se releen en zonas ampliadas)
    const pasadaGeneral = async (img) => {
      const k = Math.min(1, 1600 / img.width), chica = k < 0.97 ? escalarA(img, 1600) : img;
      const r = await w.recognize(chica, {}, { text: true, blocks: true });
      r.k = k < 0.97 ? chica.width / img.width : 1;
      return r;
    };
    let r1 = await pasadaGeneral(gris);
    // DNI girado 90° (foto vertical o el DNI parado): sin líneas <<< se prueba girando la imagen, con una pasada rápida
    const hayMRZ = (t) => /[I1][D0O]ARG|<<<</.test(String(t || '').toUpperCase().replace(/\s/g, ''));
    // ¿qué tan "reverso derecho" parece un texto? (signos <, IDARG, etiquetas, palabras reales)
    const puntajeReverso = (t) => { const U = String(t || '').toUpperCase();
      return (U.match(/</g) || []).length / 2 + (/[I1][D0O]ARG/.test(U.replace(/\s/g, '')) ? 8 : 0) +
        (/CU[I1]L/.test(U) ? 4 : 0) + (/DOMICI|OMICIL/.test(U) ? 4 : 0) + (/LUGAR|NACIM/.test(U) ? 3 : 0) + (U.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g) || []).length * 0.3; };
    const p0 = puntajeReverso(r1.data.text);
    // solo si la foto está parada (más alta que ancha) o casi no se leyó nada: una tarjeta derecha ya trae etiquetas legibles
    // (con la cámara en vivo el DNI está derecho dentro del marco: no se prueba girar)
    if (!contexto.marcoRel && !hayMRZ(r1.data.text) && (origen.height > origen.width * 1.1 || p0 < 5)) {
      let mejor = null;
      for (const ang of [90, -90]) {
        const rot = rotar(origen, ang);
        const { data: { text: tr } } = await w.recognize(escalarA(rot, 1300));
        const p = puntajeReverso(tr);
        log('🔄 prueba girando ' + ang + '°: puntaje ' + p.toFixed(1) + ' (sin girar ' + p0.toFixed(1) + ')');
        if (p > p0 * 1.5 + 3 && (!mejor || p > mejor.p)) mejor = { rot, p };
      }
      if (mejor) { origen = mejor.rot; gris = await preprocesar(mejor.rot); r1 = await pasadaGeneral(gris); contexto = Object.assign({}, contexto, { marcoRel: null }); }
    }
    await w.setParameters(PARAMS_TEXTO);
    const text = r1.data.text || '';
    raw += '\n--- reverso completo ---\n' + text;
    log('📄 OCR reverso completo:\n' + text);
    const palabras = palabrasDe(r1.data).filter((p) => p.b)
      .map((p) => r1.k === 1 ? p : { t: p.t, b: { x0: p.b.x0 / r1.k, y0: p.b.y0 / r1.k, x1: p.b.x1 / r1.k, y1: p.b.y1 / r1.k } });
    const ancla = (re) => palabras.find((p) => re.test(sinT(p.t)));
    // recorte alrededor de una etiqueta, medido en alturas de letra (h) de esa etiqueta
    const zonaAncla = (p, ix0, iy0, ix1, iy1) => {
      const h = Math.max(6, p.b.y1 - p.b.y0);
      const x0 = Math.max(0, p.b.x0 + ix0 * h), x1 = Math.min(gris.width, p.b.x0 + ix1 * h);
      const y0 = Math.max(0, p.b.y0 + iy0 * h), y1 = Math.min(gris.height, p.b.y0 + iy1 * h);
      if (x1 - x0 < 30 || y1 - y0 < 10) return null;
      return recortarRel(gris, x0 / gris.width, y0 / gris.height, x1 / gris.width, y1 / gris.height, Math.max(1.5, Math.min(4, 40 / h)));
    };
    const aDom = ancla(/OMICIL|DOMICI/), aLug = ancla(/LUGAR|NACIMIEN/), aCuil = ancla(/^\W*C[UV][I1L][L1I:]/), aTra = ancla(/TR[AÁ](?:M|RN|N)[I1L]?TE|RAMITE/);
    const aMrz = palabras.find((p) => /[I1][D0O][A4]RG/.test(sinT(p.t).replace(/\s/g, '')));
    // Dónde está la tarjeta dentro de la foto, calculado desde el bloque de la MRZ (siempre en el mismo lugar del reverso:
    // ocupa el 88,5 % del ancho empezando al 6,6 %, y termina al 93,5 % del alto). Así las zonas caen bien aunque
    // el DNI no llene el marco.
    let base = gris, marco = null;
    const mrzPal = palabras.filter((p) => /<</.test(p.t) || /[I1][D0O][A4]RG/.test(sinT(p.t)) || /\d{6}[0-9<]?[MF]/.test(p.t));
    if (mrzPal.length >= 2) {
      const bx0 = Math.min(...mrzPal.map((p) => p.b.x0)), bx1 = Math.max(...mrzPal.map((p) => p.b.x1)), by1 = Math.max(...mrzPal.map((p) => p.b.y1));
      const Wc = (bx1 - bx0) / 0.885, Hc = Wc / 1.586, x0 = bx0 - 0.066 * Wc, y0 = by1 - 0.935 * Hc;
      if (Wc > 300 && Wc < gris.width * 1.4 && x0 > -0.2 * Wc && y0 > -0.2 * Hc) {
        const m = 0.03;
        const fx0 = Math.max(0, (x0 - m * Wc) / gris.width), fy0 = Math.max(0, (y0 - m * Hc) / gris.height);
        const fx1 = Math.min(1, (x0 + (1 + m) * Wc) / gris.width), fy1 = Math.min(1, (y0 + (1 + m) * Hc) / gris.height);
        if ((fx1 - fx0) < 0.94 || (fy1 - fy0) < 0.94) { marco = [fx0, fy0, fx1, fy1]; base = recortarRel(gris, fx0, fy0, fx1, fy1, 1, 4000, 0); log('📐 tarjeta ubicada por la MRZ'); }
      }
    }

    if (!marco && contexto.marcoRel) {   // la foto viene recortada al marco de la cámara: la tarjeta está donde estaba el marco
      marco = contexto.marcoRel; base = recortarRel(gris, marco[0], marco[1], marco[2], marco[3], 1, 4000, 0); log('📐 tarjeta ubicada por el marco de la cámara');
    }

    // 2) MRZ (líneas con <<<): con el motor OCR-B en paralelo con las zonas; si no hay, con el de siempre antes de las zonas
    const textosMRZ = [text], nombresL3 = [];
    // renglón de los nombres (el último con <<), para leerlo solo: así no se pierde la primera letra del apellido
    let rectL3 = null;
    { const filasMRZ = mrzPal.filter((p) => /<</.test(p.t)).sort((p, q) => q.b.y0 - p.b.y0);
      if (filasMRZ.length) { const u = filasMRZ[0], h = u.b.y1 - u.b.y0;
        rectL3 = { y0: Math.max(0, u.b.y0 - 0.45 * h), y1: Math.min(gris.height, u.b.y1 + 0.45 * h), h }; } }
    const tareaMRZ = async (wk) => {
      const propio = wk !== w;
      const pasar = async (img, nombre, psm) => {
        if (!propio) await w.setParameters(PARAMS_MRZ);
        if (psm) await wk.setParameters({ tessedit_pageseg_mode: psm });
        const { data: { text: t } } = await wk.recognize(img);
        if (psm) await wk.setParameters({ tessedit_pageseg_mode: PARAMS_MRZ.tessedit_pageseg_mode });
        raw += `\n--- MRZ ${nombre} ---\n` + (t || ''); log('📄 OCR MRZ ' + nombre + (propio ? ' (OCR-B)' : '') + ':\n' + t);
        return t || '';
      };
      const ok = () => { const id = textosMRZ.map(extraerMRZCompleta).reduce(mejorIdentidad, null); const mz = textosMRZ.map(extraerDesdeMRZ).find((x) => x.mrzVerificada);
        return !!(mz && id && id.verificada && id.dni && id.apellido); };
      // primero con la luz normalizada (en fotos reales es la que mejor lee el OCR-B), después normal y ampliada
      const variantes = [['luz normalizada', 1.3], ['normal', 1.3], ['ampliada', 1.9]];
      for (let i = 0; i < variantes.length; i++) {
        if (i > 0 && ok()) break;
        if (i === 0 && !propio && ok()) break;   // con el motor de siempre, si la pasada general ya alcanzó no se repite
        const fuenteMrz = i === 0 ? await preprocesar(origen, 'fondo') : null;
        textosMRZ.push(await pasar(fuenteMrz ? recortarRel(fuenteMrz, 0, 0.55, 1, 1, variantes[i][1], 3000) : recortarRel(base, 0, 0.6, 1, 1, variantes[i][1], 3000), variantes[i][0]));
      }
      if (rectL3) {   // renglón de los nombres, solo
        const esc = Math.max(1, Math.min(3, 44 / Math.max(8, rectL3.h)));
        const x0 = marco ? marco[0] : 0, x1 = marco ? marco[2] : 1;
        const t3 = await pasar(recortarRel(gris, x0, rectL3.y0 / gris.height, x1, rectL3.y1 / gris.height, esc, 3000), 'renglón de nombres', '7');
        nombresL3.push(t3);
      }
    };
    const wMRZ = await wMRZp;
    const pMRZ = wMRZ ? enColaMRZ(() => tareaMRZ(wMRZ)) : null;
    if (!wMRZ) await tareaMRZ(w);

    // 3) zonas ampliadas: domicilio (arriba), lugar de nacimiento, CUIL y trámite (franja del medio)
    // si se encontró la etiqueta, la zona se ubica a partir de ella; si no, por la posición típica en la tarjeta
    const cDom = (aDom && zonaAncla(aDom, -0.6, -0.5, 48, 2.9)) || recortarRel(base, 0, 0, 0.9, 0.22, 3);
    const cLug = (aLug && zonaAncla(aLug, -1, -0.4, 46, 4.2)) || recortarRel(base, 0, 0.12, 0.66, 0.31, 3);
    const cCuil = (aCuil && zonaAncla(aCuil, -1, -0.4, 14, 2.8)) || recortarRel(base, 0, 0.43, 0.82, 0.64, 2.5);
    const zDom = await ocr(cDom, PARAMS_ZONA, 0.5, 0.58, 'zona domicilio' + (aDom ? ' (por etiqueta)' : ''));
    // la misma zona en blanco y negro (umbral local): con fotos reales es la lectura más limpia de la letra chica
    const zDomB = await ocr(binarizarCanvas(recortarRel(base, 0, 0, 0.9, 0.22, 3)), PARAMS_ZONA, 0.58, 0.62, 'zona domicilio (blanco y negro)');
    const zLug = await ocr(cLug, PARAMS_ZONA_DISPERSA, 0.62, 0.72, 'zona lugar de nacimiento' + (aLug ? ' (por etiqueta)' : ''));
    // lugar también en blanco y negro (en el DNI nuevo va en otro renglón, debajo de la etiqueta, sobre fondo de color)
    const zLugB = await ocr(binarizarCanvas(recortarRel(base, 0, 0.12, 0.66, 0.31, 3)), PARAMS_ZONA, 0.7, 0.72, 'zona lugar (blanco y negro)');
    const zCuil = await ocr(cCuil, PARAMS_ZONA, 0.72, 0.8, 'zona CUIL' + (aCuil ? ' (por etiqueta)' : ''));
    const zTra = (aTra && !tramiteDeTexto(zCuil) && !tramiteDeTexto(text)) ? await ocr(zonaAncla(aTra, -1, -0.4, 12, 2.8) || cCuil, PARAMS_ZONA, 0.8, 0.85, 'zona trámite (por etiqueta)') : zCuil;

    // el domicilio es lo más difícil (letra chica sobre fondo con dibujos): se lee también con la luz normalizada
    // y se elige la lectura más "limpia"
    const baseFn = async () => { const f = await preprocesar(origen, 'fondo'); return marco ? recortarRel(f, marco[0], marco[1], marco[2], marco[3], 1, 4000, 0) : f; };
    // si la primera lectura del domicilio ya es limpia (todas palabras válidas, sin letras sueltas), se evita la segunda
    const domPrimera = [extraerDomicilio(zDom), domicilioDeZona(zDom)].filter(Boolean).sort((a, b) => puntajeDireccion(b) - puntajeDireccion(a))[0];
    const domPrimeraB = [extraerDomicilio(zDomB), domicilioDeZona(zDomB)].filter(Boolean).sort((a, b) => puntajeDireccion(b) - puntajeDireccion(a))[0];
    const limpia = [domPrimera, domPrimeraB].some((domPrimera) => domPrimera && domPrimera.split(/[\s,]+/).filter(Boolean).length >= 4 && puntajeDireccion(domPrimera) >= domPrimera.split(/[\s,]+/).filter(Boolean).length + 4);
    const cDomF = limpia || (aDom && marco === null && zonaAncla(aDom, -0.6, -0.5, 48, 2.9)) ? null : recortarRel(await baseFn(), 0, 0, 0.9, 0.19, 3);
    const zDomF = cDomF ? await ocr(cDomF, PARAMS_ZONA, 0.85, 0.9, 'zona domicilio (luz normalizada)') : '';
    const candDom = [extraerDomicilio(zDom), domicilioDeZona(zDom), extraerDomicilio(zDomB), domicilioDeZona(zDomB), extraerDomicilio(zDomF), domicilioDeZona(zDomF), extraerDomicilio(text)].filter(Boolean);
    // se elige la lectura más limpia, sumando puntos si otras lecturas dicen casi lo mismo (dos lecturas que coinciden
    // son más confiables que una sola que "suena bien")
    const candDomN = candDom.map((v) => arreglarProvincias(arreglarSimbolos(v), true)).filter(Boolean);
    const acuerdo = (v) => candDomN.filter((x) => x !== v && parecido(x, v) >= 0.85).length;
    let domicilio = candDomN.map((v) => ({ v, p: puntajeDireccion(v) + 2 * acuerdo(v) })).sort((a, b) => b.p - a.p)[0];
    domicilio = domicilio ? domicilio.v : null;
    // lugar: entre todas las lecturas, la más completa y limpia (la zona a veces corta el final: "ROSARIO DE LEF")
    // primero lo que viene después de la etiqueta "Lugar de nacimiento" (en la misma línea o en la siguiente);
    // la zona sin etiqueta solo si no hay nada (si no, se confundía con el 2.º renglón del domicilio)
    const textosLug = [zLug, zLugB, zDom, zDomB, zDomF, text];
    let candLug = textosLug.flatMap((t) => [extraerLugarNacimiento(t), lugarTrasEtiqueta(t)]).filter(Boolean);
    if (!candLug.length) candLug = [lugarDeZona(zLug), lugarDeZona(zLugB)].filter(Boolean);
    // fuera lo que en realidad es el 2.º renglón del domicilio (mismas palabras, aunque mal leídas)
    const tokDom = String(domicilio || '').toUpperCase().split(/[\s,.\-]+/).filter((t) => t.length >= 4 && !PROVINCIAS.includes(t) && t !== 'CAPITAL');
    const pareceDom = (v) => { const t = String(v).toUpperCase().split(/[\s,.\-]+/).filter((x) => x.length >= 4 && !PROVINCIAS.includes(x) && x !== 'CAPITAL');
      return t.length >= 2 && t.filter((x) => tokDom.some((d) => parecido(x, d) >= 0.6)).length >= Math.ceil(t.length * 0.6); };
    candLug = candLug.filter((v) => !pareceDom(v) && !(domicilio && String(domicilio).toUpperCase().includes(String(v).toUpperCase()) && String(v).length > 8));
    const sinCola = (v) => {
      const t = v.split(' ');
      const basura = (w, prev) => { const x = w.replace(/[.,]/g, '').toUpperCase(); const p = (prev || '').replace(/[.,]/g, '').toUpperCase();
        return (/^[A-ZÁÉÍÓÚÑ]{1,3}$/.test(x) && !VOCAB_DIR.has(x)) || /^\d+$/.test(x) || (x.length >= 3 && p.length > x.length && p.endsWith(x)); };   // "SALTA ALTA", "JUJUY 17"
      while (t.length > 1 && basura(t[t.length - 1], t[t.length - 2])) t.pop();
      return t.join(' ').replace(/[\s,.\-]+$/, '');
    };
    // (sin letras sueltas ni guiones repetidos: "SALTA - - A 1 SANTA")
    const limpiarLug = (v) => String(v).toUpperCase().split(' ').filter((t) => !/^[A-ZÁÉÍÓÚÑ0-9]$/.test(t) || t === 'Y').join(' ').replace(/(\s-)+\s-/g, ' -').replace(/\s+/g, ' ').trim();
    const candLugN = candLug.map((v) => arreglarProvincias(sinCola(limpiarLug(v)))).filter((v) => v && !/DOMICILIO/i.test(v));
    const acuerdoL = (v) => candLugN.filter((x) => x !== v && parecido(x, v) >= 0.85).length;
    const malasL = (v) => v.split(/[\s,]+/).filter((t) => t && !VOCAB_DIR.has(t) && !/^[A-ZÁÉÍÓÚÑ.]{3,}$/.test(t)).length;
    let lugar = candLugN.slice().sort((a, b) => (puntajeDireccion(b) + 2 * acuerdoL(b) - 2 * malasL(b)) - (puntajeDireccion(a) + 2 * acuerdoL(a) - 2 * malasL(a)) || b.length - a.length)
      .filter((v) => v && !/DOMICILIO/i.test(v))[0] || null;
    // CUIL: primero una lectura que cierre sola con el dígito verificador (en cualquiera de las lecturas); recién después se repara
    if (pMRZ) await pMRZ;
    let mrz = textosMRZ.map(extraerDesdeMRZ).find((x) => x.mrzVerificada) || textosMRZ.map(extraerDesdeMRZ).find((x) => x.fechaVencimiento) || extraerDesdeMRZ(text);
    let ident = textosMRZ.map(extraerMRZCompleta).reduce(mejorIdentidad, null);
    votarNombresMRZ(ident, textosMRZ, nombresL3);

    // Un CUIL que cierra solo con su dígito verificador trae el DNI bien: corrige un número de la MRZ mal leído
    // ("25122159" por "25122169"), siempre que el dígito de control de la MRZ también cierre con el corregido.
    const textosCuil0 = [zCuil, text, zDom + '\n' + zLug, zDomB].concat(textosMRZ.slice(1));   // (el CUIL a veces sale en la lectura de la MRZ)
    const cuilLibre = textosCuil0.map((t) => extraerCUIL(t, { estricto: true })).find(Boolean);
    if (cuilLibre && ident && ident.dni) {
      const mid = cuilLibre.split('-')[1].replace(/^0+/, '');
      let dif = 0; for (let k = 0; k < Math.max(mid.length, ident.dni.length); k++) if (mid[k] !== ident.dni[k]) dif++;
      if (mid !== ident.dni && mid.length === ident.dni.length && dif <= 2 &&
          (ident.dcDoc == null || String(digitoControl((mid + '<<<<<<<<<').slice(0, 9))) === ident.dcDoc)) {
        log('🔧 DNI de la MRZ corregido con el CUIL: ' + ident.dni + ' → ' + mid);
        ident.dni = mid; if (ident.checks) ident.checks.documento = true;
      }
    }
    const sexoMRZ = ident && ident.sexo ? ident.sexo[0] : null;
    const ctxC = Object.assign({}, contexto, { sexo: sexoMRZ, dni: contexto.dni || (ident && ident.verificada && ident.dni) || (ident && ident.dni) });
    const textosCuil = textosCuil0;
    // un CUIL que cierra solo y coincide con el DNI que ya se conoce (del QR, del código de barras o de la MRZ) es el bueno
    const midLibre = cuilLibre ? cuilLibre.split('-')[1].replace(/^0+/, '') : null;
    const dniConocidos = [contexto.dni, ident && ident.dni].filter(Boolean).map((d) => String(d).replace(/\D/g, '').replace(/^0+/, ''));
    const cuil = (midLibre && dniConocidos.includes(midLibre) ? cuilLibre : null)
      || textosCuil.map((t) => extraerCUIL(t, Object.assign({ estricto: true }, ctxC))).find(Boolean)
      || textosCuil.map((t) => extraerCUIL(t, ctxC)).find(Boolean) || null;
    const tramite = tramiteDeTexto(zTra) || tramiteDeTexto(zCuil) || tramiteDeTexto(text);

    // 4) último recurso para la letra fina de arriba: zona binarizada
    if (!domicilio || !lugar) {
      const tz = await ocr(binarizarCanvas(recortarSuperior(gris, 0.4)), PARAMS_ZONA, 0.85, 0.97, 'zona superior binarizada');
      domicilio = domicilio || arreglarSimbolos(extraerDomicilio(tz) || domicilioDeZona(tz));
      lugar = lugar || extraerLugarNacimiento(tz) || lugarTrasEtiqueta(tz);
    }
    await w.setParameters(PARAMS_TEXTO);
    if (progresoCb) progresoCb(1);

    return {
      raw,
      identidad: ident,
      domicilio,
      lugarNacimiento: lugar,
      cuil,
      tramite,
      fechaVencimiento: mrz.fechaVencimiento,
      nacionalidad: mrz.nacionalidad,
      mrzVerificada: mrz.mrzVerificada
    };
  }

  return {
    leer: (...a) => enCola(() => leer(...a)),
    consensoTexto, mejorLugar,
    leerReversoRapido: (...a) => enCola(() => leerReversoRapido(...a)),
    leerReversoFoto: (...a) => enCola(() => leerReversoFoto(...a)),
    calcularCUIL,
    leerTexto: (...a) => enCola(() => leerTexto(...a)),
    leerFrente: (...a) => enCola(() => leerFrente(...a)),
    nativoDisponible: ocrNativoDisponible,
    cancelarFrente,
    abortarFrente,
    precargarMRZ: () => { initWorkerMRZ(); },
    prepararSinInternet: async () => {   // carga (y deja guardados) los dos motores; devuelve si quedaron listos
      const [a, b] = await Promise.allSettled([initWorker(), initWorkerMRZ()]);
      return { texto: a.status === 'fulfilled' && !!a.value, mrz: b.status === 'fulfilled' && !!b.value };
    },
    pareceReverso,
    precargar,
    liberar,
    setDebug: (v) => { DEBUG = !!v; },
    extraerDomicilio,
    extraerLugarNacimiento,
    extraerCUIL,
    domicilioDeZona,
    lugarDeZona,
    tramiteDeTexto,
    extraerDesdeMRZ,
    cuilValido,
    umbralLocal,
    extraerMRZCompleta,
    mejorIdentidad,
    digitoControl
  };
})();
