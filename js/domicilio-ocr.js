/**
 * OCR del reverso del DNI argentino (Versión Rápida - 2 Pasadas)
 */

const DomicilioOCR = (() => {
  'use strict';

  let DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log(...args); };

  const ANCHO_MAX = 1600; 
  const ANCHO_MIN = 1200; 

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

  let workerPromise = null;
  let progresoCb = null;

  function initWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('spa', 1, {
        logger: (m) => {
          if (progresoCb && m.status === 'recognizing text') {
            progresoCb(m.progress);
          }
        }
      }).catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  async function precargar() {
    const w = await initWorker();
    await w.setParameters(PARAMS_TEXTO);
  }

  async function liberar() {
    if (!workerPromise) return;
    const p = workerPromise;
    workerPromise = null;
    try { const w = await p; await w.terminate(); } catch (e) {}
  }

  function aElemento(fuente) {
    if (typeof fuente !== 'string') return Promise.resolve(fuente);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      im.src = fuente;
    });
  }

  function preprocesar(el) {
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

    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = g;
      hist[g]++;
    }

    const total = w * h;
    let acc = 0, lo = 0, hi = 255;
    for (let g = 0; g < 256; g++) { acc += hist[g]; if (acc >= total * 0.01) { lo = g; break; } }
    acc = 0;
    for (let g = 255; g >= 0; g--) { acc += hist[g]; if (acc >= total * 0.01) { hi = g; break; } }
    if (hi - lo < 30) { lo = 0; hi = 255; }
    const k = 255 / (hi - lo);

    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return c;
  }

  function recortar(c, desdeY, hastaY) {
    const y1 = Math.round(c.height * desdeY);
    const y2 = Math.round(c.height * hastaY);
    const h = y2 - y1;
    const r = document.createElement('canvas');
    r.width = c.width;
    r.height = h;
    r.getContext('2d').drawImage(c, 0, y1, c.width, h, 0, 0, c.width, h);
    return r;
  }

  const CLASES = { A: '[A4ÁÀ]', E: '[E3ÉÈ]', I: '[I1LÍÌ]', L: '[L1I]', O: '[O0ÓÒ]', U: '[UÚÜ]', S: '[S5]', B: '[B8]', G: '[G6]', Z: '[Z2]' };
  const tol = (palabras) => palabras.split(' ').map(p => [...p].map(ch => CLASES[ch] || ch).join('')).join('\\s*');
  const unir = (lista) => lista.map(x => tol(x)).join('|');

  const L_DOMICILIO = tol('DOMICILIO');
  const L_LUGAR_NAC = tol('LUGAR DE NACIMIENTO');
  const L_CUIL = tol('CUIL');

  const STOPS_DOMICILIO = unir(['LUGAR', 'NACIMIENTO', 'TRAMITE', 'EJEMPLAR', 'CUIL', 'FECHA', 'NACIONALIDAD', 'IDARG']);
  const STOPS_LUGAR = unir(['DOMICILIO', 'TRAMITE', 'EJEMPLAR', 'CUIL', 'FECHA', 'NACIONALIDAD', 'IDARG']);

  function normalizar(texto) {
    return (texto || '').toUpperCase().replace(/[|_=~`]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function limpiarValor(v) {
    return v.replace(/^(?:ADDRESS|PLACE OF BIRTH)\b[\s:./-]*/i, '').replace(/\s+/g, ' ').replace(/^[\s:./-]+|[\s:.,/-]+$/g, '').trim();
  }

  function valorValido(v) {
    if (!v || v.length < 4 || v.length > 150 || v.includes('<')) return false;
    return (v.match(/[A-ZÁÉÍÓÚÑ0-9]/gi) || []).length >= 3;
  }

  function titulo(s) {
    return s.toLowerCase().replace(/(^|[\s(])([^\s(])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bS\/n\b/g, 'S/N').replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii)\b/g, (m) => m.toUpperCase());
  }

  function extraerCampo(texto, etiqueta, stops) {
    const t = normalizar(texto);
    const re = new RegExp(`${etiqueta}[:\\s./-]*(.*?)(?=\\s(?:${stops})|<|$)`, 'i');
    const m = re.exec(t);
    if (!m) return null;
    const v = limpiarValor(m[1]);
    return valorValido(v) ? titulo(v) : null;
  }

  function extraerDomicilio(texto) { return extraerCampo(texto, L_DOMICILIO, STOPS_DOMICILIO); }
  function extraerLugarNacimiento(texto) { return extraerCampo(texto, L_LUGAR_NAC, STOPS_LUGAR); }

  const PREFIJOS_CUIL = ['20', '23', '24', '27', '30', '33', '34'];
  const PESOS_CUIL = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  
  function cuilValido(c) {
    const d = String(c).replace(/\D/g, '');
    if (d.length !== 11 || !PREFIJOS_CUIL.includes(d.slice(0, 2))) return false;
    const suma = PESOS_CUIL.reduce((a, p, i) => a + p * Number(d[i]), 0);
    let v = 11 - (suma % 11);
    if (v === 11) v = 0;
    return v === Number(d[10]);
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
    const i = t.search(new RegExp(L_CUIL, 'i'));
    const cercano = i >= 0 ? t.slice(i, i + 40).replace(/[OQDIL|ZSBG]/g, ch => A_DIGITO_CUIL[ch] || ch) : '';
    return (cercano && buscar(cercano, true)) || buscar(t, true) || (cercano && buscar(cercano, false)) || null;
  }

  const NACIONALIDADES = { ARG: 'ARGENTINA', CHL: 'CHILENA', URY: 'URUGUAYA', PRY: 'PARAGUAYA', PER: 'PERUANA', BOL: 'BOLIVIANA', COL: 'COLOMBIANA', ECU: 'ECUATORIANA', VEN: 'VENEZOLANA', BRA: 'BRASILEÑA' };
  const A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };
  const A_LETRA = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 8: 'B', 6: 'G' };
  const RE_MRZ = /(\d{6})([0-9<])([MF<])(\d{2})(\d{2})(\d{2})([0-9<])([A-Z]{3})/;

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

  function repararLinea2(l) {
    if (l.length < 28 || l.length > 32) return null;
    const a = [...l];
    for (let i = 0; i <= 14; i++) if (i !== 7) a[i] = A_DIGITO[a[i]] || a[i];
    for (let i = 15; i <= 17; i++) a[i] = A_LETRA[a[i]] || a[i];
    return a.join('');
  }

  function leerLineaMRZ(l) {
    const m = RE_MRZ.exec(l);
    if (!m) return null;
    const [, nacim, dcNacim, , yy, mm, dd, dcVenc, pais] = m;
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    return {
      fechaVencimiento: `20${yy}-${mm}-${dd}`,
      nacionalidad: NACIONALIDADES[pais] || pais,
      mrzVerificada: String(digitoControl(nacim)) === dcNacim && String(digitoControl(yy + mm + dd)) === dcVenc
    };
  }

  function extraerDesdeMRZ(texto) {
    const vacio = { fechaVencimiento: null, nacionalidad: null, mrzVerificada: null };
    if (!texto) return vacio;
    const lineas = texto.toUpperCase().split(/[\r\n]+/).map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 20);
    const hallazgos = [];
    for (const l of lineas) {
      for (const cand of [l, repararLinea2(l)]) {
        const h = cand && leerLineaMRZ(cand);
        if (h) hallazgos.push(h);
      }
    }
    return hallazgos.find(h => h.mrzVerificada) || hallazgos[0] || vacio;
  }

  // LECTURA RÁPIDA (Solo 2 pasadas)
  async function leer(fuente, pais = 'arg', onProgress, contexto = {}) {
    void pais;
    progresoCb = typeof onProgress === 'function' ? onProgress : null;

    const w = await initWorker();
    const origen = await aElemento(fuente);
    const gris = preprocesar(origen);

    // Pasada 1: Solo el pedazo de arriba (Domicilio y Lugar)
    const zonaSuperior = recortar(gris, 0, 0.60);
    await w.setParameters(PARAMS_TEXTO);
    const { data: { text: textArriba } } = await w.recognize(zonaSuperior);
    
    // Pasada 2: Solo el pedazo de abajo (MRZ)
    const zonaInferior = recortar(gris, 0.60, 1);
    await w.setParameters(PARAMS_MRZ);
    const { data: { text: textAbajo } } = await w.recognize(zonaInferior);

    const mrz = extraerDesdeMRZ(textAbajo);

    if (progresoCb) progresoCb(1);

    return {
      raw: '--- ARRIBA ---\n' + textArriba + '\n--- ABAJO ---\n' + textAbajo,
      domicilio: extraerDomicilio(textArriba),
      lugarNacimiento: extraerLugarNacimiento(textArriba),
      cuil: extraerCUIL(textArriba, contexto),
      fechaVencimiento: mrz.fechaVencimiento,
      nacionalidad: mrz.nacionalidad,
      mrzVerificada: mrz.mrzVerificada
    };
  }

  return { leer, precargar, liberar, setDebug: (v) => { DEBUG = !!v; }, extraerDomicilio, extraerLugarNacimiento, extraerCUIL, extraerDesdeMRZ, cuilValido };
})();
