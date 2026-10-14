/**
 * OCR del domicilio del dorso del DNI
 * Usa Tesseract.js + parser específico por país
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
      // Configurar para texto en mayúsculas con números y símbolos típicos
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789 .,-°ºª/()',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6' // Bloque uniforme de texto
      });
      workerListo = true;
      console.log('✅ Tesseract (domicilio) listo');
      return worker;
    } catch (e) {
      console.error('❌ Error inicializando Tesseract:', e);
      throw e;
    }
  }

  // ============================================
  // PREPROCESAR IMAGEN (mejora el OCR)
  // ============================================
  function preprocesarImagen(imageElement, opciones = {}) {
    const canvas = document.createElement('canvas');
    const ancho = imageElement.width || imageElement.videoWidth;
    const alto = imageElement.height || imageElement.videoHeight;

    // Si viene de un <video>, usar dimensiones de video
    const w = imageElement.videoWidth || imageElement.width;
    const h = imageElement.videoHeight || imageElement.height;

    // Escalar x1.5 para mejor OCR
    const escala = 1.5;
    canvas.width = w * escala;
    canvas.height = h * escala;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

    // Pasar a escala de grises + aumentar contraste
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Gris
      const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Aumentar contraste
      let v = (gris - 128) * 1.5 + 128;
      v = Math.max(0, Math.min(255, v));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
  }

  // ============================================
  // PARSER DE DOMICILIO ARGENTINO
  // ============================================
  function parsearDomicilioArgentina(textoOCR) {
    if (!textoOCR) return null;
    // Normalizar: quitar saltos, juntar espacios
    const limpio = textoOCR
      .toUpperCase()
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // 1) Buscar "DOMICILIO" seguido de texto
    const match = limpio.match(/DOMICILIO[:\s]+([^|]{6,120}?)(?=\s(?:LUGAR|FECHA|NACIONALIDAD|EJEMPLAR|TRAMITE|TRÁMITE|$))/);
    if (match && match[1]) {
      return limpiarDomicilio(match[1]);
    }

    // 2) Fallback: buscar línea con palabras típicas de dirección
    const palabrasClave = /\b(AV\.|AVENIDA|CALLE|PASAJE|RUTA|KM|B°|BARRIO|MZA|MANZANA|CASA|DPTO|PISO|Vª|VILLA)\b/i;
    const lineas = textoOCR.split(/[\n\r]+/);
    for (const linea of lineas) {
      if (palabrasClave.test(linea) && linea.length > 8 && linea.length < 150) {
        return limpiarDomicilio(linea);
      }
    }

    // 3) Último fallback: si hay muchas mayúsculas seguidas
    const lineasMayus = lineas.filter(l => l.length > 12 && /^[A-ZÁÉÍÓÚÑ0-9\s.,\-°ºª/()]+$/.test(l));
    if (lineasMayus.length > 0) {
      return limpiarDomicilio(lineasMayus[0]);
    }

    return null;
  }

  // ============================================
  // PARSER DE DOMICILIO CHILE
  // ============================================
  function parsearDomicilioChile(textoOCR) {
    if (!textoOCR) return null;
    const limpio = textoOCR.toUpperCase().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // Chile: "DOMICILIO" o "DIRECCION"
    const match = limpio.match(/(?:DOMICILIO|DIRECCI[OÓ]N)[:\s]+([^|]{6,120}?)(?=\s(?:COMUNA|CIUDAD|REGION|REGIÓN|$))/);
    if (match && match[1]) return limpiarDomicilio(match[1]);
    return null;
  }

  // ============================================
  // PARSER UNIVERSAL (fallback)
  // ============================================
  function parsearDomicilioUniversal(textoOCR) {
    if (!textoOCR) return null;
    const limpio = textoOCR.toUpperCase().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // Buscar cualquier variante de "DOMICILIO" / "DIRECCION" / "DIRECCIÓN"
    const match = limpio.match(/(?:DOMICILIO|DIRECCION|DIRECCI[OÓ]N|ADDRESS)[:\s]+([^|]{6,120})/);
    if (match && match[1]) {
      return limpiarDomicilio(match[1].split(/\s{3,}/)[0]);
    }
    return null;
  }

  // ============================================
  // LIMPIAR TEXTO DEL DOMICILIO
  // ============================================
  function limpiarDomicilio(texto) {
    if (!texto) return null;
    let t = texto
      .replace(/[|_=~`]+/g, ' ')
      .replace(/[^\wÁÉÍÓÚÑÜáéíóúñü0-9\s.,\-°ºª/()]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Capitalizar palabras (Title Case)
    t = t.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());

    // Limitar longitud razonable
    if (t.length > 150) t = t.substring(0, 150);

    return t.length >= 5 ? t : null;
  }

  // ============================================
  // LEER DOMICILIO
  // ============================================
  /**
   * Recibe una imagen o video y devuelve el domicilio detectado.
   * @param {HTMLImageElement|HTMLVideoElement|string} fuente
   * @param {string} pais - 'arg', 'chl', etc.
   * @param {Function} onProgress - callback(0..1)
   * @returns {Promise<{domicilio: string|null, raw: string}>}
   */
  async function leer(fuente, pais = 'arg', onProgress) {
    // Preparar imagen
    let imageSource;
    if (typeof fuente === 'string') {
      imageSource = fuente;
    } else {
      imageSource = preprocesarImagen(fuente);
    }

    // Ejecutar OCR
    const w = await initWorker(onProgress);
    const { data: { text } } = await w.recognize(imageSource);

    console.log('📄 OCR crudo del dorso:', text);

    // Parsear según país
    let domicilio = null;
    if (pais === 'arg') {
      domicilio = parsearDomicilioArgentina(text);
    } else if (pais === 'chl') {
      domicilio = parsearDomicilioChile(text);
    }

    // Fallback universal
    if (!domicilio) {
      domicilio = parsearDomicilioUniversal(text);
    }

    return {
      domicilio: domicilio,
      raw: text
    };
  }

  return {
    leer,
    parsearDomicilioArgentina,
    parsearDomicilioChile,
    parsearDomicilioUniversal
  };
})();

console.log('✅ domicilio-ocr.js cargado');
