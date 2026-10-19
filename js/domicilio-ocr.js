/**
 * OCR del reverso del DNI
 * Extrae: domicilio, lugar de nacimiento, CUIL (desde texto)
 * Y extrae: Vencimiento, Nacionalidad (desde la MRZ)
 */

const DomicilioOCR = (() => {

  let worker = null;
  let workerListo = false;

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
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789 .,-°ºª/()<>:',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6' // Bloque de texto uniforme
      });
      workerListo = true;
      console.log('✅ Tesseract listo');
      return worker;
    } catch (e) {
      console.error('❌ Error Tesseract:', e);
      throw e;
    }
  }

  // ============================================
  // PREPROCESAR: Imagen completa, alto contraste
  // ============================================
  function preprocesarImagen(fuente) {
    const canvas = document.createElement('canvas');
    // Usar el tamaño nativo (o video) sin recortar
    const w = fuente.videoWidth || fuente.width;
    const h = fuente.videoHeight || fuente.height;
    canvas.width = w;
    canvas.height = h;
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fuente, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Aumentar contraste y pasar a escala de grises (sin binarizar a B/N puro)
    for (let i = 0; i < data.length; i += 4) {
      let gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Contraste fuerte pero manteniendo los grises para no perder letras finas
      gris = (gris - 128) * 1.8 + 128; 
      gris = Math.max(0, Math.min(255, gris));
      data[i] = data[i + 1] = data[i + 2] = gris;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.95);
  }

  // ============================================
  // PARSER: DOMICILIO (Tolerante a multi-línea)
  // ============================================
  function extraerDomicilio(texto) {
    if (!texto) return null;
    
    // Normalizar texto
    let limpio = texto.toUpperCase()
      .replace(/[|_=~`]+/g, ' ')
      .replace(/\s{2,}/g, ' ');

    // Buscar DOMICILIO (tolerando errores de OCR como D0MICILI0)
    const match = limpio.match(/D[O0]M[I1L]C[I1L][I1L][O0][:\s]*(.*?)(?=\s(?:LUGAR|N[4A]C[I1L]M|FECHA|NACIONALIDAD|CUIL|TRAMITE|EJEMPLAR|IDARG)|$)/i);
    
    if (match && match[1]) {
      let dom = match[1].trim();
      // Si el texto se cortó muy corto, buscamos la siguiente línea que contenga la ciudad
      if (dom.length > 5 && dom.length < 30) {
        const resto = limpio.substring(match.index + match[0].length);
        // Tomar lo que sigue hasta encontrar una palabra clave
        const continuacion = resto.split(/(?:LUGAR|N[4A]C[I1L]M|CUIL|TRAMITE|EJEMPLAR)/i)[0].trim();
        if (continuacion.length > 3 && continuacion.length < 50) {
          dom += ' - ' + continuacion;
        }
      }
      
      if (dom.length > 5 && !dom.includes('<<<')) {
        return dom.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      }
    }
    return null;
  }

  // ============================================
  // PARSER: LUGAR DE NACIMIENTO
  // ============================================
  function extraerLugarNacimiento(texto) {
    if (!texto) return null;
    let limpio = texto.toUpperCase().replace(/\s{2,}/g, ' ');

    const match = limpio.match(/(?:LUG[4A]R\s*DE\s*N[4A]C[I1L]M[I1L]ENT[O0]|NACIDO\s*EN)[:\s]*(.*?)(?=\s(?:DOMICILIO|FECHA|NACIONALIDAD|CUIL|IDARG)|$)/i);
    if (match && match[1]) {
      let lugar = match[1].trim();
      if (lugar.length > 3 && !lugar.includes('<<<')) {
        return lugar.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      }
    }
    return null;
  }

  // ============================================
  // PARSER: CUIL
  // ============================================
  function extraerCUIL(texto) {
    if (!texto) return null;
    const m = texto.match(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  // ============================================
  // PARSER MRZ: Vencimiento y Nacionalidad
  // ============================================
  function extraerDesdeMRZ(texto) {
    if (!texto) return { fechaVencimiento: null, nacionalidad: null };
    
    // Limpiar el texto para buscar la MRZ (solo letras, números y <)
    const lineas = texto.toUpperCase().split(/[\n\r]+/).map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 20);
    
    // La línea 2 de la MRZ siempre tiene una M o F en el medio, rodeada de números
    const mrzLine = lineas.find(l => /\d{6}[0-9<][MF]\d{6}[0-9<][A-Z]{3}/.test(l));

    if (mrzLine) {
      // Formato: 0208150 M 3601073 ARG
      const idx = mrzLine.search(/[MF]/);
      if (idx !== -1) {
        const fechaVencRaw = mrzLine.substring(idx + 1, idx + 7); // YYMMDD
        const nacRaw = mrzLine.substring(idx + 8, idx + 11); // ARG

        let vencimiento = null;
        if (/^\d{6}$/.test(fechaVencRaw)) {
          const yy = parseInt(fechaVencRaw.substring(0, 2));
          const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
          vencimiento = `${yyyy}-${fechaVencRaw.substring(2, 4)}-${fechaVencRaw.substring(4, 6)}`;
        }

        let nacionalidad = null;
        if (nacRaw === 'ARG') nacionalidad = 'ARGENTINA';
        else if (nacRaw === 'CHL') nacionalidad = 'CHILENA';
        else if (nacRaw === 'URY') nacionalidad = 'URUGUAYA';
        else if (nacRaw === 'PRY') nacionalidad = 'PARAGUAYA';
        else if (nacRaw === 'PER') nacionalidad = 'PERUANA';
        else if (nacRaw === 'BOL') nacionalidad = 'BOLIVIANA';
        else if (nacRaw === 'COL') nacionalidad = 'COLOMBIANA';
        else if (nacRaw === 'ECU') nacionalidad = 'ECUATORIANA';
        else if (nacRaw === 'VEN') nacionalidad = 'VENEZOLANA';
        else if (nacRaw === 'BRA') nacionalidad = 'BRASILEÑA';
        else if (nacRaw.length > 0) nacionalidad = nacRaw;

        return { fechaVencimiento: vencimiento, nacionalidad: nacionalidad };
      }
    }
    return { fechaVencimiento: null, nacionalidad: null };
  }

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

    const mrzData = extraerDesdeMRZ(text);

    return {
      raw: text,
      domicilio: extraerDomicilio(text),
      lugarNacimiento: extraerLugarNacimiento(text),
      cuil: extraerCUIL(text),
      fechaVencimiento: mrzData.fechaVencimiento,
      nacionalidad: mrzData.nacionalidad
    };
  }

  return {
    leer,
    extraerDomicilio,
    extraerLugarNacimiento,
    extraerCUIL,
    extraerDesdeMRZ
  };
})();

console.log('✅ domicilio-ocr.js optimizado (Lectura completa)');
