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
        tessedit_pageseg_mode: '6' // Bloque de texto
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
  // PREPROCESAR: Leer toda la tarjeta (incluyendo MRZ)
  // ============================================
  function preprocesarImagen(fuente) {
    const canvasOriginal = document.createElement('canvas');
    const w = fuente.videoWidth || fuente.width;
    const h = fuente.videoHeight || fuente.height;
    canvasOriginal.width = w;
    canvasOriginal.height = h;
    const ctxOrig = canvasOriginal.getContext('2d', { willReadFrequently: true });
    ctxOrig.drawImage(fuente, 0, 0, w, h);

    // Recortamos el 80% superior (dejamos afuera solo el borde inferior con el QR).
    // Esto asegura que la MRZ entre en la foto.
    const recorte = {
      x: Math.round(w * 0.05),
      y: Math.round(h * 0.05),
      ancho: Math.round(w * 0.90),
      alto: Math.round(h * 0.80)
    };

    const canvas = document.createElement('canvas');
    const escala = 2.0; // Escalar x2 es suficiente y más rápido
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

    // Binarizar
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let sumaGris = 0, muestras = 0;
    for (let i = 0; i < data.length; i += 40) {
      const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sumaGris += gris; muestras++;
    }
    const umbral = muestras > 0 ? sumaGris / muestras : 128;

    for (let i = 0; i < data.length; i += 4) {
      let gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gris = (gris - 128) * 1.5 + 128;
      const v = gris > umbral ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
  }

  // ============================================
  // PARSER: DOMICILIO (Tolerante a errores)
  // ============================================
  function extraerDomicilio(texto) {
    if (!texto) return null;
    // Normalizar texto: corregir errores comunes de OCR
    let limpio = texto.toUpperCase()
      .replace(/D[O0]M[I1L]C[I1L][I1L][O0]/g, 'DOMICILIO')
      .replace(/LUG[4A]R/g, 'LUGAR')
      .replace(/N[4A]C[I1L]M[I1L]ENT[O0]/g, 'NACIMIENTO')
      .replace(/[|_=~`]+/g, ' ')
      .replace(/\s+/g, ' '); // Colapsar saltos de línea en un solo espacio

    // Buscar desde "DOMICILIO" hasta "LUGAR" o "NACIMIENTO"
    const match = limpio.match(/DOMICILIO[:\s]*(.*?)(?=LUGAR|NACIMIENTO|FECHA|NACIONALIDAD|CUIL|TRAMITE|EJEMPLAR|$)/i);
    
    if (match && match[1]) {
      let dom = match[1].trim();
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
    let limpio = texto.toUpperCase()
      .replace(/LUG[4A]R/g, 'LUGAR')
      .replace(/N[4A]C[I1L]M[I1L]ENT[O0]/g, 'NACIMIENTO')
      .replace(/\s+/g, ' ');

    const match = limpio.match(/(?:LUGAR\s*DE\s*NACIMIENTO|NACIDO\s*EN)[:\s]*(.*?)(?=DOMICILIO|FECHA|NACIONALIDAD|CUIL|IDARG|$)/i);
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
    
    // Buscar las 3 líneas de la MRZ (empiezan con ID o terminan con <<<)
    const lineas = texto.toUpperCase().split(/[\n\r]+/).map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 20);
    
    if (lineas.length >= 3) {
      // La segunda línea de la MRZ tiene el formato:
      // FechaNac(6) + Check(1) + Sexo(1) + FechaVenc(6) + Check(1) + Nacionalidad(3)
      // Ej: 0208150M3601073ARG...
      const l2 = lineas[1];
      const fechaVencRaw = l2.substring(8, 14); // Posición 8 a 13 (YYMMDD)
      const nacRaw = l2.substring(15, 18).replace(/</g, ''); // Posición 15 a 17 (ARG)

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

console.log('✅ domicilio-ocr.js optimizado para leer MRZ y texto');
