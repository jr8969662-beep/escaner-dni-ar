/**
 * Lector de códigos (PDF417, QR, Code128, etc) con ZXing
 * Expone el objeto BarcodeReader (NO PDF417Reader)
 */

const BarcodeReader = (() => {

  let reader = null;

  function buildHints() {
    const h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.PDF_417,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.AZTEC,
      ZXing.BarcodeFormat.QR_CODE
    ]);
    h.set(ZXing.DecodeHintType.TRY_HARDER, true);
    h.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
    return h;
  }

  function init() {
    if (reader) return reader;
    reader = new ZXing.BrowserMultiFormatReader(buildHints(), {
      delayBetweenScanAttempts: 60,
      delayBetweenScanSuccess: 500
    });
    return reader;
  }

  async function decode(imageSource) {
    const r = init();
    try {
      const result = await r.decodeFromImageUrl(imageSource);
      if (!result) return null;
      return {
        texto: result.getText(),
        formato: formatName(result.getBarcodeFormat()),
        esVerificacion: esURLVerificacion(result.getText())
      };
    } catch (e) {
      return null;
    }
  }

  function scanFromVideo(videoElement, onDetected, onTimeout, timeoutMs = 15000) {
    const r = init();
    let activo = true;

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
          const texto = result.getText();
          const formato = formatName(result.getBarcodeFormat());
          const esVerif = esURLVerificacion(texto);

          // Si es QR de verificación, avisar pero SEGUIR buscando
          if (formato === 'qr' && esVerif) {
            if (window.__onQRSolo) window.__onQRSolo();
          } else {
            activo = false;
            clearTimeout(timer);
            onDetected({ texto, formato, esVerificacion: esVerif });
            return;
          }
        }
      } catch (e) {}
      if (activo) setTimeout(loop, 60);
    }

    loop();

    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }

  function esURLVerificacion(texto) {
    if (!texto) return false;
    return /^https?:\/\/(www\.)?(argentina\.gob\.ar|dni\.argentina\.gob\.ar|renaper\.gob\.ar)/i.test(texto)
        || /consulta-dni|verificar|verificacion/i.test(texto);
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

  return { decode, scanFromVideo, init, esURLVerificacion };
})();

console.log('✅ scanner.js cargado');
