/**
 * Lógica principal - con escaneo en vivo y cascada de intentos
 */

(() => {
  'use strict';

  const video = document.getElementById('video');
  const preview = document.getElementById('preview');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const btnStart = document.getElementById('btnStart');
  const btnLive = document.getElementById('btnLive');
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

  let stream = null;
  let stopLiveScan = null;

  // ---- Helpers UI ----
  function showError(msg) { errorEl.textContent = msg; }
  function clearError() { errorEl.textContent = ''; }
  function showLoader(msg = 'Procesando…') {
    loaderText.textContent = msg;
    loader.style.display = 'flex';
  }
  function hideLoader() { loader.style.display = 'none'; }

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
      btnLive.disabled = false;
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

  // ---- Captura con preprocesamiento (contraste + grises) ----
  function captureFrame() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('La cámara no está lista todavía.');

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let v = (gris - 128) * 1.4 + 128;
      v = Math.max(0, Math.min(255, v));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

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
    btnLive.disabled = true;
  }

  // ---- Utilidades de imagen ----
  function recortarCentro(imageSrc, factor = 0.6) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const w = img.width * factor;
        const h = img.height * factor;
        const x = (img.width - w) / 2;
        const y = (img.height - h) / 2;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.95));
      };
      img.src = imageSrc;
    });
  }

  function escalarImagen(imageSrc, factor = 2) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width * factor;
        c.height = img.height * factor;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.95));
      };
      img.src = imageSrc;
    });
  }

  function binarizar(imageSrc, umbral = 128) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
          const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          const v = g > umbral ? 255 : 0;
          p[i] = p[i + 1] = p[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.95));
      };
      img.src = imageSrc;
    });
  }

  // ---- Cascada de intentos ----
  async function intentarLeerPDF417(imageSrc, onPaso) {
    // Intento 1: normal
    if (onPaso) onPaso('Intento 1/4…');
    let texto = await PDF417Reader.decode(imageSrc);
    if (texto) return texto;

    // Intento 2: recorte central
    if (onPaso) onPaso('Intento 2/4…');
    const recortado = await recortarCentro(imageSrc, 0.7);
    texto = await PDF417Reader.decode(recortado);
    if (texto) return texto;

    // Intento 3: escalado x2
    if (onPaso) onPaso('Intento 3/4…');
    const escalado = await escalarImagen(imageSrc, 2);
    texto = await PDF417Reader.decode(escalado);
    if (texto) return texto;

    // Intento 4: binarizado
    if (onPaso) onPaso('Intento 4/4…');
    const binarizado = await binarizar(imageSrc);
    texto = await PDF417Reader.decode(binarizado);
    return texto;
  }

  // ---- Render ----
  function render(data) {
    if (!data) {
      showError('No se pudieron extraer datos.');
      return;
    }

    document.getElementById('rDni').textContent = data.dni || '—';
    document.getElementById('rApellido').textContent = data.apellido || '—';
    document.getElementById('rNombre').textContent = data.nombre || '—';
    document.getElementById('rSexo').textContent =
      data.sexo === 'M' ? 'Masculino' :
      data.sexo === 'F' ? 'Femenino' :
      (data.sexo || '—');
    document.getElementById('rNacimiento').textContent = data.fechaNacimiento || '—';
    document.getElementById('rEmision').textContent = data.fechaEmision || '—';
    document.getElementById('rVencimiento').textContent = data.fechaVencimiento || '—';
    document.getElementById('rEjemplar').textContent = data.ejemplar || '—';
    document.getElementById('rTramite').textContent = data.tramite || '—';
    document.getElementById('rCuil').textContent = data.cuil || '—';
    document.getElementById('rNacionalidad').textContent = data.nacionalidad || '—';
    document.getElementById('rRaw').textContent = data.raw || '—';

    if (data.validaciones && data.validaciones.edad != null) {
      document.getElementById('rNacimiento').textContent += ` (${data.validaciones.edad} años)`;
    }

    badgeMetodo.textContent = data.metodo.toUpperCase();
    badgeMetodo.className = 'badge ' + data.metodo;

    resultBox.classList.add('active');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Flujo PDF417 con cascada ----
  async function runPDF417(imageSrc) {
    clearError();
    showLoader('Buscando PDF417…');
    try {
      const texto = await intentarLeerPDF417(imageSrc, (paso) => {
        loaderText.textContent = paso;
      });
      if (!texto) {
        showError('No se detectó el PDF417. Probá con más luz, sin reflejos, y acercate al código.');
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
    showLoader('Ejecutando OCR…');
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
      console.log('NFC leído:', resultado);
      showError('NFC detectado. Para leer los datos del DNIe se requiere el código CAN.');
    } catch (e) {
      showError('Error NFC: ' + e.message);
    } finally {
      hideLoader();
    }
  }

  // ---- Eventos ----
  btnStart.addEventListener('click', startCamera);

  btnLive.addEventListener('click', () => {
    if (stopLiveScan) {
      stopLiveScan();
      stopLiveScan = null;
      btnLive.textContent = '🎯 Escaneo en vivo';
      return;
    }

    clearError();
    btnLive.textContent = '⏹ Detener';
    showError('Apuntá al PDF417 y mantené el pulso firme…');

    stopLiveScan = PDF417Reader.scanFromVideo(
      video,
      (texto) => {
        stopLiveScan = null;
        btnLive.textContent = '🎯 Escaneo en vivo';
        clearError();
        const data = DNIParser.parsearPDF417(texto);
        render(data);
      },
      (err) => {
        stopLiveScan = null;
        btnLive.textContent = '🎯 Escaneo en vivo';
        showError(err);
      }
    );
  });

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

  window.addEventListener('beforeunload', () => {
    stopCamera();
    if (stopLiveScan) stopLiveScan();
    OCRReader.terminate();
  });

  if (!NFCReader.isSupported()) {
    btnNFC.title = 'NFC no soportado en este navegador';
  }

})();
