/**
 * Lector de PDF417 con ZXing - versión mejorada
 * Soporta escaneo continuo desde vídeo y decodificación desde imagen
 */

const PDF417Reader = (() => {

  let hints = null;
  let reader = null;

  function buildHints() {
    const h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
    h.set(ZXing.DecodeHintType.TRY_HARDER, true);
    // PURE_BARCODE ayuda cuando el código está solo sobre fondo claro
    // pero puede fallar si hay más elementos; lo dejamos desactivado por defecto
    // h.set(ZXing.DecodeHintType.PURE_BARCODE, true);
    return h;
  }

  function init() {
    if (reader) return reader;
    hints = buildHints();
    reader = new ZXing.BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 500
    });
    return reader;
  }

  /**
   * Decodifica desde una imagen estática (base64, URL, canvas)
   */
  async function decode(imageSource) {
    const r = init();
    try {
      const result = await r.decodeFromImageUrl(imageSource);
      return result ? result.getText() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Decodifica desde un canvas ya dibujado (más rápido que base64)
   */
  async function decodeFromCanvas(canvas) {
    const r = init();
    try {
      const result = await r.decodeFromCanvas(canvas);
      return result ? result.getText() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Escaneo continuo desde <video>
   * Devuelve una función para detener
   */
  function scanFromVideo(videoElement, onDetected, onError) {
    const r = init();
    let activo = true;
    let intentos = 0;
    const maxIntentos = 300; // ~60 segundos a 200ms

    async function loop() {
      if (!activo) return;
      intentos++;

      try {
        const result = await r.decodeFromVideoElement(videoElement);
        if (result && activo) {
          activo = false;
          onDetected(result.getText());
          return;
        }
      } catch (e) {
        // Silencioso: simplemente no había código en ese frame
      }

      if (intentos >= maxIntentos) {
        activo = false;
        if (onError) onError('No se detectó el código después de 60 segundos. Probá con más luz y acercate.');
        return;
      }

      if (activo) setTimeout(loop, 200);
    }

    loop();

    return () => { activo = false; };
  }

  return { decode, decodeFromCanvas, scanFromVideo, init };
})();
