/**
 * Lector de código PDF417 usando ZXing
 * Es el método más fiable para el DNI argentino
 */

const PDF417Reader = (() => {

  let reader = null;

  function init() {
    if (reader) return reader;
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 100
    });
    return reader;
  }

  /**
   * Decodifica un PDF417 desde una imagen (base64, URL o canvas)
   * @param {string|HTMLCanvasElement|HTMLImageElement} imageSource
   * @returns {Promise<string|null>} Texto decodificado o null
   */
  async function decode(imageSource) {
    const r = init();
    try {
      const result = await r.decodeFromImageUrl(imageSource);
      if (!result) return null;
      return result.getText();
    } catch (e) {
      // ZXing lanza error si no encuentra código
      return null;
    }
  }

  /**
   * Escaneo continuo desde un elemento <video>
   * Llama a onDetected(texto) cuando encuentra un PDF417
   * @param {HTMLVideoElement} videoElement
   * @param {Function} onDetected
   * @returns {Function} Función para detener el escaneo
   */
  function scanFromVideo(videoElement, onDetected) {
    const r = init();
    let activo = true;

    async function loop() {
      if (!activo) return;
      try {
        const result = await r.decodeFromVideoElement(videoElement);
        if (result && activo) {
          activo = false;
          onDetected(result.getText());
          return;
        }
      } catch (e) {
        // Sin código en este frame, seguir intentando
      }
      if (activo) setTimeout(loop, 200);
    }

    loop();

    return () => { activo = false; };
  }

  return { decode, scanFromVideo, init };
})();
