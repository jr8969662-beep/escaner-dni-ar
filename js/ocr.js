/**
 * OCR con Tesseract.js para leer el anverso del DNI argentino
 * Método de respaldo cuando falla el PDF417
 */

const OCRReader = (() => {

  let worker = null;
  let workerReady = false;

  async function init(onProgress) {
    if (worker) return worker;
    worker = await Tesseract.createWorker('spa', 1, {
      logger: m => {
        if (onProgress && typeof onProgress === 'function') onProgress(m);
      }
    });
    // Configurar Tesseract para documentos
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789-/.,: ',
      preserve_interword_spaces: '1'
    });
    workerReady = true;
    return worker;
  }

  /**
   * Reconoce texto en una imagen
   * @param {string} imageSource - Base64 o URL
   * @param {Function} onProgress - Callback de progreso (opcional)
   * @returns {Promise<string>} Texto reconocido
   */
  async function recognize(imageSource, onProgress) {
    const w = await init(onProgress);
    const { data: { text } } = await w.recognize(imageSource);
    return text;
  }

  async function terminate() {
    if (worker) {
      await worker.terminate();
      worker = null;
      workerReady = false;
    }
  }

  return { recognize, init, terminate, get ready() { return workerReady; } };
})();
