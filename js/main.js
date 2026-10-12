/**
 * Lógica principal: inicialización, eventos y flujo en cascada
 */

(() => {
  'use strict';

  // ---- Referencias DOM ----
  const video = document.getElementById('video');
  const preview = document.getElementById('preview');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const btnStart = document.getElementById('btnStart');
  const btnScanPDF417 = document.getElementById('btnScanPDF417');
  const btnScanOCR = document.getElementById('btnScanOCR');
  const btnNFC = document.getElementById('btnNFC');
  const btnUpload = document.getElementById('btnUpload');
  const btnReset = document.getElementById('btnReset');
  const fileInput = document.getElementById('fileInput');
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loaderText');
  const errorEl = document.getElementById('error');
  const resultBox = document.getElementById('result');
  const badgeMetodo = document.getElementById('badgeMetodo');

  // ---- Estado ----
  let stream = null;
  let stopScanFn = null; // función para detener el escaneo continuo

  // ---- Helpers UI ----
  function showError(msg) {
    errorEl.textContent = msg;
  }
  function clearError() {
    errorEl.textContent = '';
  }
  function showLoader(msg = 'Procesando…') {
    loaderText.textContent = msg;
    loader.style.display = 'flex';
  }
  function hideLoader() {
    loader.style.display = 'none';
  }

  // ---- Cámara ----
  async function startCamera() {
    try {
      clearError();
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      video.srcObject = stream;
      video.style.display = 'block';
      preview.style.display = 'none';
      overlay.style.display = 'flex';

      btnStart.disabled = true;
      btnScanPDF417.disabled = false;
      btnScanOCR.disabled = false;
      if (NFCReader.isSupported()) btnNFC.disabled = false;
    } catch (e) {
      showError('No se pudo acceder a la cámara: ' + e.message);
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function captureFrame() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      throw new Error('La cámara no está lista todavía.');
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.95);
  }

  function showImage(src) {
    preview.src = src;
    preview.style.display = 'block';
    video.style.display = 'none';
    overlay.style.display = 'none';
    btnReset.style.display = 'inline-block';
    btnScanPDF417.disabled = true;
    btnScanOCR.disabled = true;
  }

  // ---- Render de resultado ----
  function render(data) {
    if (!data) {
      showError('No se pudieron extraer datos del documento.');
      return;
    }

    document.getElementById('rDni').textContent = data.dni || '—';
    document.getElementById('rApellido').textContent = data.apellido || '—';
    document.getElementById('rNombre').textContent = data.nombre || '—';
    document.getElementById('rSexo').textContent = data.sexo === 'M' ? 'Masculino'
                                                    : data.sexo === 'F' ? 'Femenino'
                                                    : (data.sexo || '—');
    document.getElementById('rNacimiento').textContent = data.fechaNacimiento || '—';
    document.getElementById('rEmision').textContent = data.fechaEmision || '—';
    document.getElementById('rVencimiento').textContent = data.fechaVencimiento || '—';
    document.getElementById('rEjemplar').textContent = data.ejemplar || '—';
    document.getElementById('rTramite').textContent = data.tramite || '—';
    document.getElementById('rCuil').textContent = data.cuil || '—';
    document.getElementById('rNacionalidad').textContent = data.nacionalidad || '—';
    document.getElementById('rRaw').textContent = data.raw || '—';

    // Mostrar edad junto a la fecha de nacimiento si está disponible
    if (data.validaciones && data.validaciones.edad !== null && data.validaciones.edad !== undefined) {
      document.getElementById('rNacimiento').textContent += ` (${data.validaciones.edad} años)`;
    }

    // Badge del método
    badgeMetodo.textContent = data.metodo.toUpperCase();
    badgeMetodo.className = 'badge ' + data.metodo;

    resultBox.classList.add('active');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Flujo PDF417 ----
  async function runPDF417(imageSrc) {
    clearError();
    showLoader('Buscando código PDF417…');
    try {
      const texto = await PDF417Reader.decode(imageSrc);
      if (!texto) {
        showError('No se detectó PDF417. Probá con mejor luz o usá el OCR.');
        return;
      }
      const data = DNIParser.parsearPDF417(texto);
      render(data);
    } catch (e) {
      showError('Error al leer PDF417: ' + e.message);
    } finally {
      hideLoader();
    }
  }

  // ---- Flujo OCR ----
  async function runOCR(imageSrc) {
    clearError();
    showLoader('Ejecutando OCR… (puede tardar)');
    try {
      const texto = await OCRReader.recognize(imageSrc, (m) => {
        if (m.status === 'recognizing text') {
          loaderText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
        }
      });
      const data = DNIParser.parsearOCR(texto);
      render(data);
    } catch (e) {
      showError('Error en OCR: ' + e.message);
    } finally {
      hideLoader();
    }
  }

  // ---- Flujo NFC ----
  async function runNFC() {
    clearError();
    showLoader('Acercá el DNI al lector NFC…');
    try {
      const resultado = await NFCReader.read(30000);
      // El chip del DNIe devuelve datos estructurados; acá mostramos el raw
      // En producción se requiere BAC/PACE + CAN para acceso seguro
      console.log('NFC leído:', resultado);
      showError('NFC detectado. Para leer los datos del DNIe se requiere el código CAN y un SDK especializado.');
    } catch (e) {
      showError('Error NFC: ' + e.message);
    } finally {
      hideLoader();
    }
  }

  // ---- Eventos ----
  btnStart.addEventListener('click', startCamera);

  btnScanPDF417.addEventListener('click', () => {
    try {
      const src = captureFrame();
      showImage(src);
      runPDF417(src);
    } catch (e) {
      showError(e.message);
    }
  });

  btnScanOCR.addEventListener('click', () => {
    try {
      const src = captureFrame();
      showImage(src);
      runOCR(src);
    } catch (e) {
      showError(e.message);
    }
  });

  btnNFC.addEventListener('click', runNFC);

  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      showImage(ev.target.result);
      // Intentar PDF417 primero, luego OCR
      runPDF417(ev.target.result).then(() => {
        if (!resultBox.classList.contains('active')) {
          runOCR(ev.target.result);
        }
      });
    };
    reader.readAsDataURL(file);
  });

  btnReset.addEventListener('click', () => {
    resultBox.classList.remove('active');
    preview.style.display = 'none';
    btnReset.style.display = 'none';
    btnStart.disabled = false;
    clearError();
    if (!stream) startCamera();
  });

  // Limpieza al salir
  window.addEventListener('beforeunload', () => {
    stopCamera();
    if (stopScanFn) stopScanFn();
    OCRReader.terminate();
  });

  // Detectar soporte NFC al inicio
  if (!NFCReader.isSupported()) {
    btnNFC.title = 'NFC no soportado en este navegador';
  }

})();
