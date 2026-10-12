/**
 * Flujo principal: UN botón que hace todo automáticamente
 */

(() => {
  'use strict';

  const video = document.getElementById('video');
  const preview = document.getElementById('preview');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const overlayLabel = document.getElementById('overlayLabel');
  const btnScan = document.getElementById('btnScan');
  const btnUpload = document.getElementById('btnUpload');
  const btnReset = document.getElementById('btnReset');
  const fileInput = document.getElementById('fileInput');
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loaderText');
  const errorEl = document.getElementById('error');
  const resultBox = document.getElementById('result');
  const badgeMetodo = document.getElementById('badgeMetodo');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');

  let stream = null;
  let stopScanFn = null;
  let escaneando = false;

  // ---- Helpers UI ----
  const setError = (msg) => { errorEl.textContent = msg; };
  const clearError = () => { errorEl.textContent = ''; };
  const showLoader = (msg) => {
    loaderText.textContent = msg;
    loader.style.display = 'flex';
  };
  const hideLoader = () => { loader.style.display = 'none'; };

  function setProgress(percent) {
    if (percent == null) {
      progressBar.style.display = 'none';
      return;
    }
    progressBar.style.display = 'block';
    progressFill.style.width = percent + '%';
  }

  // ---- Cámara ----
  async function ensureCamera() {
    if (stream) return;
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
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function capturar() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('La cámara no está lista todavía.');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.95);
  }

  // ---- Escaneo automático en cascada ----
  async function escanearAutomatico() {
    if (escaneando) {
      detener();
      return;
    }
    escaneando = true;
    clearError();
    btnScan.textContent = '⏹ Detener';
    btnReset.style.display = 'none';
    resultBox.classList.remove('active');

    try {
      await ensureCamera();
      overlayLabel.textContent = 'Apuntá al código del DNI…';

      // ---- FASE 1: buscar código de barras en vivo (20s) ----
      const inicio = Date.now();
      const duracion = 20000;

      setProgress(0);
      const codigo = await new Promise((resolve) => {
        stopScanFn = BarcodeReader.scanFromVideo(
          video,
          (result) => resolve(result),
          () => resolve(null),
          duracion
        );

        // Barra de progreso animada
        const tick = setInterval(() => {
          const t = (Date.now() - inicio) / duracion;
          setProgress(Math.min(100, t * 100));
          if (t >= 1) clearInterval(tick);
        }, 100);

        // Guardar limpieza
        const orig = stopScanFn;
        stopScanFn = () => { clearInterval(tick); orig && orig(); };
      });

      setProgress(null);

      // Si el usuario detuvo manualmente
      if (!escaneando) return;

      // ---- FASE 2: si encontramos código, parsear ----
      if (codigo) {
        overlayLabel.textContent = '¡Código detectado!';
        const data = DNIParser.parsearUniversal(codigo.texto);
        if (data) {
          data.metodo = codigo.formato || data.metodo;
          render(data);
          finalizarEscaneo();
          return;
        }
      }

      // ---- FASE 3: fallback a OCR ----
      overlayLabel.textContent = 'No detecté código. Analizando imagen…';
      setError('Sin código visible. Aplicando OCR…');
      showLoader('Ejecutando OCR (puede tardar)…');

      const frame = capturar();
      const ocrText = await OCRReader.recognize(frame, (m) => {
        if (m.status === 'recognizing text') {
          loaderText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
        }
      });
      hideLoader();

      const data = DNIParser.parsearOCR(ocrText);
      if (data) {
        render(data);
      } else {
        setError('No se pudieron extraer datos. Probá con mejor luz o acercate al DNI.');
      }

      finalizarEscaneo();

    } catch (e) {
      hideLoader();
      setProgress(null);
      setError('Error: ' + e.message);
      finalizarEscaneo();
    }
  }

  function detener() {
    escaneando = false;
    if (stopScanFn) { stopScanFn(); stopScanFn = null; }
    setProgress(null);
    hideLoader();
    btnScan.textContent = '📷 Escanear DNI';
    btnReset.style.display = 'inline-block';
  }

  function finalizarEscaneo() {
    escaneando = false;
    stopScanFn = null;
    setProgress(null);
    hideLoader();
    btnScan.textContent = '📷 Escanear DNI';
    btnReset.style.display = 'inline-block';
  }

  // ---- Render ----
  function render(data) {
    if (!data) return;
    overlayLabel.textContent = 'Escaneo completado';
    setError('');

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

    badgeMetodo.textContent = (data.metodo || 'desconocido').toUpperCase();
    badgeMetodo.className = 'badge ' + (data.metodo || 'pdf417');

    resultBox.classList.add('active');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Eventos ----
  btnScan.addEventListener('click', escanearAutomatico);

  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    clearError();
    btnReset.style.display = 'inline-block';
    resultBox.classList.remove('active');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      preview.src = src;
      preview.style.display = 'block';
      video.style.display = 'none';
      overlay.style.display = 'none';
      btnScan.disabled = true;

      showLoader('Analizando imagen…');
      try {
        // Intentar código primero
        let codigo = await BarcodeReader.decode(src);
        if (!codigo) {
          // Probar con escalado x2
          const escalado = await escalarImagen(src, 2);
          codigo = await BarcodeReader.decode(escalado);
        }

        if (codigo) {
          hideLoader();
          const data = DNIParser.parsearUniversal(codigo.texto);
          data.metodo = codigo.formato;
          render(data);
          return;
        }

        // Fallback a OCR
        loaderText.textContent = 'Ejecutando OCR…';
        const ocrText = await OCRReader.recognize(src, (m) => {
          if (m.status === 'recognizing text') {
            loaderText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
          }
        });
        hideLoader();

        const data = DNIParser.parsearOCR(ocrText);
        if (data) render(data);
        else setError('No se pudieron extraer datos de la imagen.');

      } catch (err) {
        hideLoader();
        setError('Error: ' + err.message);
      } finally {
        btnScan.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  });

  btnReset.addEventListener('click', () => {
    detener();
    resultBox.classList.remove('active');
    preview.style.display = 'none';
    video.style.display = 'block';
    overlay.style.display = 'flex';
    overlayLabel.textContent = 'Apuntá al DNI';
    btnReset.style.display = 'none';
    setError('');
    fileInput.value = '';
    ensureCamera().catch(e => setError('No se pudo acceder a la cámara: ' + e.message));
  });

  // ---- Helpers ----
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

  // Limpieza
  window.addEventListener('beforeunload', () => {
    stopCamera();
    if (stopScanFn) stopScanFn();
    OCRReader.terminate();
  });

})();
