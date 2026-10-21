(() => {
  'use strict';

  const DEBUG = false;
  const STORAGE_KEY = 'escaner_dni_historial';
  const MAX_HISTORIAL = 50;
  const PAIS_KEY = 'pais_escaner';
  const TEMA_KEY = 'tema_escaner';
  const SONIDO_KEY = 'sonido_escaner';
  const BRILLO_UMBRAL_BAJO = 80;
  const BRILLO_UMBRAL_ALTO = 140;
  let autoFlashActivo = false;

  // Variables de control de cámara
  let resolucionActual = '720p';
  let timerResolucion = null;
  let screenFlashActive = false;

  function log(msg) { if (DEBUG) console.log(msg); }

  // DOM
  const video = document.getElementById('scan-video');
  const canvas = document.getElementById('scan-canvas');
  const img = document.getElementById('scan-img');
  const estado = document.querySelector('.captura-estado');
  const escaneoEstado = document.querySelector('.escaneo-estado');
  const scanFrame = document.getElementById('scan-frame');
  const cameraHint = document.getElementById('camera-hint');
  const cameraError = document.getElementById('camera-error');
  const cameraErrorText = document.getElementById('camera-error-text');
  const btnCamara = document.getElementById('btn-camara');
  const btnRetryCamara = document.getElementById('btn-retry-camara');
  const btnUpload = document.getElementById('btn-upload');
  const btnRepetir = document.getElementById('btn-repetir');
  const btnFlash = document.getElementById('flash-btn');
  const btnTema = document.getElementById('btn-tema');
  const fileInput = document.getElementById('file-input');
  const resultado = document.getElementById('resultado');
  const badgeMetodo = document.getElementById('badge-metodo');
  const badgePais = document.getElementById('badge-pais');
  const resultPais = document.getElementById('result-pais');
  const labelNumero = document.getElementById('label-numero');
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const btnCopiar = document.getElementById('btn-copiar');
  const btnDescargar = document.getElementById('btn-descargar');
  const btnGuardarHistorial = document.getElementById('btn-guardar-historial');
  const btnHistorial = document.getElementById('btn-historial');
  const historialCount = document.getElementById('historial-count');
  const modalHistorial = document.getElementById('modal-historial');
  const btnCerrarHistorial = document.getElementById('btn-cerrar-historial');
  const btnLimpiarHistorial = document.getElementById('btn-limpiar-historial');
  const historialLista = document.getElementById('historial-lista');
  const toast = document.getElementById('toast');
  
  const focusReticle = document.getElementById('focus-reticle');
  const zoomControl = document.getElementById('zoom-control');
  const zoomSlider = document.getElementById('zoom-slider');
  
  // NUEVO: Overlay para flash de pantalla
  const screenFlashOverlay = document.createElement('div');
  screenFlashOverlay.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;opacity:0;pointer-events:none;transition:opacity 0.3s;';
  document.body.appendChild(screenFlashOverlay);

  // ... (Mantener las referencias al modal de domicilio igual que antes) ...

  function setStatus(texto, tipo = 'idle') {
    if (statusText) statusText.textContent = texto;
    if (statusPill) { statusPill.classList.remove('active', 'error'); if (tipo === 'active') statusPill.classList.add('active'); if (tipo === 'error') statusPill.classList.add('error'); }
  }

  function mostrarToast(msg, tipo = 'success') {
    if (!toast) return;
    toast.className = 'toast ' + tipo; toast.textContent = msg; toast.hidden = false;
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => { toast.hidden = true; }, 300); }, 2500);
  }

  // --- LÓGICA DE CÁMARA MEJORADA ---

  async function iniciarCamara(escala = '720p') {
    if (stream) detenerCamara();
    resolucionActual = escala;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarErrorCamara('Este navegador no permite acceder a la cámara.'); setStatus('Sin cámara', 'error'); return;
    }

    const width = escala === '1080p' ? 1920 : 1280;
    const height = escala === '1080p' ? 1080 : 720;

    try {
      setStatus(`Iniciando cámara (${escala})…`);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height }, focusMode: 'continuous', exposureMode: 'continuous' },
        audio: false
      });
    } catch (err) {
      mostrarErrorCamara('No se pudo acceder a la cámara.'); setStatus('Error cámara', 'error'); return;
    }

    try {
      video.srcObject = stream; video.hidden = false;
      video.setAttribute('autoplay', ''); video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
      video.muted = true;
      try { await video.play(); } catch (e) {}

      await new Promise((resolve) => { if (video.videoWidth > 0) return resolve(); const check = setInterval(() => { if (video.videoWidth > 0) { clearInterval(check); resolve(); } }, 100); setTimeout(() => { clearInterval(check); resolve(); }, 3000); });
      
      if (img) img.hidden = true;
      if (scanFrame) { scanFrame.classList.add('activo'); setScanFrameState('buscando'); }
      if (cameraHint) cameraHint.style.opacity = '1'; if (btnCamara) btnCamara.hidden = true; if (btnRepetir) btnRepetir.hidden = true;
      setStatus('Buscando código...', 'active');

      trackActual = stream.getVideoTracks()[0];
      const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
      if (flashSoportado && btnFlash) btnFlash.classList.add('activo');
      
      // Si no hay linterna, activamos el flash de pantalla
      if (!flashSoportado && !screenFlashActive) {
        screenFlashOverlay.style.opacity = '0.7';
        screenFlashActive = true;
        if (btnFlash) {
          btnFlash.style.display = 'flex';
          btnFlash.textContent = '💡';
          btnFlash.title = 'Flash de pantalla';
          btnFlash.classList.add('activo', 'encendido');
        }
      }

      iniciarEscaneoContinuo();
    } catch (err) { mostrarErrorCamara('Error al mostrar el video.'); setStatus('Error', 'error'); }
  }

  function detenerCamara() {
    if (timerResolucion) { clearTimeout(timerResolucion); timerResolucion = null; }
    if (stopScan) { stopScan(); stopScan = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null; flashEncendido = false; autoFlashActivo = false;
    if (btnFlash) btnFlash.classList.remove('encendido', 'activo'); 
    if (zoomControl) zoomControl.hidden = true;
    if (screenFlashActive) { screenFlashOverlay.style.opacity = '0'; screenFlashActive = false; }
  }

  function setScanFrameState(state) {
    if (!scanFrame) return;
    scanFrame.classList.remove('buscando', 'ok', 'error');
    scanFrame.classList.add(state);
  }

  function bloquearFoco() {
    if (!trackActual) return;
    const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
    // Si soporta foco manual, lo bloqueamos un segundo para que la segunda foto salga nítida
    if (caps.focusMode && caps.focusMode.includes('manual')) {
      trackActual.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {});
    }
  }

  function iniciarEscaneoContinuo() {
    if (stopScan) stopScan();
    if (escaneoEstado) escaneoEstado.textContent = '🔍 Buscando código…'; setScanFrameState('buscando');

    // Timer de Resolución Adaptativa: si en 4 segundos no lee, subimos a 1080p
    if (resolucionActual === '720p') {
      timerResolucion = setTimeout(() => {
        if (stream) {
          log('📷 Subiendo resolución a 1080p por falta de detección...');
          mostrarToast('Mejorando resolución...', 'success');
          iniciarCamara('1080p');
        }
      }, 4000);
    }

    stopScan = DNIScanner.escanearContinuo(
      video, canvas, 
      (texto) => exitoEscaneo(texto), 
      () => { if (escaneoEstado) escaneoEstado.textContent = '⏱ No se detectó.'; setScanFrameState('error'); setStatus('Sin detección'); }, 
      bloquearFoco, // Callback de Focus Lock
      { intervaloMs: 300, timeoutMs: 20000, anchoMax: resolucionActual === '1080p' ? 1920 : 1280, usarROI: true, framesConfirmacion: 2, onBrillo: (brillo) => evaluarAutoFlash(brillo) }
    );
  }

  async function exitoEscaneo(texto) {
    if (timerResolucion) { clearTimeout(timerResolucion); timerResolucion = null; }
    if (stopScan) { stopScan(); stopScan = null; }
    if (cameraHint) cameraHint.style.opacity = '0'; setScanFrameState('ok');
    
    // ... (El resto del código de exitoEscaneo se mantiene exactamente igual que en el paso anterior)
  }

  // ... (El resto del archivo main.js se mantiene exactamente igual: parsearSeguro, render, Supabase, domicilio-ocr, etc.)
