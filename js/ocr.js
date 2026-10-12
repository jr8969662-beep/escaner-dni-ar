/**
 * OCR con Tesseract.js
 */

const OCRReader = (() => {

  let worker = null;
  let workerReady = false;

  async function init(onProgress) {
    if (worker) return worker;
    worker = await Tesseract.createWorker('spa', 1, {
      logger: m => { if (onProgress) onProgress(m); }
    });
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑabcdefghijklmnopqrstuvwxyz0123456789-/.,: <>',
      preserve_interword_spaces: '1'
    });
    workerReady = true;
    return worker;
  }

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

console.log('✅ ocr.js cargado');
