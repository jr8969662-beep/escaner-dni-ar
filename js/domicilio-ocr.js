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

  function initWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('spa', 1, {
        logger: (m) => {
          if (progresoCb && m.status === 'recognizing text') {
            progresoCb(etapaDesde + m.progress * (etapaHasta - etapaDesde));
          }
        }
      }).catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // Carga el motor y el idioma en segundo plano (llamarlo al abrir el modal, antes de capturar)
  async function precargar() {
    const w = await initWorker();
    await w.setParameters(PARAMS_TEXTO);
  }

  // Solo texto, para leer el FRENTE del DNI nuevo: dos pasadas (párrafo y texto disperso), sin whitelist
  async function leerTexto(fuente, onProgress) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    const gris = preprocesar(await aElemento(fuente));
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
    if (/APELL|PELLID/.test(U)) return { k: 'apellido', izq: 1.5, ancho: 26 };
    if (/SURNAM|URNAME/.test(U)) return { k: 'apellido', izq: 6.5, ancho: 26 };
    if (/NOMBR|OMBRE/.test(U) && !/SUR/.test(U)) return { k: 'nombre', izq: 1.5, ancho: 26 };
    if (/^\W*\/?NAME\W*$/.test(U) || (/\/NAME/.test(U) && !/SUR/.test(U))) return { k: 'nombre', izq: 5, ancho: 26 };
    if (/NACIM|ACIMIEN/.test(U)) return { k: 'nac', izq: 5, ancho: 17 };
    if (/BIRTH/.test(U)) return { k: 'nac', izq: 14, ancho: 22 };
    if (/EMISI|MISION/.test(U)) return { k: 'emi', izq: 5, ancho: 15 };
    if (/ISSUE/.test(U)) return { k: 'emi', izq: 12, ancho: 20 };
    if (/VENCIM|ENCIMI/.test(U)) return { k: 'ven', izq: 5, ancho: 15 };
    if (/EXPIR/.test(U)) return { k: 'ven', izq: 13, ancho: 20 };
    if (/ocumento/.test(t)) return { k: 'doc', izq: 0.4, ancho: 14, alto: 3 };      // "Documento" (no el título en mayúsculas)
    if (/ocument\b/.test(t)) return { k: 'doc', izq: 6.5, ancho: 16, alto: 3 };
    if (/TRAMIT|RAMITE/.test(U)) return { k: 'tramite', izq: 0.4, ancho: 12, alto: 2.6 };
    return null;
  }

  // FRENTE del DNI (viejo y nuevo). 1) texto disperso de la imagen completa + posición de las etiquetas;
  // 2) se relee AMPLIADA la línea que está debajo de "Apellido" y de "Nombre" (ahí falla más el OCR);
  // 3) una pasada más de párrafo. Corta apenas tiene todo. Devuelve los textos (+ .nombres) para votar.
  async function leerFrente(fuente, onProgress, suficiente) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    const origen = await aElemento(fuente);
    const gris = preprocesar(origen);              // contraste estirado
    const grisF = preprocesar(origen, 'fondo');    // iluminación normalizada (sombras, reflejos, fondo de color)
    const textos = [];
    textos.nombres = { apellido: [], nombre: [] };
    const listo = () => typeof suficiente === 'function' && suficiente(textos);
    const setPsm = (psm) => w.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1', tessedit_pageseg_mode: psm });

    // 1) imagen completa, texto disperso, con posiciones
    etapa(0, 0.3);
    await setPsm('11');
    const r1 = await w.recognize(grisF, {}, { text: true, blocks: true });
    textos.push(r1.data.text || '');
    log('📄 OCR frente (disperso):\n' + r1.data.text);

    // 2) zonas debajo de las etiquetas: nombres, fechas, número y trámite, releídos ampliados
    textos.zonas = { nac: [], emi: [], ven: [], doc: [], tramite: [] };
    const etiquetas = [];
    palabrasDe(r1.data).forEach((p) => {
      const e = p.b && tipoEtiqueta(p.t);
      if (!e) return;
      // etiqueta en dos renglones ("Fecha de emisión/" + "Date of issue"): el dato está debajo del renglón de más abajo
      const prev = etiquetas.find((x) => x.k === e.k);
      if (!prev) etiquetas.push(Object.assign({ b: p.b }, e));
      else if (p.b.y0 > prev.b.y1 && p.b.y0 - prev.b.y1 < 2 * (prev.b.y1 - prev.b.y0) && Math.abs((p.b.x0 - e.izq * (p.b.y1 - p.b.y0)) - (prev.b.x0 - prev.izq * (prev.b.y1 - prev.b.y0))) < 8 * (prev.b.y1 - prev.b.y0)) {
        Object.assign(prev, { b: p.b }, e);
      }
    });
    if (etiquetas.length) {
      await setPsm('7');
      for (let i = 0; i < etiquetas.length; i++) {
        etapa(0.3 + i * (0.2 / etiquetas.length), 0.3 + (i + 1) * (0.2 / etiquetas.length));
        const e = etiquetas[i], h = Math.max(8, e.b.y1 - e.b.y0);
        const x0 = Math.max(0, Math.round(e.b.x0 - e.izq * h)), x1 = Math.min(gris.width, Math.round(x0 + e.ancho * h));
        const y0 = Math.round(e.b.y1 + 0.1 * h), y1 = Math.min(gris.height, Math.round(e.b.y1 + (e.alto || 2.4) * h));
        if (x1 - x0 < 20 || y1 - y0 < 8) continue;
        const esc = Math.max(1, Math.min(4, 48 / h));
        const recorte = (base) => {
          const z = document.createElement('canvas');
          z.width = Math.round((x1 - x0) * esc); z.height = Math.round((y1 - y0) * esc);
          const zc = z.getContext('2d'); zc.imageSmoothingQuality = 'high';
          zc.drawImage(base, x0, y0, x1 - x0, y1 - y0, 0, 0, z.width, z.height);
          return z;
        };
        const destino = textos.nombres[e.k] || textos.zonas[e.k];
        const { data: { text } } = await w.recognize(recorte(gris));
        destino.push(text || '');
        log('📄 zona ' + e.k + ': ' + text);
        // fechas / números que no salieron legibles: otra vez con la luz normalizada
        const pareceDato = e.k === 'apellido' || e.k === 'nombre' ? true
          : (e.k === 'doc' ? /\d{2}[.\s]?\d{3}[.\s]?\d{3}/.test(text) : e.k === 'tramite' ? /\d{11}/.test(text) : /\d{1,2}\s*[.\/A-Z]{1,4}[^\n]*(19|20)\d{2}/i.test(text));
        if (!pareceDato) {
          const { data: { text: t2 } } = await w.recognize(recorte(grisF));
          destino.push(t2 || '');
          log('📄 zona ' + e.k + ' (luz normalizada): ' + t2);
        }
      }
    }

    // 3) más pasadas de la imagen completa, solo mientras falte algo
    const extra = [[gris, '6', 'párrafo'], [grisF, '6', 'párrafo, luz normalizada'], [gris, '11', 'disperso']];
    for (let i = 0; i < extra.length && !listo(); i++) {
      etapa(0.5 + i * 0.16, 0.66 + i * 0.16);
      await setPsm(extra[i][1]);
      const { data: { text } } = await w.recognize(extra[i][0]);
      textos.push(text || '');
      log('📄 OCR frente (' + extra[i][2] + '):\n' + text);
    }
    await w.setParameters(PARAMS_TEXTO);
    if (progresoCb) progresoCb(1);
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

  function preprocesar(el, modo) {
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
    const d = imgData.data;

    // Escala de grises + histograma
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = g;
      hist[g]++;
    }

    // Modo "fondo": divide cada píxel por el brillo del fondo de su zona (fondo estimado achicando la imagen).
    // Saca sombras, reflejos suaves y el fondo de color del documento: el texto queda negro sobre blanco.
    if (modo === 'fondo') {
      const sw = Math.max(8, Math.round(w / 24)), sh = Math.max(8, Math.round(h * sw / w));
      const chico = document.createElement('canvas'); chico.width = sw; chico.height = sh;
      const cc = chico.getContext('2d', { willReadFrequently: true });
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      const tc = tmp.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
      tc.putImageData(imgData, 0, 0);
      cc.imageSmoothingQuality = 'high'; cc.drawImage(tmp, 0, 0, sw, sh);
      const fondo = document.createElement('canvas'); fondo.width = w; fondo.height = h;
      const fc = fondo.getContext('2d', { willReadFrequently: true });
      fc.imageSmoothingEnabled = true; fc.drawImage(chico, 0, 0, w, h);
      const bg = fc.getImageData(0, 0, w, h).data;
      hist.fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.min(255, (d[i] / Math.max(1, bg[i])) * 200) | 0;
        d[i] = v; hist[v]++;
      }
    }

    // Estirar contraste entre los percentiles 1 % y 99 % (se adapta a la luz de cada foto)
    const total = w * h;
    let acc = 0, lo = 0, hi = 255;
    for (let g = 0; g < 256; g++) { acc += hist[g]; if (acc >= total * 0.01) { lo = g; break; } }
    acc = 0;
    for (let g = 255; g >= 0; g--) { acc += hist[g]; if (acc >= total * 0.01) { hi = g; break; } }
    if (hi - lo < 30) { lo = 0; hi = 255; } // imagen casi plana: no estirar
    const k = 255 / (hi - lo);

    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
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
  function limpiarTextoDato(v) {
    return v.toUpperCase().replace(/\bV[*°º]/g, 'Vª').replace(/[^A-Z0-9ÁÉÍÓÚÜÑªº°.,\-/() ]/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s:.,\-/]+|[\s:.,\-/]+$/g, '').replace(/\s+([,.])/g, '$1').replace(/\s*-\s*/g, ' - ').trim();
  }
  // Domicilio: zona de 2 líneas arriba del reverso. La 1.ª empieza con la etiqueta (a veces mal leída): se saca.
  function domicilioDeZona(t) {
    const ls = String(t || '').split(/\r?\n/).map((l) => l.replace(/\s{3,}\S{1,2}\s*$/, '').replace(/^\s*\S{1,2}\s{3,}/, '')).join('\n');
    return domicilioDeLineas(lineasDe(ls));
  }
  function domicilioDeLineas(lineas) {
    const ls = lineas.filter((l) => !esLineaEtiqueta(l, ['LUGAR', 'NACIMIENTO']));
    if (!ls.length) return null;
    let l1 = ls[0];
    const m = /^\W*([A-Za-zÁÉÍÓÚáéíóú]{3,12})[.:,]?\s+(.*)$/.exec(l1);
    if (m && (parecido(m[1], 'DOMICILIO') >= 0.4 || /[a-z]/.test(m[1]))) l1 = m[2];
    const partes = [l1].concat(ls.slice(1, 2).filter((l) => (l.match(/[A-Z]/g) || []).length >= 4));
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
    'S/N SN FRONTERA ROSARIO GENERAL GRAL DOCTOR DR PRESIDENTE INGENIERO JUJUY TUCUMAN CORDOBA BUENOS AIRES ORAN TARTAGAL METAN CERRILLOS').split(' '));
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
    const m = /(?<!\d)(\d{9,11})(?!\d)/.exec(T.slice(i).replace(/(\d)[OQD]|[OQD](\d)/g, (x) => x.replace(/[OQD]/, '0')));
    return m ? m[1] : null;
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

    const reparado = () => {   // "90-25122169-4": prefijo mal leído; se prueba con los prefijos válidos
      for (const seg of [cercano, t]) {
        if (!seg) continue;
        for (const m of seg.matchAll(/(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)(?!\d)/g)) {
          if (dniPad && m[2] !== dniPad) continue;
          for (const p of PREFIJOS_CUIL) { const c = `${p}-${m[2]}-${m[3]}`; if (cuilValido(c)) return c; }
        }
      }
      return null;
    };
    return (cercano && buscar(cercano, true))
      || buscar(t, true)
      || (cercano && buscar(cercano, false))
      || reparado()
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

  function extraerMRZCompleta(texto) {
    const lineas = (texto || '').toUpperCase().split(/[\r\n]+/)
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
    let dni = null, docOk = null;
    let l1orig = lineas.find(l => l !== l2orig && /^[I1][D0O<]ARG/.test(l));
    if (!l1orig) { const c = lineas.find(l => l !== l2orig && /[I1][D0O]ARG[0-9OQDILZSBG]{7}/.test(l)); if (c) l1orig = c.slice(c.search(/[I1][D0O]ARG/)); }
    if (l1orig) {
      const a = [...l1orig];
      const dcDoc = A_DIGITO[a[14]] || a[14];
      const rep = repararCampo(a.slice(5, 14).join(''), dcDoc || '?');
      for (let i = 5; i <= 14 && i < a.length; i++) a[i] = A_DIGITO[a[i]] || a[i];
      const campo = rep ? rep.valor : a.slice(5, 14).join('');
      dni = campo.replace(/</g, '').replace(/\D/g, '') || null;
      docOk = rep && rep.ok !== null ? rep.ok : String(digitoControl(campo)) === a[14];
    }

    // Línea 3 (nombres)
    let apellido = null, nombre = null, truncado = false;
    const l3 = lineas.find(l => l !== l2orig && l !== l1orig && l.includes('<<') && (l.match(/\d/g) || []).length <= 2);
    if (l3) {
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
      checks: { documento: docOk, nacimiento: nacOk, vencimiento: vencOk, compuesto: compOk }
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
  // LECTURA COMPLETA
  // ============================================
  async function leer(fuente, pais = 'arg', onProgress, contexto = {}) {
    void pais; // reservado para otros países
    progresoCb = typeof onProgress === 'function' ? onProgress : null;

    const w = await initWorker();
    const origen = await aElemento(fuente);
    const gris = preprocesar(origen);
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
    const r1 = await w.recognize(gris, {}, { text: true, blocks: true });
    const text = r1.data.text || '';
    raw += '\n--- reverso completo ---\n' + text;
    log('📄 OCR reverso completo:\n' + text);
    const palabras = palabrasDe(r1.data).filter((p) => p.b);
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

    // 2) MRZ (líneas con <<<) del borde inferior; si los dígitos de control no cierran, otra vez con la luz normalizada
    let mrz = extraerDesdeMRZ(text);
    let ident = extraerMRZCompleta(text);
    const identCompleta = () => ident && ident.verificada && ident.dni && ident.apellido;
    if (!mrz.mrzVerificada || !identCompleta()) {
      const variantes = [['normal', 1.3], ['ampliada', 1.9], ['luz normalizada', 1.3]];
      for (let i = 0; i < variantes.length && !(mrz.mrzVerificada && identCompleta()); i++) {
        const fuenteMrz = i === 2 ? preprocesar(origen, 'fondo') : null;
        const t = await ocr(fuenteMrz ? recortarRel(fuenteMrz, 0, 0.55, 1, 1, variantes[i][1], 3000) : recortarRel(base, 0, 0.6, 1, 1, variantes[i][1], 3000), PARAMS_MRZ, 0.25 + i * 0.08, 0.33 + i * 0.08, 'MRZ ' + variantes[i][0]);
        const cand = extraerDesdeMRZ(t);
        if (cand.mrzVerificada || (!mrz.fechaVencimiento && cand.fechaVencimiento)) mrz = cand;
        ident = mejorIdentidad(ident, extraerMRZCompleta(t));
      }
    }

    // 3) zonas ampliadas: domicilio (arriba), lugar de nacimiento, CUIL y trámite (franja del medio)
    // si se encontró la etiqueta, la zona se ubica a partir de ella; si no, por la posición típica en la tarjeta
    const cDom = (aDom && zonaAncla(aDom, -0.6, -0.5, 48, 2.9)) || recortarRel(base, 0, 0, 0.9, 0.19, 3);
    const cLug = (aLug && zonaAncla(aLug, -1, -0.4, 26, 2.6)) || recortarRel(base, 0, 0.12, 0.62, 0.28, 3);
    const cCuil = (aCuil && zonaAncla(aCuil, -1, -0.4, 14, 2.8)) || recortarRel(base, 0, 0.43, 0.82, 0.64, 2.5);
    const zDom = await ocr(cDom, PARAMS_ZONA, 0.5, 0.62, 'zona domicilio' + (aDom ? ' (por etiqueta)' : ''));
    const zLug = await ocr(cLug, PARAMS_ZONA_DISPERSA, 0.62, 0.72, 'zona lugar de nacimiento' + (aLug ? ' (por etiqueta)' : ''));
    const zCuil = await ocr(cCuil, PARAMS_ZONA, 0.72, 0.8, 'zona CUIL' + (aCuil ? ' (por etiqueta)' : ''));
    const zTra = aTra ? await ocr(zonaAncla(aTra, -1, -0.4, 12, 2.8) || cCuil, PARAMS_ZONA, 0.8, 0.85, 'zona trámite (por etiqueta)') : zCuil;

    // el domicilio es lo más difícil (letra chica sobre fondo con dibujos): se lee también con la luz normalizada
    // y se elige la lectura más "limpia"
    const baseF = (() => { const f = preprocesar(origen, 'fondo'); return marco ? recortarRel(f, marco[0], marco[1], marco[2], marco[3], 1, 4000, 0) : f; })();
    const cDomF = (aDom && marco === null && zonaAncla(aDom, -0.6, -0.5, 48, 2.9)) ? null : recortarRel(baseF, 0, 0, 0.9, 0.19, 3);
    const zDomF = cDomF ? await ocr(cDomF, PARAMS_ZONA, 0.85, 0.9, 'zona domicilio (luz normalizada)') : '';
    const candDom = [extraerDomicilio(zDom), domicilioDeZona(zDom), extraerDomicilio(zDomF), domicilioDeZona(zDomF), extraerDomicilio(text)].filter(Boolean);
    let domicilio = candDom.sort((a, b) => puntajeDireccion(b) - puntajeDireccion(a))[0] || null;
    let lugar = extraerLugarNacimiento(zLug) || lugarDeZona(zLug) || extraerLugarNacimiento(text) || lugarTrasEtiqueta(text);
    const cuil = extraerCUIL(zCuil, contexto) || extraerCUIL(text, contexto) || extraerCUIL(zDom + '\n' + zLug, contexto);
    const tramite = tramiteDeTexto(zTra) || tramiteDeTexto(zCuil) || tramiteDeTexto(text);

    // 4) último recurso para la letra fina de arriba: zona binarizada
    if (!domicilio || !lugar) {
      const tz = await ocr(binarizarCanvas(recortarSuperior(gris, 0.4)), PARAMS_ZONA, 0.85, 0.97, 'zona superior binarizada');
      domicilio = domicilio || extraerDomicilio(tz) || domicilioDeZona(tz);
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
    leer,
    leerTexto,
    leerFrente,
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
