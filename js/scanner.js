/**
 * Escáner de códigos - Triple motor + ROI (Region of Interest)
 * 1) BarcodeDetector nativo
 * 2) ZXing (garantiza PDF417)
 * 3) jsQR (fallback QR)
 * Optimizado para escanear solo la zona del marco.
 */

const DNIScanner = (() => {

  let barcodeDetector = null;
  let zxingReader = null;

  const barcodeDisponible = typeof BarcodeDetector !== 'undefined';
  const zxingDisponible = typeof ZXing !== 'undefined';
  const jsQRDisponible = typeof jsQR === 'function';

  if (barcodeDisponible) {
    try {
      barcodeDetector = new BarcodeDetector({
        formats: ['pdf417', 'qr_code', 'code_128', 'code_39', 'data_matrix', 'aztec']
      });
      console.log('✅ BarcodeDetector inicializado');
    } catch (e) {
      console.warn('⚠️ BarcodeDetector no soporta esos formatos:', e.message);
      barcodeDetector = null;
    }
  }

  if (zxingDisponible) {
    try {
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.PDF_417,
        ZXing.BarcodeFormat.QR_CODE,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.DATA_MATRIX,
        ZXing.BarcodeFormat.AZTEC
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 500
      });
      console.log('✅ ZXing inicializado');
    } catch (e) {
      console.warn('⚠️ Error ZXing:', e.message);
      zxingReader = null;
    }
  }

  console.log('🔍 Motores:',
    'BarcodeDetector:', !!barcodeDetector,
    '| ZXing:', !!zxingReader,
    '| jsQR:', jsQRDisponible
  );

  // ============================================================
  // ROI - Recortar la zona central (donde está el marco)
  // ============================================================
  /**
   * Recorta el canvas original a la zona del marco (centro, 80% x 63%).
   * Esto acelera la detección y elimina falsos positivos fuera del marco.
   */
  function extraerROI(canvasOriginal) {
    const w = canvasOriginal.width;
    const h = canvasOriginal.height;

    // El marco ocupa el 80% del ancho y 63% del alto (aspect ratio 1.586)
    const roiW = Math.round(w * 0.80);
    const roiH = Math.round(h * 0.63);
    const roiX = Math.round((w - roiW) / 2);
    const roiY = Math.round((h - roiH) / 2);

    const roi = document.createElement('canvas');
    roi.width = roiW;
    roi.height = roiH;
    const ctx = roi.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvasOriginal, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
    return roi;
  }

  // ============================================================
  // Detector de luminosidad
  // ============================================================
  /**
   * Devuelve el brillo promedio (0-255) de un canvas.
   */
  function medirBrillo(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    // Sample cada 20 píxeles para no recorrer toda la imagen
    const paso = 20;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    let suma = 0;
    let muestras = 0;
    for (let y = 0; y < h; y += paso) {
      for (let x = 0; x < w; x += paso) {
        const i = (y * w + x) * 4;
        const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        suma += gris;
        muestras++;
      }
    }
    return muestras > 0 ? suma / muestras : 0;
  }

  // ============================================================
  // Escanear UN canvas (con o sin ROI)
  // ============================================================
  async function escanearFrame(canvas, usarROI = true) {
    // Extraer ROI solo si se pide
    const canvasEscaneo = usarROI ? extraerROI(canvas) : canvas;
    const ctx = canvasEscaneo.getContext('2d', { willReadFrequently: true });

    // 1) BarcodeDetector
    if (barcodeDetector) {
      try {
        const codigos = await barcodeDetector.detect(canvasEscaneo);
        if (codigos && codigos.length) {
          console.log('📷 BarcodeDetector:', codigos[0].rawValue.substring(0, 60));
          return codigos[0].rawValue;
        }
      } catch (e) {}
    }

    // 2) ZXing
    if (zxingReader) {
      try {
        const resultado = await zxingReader.decodeFromCanvas(canvasEscaneo);
        if (resultado && resultado.getText) {
          console.log('📷 ZXing:', resultado.getText().substring(0, 60));
          return resultado.getText();
        }
      } catch (e) {}
    }

    // 3) jsQR
    if (jsQRDisponible) {
      try {
        const imageData = ctx.getImageData(0, 0, canvasEscaneo.width, canvasEscaneo.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (qr && qr.data) {
          console.log('📷 jsQR:', qr.data.substring(0, 60));
          return qr.data;
        }
      } catch (e) {}
    }

    return null;
  }

  // ============================================================
  // Escaneo continuo con ROI + callback de brillo
  // ============================================================
  function escanearContinuo(video, canvas, onDetected, onTimeout, opciones = {}) {
    const intervaloMs = opciones.intervaloMs || 400;
    const timeoutMs = opciones.timeoutMs || 20000;
    const anchoMax = opciones.anchoMax || 1280;
    const usarROI = opciones.usarROI !== false;
    const onBrillo = opciones.onBrillo; // callback(brightness)

    let activo = true;
    let intentos = 0;
    let ultimoTextoDetectado = null;
    let framesConfirmados = 0;
    const FRAMES_PARA_CONFIRMAR = 1; // 1 = sin confirmación, 2 = confirmar en 2 frames

    const timer = setTimeout(() => {
      if (activo) {
        activo = false;
        if (onTimeout) onTimeout();
      }
    }, timeoutMs);

    async function loop() {
      if (!activo) return;
      try {
        if (video.srcObject && video.readyState >= 2 && video.videoWidth) {
          const escala = Math.min(1, anchoMax / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * escala);
          canvas.height = Math.round(video.videoHeight * escala);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Medir brillo cada ~3 frames (no todos, para no gastar CPU)
          if (intentos % 3 === 0 && onBrillo) {
            try {
              const brillo = medirBrillo(canvas);
              onBrillo(brillo);
            } catch (e) {}
          }

          const texto = await escanearFrame(canvas, usarROI);

          if (texto && activo) {
            if (texto === ultimoTextoDetectado) {
              framesConfirmados++;
            } else {
              ultimoTextoDetectado = texto;
              framesConfirmados = 1;
            }

            if (framesConfirmados >= FRAMES_PARA_CONFIRMAR) {
              activo = false;
              clearTimeout(timer);
              onDetected(texto);
              return;
            }
          } else {
            ultimoTextoDetectado = null;
            framesConfirmados = 0;
          }
          intentos++;
        }
      } catch (e) {}
      if (activo) setTimeout(loop, intervaloMs);
    }

    loop();
    return () => { activo = false; clearTimeout(timer); };
  }

  // ============================================================
  // Escanear una imagen subida (con ROI + intentos extras)
  // ============================================================
  async function escanearImagen(imgElement) {
    const maxAncho = 1920;
    const escala = Math.min(1, maxAncho / imgElement.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imgElement.width * escala);
    canvas.height = Math.round(imgElement.height * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

    // Intento 1: con ROI (rápido)
    let texto = await escanearFrame(canvas, true);
    if (texto) return texto;

    // Intento 2: sin ROI (toda la imagen)
    texto = await escanearFrame(canvas, false);
    if (texto) return texto;

    // Intento 3: escalar x2 sin ROI
    const c2 = document.createElement('canvas');
    c2.width = canvas.width * 2;
    c2.height = canvas.height * 2;
    const ctx2 = c2.getContext('2d', { willReadFrequently: true });
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(canvas, 0, 0, c2.width, c2.height);
    texto = await escanearFrame(c2, false);

    return texto;
  }

  return {
    escanearContinuo,
    escanearImagen,
    medirBrillo,
    barcodeDisponible: !!barcodeDetector,
    zxingDisponible: !!zxingReader,
    jsQRDisponible
  };
})();

console.log('✅ scanner.js cargado');
