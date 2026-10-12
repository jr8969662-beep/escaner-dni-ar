/**
 * Lector universal de códigos (PDF417, QR, Code128, Code39, DataMatrix, Aztec)
 * Usa ZXing para máxima compatibilidad
 */

const BarcodeReader = (() => {

  let reader = null;

  function buildHints() {
    const h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.PDF_417,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.AZTEC,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39
    ]);
    h.set(ZXing.DecodeHintType.TRY_HARDER, true);
    return h;
  }

  function init() {
    if (reader) return reader;
    reader = new ZXing.BrowserMultiFormatReader(buildHints(), {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 500
    });
    return reader;
  }

  /**
   * Decodifica desde una imagen estática
   */
  async function decode(imageSource) {
    const r = init();
    try {
      const result = await r.decodeFromImageUrl(imageSource);
      return result ? { texto: result.getText(), formato: formatName(result.getBarcodeFormat()) } : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Escaneo continuo desde <video>
   * @returns {Function} función para detener
   */
  function scanFromVideo(videoElement, onDetected, onTimeout, timeoutMs = 20000) {
    const r = init();
    let activo = true;
    let ultimoIntento = Date.now();

    const timer = setTimeout(() => {
      if (activo) {
        activo = false;
        if (onTimeout) onTimeout();
      }
    }, timeoutMs);

    async function loop() {
      if (!activo) return;
      try {
        const result = await r.decodeFromVideoElement(videoElement);
        if (result && activo) {
          activo = false;
          clearTimeout(timer);
          onDetected({
            texto: result.getText(),
            formato: formatName(result.getBarcodeFormat())
          });
          return;
        }
      } catch (e) { /* sin código en este frame */ }
      if (activo) setTimeout(loop, 180);
    }

    loop();

    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }

  function formatName(format) {
    if (!format) return 'código';
    const f = String(format);
    if (f.includes('PDF_417')) return 'pdf417';
    if (f.includes('QR')) return 'qr';
    if (f.includes('DATA_MATRIX')) return 'qr';
    if (f.includes('AZTEC')) return 'qr';
    if (f.includes('CODE_128')) return 'pdf417';
    if (f.includes('CODE_39')) return 'pdf417';
    return 'pdf417';
  }

  return { decode, scanFromVideo, init };
})();
