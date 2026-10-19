/**
 * OCR del reverso del DNI
 * Extrae: domicilio, lugar de nacimiento, CUIL, vencimiento, nacionalidad
 * Con recorte inteligente y filtros anti-MRZ.
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
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789 .,-°ºª/()',
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
  // PREPROCESAR: Recortar solo la parte de arriba
  // ============================================
  function preprocesarImagen(fuente) {
    const canvasOriginal = document.createElement('canvas');
    const w = fuente.videoWidth || fuente.width;
    const h = fuente.videoHeight || fuente.height;
    canvasOriginal.width = w;
    canvasOriginal.height = h;
    const ctxOrig = canvasOriginal.getContext('2d', { willReadFrequently: true });
    ctxOrig.drawImage(fuente, 0, 0, w, h);

    // 🔥 RECORTE CRÍTICO: Solo tomamos el 45% superior.
    // Esto elimina la MRZ y el QR de abajo que arruinan el OCR.
    const recorte = {
      x: Math.round(w * 0.05),
      y: Math.round(h * 0.05),
      ancho: Math.round(w * 0.90),
      alto: Math.round(h * 0.45)
    };

    const canvas = document.createElement('canvas');
    const escala = 2.5; // Escalar x2.5 hace la letra más grande
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

    // Binarizar y aumentar contraste
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
      gris = (gris - 128) * 1.6 + 128; // Contraste fuerte
      const v = gris > umbral ? 255 : 0; // B/N puro
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
  }

  // ============================================
  // FILTRO ANTI-BASURA (Ignorar MRZ y ruido)
  // ============================================
  function esTextoBasura(texto) {
    if (!texto) return true;
    // Si tiene muchos símbolos < o >, es la MRZ
    if ((texto.match(/[<>]/g) || []).length > 3) return true;
    // Si tiene muchas barras o puntos seguidos
    if (/[|_=~`]{2,}/.test(texto)) return true;
    // Si tiene menos de 3 letras, es basura
    if (texto.replace(/[^a-zA-Z]/g, '').length < 3) return true;
    return false;
  }

  // ============================================
  // PARSERS MEJORADOS
  // ============================================
  function extraerDomicilio(texto) {
    if (!texto) return null;
    // Limpiar errores típicos del OCR
    const limpio = texto
      .replace(/[O0]M[I1L]C[I1L][I1L][O0]/gi, 'DOMICILIO')
      .replace(/[|_=~`]+/g, ' ')
      .replace(/\s{2,}/g, ' ');

    // Buscar DOMICILIO y tomar lo que sigue hasta LUGAR o FECHA
    const match = limpio.match(/DOMICILIO[:\s]+(.*?)(?=\s+(?:LUGAR|FECHA|NACIONALIDAD|CUIL|TRAMITE|EJEMPLAR)|$)/i);
    if (match && match[1]) {
      let dom = match[1].trim();
      if (!esTextoBasura(dom) && dom.length > 5) {
        return dom.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      }
    }

    // Fallback: buscar "Calle", "Av.", "B°", etc.
    const lineas = texto.split(/[\n\r]+/);
    for (let l of lineas) {
      if (/(AV\.|AVENIDA|CALLE|PASAJE|RUTA|KM|B°|BARRIO|Vª|VILLA|MZA|CASA)/i.test(l)) {
        if (!esTextoBasura(l) && l.length > 8 && l.length < 100) {
          return l.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  function extraerLugarNacimiento(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/[|_=~`]+/g, ' ');
    const match = limpio.match(/(?:LUGAR\s*DE\s*NACIMIENTO|NACIDO\s*EN)[:\s]+(.*?)(?=\s+(?:DOMICILIO|FECHA|NACIONALIDAD|CUIL)|$)/i);
    if (match && match[1]) {
      let lugar = match[1].trim();
      if (!esTextoBasura(lugar) && lugar.length > 3) {
        return lugar.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      }
    }
    return null;
  }

  function extraerCUIL(texto) {
    if (!texto) return null;
    // Buscar formato XX-XXXXXXXX-X o XX XXXXXXXXX X
    const m = texto.match(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }

  function extraerVencimiento(texto) {
    if (!texto) return null;
    // Buscar fechas
    const m = texto.match(/(?:VENCIMIENTO|VENCE|VALID[OA])[:\s]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
    if (m) {
      let anio = m[3];
      if (anio.length === 2) anio = parseInt(anio) > 50 ? '19' + anio : '20' + anio;
      return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

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

console.log('✅ domicilio-ocr.js optimizado');
