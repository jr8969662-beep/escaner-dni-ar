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

  // FRENTE del DNI nuevo: la imagen debe ser la tarjeta (recortada al marco). Pasadas: párrafo, texto disperso y dos zonas
  // ampliadas (nombres; documento + fechas). Devuelve los textos para que FrenteDNI decida cada dato por votación.
  async function leerFrente(fuente, onProgress) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    const gris = preprocesar(await aElemento(fuente));
    const zona = (x0, y0, x1, y1, esc) => {
      const sx = Math.round(gris.width * x0), sy = Math.round(gris.height * y0);
      const sw = Math.round(gris.width * (x1 - x0)), sh = Math.round(gris.height * (y1 - y0));
      const c = document.createElement('canvas');
      c.width = Math.round(sw * esc); c.height = Math.round(sh * esc);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(gris, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c;
    };
    const pasadas = [
      { img: gris, psm: '6' },
      { img: gris, psm: '11' },
      { img: zona(0.32, 0.15, 0.86, 0.43, 2), psm: '6' },
      { img: zona(0.32, 0.42, 0.96, 0.82, 2), psm: '6' }
    ];
    const textos = [];
    for (let i = 0; i < pasadas.length; i++) {
      etapa(i / pasadas.length, (i + 1) / pasadas.length);
      await w.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1', tessedit_pageseg_mode: pasadas[i].psm });
      const { data: { text } } = await w.recognize(pasadas[i].img);
      textos.push(text);
      log('📄 OCR frente pasada ' + (i + 1) + ':\n' + text);
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

    // Escala de grises + histograma
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = g;
      hist[g]++;
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

  function titulo(s) {
    return s.toLowerCase()
      .replace(/(^|[\s(])([^\s(])/g, (_, a, b) => a + b.toUpperCase())
      .replace(/\bS\/n\b/g, 'S/N')
      .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii)\b/g, (m) => m.toUpperCase()); // números romanos
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

    return (cercano && buscar(cercano, true))
      || buscar(t, true)
      || (cercano && buscar(cercano, false))
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
  const RE_MRZ = /(\d{6})([0-9<])([MF<])(\d{2})(\d{2})(\d{2})([0-9<])([A-Z]{3})/;

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

  // Si la línea tiene el largo de una línea 2, corrige confusiones letra/dígito por posición
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
    const l1orig = lineas.find(l => l !== l2orig && /^[I1][D0<]ARG/.test(l));
    if (l1orig) {
      const a = [...l1orig];
      for (let i = 5; i <= 14 && i < a.length; i++) a[i] = A_DIGITO[a[i]] || a[i];
      const campo = a.slice(5, 14).join('');
      dni = campo.replace(/</g, '').replace(/\D/g, '') || null;
      docOk = String(digitoControl(campo)) === a[14];
    }

    // Línea 3 (nombres)
    let apellido = null, nombre = null, truncado = false;
    const l3 = lineas.find(l => l !== l2orig && l !== l1orig && l.includes('<<') && (l.match(/\d/g) || []).length <= 2);
    if (l3) {
      const limpio = [...l3].map(ch => A_LETRA_NOMBRE[ch] || ch).join('');
      const partes = limpio.split('<<');
      apellido = partes[0].replace(/</g, ' ').trim() || null;
      nombre = partes.slice(1).join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim() || null;
      truncado = limpio.length >= 30 && !limpio.endsWith('<');
    }

    const nacOk = String(digitoControl(nac6)) === dcNacim;
    const vencOk = String(digitoControl(yy + mm + dd)) === dcVenc;
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
    return (i.verificada ? 100 : 0) + (i.dni ? 10 : 0) + (i.apellido ? 10 : 0) + (i.nombre ? 5 : 0);
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

    // Pasada 1: texto completo
    etapa(0, 0.4);
    await w.setParameters(PARAMS_TEXTO);
    const { data: { text } } = await w.recognize(gris);
    log('📄 OCR crudo del reverso:\n' + text);

    // Pasada 2: MRZ sobre el borde inferior (solo si no hay una MRZ verificada)
    let mrz = extraerDesdeMRZ(text);
    let ident = extraerMRZCompleta(text);
    let textoMRZs = '';
    const identCompleta = () => ident && ident.verificada && ident.dni && ident.apellido;
    if (!mrz.mrzVerificada || !identCompleta()) {
      await w.setParameters(PARAMS_MRZ);
      for (let i = 0; i < FRACCIONES_MRZ.length; i++) {
        etapa(0.4 + i * 0.15, 0.55 + i * 0.15);
        const { data: { text: textoMRZ } } = await w.recognize(recortarInferior(gris, FRACCIONES_MRZ[i]));
        log(`📄 OCR MRZ (${FRACCIONES_MRZ[i] * 100}% inferior):\n` + textoMRZ);
        textoMRZs += `\n--- MRZ ${Math.round(FRACCIONES_MRZ[i] * 100)}% inferior ---\n` + textoMRZ;
        const cand = extraerDesdeMRZ(textoMRZ);
        if (cand.mrzVerificada || (!mrz.fechaVencimiento && cand.fechaVencimiento)) mrz = cand;
        ident = mejorIdentidad(ident, extraerMRZCompleta(textoMRZ));
        if (mrz.mrzVerificada && identCompleta()) break;
      }
      await w.setParameters(PARAMS_TEXTO);
    }

    // Pasada 3: zona superior (domicilio / lugar de nacimiento) si la letra fina no se leyó
    let domicilio = extraerDomicilio(text);
    let lugar = extraerLugarNacimiento(text);
    let textoZonas = '';
    if (!domicilio || !lugar) {
      await w.setParameters(PARAMS_ZONA);
      const variantes = [[0.4, true], [0.6, true]]; // [fracción superior, binarizar]; cada una es una pasada más
      for (let i = 0; i < variantes.length && (!domicilio || !lugar); i++) {
        const [fr, bin] = variantes[i];
        etapa(0.7 + i * 0.1, 0.8 + i * 0.1);
        let zona = recortarSuperior(gris, fr);
        if (bin) zona = binarizarCanvas(zona);
        const { data: { text: tz } } = await w.recognize(zona);
        textoZonas += `\n--- zona ${Math.round(fr * 100)}%${bin ? ' binarizada' : ''} ---\n` + tz;
        log('📄 OCR zona superior:\n' + tz);
        domicilio = domicilio || extraerDomicilio(tz);
        lugar = lugar || extraerLugarNacimiento(tz);
      }
      await w.setParameters(PARAMS_TEXTO);
    }

    if (progresoCb) progresoCb(1);

    return {
      raw: text + textoMRZs + textoZonas,
      identidad: ident,
      domicilio,
      lugarNacimiento: lugar,
      cuil: extraerCUIL(text, contexto),
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
    extraerDesdeMRZ,
    cuilValido,
    umbralLocal,
    extraerMRZCompleta,
    mejorIdentidad,
    digitoControl
  };
})();
