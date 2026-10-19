const DNIScanner = (() => {
  let barcodeDetector = null;
  let zxingReader = null;
  const barcodeDisponible = typeof BarcodeDetector !== 'undefined';
  const zxingDisponible = typeof ZXing !== 'undefined';
  const jsQRDisponible = typeof jsQR === 'function';

  if (barcodeDisponible) {
    try {
      barcodeDetector = new BarcodeDetector({ formats: ['pdf417', 'qr_code', 'code_128', 'code_39', 'data_matrix', 'aztec'] });
    } catch (e) { barcodeDetector = null; }
  }
  if (zxingDisponible) {
    try {
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417, ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.DATA_MATRIX, ZXing.BarcodeFormat.AZTEC]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 500 });
    } catch (e) { zxingReader = null; }
  }

  function extraerROI(canvasOriginal) {
    const w = canvasOriginal.width, h = canvasOriginal.height;
    const roiW = Math.round(w * 0.85), roiH = Math.round(h * 0.65);
    const roiX = Math.round((w - roiW) / 2), roiY = Math.round((h - roiH) / 2);
    const roi = document.createElement('canvas');
    roi.width = roiW; roi.height = roiH;
    const ctx = roi.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvasOriginal, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
    return roi;
  }

  function medirBrillo(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height, paso = 20;
    const imgData = ctx.getImageData(0, 0, w, h), data = imgData.data;
    let suma = 0, muestras = 0;
    for (let y = 0; y < h; y += paso) {
      for (let x = 0; x < w; x += paso) {
        const i = (y * w + x) * 4;
        suma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        muestras++;
      }
    }
    return muestras > 0 ? suma / muestras : 0;
  }

  async function escanearFrame(canvas, usarROI = true) {
    const canvasEscaneo = usarROI ? extraerROI(canvas) : canvas;
    const ctx = canvasEscaneo.getContext('2d', { willReadFrequently: true });
    if (barcodeDetector) {
      try {
        const codigos = await barcodeDetector.detect(canvasEscaneo);
        if (codigos && codigos.length) return codigos[0].rawValue;
      } catch (e) {}
    }
    if (zxingReader) {
      try {
        const resultado = await zxingReader.decodeFromCanvas(canvasEscaneo);
        if (resultado && resultado.getText) return resultado.getText();
      } catch (e) {}
    }
    if (jsQRDisponible) {
      try {
        const imageData = ctx.getImageData(0, 0, canvasEscaneo.width, canvasEscaneo.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data) return qr.data;
      } catch (e) {}
    }
    return null;
  }

  function escanearContinuo(video, canvas, onDetected, onTimeout, opciones = {}) {
    const intervaloMs = opciones.intervaloMs || 300;
    const timeoutMs = opciones.timeoutMs || 20000;
    const anchoMax = opciones.anchoMax || 1920;
    const usarROI = opciones.usarROI !== false;
    const onBrillo = opciones.onBrillo;
    const framesConfirmacion = opciones.framesConfirmacion || 2;
    let activo = true, intentos = 0, ultimoTextoDetectado = null, framesConfirmados = 0;

    const timer = setTimeout(() => { if (activo) { activo = false; if (onTimeout) onTimeout(); } }, timeoutMs);

    async function loop() {
      if (!activo) return;
      try {
        if (video.srcObject && video.readyState >= 2 && video.videoWidth) {
          const escala = Math.min(1, anchoMax / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * escala);
          canvas.height = Math.round(video.videoHeight * escala);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (intentos % 3 === 0 && onBrillo) {
            try { onBrillo(medirBrillo(canvas)); } catch (e) {}
          }
          const texto = await escanearFrame(canvas, usarROI);
          if (texto && activo) {
            if (texto === ultimoTextoDetectado) framesConfirmados++;
            else { ultimoTextoDetectado = texto; framesConfirmados = 1; }
            if (framesConfirmados >= framesConfirmacion) {
              activo = false; clearTimeout(timer); onDetected(texto); return;
            }
          } else { ultimoTextoDetectado = null; framesConfirmados = 0; }
          intentos++;
        }
      } catch (e) {}
      if (activo) setTimeout(() => requestAnimationFrame(loop), intervaloMs);
    }
    loop();
    return () => { activo = false; clearTimeout(timer); };
  }

  async function escanearImagen(imgElement) {
    const maxAncho = 1920, escala = Math.min(1, maxAncho / imgElement.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imgElement.width * escala);
    canvas.height = Math.round(imgElement.height * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    let texto = await escanearFrame(canvas, true);
    if (texto) return texto;
    texto = await escanearFrame(canvas, false);
    if (texto) return texto;
    const c2 = document.createElement('canvas');
    c2.width = canvas.width * 2; c2.height = canvas.height * 2;
    const ctx2 = c2.getContext('2d', { willReadFrequently: true });
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(canvas, 0, 0, c2.width, c2.height);
    return await escanearFrame(c2, false);
  }

  return { escanearContinuo, escanearImagen, medirBrillo, barcodeDisponible: !!barcodeDetector, zxingDisponible: !!zxingReader, jsQRDisponible };
})();
