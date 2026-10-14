/**
 * OCR del reverso del DNI
 * Extrae: domicilio, lugar de nacimiento, CUIL, vencimiento, nacionalidad
 * Con preprocesamiento de imagen + correcciones típicas del OCR
 */

const DomicilioOCR = (() => {

  let worker = null;
  let workerListo = false;

  // ============================================
  // INICIALIZAR TESSERACT
  // ============================================
  async function initWorker(onProgress) {
    if (workerListo) return worker;
    try {
      worker = await Tesseract.createWorker('spa', 1, {
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(m.progress);
          }
        }
      });
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789 .,-°ºª/():<>',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6'
      });
      workerListo = true;
      console.log('✅ Tesseract (dorso) listo');
      return worker;
    } catch (e) {
      console.error('❌ Error Tesseract:', e);
      throw e;
    }
  }

  // ============================================
  // PREPROCESAR IMAGEN (mejorado)
  // ============================================
  /**
   * Mejora la imagen antes del OCR:
   * 1. Recorta la zona superior (donde está domicilio + lugar nac)
   * 2. Escala x2 para mejor lectura de letra chica
   * 3. Binariza (blanco y negro puro)
   * 4. Aumenta contraste
   */
  function preprocesarImagen(fuente) {
    const canvasOriginal = document.createElement('canvas');
    const w = fuente.videoWidth || fuente.width;
    const h = fuente.videoHeight || fuente.height;
    canvasOriginal.width = w;
    canvasOriginal.height = h;
    const ctxOrig = canvasOriginal.getContext('2d', { willReadFrequently: true });
    ctxOrig.drawImage(fuente, 0, 0, w, h);

    // =========================================
    // RECORTAR ZONA SUPERIOR
    // El domicilio suele estar en el tercio superior-central del reverso.
    // Recortamos: 5% desde arriba, 25% de alto, y ancho completo menos 5% de márgenes.
    // =========================================
    const recorte = {
      x: Math.round(w * 0.05),
      y: Math.round(h * 0.05),
      ancho: Math.round(w * 0.90),
      alto: Math.round(h * 0.55)  // mitad superior del reverso
    };

    const canvas = document.createElement('canvas');
    const escala = 2; // x2 para mejor OCR
    canvas.width = recorte.ancho * escala;
    canvas.height = recorte.alto * escala;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      canvasOriginal,
      recorte.x, recorte.y, recorte.ancho, recorte.alto,
      0, 0, canvas.width, canvas.height
    );

    // =========================================
    // PROCESAR PÍXELES: binarizar + contraste
    // =========================================
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Paso 1: calcular umbral promedio (Otsu simplificado)
    let sumaGris = 0;
    let muestras = 0;
    for (let i = 0; i < data.length; i += 40) {
      const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sumaGris += gris;
      muestras++;
    }
    const umbral = muestras > 0 ? sumaGris / muestras : 128;

    // Paso 2: aplicar binarización + contraste
    for (let i = 0; i < data.length; i += 4) {
      const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Contraste primero
      let v = (gris - 128) * 1.4 + 128;
      // Binarización suave con umbral
      v = v > umbral ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
  }

  // ============================================
  // CORRECCIONES DE OCR
  // ============================================
  function corregirTexto(texto) {
    if (!texto) return '';
    let t = texto;
    // Correcciones típicas de OCR en documentos argentinos
    t = t.replace(/\bV[ª°º]\s*/gi, 'Villa ');
    t = t.replace(/\bREP\b/gi, 'Rep');
    t = t.replace(/\bGRAL\b/gi, 'General');
    t = t.replace(/\bAV\b/gi, 'Av');
    t = t.replace(/\bB[°º]\s*/gi, 'Barrio ');
    t = t.replace(/\bMZA\b/gi, 'Manzana');
    t = t.replace(/\bDPTO\b/gi, 'Dpto');
    t = t.replace(/\bP[°º]\s*/gi, 'Piso ');
    // Corregir múltiples espacios
    t = t.replace(/\s{2,}/g, ' ');
    return t.trim();
  }

  // ============================================
  // HELPERS DE LIMPIEZA
  // ============================================
  function limpiarTexto(texto, maxLen = 150) {
    if (!texto) return null;
    let t = texto
      .replace(/[|_=~`\[\]{}]+/g, ' ')
      .replace(/[^\wÁÉÍÓÚÑÜáéíóúñü0-9\s.,\-°ºª/()]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    t = corregirTexto(t);
    t = t.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    if (t.length > maxLen) t = t.substring(0, maxLen);
    return t.length >= 3 ? t : null;
  }

  // ============================================
  // PARSER: DOMICILIO (MEJORADO)
  // ============================================
  function extraerDomicilio(texto) {
    if (!texto) return null;
    const limpio = texto
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Estrategia 1: buscar "DOMICILIO" seguido de texto hasta "LUGAR" o "FECHA"
    const patrones = [
      /DOMICILIO[:\s]+([^|]{6,140}?)(?=\s+(?:LUGAR|FECHA|NACIONALIDAD|EJEMPLAR|TRAMITE|TRÁMITE|CUIL|SEXO|N[°º]\s*TRAM|$))/i,
      /DOMICILIO[:\s]+([^|]{6,140})/i,
      /DIRECCI[ÓO]N[:\s]+([^|]{6,140})/i
    ];

    for (const patron of patrones) {
      const m = limpio.match(patron);
      if (m && m[1]) {
        let dom = m[1].trim();
        // Cortar si incluye "LUGAR DE NACIMIENTO" u otras secciones
        dom = dom.split(/\s(?:LUGAR|NACIMIENTO|FECHA|NACIONALIDAD|EJEMPLAR|TRAMITE|TRÁMITE|CUIL|SEXO)\s/i)[0];
        const limpioDom = limpiarTexto(dom);
        if (limpioDom && limpioDom.length >= 8) return limpioDom;
      }
    }

    // Estrategia 2: buscar línea que contenga palabras clave de dirección
    const palabrasClave = /\b(AV\.?|AVENIDA|CALLE|PASAJE|RUTA|KM|B°|Bº|BARRIO|MZA|MANZANA|CASA|DPTO|PISO|Vª|VILLA|REP|REPÚBLICA|SIRIA|BOLIVAR|SAN MARTIN|BELGRANO|RIVADAVIA|MITRE|SARMIENTO|URQUIZA|ALSINA|CORRIENTES|9 DE JULIO)\b/i;
    const lineas = texto.split(/[\n\r]+/);
    for (const l of lineas) {
      const lTrim = l.trim();
      if (palabrasClave.test(lTrim) && lTrim.length > 8 && lTrim.length < 160) {
        const limpioL = limpiarTexto(lTrim);
        if (limpioL) return limpioL;
      }
    }

    // Estrategia 3: la línea más larga en mayúsculas (típico de domicilio)
    const lineasMayus = lineas
      .map(l => l.trim())
      .filter(l => l.length > 12 && /[A-ZÁÉÍÓÚÑ]{3,}/.test(l) && !/^(N[°º]?\s*TRAM|CUIL|EJEMPLAR|FECHA|SEXO|NACIONALIDAD|IDARG)/i.test(l))
      .sort((a, b) => b.length - a.length);

    if (lineasMayus.length > 0) {
      const limpioL = limpiarTexto(lineasMayus[0]);
      if (limpioL) return limpioL;
    }

    return null;
  }

  // ============================================
  // PARSER: LUGAR DE NACIMIENTO
  // ============================================
  function extraerLugarNacimiento(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    const patrones = [
      /LUGAR\s*DE\s*NACIMIENTO[:\s]+([A-ZÁÉÍÓÚÑ\s]{4,80}?)(?=\s+(?:DOMICILIO|FECHA|NACIONALIDAD|EJEMPLAR|TRAMITE|TRÁMITE|CUIL|SEXO|$))/i,
      /NACIDO\s*EN[:\s]+([A-ZÁÉÍÓÚÑ\s]{4,80}?)(?=\s+(?:DOMICILIO|FECHA|NACIONALIDAD|EJEMPLAR|TRAMITE|TRÁMITE|CUIL|SEXO|$))/i,
      /LUGAR\s*DE\s*NACIMIENTO[:\s]+([A-ZÁÉÍÓÚÑ\s]{4,80})/i
    ];

    for (const patron of patrones) {
      const m = limpio.match(patron);
      if (m && m[1]) {
        const lugar = limpiarTexto(m[1], 60);
        if (lugar) return lugar;
      }
    }

    // Fallback: buscar "PROV. DE" o "PROVINCIA DE"
    const mProv = limpio.match(/(?:PROV\.?\s*(?:DE)?|PROVINCIA\s*DE)[:\s]+([A-ZÁÉÍÓÚÑ\s]{3,50}?)(?=\s|$)/i);
    if (mProv && mProv[1]) {
      return limpiarTexto('Prov. de ' + mProv[1], 60);
    }

    return null;
  }

  // ============================================
  // PARSER: CUIL
  // ============================================
  function extraerCUIL(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/\s+/g, ' ');
    const m = limpio.match(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  // ============================================
  // PARSER: FECHA DE VENCIMIENTO
  // ============================================
  function extraerVencimiento(texto) {
    if (!texto) return null;
    const limpio = texto.toUpperCase();
    const m = limpio.match(/(?:VENCIMIENTO|VENCE|VALID[OA]\s*HASTA|CADUCA)[:\s]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let anio = m[3];
      if (anio.length === 2) anio = parseInt(anio) > 50 ? '19' + anio : '20' + anio;
      return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

  // ============================================
  // PARSER: NACIONALIDAD
  // ============================================
  function extraerNacionalidad(texto) {
    if (!texto) return null;
    const up = texto.toUpperCase();
    if (/ARGENTIN[OA]/.test(up)) return 'ARGENTINA';
    if (/CHILEN[OA]/.test(up)) return 'CHILENA';
    if (/URUGUAY[OA]/.test(up)) return 'URUGUAYA';
    if (/PARAGUAY[OA]/.test(up)) return 'PARAGUAYA';
    if (/PERUAN[OA]/.test(up)) return 'PERUANA';
    if (/BOLIVIAN[OA]/.test(up)) return 'BOLIVIANA';
    if (/COLOMBIAN[OA]/.test(up)) return 'COLOMBIANA';
    if (/ECUATORIAN[OA]/.test(up)) return 'ECUATORIANA';
    if (/VENEZOLAN[OA]/.test(up)) return 'VENEZOLANA';
    if (/BRASILE[ÑN][OA]/.test(up)) return 'BRASILEÑA';
    return null;
  }

  // ============================================
  // LEER TODOS LOS CAMPOS DEL DORSO
  // ============================================
  async function leer(fuente, pais = 'arg', onProgress) {
    let imageSource;
    if (typeof fuente === 'string') {
      imageSource = fuente;
    } else {
      imageSource = preprocesarImagen(fuente);
    }

    const w = await initWorker(onProgress);
    const { data: { text } } = await w.recognize(imageSource);

    console.log('📄 OCR crudo del reverso:\n', text);

    return {
      raw: text,
      domicilio: extraerDomicilio(text),
      lugarNacimiento: extraerLugarNacimiento(text),
      cuil: extraerCUIL(text),
      fechaVencimiento: extraerVencimiento(text),
      nacionalidad: extraerNacionalidad(text)
    };
  }

  return {
    leer,
    extraerDomicilio,
    extraerLugarNacimiento,
    extraerCUIL,
    extraerVencimiento,
    extraerNacionalidad
  };
})();

console.log('✅ domicilio-ocr.js cargado');
