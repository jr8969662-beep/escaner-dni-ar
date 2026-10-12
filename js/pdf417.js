/**
 * Lector de PDF417 con ZXing - versión mejorada con escaneo en vivo
 */

const PDF417Reader = (() => {

  let reader = null;

  function buildHints() {
    const h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
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

  async function decode(imageSource) {
    const r = init();
    try {
      const result = await r.decodeFromImageUrl(imageSource);
      return result ? result.getText() : null;
    } catch (e) {
      return null;
    }
  }

  function scanFromVideo(videoElement, onDetected, onError) {
    const r = init();
    let activo = true;
    let intentos = 0;
    const maxIntentos = 300;

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
      } catch (e) {}
      if (intentos >= maxIntentos) {
        activo = false;
        if (onError) onError('No se detectó el código en 60 segundos. Probá con más luz y acercate.');
        return;
      }
      if (activo) setTimeout(loop, 200);
    }

    loop();
    return () => { activo = false; };
  }

  return { decode, scanFromVideo, init };
})();
