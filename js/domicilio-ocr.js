const DomicilioOCR = (() => {
  'use strict';

  let DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log(...args); };

  const ANCHO_MIN = 1500; 

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
    const escala = w0 < ANCHO_MIN ? Math.min(ANCHO_MIN / w0, 2.5) : 1; 
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

    for (let i = 0; i < d.length; i += 4) {
      const gris = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = (gris - 128) * 1.4 + 128;
      v = Math.max(0, Math.min(255, v));
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

  // 🔥 PARSER A PRUEBA DE BALAS
  function extraerDomicilio(texto) {
    if (!texto) return null;
    // Junta todo en una sola línea
    let limpio = texto.toUpperCase().replace(/\s+/g, ' ').trim();
    
    // Busca "DOMICILIO" tolerando errores de OCR (0 en vez de O)
    const idx = limpio.search(/D[O0]M[I1L]C[I1L][I1L][O0]/i);
    
    if (idx !== -1) {
      // Toma todo el texto que sigue después de "DOMICILIO" (9 letras)
      let resto = limpio.substring(idx + 9); 
      resto = resto.replace(/^[^A-Z0-9]+/, ''); // Limpia los ":" o espacios iniciales
      
      // Corta el texto cuando encuentra "LUGAR" o "CUIL"
      const fin = resto.search(/(LUGAR|NACIMIENTO|CUIL|TRAMITE|EJEMPLAR|IDARG)/i);
      if (fin !== -1) {
        resto = resto.substring(0, fin);
      }
      
      let dom = resto.trim().replace(/[\s:.,/-]+$/, '');
      if (dom.length > 5) {
        // Corrige errores típicos
        dom = dom.replace(/PABLM/gi, 'PABLO')
                 .replace(/NORT/gi, 'NORTE')
                 .replace(/CAJ/gi, 'CAPITAL')
                 .replace(/\s*-\s*/g, ' - ');
        return dom.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      }
    }
    return null;
  }

  function extraerLugarNacimiento(texto) {
    if (!texto) return null;
    let limpio = texto.toUpperCase().replace(/\s+/g, ' ').trim();
    
    let idx = limpio.search(/(LUGAR\s*DE\s*NACIMIENTO|NACIDO\s*EN)/i);
    if (idx === -1) idx = limpio.search(/NACIMIENTO/i);
    
    if (idx !== -1) {
      // Busca la palabra exacta para cortar
      const match = limpio.substring(idx).match(/^(LUGAR\s*DE\s*NACIMIENTO|NACIDO\s*EN|NACIMIENTO)/i);
      if (match) {
        let resto = limpio.substring(idx + match[0].length);
        resto = resto.replace(/^[^A-Z0-9]+/, '');
        
        const fin = resto.search(/(DOMICILIO|CUIL|TRAMITE|EJEMPLAR|IDARG)/i);
        if (fin !== -1) {
          resto = resto.substring(0, fin);
        }
        
        let lugar = resto.trim().replace(/[\s:.,/-]+$/, '');
        if (lugar.length > 3) {
          return lugar.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  function extraerCUIL(texto) {
    if (!texto) return null;
    const m = texto.match(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  function extraerDesdeMRZ(texto) {
    if (!texto) return { fechaVencimiento: null, nacionalidad: null };
    const lineas = texto.toUpperCase().split(/[\r\n]+/).map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 20);
    const mrzLine = lineas.find(l => /\d{6}[0-9<][MF]\d{6}[0-9<][A-Z]{3}/.test(l));

    if (mrzLine) {
      const idx = mrzLine.search(/[MF]/);
      if (idx !== -1) {
        const fechaVencRaw = mrzLine.substring(idx + 1, idx + 7);
        const nacRaw = mrzLine.substring(idx + 8, idx + 11);

        let vencimiento = null;
        if (/^\d{6}$/.test(fechaVencRaw)) {
          const yy = parseInt(fechaVencRaw.substring(0, 2));
          const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
          vencimiento = `${yyyy}-${fechaVencRaw.substring(2, 4)}-${fechaVencRaw.substring(4, 6)}`;
        }

        let nacionalidad = null;
        const paises = { ARG: 'ARGENTINA', CHL: 'CHILENA', URY: 'URUGUAYA', PRY: 'PARAGUAYA', PER: 'PERUANA', BOL: 'BOLIVIANA', COL: 'COLOMBIANA', ECU: 'ECUATORIANA', VEN: 'VENEZOLANA', BRA: 'BRASILEÑA' };
        if (paises[nacRaw]) nacionalidad = paises[nacRaw];

        return { fechaVencimiento: vencimiento, nacionalidad: nacionalidad };
      }
    }
    return { fechaVencimiento: null, nacionalidad: null };
  }

  async function leer(fuente, pais = 'arg', onProgress, contexto = {}) {
    progresoCb = typeof onProgress === 'function' ? onProgress : null;
    const w = await initWorker();
    const origen = await aElemento(fuente);
    const gris = preprocesar(origen);

    await w.setParameters(PARAMS_TEXTO);
    const { data: { text } } = await w.recognize(gris);
    log('📄 OCR crudo del reverso:\n' + text);

    let mrz = { fechaVencimiento: null, nacionalidad: null };
    await w.setParameters(PARAMS_MRZ);
    const { data: { text: textoMRZ } } = await w.recognize(recortarInferior(gris, 0.4));
    const mrzData = extraerDesdeMRZ(textoMRZ || text);
    if (mrzData.fechaVencimiento) mrz = mrzData;

    if (progresoCb) progresoCb(1);

    return {
      raw: text,
      domicilio: extraerDomicilio(text),
      lugarNacimiento: extraerLugarNacimiento(text),
      cuil: extraerCUIL(text),
      fechaVencimiento: mrz.fechaVencimiento,
      nacionalidad: mrz.nacionalidad
    };
  }

  return { leer, liberar: async () => { if (workerPromise) { const w = await workerPromise; w.terminate(); workerPromise = null; } }, setDebug: (v) => { DEBUG = !!v; } };
})();
