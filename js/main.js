/**
 * Flujo principal
 */

(() => {
  'use strict';

  console.log('🚀 main.js iniciando...');

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
  let qrAvisado = false;

  const setError = (msg) => { errorEl.textContent = msg; };
  const clearError = () => { errorEl.textContent = ''; };
  const showLoader = (msg) => { loaderText.textContent = msg; loader.style.display = 'flex'; };
  const hideLoader = () => { loader.style.display = 'none'; };

  function setProgress(percent) {
    if (percent == null) { progressBar.style.display = 'none'; return; }
    progressBar.style.display = 'block';
    progressFill.style.width = percent + '%';
  }

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
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function capturar() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) throw new Error('La cámara no está lista todavía.');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.95);
  }

  async function escanearAutomatico() {
    if (escaneando) { detener(); return; }
    escaneando = true;
    qrAvisado = false;
    clearError();
    btnScan.textContent = '⏹ Detener';
    btnReset.style.display = 'none';
    resultBox.classList.remove('active');

    try {
      await ensureCamera();
      overlayLabel.textContent = 'Apuntá al PDF417 (frente) o MRZ (dorso)';

      window.__onQRSolo = () => {
        if (!qrAvisado) {
          qrAvisado = true;
          overlayLabel.textContent = '⚠️ QR detectado. Apuntá al código alargado o al MRZ';
        }
      };

      const duracion = 15000;
      const inicio = Date.now();
      setProgress(0);

      const codigo = await new Promise((resolve) => {
        stopScanFn = BarcodeReader.scanFromVideo(
          video,
          (result) => resolve(result),
          () => resolve(null),
          duracion
        );
        const tick = setInterval(() => {
          const t = (Date.now() - inicio) / duracion;
          setProgress(Math.min(100, t * 100));
          if (t >= 1) clearInterval(tick);
        }, 100);
        const orig = stopScanFn;
        stopScanFn = () => { clearInterval(tick); orig && orig(); };
      });

      setProgress(null);
      if (!escaneando) return;

      if (codigo && !codigo.esVerificacion) {
        overlayLabel.textContent = '¡Código detectado!';
        const data = DNIParser.parsearUniversal(codigo.texto);
        if (data && (data.dni || data.apellido)) {
          data.metodo = codigo.formato || data.metodo;
          render(data);
          finalizarEscaneo();
          return;
        }
      }

      // Fallback OCR
      overlayLabel.textContent = 'Analizando imagen con OCR…';
      showLoader('Ejecutando OCR (puede tardar)…');

      const frame = capturar();
      const ocrText = await OCRReader.recognize(frame, (m) => {
        if (m.status === 'recognizing text') {
          loaderText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
        }
      });
      hideLoader();

      console.log('=== Texto OCR ===');
      console.log(ocrText);

      const data = DNIParser.parsearUniversal(ocrText);
      console.log('=== Datos parseados ===');
      console.log(data);

      if (data && (data.dni || data.apellido)) {
        render(data);
      } else if (data && data.esVerificacion) {
        setError('Solo se detectó el QR de verificación. Apuntá al PDF417 o MRZ.');
      } else {
        setError('No se pudieron extraer datos. Revisá "Ver texto crudo" más abajo.');
        if (data) render(data);
      }

      finalizarEscaneo();

    } catch (e) {
      console.error(e);
      hideLoader();
      setProgress(null);
      setError('Error: ' + e.message);
      finalizarEscaneo();
    } finally {
      window.__onQRSolo = null;
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

  function render(data) {
    if (!data) return;

    overlayLabel.textContent = 'Escaneo completado';

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
        let codigo = await BarcodeReader.decode(src);
        if (!codigo || codigo.esVerificacion) {
          const escalado = await escalarImagen(src, 2);
          const codigo2 = await BarcodeReader.decode(escalado);
          if (codigo2 && !codigo2.esVerificacion) codigo = codigo2;
        }

        if (codigo && !codigo.esVerificacion) {
          const data = DNIParser.parsearUniversal(codigo.texto);
          if (data && (data.dni || data.apellido)) {
            hideLoader();
            data.metodo = codigo.formato;
            render(data);
            return;
          }
        }

        loaderText.textContent = 'Ejecutando OCR…';
        const ocrText = await OCRReader.recognize(src, (m) => {
          if (m.status === 'recognizing text') {
            loaderText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
          }
        });
        hideLoader();

        console.log('=== Texto OCR (upload) ===');
        console.log(ocrText);

        const data = DNIParser.parsearUniversal(ocrText);
        if (data && (data.dni || data.apellido)) render(data);
        else if (data) render(data);
        else setError('No se pudieron extraer datos.');

      } catch (err) {
        console.error(err);
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

  window.addEventListener('beforeunload', () => {
    stopCamera();
    if (stopScanFn) stopScanFn();
    OCRReader.terminate();
  });

  console.log('✅ main.js listo');
  console.log('Objetos cargados:', {
    Validators: typeof Validators,
    DNIParser: typeof DNIParser,
    BarcodeReader: typeof BarcodeReader,
    OCRReader: typeof OCRReader,
    ZXing: typeof ZXing,
    Tesseract: typeof Tesseract
  });

})();
