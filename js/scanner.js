/**
 * Escáner de códigos - BarcodeDetector nativo + jsQR fallback
 * Basado en el proyecto Trámites Policiales Salta
 */

const DNIScanner = (() => {

  let detector = null;
  const barcodeDisponible = !!window.BarcodeDetector;
  const jsQRDisponible = !!window.jsQR;

  if (barcodeDisponible) {
    try {
      detector = new BarcodeDetector({ formats: ['pdf417', 'qr_code', 'code_128', 'code_39'] });
      console.log('✅ BarcodeDetector nativo activo');
    } catch (e) {
      console.warn('⚠️ BarcodeDetector no soporta esos formatos:', e);
      detector = null;
    }
  }
  if (!barcodeDisponible && jsQRDisponible) {
    console.log('⚠️ Usando jsQR (compatibilidad)');
  }
  if (!barcodeDisponible && !jsQRDisponible) {
    console.warn('❌ Ningún decodificador disponible');
  }

  /**
   * Escanea UN frame de un canvas
   * @returns {Promise<string|null>} texto crudo o null
   */
  async function escanearFrame(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 1) Intentar con BarcodeDetector nativo
    if (detector) {
      try {
        const codigos = await detector.detect(canvas);
        if (codigos && codigos.length) {
          console.log('📷 Detectado con BarcodeDetector:', codigos[0].rawValue);
          return codigos[0].rawValue;
        }
      } catch (e) { /* silencioso */ }
    }

    // 2) Fallback a jsQR
    if (window.jsQR) {
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (qr && qr.data) {
          console.log('📷 Detectado con jsQR:', qr.data);
          return qr.data;
        }
      } catch (e) { /* silencioso */ }
    }

    return null;
  }

  /**
   * Inicia escaneo continuo desde un <video> y un <canvas>
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} canvas
   * @param {Function} onDetected - callback(texto)
   * @param {Function} onTimeout - callback() si no encuentra en X ms
   * @param {Object} opciones - { intervaloMs, timeoutMs, anchoMax }
   * @returns {Function} función para detener
   */
  function escanearContinuo(video, canvas, onDetected, onTimeout, opciones = {}) {
    const intervaloMs = opciones.intervaloMs || 400;
    const timeoutMs = opciones.timeoutMs || 20000;
    const anchoMax = opciones.anchoMax || 1280;

    let activo = true;
    let intentosSinDeteccion = 0;

    const timerTimeout = setTimeout(() => {
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

          const texto = await escanearFrame(canvas);
          if (texto && activo) {
            activo = false;
            clearTimeout(timerTimeout);
            onDetected(texto);
            return;
          }
          intentosSinDeteccion++;
        }
      } catch (e) {
        console.warn('Error escaneando frame:', e);
      }
      if (activo) setTimeout(loop, intervaloMs);
    }

    loop();

    return () => {
      activo = false;
      clearTimeout(timerTimeout);
    };
  }

  /**
   * Decodifica un frame actual (para cuando el usuario aprieta un botón)
   */
  async function capturarYDecodificar(video, canvas, anchoMax = 1600) {
    if (!video.srcObject || !video.videoWidth) return null;
    const escala = Math.min(1, anchoMax / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return escanearFrame(canvas);
  }

  return { escanearContinuo, capturarYDecodificar, barcodeDisponible, jsQRDisponible };
})();
