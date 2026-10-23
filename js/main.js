(() => {
  'use strict';

  // --- CONFIGURACIÓN DE SUPABASE ---
  const SUPABASE_URL = 'https://TU_SUPABASE_URL.supabase.co'; // <-- REEMPLAZAR
  const SUPABASE_KEY = 'TU_SUPABASE_ANON_KEY'; // <-- REEMPLAZAR
  let supabaseClient = null;
  if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  const DEBUG = false;
  const STORAGE_KEY = 'escaner_dni_historial';
  const MAX_HISTORIAL = 50;
  const PAIS_KEY = 'pais_escaner';
  const TEMA_KEY = 'tema_escaner';
  const SONIDO_KEY = 'sonido_escaner';
  const BRILLO_UMBRAL_BAJO = 80;
  const BRILLO_UMBRAL_ALTO = 140;
  let autoFlashActivo = false;

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

  // DORSO / OCR
  const btnDomicilio = document.getElementById('btn-domicilio');
  const modalDomicilio = document.getElementById('modal-domicilio');
  const btnCerrarModalDomicilio = document.getElementById('btn-cerrar-modal-domicilio');
  const btnCancelarDomicilio = document.getElementById('btn-cancelar-domicilio');
  const btnCapturarDomicilio = document.getElementById('btn-capturar-domicilio');
  const btnReintentarDomicilio = document.getElementById('btn-reintentar-domicilio');
  const btnGuardarDomicilio = document.getElementById('btn-guardar-domicilio');
  const domicilioVideo = document.getElementById('domicilio-video');
  const domicilioPreview = document.getElementById('domicilio-preview');
  const domicilioProgress = document.getElementById('domicilio-progress');
  const domicilioProgressFill = document.getElementById('domicilio-progress-fill');
  const domicilioProgressText = document.getElementById('domicilio-progress-text');
  const domicilioResultado = document.getElementById('domicilio-resultado');
  const domInputDomicilio = document.getElementById('dom-input-domicilio');
  const domInputNacimiento = document.getElementById('dom-input-nacimiento');
  const domInputCuil = document.getElementById('dom-input-cuil');
  const domInputVencimiento = document.getElementById('dom-input-vencimiento');
  const domInputNacionalidad = document.getElementById('dom-input-nacionalidad');
  const domicilioFlashBtn = document.getElementById('domicilio-flash-btn');

  let stream = null;
  let trackActual = null;
  let flashEncendido = false;
  let flashSoportado = false;
  let stopScan = null;
  let ultimoResultado = null;
  let ultimaFotoDataUrl = null;
  let paisSeleccionado = localStorage.getItem(PAIS_KEY) || 'arg';
  const sonidoActivo = localStorage.getItem(SONIDO_KEY) !== 'false';
  
  let currentZoom = 1;
  let maxZoom = 1;
  let touchStartDistance = 0;
  let initialZoomValue = 1;

  let domicilioStream = null;
  let domicilioTrack = null;
  let domicilioFlashSoportado = false;
  let domicilioFlashEncendido = false;
  
  // Variables para el Auto-Escaneo
  let autoScanActivo = false;
  let autoScanProcesando = false;

  const BANDERAS = { arg: '🇦🇷', chl: '🇨🇱', ury: '🇺🇾', pry: '🇵🇾', per: '🇵🇪', bol: '🇧🇴', col: '🇨🇴', ecu: '🇪🇨', ven: '🇻🇪', bra: '🇧🇷' };

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

  function mostrarErrorCamara(msg) {
    if (cameraError) cameraError.hidden = false;
    if (cameraErrorText) cameraErrorText.textContent = msg;
    if (scanFrame) scanFrame.classList.remove('activo');
    if (cameraHint) cameraHint.style.opacity = '0';
  }
  function ocultarErrorCamara() { if (cameraError) cameraError.hidden = true; }

  function setEstadoMarco(estado) {
    if (!scanFrame) return;
    scanFrame.classList.remove('buscando', 'detectando', 'ok', 'error');
    scanFrame.classList.add(estado);
  }

  function animarCaptura() {
    if (!scanFrame) return;
    scanFrame.classList.add('capturando');
    setTimeout(() => scanFrame.classList.remove('capturando'), 600);
  }

  function reproducirSonidoExito() {
    if (!sonidoActivo) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); const notas = [{ freq: 880, start: 0, dur: 0.08 }, { freq: 1318.5, start: 0.09, dur: 0.12 }];
      notas.forEach(nota => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = nota.freq; osc.connect(gain); gain.connect(ctx.destination);
        const t = ctx.currentTime + nota.start;
        gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.15, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, t + nota.dur);
        osc.start(t); osc.stop(t + nota.dur);
      });
      setTimeout(() => ctx.close(), 500);
    } catch (e) {}
  }

  function reproducirSonidoError() {
    if (!sonidoActivo) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 220; osc.connect(gain); gain.connect(ctx.destination);
      const t = ctx.currentTime; gain.gain.setValueAtTime(0.15, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.25); setTimeout(() => ctx.close(), 500);
    } catch (e) {}
  }

  function vibrarExito() { if (sonidoActivo && 'vibrate' in navigator) navigator.vibrate([60, 40, 100]); }
  function vibrarError() { if (sonidoActivo && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]); }

  function aplicarTema(tema) {
    if (tema === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', '#e9edf3');
    } else {
      document.documentElement.removeAttribute('data-theme');
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', '#0a1220');
    }
    localStorage.setItem(TEMA_KEY, tema);
  }

  function inicializarTema() {
    const guardado = localStorage.getItem(TEMA_KEY) || 'dark'; aplicarTema(guardado);
    if (btnTema) { btnTema.addEventListener('click', () => { const actual = document.documentElement.getAttribute('data-theme'); aplicarTema(actual === 'light' ? 'dark' : 'light'); }); }
  }

  function detectarPaisDelTexto(texto) {
    if (!texto) return null;
    if (typeof DNIParser !== 'undefined' && DNIParser.esDeEstePais(texto)) return 'arg';
    if (typeof ParsersMundo !== 'undefined' && ParsersMundo.detectarPais) { const d = ParsersMundo.detectarPais(texto); if (d) return d; }
    return null;
  }

  function nombrePaisDesdeCodigo(codigo) {
    const n = { arg: 'Argentina', chl: 'Chile', ury: 'Uruguay', pry: 'Paraguay', per: 'Perú', bol: 'Bolivia', col: 'Colombia', ecu: 'Ecuador', ven: 'Venezuela', bra: 'Brasil' };
    return n[codigo] || codigo;
  }

  function destacarChipPais(codigo) {
    const chips = document.querySelectorAll('.country-chip[data-country]');
    chips.forEach(chip => { if (chip.dataset.country === codigo && !chip.disabled) { chip.style.animation = 'chipPulse 0.8s ease-in-out 3'; setTimeout(() => { chip.style.animation = ''; }, 2500); } });
  }

  function mostrarErrorDocumento(titulo, mensajeHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'modal'; overlay.style.display = 'flex'; overlay.style.zIndex = '300';
    overlay.innerHTML = `<div class="modal-content" style="max-width: 440px;"><div class="modal-header"><h2 style="display:flex;align-items:center;gap:10px;"><span style="font-size:1.3rem;">⚠️</span><span>${titulo}</span></h2><button type="button" class="icon-btn-close" data-close>✕</button></div><div class="modal-body" style="padding: 20px 24px;"><p style="font-size: 0.95rem; line-height: 1.65; color: var(--text-secondary); margin: 0;">${mensajeHtml}</p></div><div class="modal-footer" style="justify-content: center;"><button type="button" class="btn btn-primary" data-close style="min-width: 140px;">Entendido</button></div></div>`;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', cerrar));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  }

  async function evaluarAutoFlash(brillo) {
    if (!trackActual || !flashSoportado) return;
    if (brillo < BRILLO_UMBRAL_BAJO && !flashEncendido && !autoFlashActivo) {
      try { await trackActual.applyConstraints({ advanced: [{ torch: true }] }); flashEncendido = true; autoFlashActivo = true; if (btnFlash) btnFlash.classList.add('encendido'); } catch (e) {}
    } else if (brillo > BRILLO_UMBRAL_ALTO && flashEncendido && autoFlashActivo) {
      try { await trackActual.applyConstraints({ advanced: [{ torch: false }] }); flashEncendido = false; autoFlashActivo = false; if (btnFlash) btnFlash.classList.remove('encendido'); } catch (e) {}
    }
  }

  function setupCameraControls() {
    if (!trackActual) return;
    const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
    if (caps.zoom) {
      maxZoom = caps.zoom.max || 1;
      if (maxZoom > 1 && zoomControl) {
        zoomControl.hidden = false; zoomSlider.min = caps.zoom.min || 1; zoomSlider.max = maxZoom; zoomSlider.step = 0.1; zoomSlider.value = caps.zoom.min || 1;
      }
    } else if (zoomControl) { zoomControl.hidden = true; }
  }

  async function aplicarZoom(valor) {
    if (!trackActual) return;
    try { await trackActual.applyConstraints({ advanced: [{ zoom: valor }] }); currentZoom = valor; if (zoomSlider) zoomSlider.value = valor; } catch (e) {}
  }

  if (zoomSlider) { zoomSlider.addEventListener('input', (e) => { aplicarZoom(parseFloat(e.target.value)); }); }

  const cameraViewport = document.getElementById('captura-dni');
  cameraViewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistance = Math.sqrt(dx * dx + dy * dy); initialZoomValue = currentZoom;
    }
  }, { passive: true });
  cameraViewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && maxZoom > 1) {
      const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (touchStartDistance > 0) {
        const scale = distance / touchStartDistance; let newZoom = initialZoomValue * scale;
        newZoom = Math.max(1, Math.min(newZoom, maxZoom)); aplicarZoom(newZoom);
      }
    }
  }, { passive: true });
  cameraViewport.addEventListener('touchend', (e) => { if (e.touches.length < 2) touchStartDistance = 0; });
  cameraViewport.addEventListener('click', async (e) => {
    if (!trackActual || e.target.closest('button')) return;
    const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
    if (!caps.focusMode || !caps.focusMode.includes('manual')) return;
    const rect = video.getBoundingClientRect(); const x = (e.clientX - rect.left) / rect.width; const y = (e.clientY - rect.top) / rect.height;
    if (focusReticle) { focusReticle.style.left = e.clientX + 'px'; focusReticle.style.top = e.clientY + 'px'; focusReticle.classList.remove('animating'); void focusReticle.offsetWidth; focusReticle.classList.add('animating'); }
    try {
      await trackActual.applyConstraints({ advanced: [{ focusMode: 'manual', pointsOfInterest: [{ x: x, y: y }] }] });
      setTimeout(async () => { try { await trackActual.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (err) {} }, 3000);
    } catch (error) {}
  });

  async function iniciarCamara() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { mostrarErrorCamara('Este navegador no permite acceder a la cámara.'); setStatus('Sin cámara', 'error'); return; }
    const configs = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 }, focusMode: 'continuous', exposureMode: 'continuous' }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
    let ultimoError = null;
    for (let i = 0; i < configs.length; i++) {
      try { setStatus('Iniciando cámara…'); stream = await navigator.mediaDevices.getUserMedia(configs[i]); break; }
      catch (err) { ultimoError = err; stream = null; }
    }
    if (!stream) {
      let msg = 'No se pudo acceder a la cámara.';
      if (ultimoError) { if (ultimoError.name === 'NotAllowedError') msg = 'Permiso denegado. Habilitá la cámara.'; else if (ultimoError.name === 'NotFoundError') msg = 'No hay cámara disponible.'; else if (ultimoError.name === 'NotReadableError') msg = 'La cámara está en uso.'; }
      mostrarErrorCamara(msg); setStatus('Error cámara', 'error'); return;
    }
    try {
      video.srcObject = stream; video.hidden = false; video.setAttribute('autoplay', ''); video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true;
      try { await video.play(); } catch (e) { setTimeout(async () => { try { await video.play(); } catch (e) {} }, 500); }
      await new Promise((resolve) => { if (video.videoWidth > 0) return resolve(); const check = setInterval(() => { if (video.videoWidth > 0) { clearInterval(check); resolve(); } }, 100); setTimeout(() => { clearInterval(check); resolve(); }, 3000); });
      ocultarErrorCamara(); if (img) img.hidden = true;
      if (scanFrame) { scanFrame.classList.add('activo'); setEstadoMarco('buscando'); }
      if (cameraHint) cameraHint.style.opacity = '1'; if (btnCamara) btnCamara.hidden = true; if (btnRepetir) btnRepetir.hidden = true;
      if (estado) estado.textContent = 'Apuntá al código del documento.'; setStatus('Cámara activa', 'active');
      trackActual = stream.getVideoTracks()[0]; const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
      flashSoportado = !!caps.torch; if (flashSoportado && btnFlash) btnFlash.classList.add('activo');
      optimizarTrack(trackActual, caps);
      setupCameraControls(); autoFlashActivo = false; iniciarEscaneoContinuo(); iniciarDeteccionDNINuevo(); iniciarMonitorCalidad();
    } catch (err) { mostrarErrorCamara('Error al mostrar el video.'); setStatus('Error', 'error'); }
  }

  function detenerCamara() {
    detenerDeteccionDNINuevo();
    if (typeof detenerMonitorCalidad === 'function') detenerMonitorCalidad();
    if (stopScan) { stopScan(); stopScan = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null; flashEncendido = false; autoFlashActivo = false; currentZoom = 1;
    if (btnFlash) btnFlash.classList.remove('encendido', 'activo'); if (zoomControl) zoomControl.hidden = true;
  }

  function iniciarEscaneoContinuo() {
    if (stopScan) stopScan(); if (escaneoEstado) escaneoEstado.textContent = '🔍 Buscando código…'; setEstadoMarco('buscando');
    stopScan = DNIScanner.escanearContinuo(video, canvas, (texto) => exitoEscaneo(texto), () => { if (escaneoEstado) escaneoEstado.textContent = '⏱ No se detectó. ¿Es un DNI nuevo? Usá “DNI nuevo: leer reverso”.'; setEstadoMarco('error'); setStatus('Sin detección'); }, { intervaloMs: 300, timeoutMs: 20000, anchoMax: 1280, usarROI: true, framesConfirmacion: 2, onBrillo: (brillo) => evaluarAutoFlash(brillo) });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function parsearSeguro(texto) {
    try {
      return paisSeleccionado === 'arg'
        ? DNIParser.parsear(texto)
        : ParsersMundo.parsear(paisSeleccionado, texto);
    } catch (e) {
      log(e);
      return null;
    }
  }

  function nitidez(c) {
    const w = 480;
    const h = Math.max(2, Math.round(c.height * w / c.width));
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const x = t.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let s = 0;
    for (let y = 0; y < h - 1; y++) {
      for (let i = 0; i < w - 1; i++) {
        const p = (y * w + i) * 4 + 1;
        const gx = d[p] - d[p + 4];
        const gy = d[p] - d[p + w * 4];
        s += gx * gx + gy * gy;
      }
    }
    return s;
  }

  async function capturarMasNitido(videoEl, n = 5, pausaMs = 150) {
    let mejor = null;
    let mejorScore = -1;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth;
      c.height = videoEl.videoHeight;
      c.getContext('2d').drawImage(videoEl, 0, 0, c.width, c.height);
      const s = nitidez(c);
      if (s > mejorScore) { mejorScore = s; mejor = c; }
      if (i < n - 1) await new Promise(r => setTimeout(r, pausaMs));
    }
    return mejor;
  }

  function aISO(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  async function exitoEscaneo(texto) {
    detenerDeteccionDNINuevo();
    if (stopScan) { stopScan(); stopScan = null; } if (cameraHint) cameraHint.style.opacity = '0'; setEstadoMarco('ok'); animarCaptura();
    if (flashEncendido && trackActual) { trackActual.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); flashEncendido = false; autoFlashActivo = false; if (btnFlash) btnFlash.classList.remove('encendido'); }
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8); 
    ultimaFotoDataUrl = dataUrl;
    
    if (img) { img.src = dataUrl; img.hidden = false; } video.hidden = true;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } trackActual = null; if (zoomControl) zoomControl.hidden = true;
    await new Promise(r => setTimeout(r, 250)); if (scanFrame) scanFrame.classList.remove('activo');
    const paisDelDocumento = detectarPaisDelTexto(texto); const paisElegidoNombre = nombrePaisDesdeCodigo(paisSeleccionado);
    
    if (paisDelDocumento && paisDelDocumento !== paisSeleccionado) {
      const nd = nombrePaisDesdeCodigo(paisDelDocumento); setEstadoMarco('error');
      mostrarErrorDocumento('Documento incorrecto', `Elegiste <strong>${paisElegidoNombre}</strong> pero este documento parece ser de <strong>${nd}</strong>.<br><br>Cambiá el país en el selector de arriba y volvé a escanear.`);
      if (estado) { estado.textContent = `⚠️ Este documento es de ${nd}`; estado.classList.add('error'); estado.classList.remove('ok'); }
      if (escaneoEstado) escaneoEstado.textContent = ''; setStatus('Documento incorrecto', 'error'); if (btnRepetir) btnRepetir.hidden = false;
      destacarChipPais(paisDelDocumento); reproducirSonidoError(); vibrarError(); return;
    }
    
    const datos = parsearSeguro(texto);
    
    if (!datos || (!datos.dni && !datos.numero && !datos.apellido && !datos.nombre)) {
      setEstadoMarco('error');
      if (paisDelDocumento) { const nd = nombrePaisDesdeCodigo(paisDelDocumento); mostrarErrorDocumento('Documento no reconocido', `No pudimos leer este documento como uno de ${paisElegidoNombre}. Parece ser de ${nd}.`); }
      else { mostrarErrorDocumento('Documento no reconocido', `No pudimos interpretar este código como un documento de ${paisElegidoNombre}.<br><br>Si es un <strong>DNI nuevo</strong> (con chip), tocá <strong>“DNI nuevo: leer reverso”</strong>.`); }
      if (estado) { estado.textContent = '⚠️ No se pudieron extraer datos'; estado.classList.add('error'); estado.classList.remove('ok'); }
      if (escaneoEstado) escaneoEstado.textContent = 'Texto: ' + texto.substring(0, 60); setStatus('Sin datos', 'error'); if (btnRepetir) btnRepetir.hidden = false; reproducirSonidoError(); vibrarError(); return;
    }
    render(datos); if (estado) { estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni || datos.numero || 'Documento'); estado.classList.remove('error'); estado.classList.add('ok'); }
    if (escaneoEstado) escaneoEstado.textContent = '✅ Escaneo OK'; setStatus('Escaneo OK', 'active'); if (btnRepetir) btnRepetir.hidden = false; reproducirSonidoExito(); vibrarExito();
  }

  function setTexto(id, valor) { const el = document.getElementById(id); if (!el) return; el.textContent = (valor === null || valor === undefined || valor === '') ? '—' : String(valor); el.classList.remove('ok', 'err'); }
  function setBool(id, valor, sSi, sNo) { const el = document.getElementById(id); if (!el) return; if (valor === true) { el.textContent = sSi; el.classList.add('ok'); el.classList.remove('err'); } else if (valor === false) { el.textContent = sNo; el.classList.add('err'); el.classList.remove('ok'); } else { el.textContent = '—'; el.classList.remove('ok', 'err'); } }
  
  function render(d) {
    ultimoResultado = d;
    const esChile = d.pais === 'CHL', esUruguay = d.pais === 'URY', esParaguay = d.pais === 'PRY', esBrasil = d.pais === 'BRA';
    if (labelNumero) { if (esChile) labelNumero.textContent = 'RUN'; else if (esUruguay || esParaguay) labelNumero.textContent = 'Número de CI'; else if (esBrasil) labelNumero.textContent = 'Número de pasaporte'; else labelNumero.textContent = 'Número de DNI'; }
    if (badgePais) { const cp = (d.pais || 'ARG').toLowerCase(); badgePais.textContent = BANDERAS[cp] || '📄'; }
    if (resultPais) resultPais.textContent = d.paisNombre ? `Datos extraídos · ${d.paisNombre}` : 'Datos extraídos del documento';
    if (badgeMetodo) badgeMetodo.textContent = (d.metodo || 'código').toUpperCase();
    setTexto('r-dni', d.dni || d.numero || null); setTexto('r-apellido', d.apellido); setTexto('r-nombre', d.nombre); setTexto('r-nombreCompleto', d.nombreCompleto); setTexto('r-sexo', d.sexo); setTexto('r-nacimiento', d.fechaNacimiento); setTexto('r-edad', d.edad != null ? d.edad + ' años' : null); setTexto('r-nacionalidad', d.nacionalidad); setTexto('r-lugarNacimiento', d.lugarNacimiento); setTexto('r-tipo', d.tipoDocumento); setTexto('r-ejemplar', d.ejemplar); setTexto('r-tramite', d.tramite); setTexto('r-cuil', d.cuil); setTexto('r-emision', d.fechaEmision); setTexto('r-vencimiento', d.fechaVencimiento); setBool('r-vigente', d.vigente, '✅ Vigente', '❌ Vencido'); setTexto('r-pais', d.pais || '—'); setTexto('r-domicilio', d.domicilio);
    const numValido = d.numeroValido != null ? d.numeroValido : (d.dni ? /^\d{7,8}$/.test(d.dni) : null);
    setBool('r-val-dni', numValido, '✅ Válido', '❌ Inválido'); setBool('r-val-cuil', d.cuil ? Validators.validarCUIL(d.cuil) : null, '✅ Válido', '❌ Inválido'); setTexto('r-val-mrz', d.metodo === 'mrz' ? 'Sin verificar' : '—'); setTexto('r-raw', d.raw);
    if (resultado) { resultado.hidden = false; setTimeout(() => resultado.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }
  }

  function datosComoTexto(d) { if (!d) return ''; return ['DATOS DEL DOCUMENTO', '================', `País: ${d.paisNombre || d.pais || '—'}`, `Tipo: ${d.tipoDocumento || '—'}`, `Número: ${d.dni || d.numero || '—'}`, `Nombre: ${d.nombreCompleto || '—'}`, `Sexo: ${d.sexo || '—'}`, `Nacimiento: ${d.fechaNacimiento || '—'}`, `Edad: ${d.edad != null ? d.edad + ' años' : '—'}`, `Nacionalidad: ${d.nacionalidad || '—'}`, `Lugar de nacimiento: ${d.lugarNacimiento || '—'}`, `Domicilio: ${d.domicilio || '—'}`, `Ejemplar: ${d.ejemplar || '—'}`, `Trámite: ${d.tramite || '—'}`, `CUIL: ${d.cuil || '—'}`, `Emisión: ${d.fechaEmision || '—'}`, `Vencimiento: ${d.fechaVencimiento || '—'}`, `Método: ${d.metodo || '—'}`].join('\n'); }
  async function copiarDatos() { if (!ultimoResultado) return; const texto = datosComoTexto(ultimoResultado); try { await navigator.clipboard.writeText(texto); mostrarToast('✓ Datos copiados', 'success'); } catch (e) { const ta = document.createElement('textarea'); ta.value = texto; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); mostrarToast('✓ Copiado', 'success'); } catch (err) { mostrarToast('No se pudo copiar', 'error'); } document.body.removeChild(ta); } }
  function descargarJSON() { if (!ultimoResultado) return; const json = JSON.stringify(ultimoResultado, null, 2); const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; const num = ultimoResultado.dni || ultimoResultado.numero || 'escaneo'; a.download = `doc-${num}-${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); mostrarToast('✓ JSON descargado', 'success'); }

  function leerHistorial() { try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
  function escribirHistorial(arr) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (e) {} }
  function actualizarContadorHistorial() { const arr = leerHistorial(); if (historialCount) historialCount.textContent = arr.length; if (btnHistorial) btnHistorial.style.display = arr.length > 0 ? 'flex' : 'none'; }
  
  async function guardarEnHistorial() {
    if (!ultimoResultado) return;

    const arr = leerHistorial();
    arr.unshift({ id: Date.now(), fecha: new Date().toISOString(), datos: ultimoResultado });
    if (arr.length > MAX_HISTORIAL) arr.length = MAX_HISTORIAL;
    escribirHistorial(arr);
    actualizarContadorHistorial();

    if (supabaseClient && ultimaFotoDataUrl) {
      mostrarToast('Guardando en la nube...', 'success');
      
      try {
        const nombreArchivo = `dni_${Date.now()}.jpg`;
        const respuestaFetch = await fetch(ultimaFotoDataUrl);
        const blob = await respuestaFetch.blob();

        const { data: uploadData, error: uploadError } = await supabaseClient
          .storage
          .from('fotos-dni')
          .upload(nombreArchivo, blob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabaseClient
          .storage
          .from('fotos-dni')
          .getPublicUrl(nombreArchivo);

        const { error: dbError } = await supabaseClient
          .from('escaneos')
          .insert([{
            dni: ultimoResultado.dni || ultimoResultado.numero || 'N/A',
            nombre_completo: ultimoResultado.nombreCompleto || 'N/A',
            pais: ultimoResultado.pais || 'ARG',
            datos: ultimoResultado,
            foto_url: urlData.publicUrl
          }]);

        if (dbError) throw dbError;

        mostrarToast('✓ Guardado en la base de datos', 'success');
      } catch (e) {
        console.error('Error Supabase:', e);
        mostrarToast('Guardado local, falló en la nube', 'error');
      }
    } else {
      mostrarToast('✓ Guardado en historial local', 'success');
    }
  }

  function renderHistorial() {
    if (!historialLista) return;
    const arr = leerHistorial();
    if (arr.length === 0) { historialLista.innerHTML = '<p class="empty-state">No hay escaneos guardados</p>'; return; }

    historialLista.innerHTML = arr.map(item => {
      const d = item.datos || {};
      const id = Number(item.id) || 0;
      const fecha = new Date(item.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const num = d.dni || d.numero || '—';
      return `<div class="historial-item" data-id="${id}"><div class="historial-info"><div class="historial-nombre">${esc(d.nombreCompleto || 'Sin nombre')}</div><div class="historial-meta">${esc(num)} · ${esc(d.paisNombre || '')} · ${esc(fecha)}</div></div><div class="historial-actions"><button class="historial-btn" data-action="ver" data-id="${id}">👁</button><button class="historial-btn delete" data-action="borrar" data-id="${id}">✕</button></div></div>`;
    }).join('');

    historialLista.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.action === 'ver') {
          const item = leerHistorial().find(x => x.id === id);
          if (item) { render(item.datos); cerrarHistorial(); }
        } else {
          escribirHistorial(leerHistorial().filter(x => x.id !== id));
          renderHistorial();
          actualizarContadorHistorial();
        }
      });
    });
  }

  function abrirHistorial() { renderHistorial(); if (modalHistorial) modalHistorial.hidden = false; }
  function cerrarHistorial() { if (modalHistorial) modalHistorial.hidden = true; }

  async function procesarImagen(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const src = e.target.result; const imageEl = new Image();
      imageEl.onload = async () => {
        if (img) { img.src = src; img.hidden = false; } if (video) video.hidden = true; if (scanFrame) scanFrame.classList.remove('activo'); if (cameraHint) cameraHint.style.opacity = '0';
        detenerCamara(); setStatus('Procesando imagen…'); if (escaneoEstado) escaneoEstado.textContent = '🔍 Analizando…';
        
        let texto = null;
        try { texto = await DNIScanner.escanearImagen(imageEl); } catch (e) { log(e); }
        if (!texto && paisSeleccionado === 'arg' && typeof QRDNINuevo !== 'undefined') {
          const cf = canvasDesdeImagen(imageEl);
          const rq = await QRDNINuevo.decodificar(cf, { modo: 'frame', anchos: [Math.min(cf.width, 3000), 2000] });
          if (rq) { await exitoDNINuevo(rq, cf); return; }
        }

        if (!texto) { if (estado) { estado.textContent = '⚠️ No se detectó código'; estado.classList.add('error'); } if (escaneoEstado) escaneoEstado.textContent = 'Probá con una imagen más nítida'; setStatus('Sin código', 'error'); if (btnRepetir) btnRepetir.hidden = false; reproducirSonidoError(); vibrarError(); return; }
        const paisDelDocumento = detectarPaisDelTexto(texto); const paisElegidoNombre = nombrePaisDesdeCodigo(paisSeleccionado);
        if (paisDelDocumento && paisDelDocumento !== paisSeleccionado) { const nd = nombrePaisDesdeCodigo(paisDelDocumento); mostrarErrorDocumento('Documento incorrecto', `Elegiste <strong>${paisElegidoNombre}</strong> pero este documento parece ser de <strong>${nd}</strong>.`); if (estado) { estado.textContent = `⚠️ Este documento es de ${nd}`; estado.classList.add('error'); } setStatus('Documento incorrecto', 'error'); if (btnRepetir) btnRepetir.hidden = false; destacarChipPais(paisDelDocumento); reproducirSonidoError(); vibrarError(); return; }
        
        const datos = parsearSeguro(texto);
        ultimaFotoDataUrl = src;
        
        if (datos && (datos.dni || datos.numero || datos.apellido || datos.nombre)) { render(datos); if (estado) { estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni || datos.numero); estado.classList.remove('error'); estado.classList.add('ok'); } if (escaneoEstado) escaneoEstado.textContent = '✅ Escaneo OK'; setStatus('Escaneo OK', 'active'); if (btnRepetir) btnRepetir.hidden = false; reproducirSonidoExito(); vibrarExito(); return; }
        mostrarErrorDocumento('Documento no reconocido', `No pudimos interpretar este código como un documento de ${paisElegidoNombre}.`); if (estado) { estado.textContent = '⚠️ No se pudieron extraer datos'; estado.classList.add('error'); } setStatus('Sin datos', 'error'); if (btnRepetir) btnRepetir.hidden = false; reproducirSonidoError(); vibrarError();
      }; 
      imageEl.onerror = () => { mostrarToast('No se pudo abrir la imagen', 'error'); setStatus('Error', 'error'); };
      imageEl.src = src;
    }; reader.readAsDataURL(file);
  }

  function inicializarSelectorPais() {
    const chips = document.querySelectorAll('.country-chip[data-country]'); if (!chips.length) return;
    chips.forEach(chip => { chip.classList.toggle('active', chip.dataset.country === paisSeleccionado); });
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.disabled) return; paisSeleccionado = chip.dataset.country; localStorage.setItem(PAIS_KEY, paisSeleccionado);
        chips.forEach(c => c.classList.toggle('active', c === chip)); const nombrePais = chip.querySelector('.chip-name')?.textContent || '';
        mostrarToast(`País: ${nombrePais}`, 'success'); if (resultado) resultado.hidden = true;
        if (!stream && !img.hidden && img.src) { img.hidden = true; img.src = ''; video.hidden = false; iniciarCamara(); }
      });
    });
  }

  async function activarLinternaReverso() { if (!domicilioTrack || !domicilioFlashSoportado) return; try { await domicilioTrack.applyConstraints({ advanced: [{ torch: true }] }); domicilioFlashEncendido = true; if (domicilioFlashBtn) domicilioFlashBtn.classList.add('encendido'); } catch (e) {} }
  async function apagarLinternaReverso() { if (!domicilioTrack || !domicilioFlashEncendido) return; try { await domicilioTrack.applyConstraints({ advanced: [{ torch: false }] }); domicilioFlashEncendido = false; if (domicilioFlashBtn) domicilioFlashBtn.classList.remove('encendido'); } catch (e) {} }
  async function toggleLinternaReverso() { if (!domicilioTrack || !domicilioFlashSoportado) return; if (domicilioFlashEncendido) await apagarLinternaReverso(); else await activarLinternaReverso(); }
  
  async function abrirModalDomicilio() {
    if (!ultimoResultado && !modoReversoNuevo) { mostrarToast('Primero escaneá el frente', 'error'); return; }
    
    // 🔥 PRECARGA TESSERACT
    if (typeof DomicilioOCR !== 'undefined' && DomicilioOCR.precargar) {
      DomicilioOCR.precargar().catch(console.warn);
    }

    if (modalDomicilio) modalDomicilio.hidden = false; if (domicilioPreview) domicilioPreview.hidden = true; if (domicilioResultado) domicilioResultado.hidden = true; if (domicilioProgress) domicilioProgress.hidden = true;
    if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false; if (btnReintentarDomicilio) btnReintentarDomicilio.hidden = true; if (btnGuardarDomicilio) btnGuardarDomicilio.hidden = true;
    [domInputDomicilio, domInputNacimiento, domInputCuil, domInputVencimiento, domInputNacionalidad].forEach(inp => { if (inp) inp.value = ''; });
    try {
      domicilioStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (domicilioVideo) { domicilioVideo.srcObject = domicilioStream; domicilioVideo.hidden = false; try { await domicilioVideo.play(); } catch (e) {} }
      
      domicilioTrack = domicilioStream.getVideoTracks()[0]; const caps = domicilioTrack.getCapabilities ? domicilioTrack.getCapabilities() : {};
      if ((caps.focusMode || []).includes('continuous')) {
        domicilioTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      
      domicilioFlashSoportado = !!caps.torch; if (domicilioFlashBtn) { if (domicilioFlashSoportado) { domicilioFlashBtn.style.display = 'flex'; } else { domicilioFlashBtn.style.display = 'none'; } }
      await new Promise((resolve) => { if (domicilioVideo.videoWidth > 0) return resolve(); const check = setInterval(() => { if (domicilioVideo.videoWidth > 0) { clearInterval(check); resolve(); } }, 100); setTimeout(() => { clearInterval(check); resolve(); }, 2000); });
      prepararMarcoDomicilio(); iniciarMonitorLuz();

      // INICIAR AUTO-ESCANEO
      iniciarAutoScanDomicilio();
    } catch (e) { mostrarToast('No se pudo acceder a la cámara', 'error'); if (modalDomicilio) modalDomicilio.hidden = true; }
  }
  
  async function cerrarModalDomicilio() {
    detenerMonitorLuz(); ocultarMarcoDomicilio();
    autoScanActivo = false;
    autoScanProcesando = false;
    await apagarLinternaReverso(); if (domicilioStream) { domicilioStream.getTracks().forEach(t => t.stop()); domicilioStream = null; } if (domicilioVideo) domicilioVideo.srcObject = null;
    if (modalDomicilio) modalDomicilio.hidden = true; domicilioTrack = null; domicilioFlashSoportado = false; domicilioFlashEncendido = false; if (domicilioFlashBtn) domicilioFlashBtn.classList.remove('encendido');
    if (modoReversoNuevo && !ultimoResultado && btnCamara) btnCamara.hidden = false;
    modoReversoNuevo = false;
  }

  function detenerCamaraModal() {
    detenerMonitorLuz(); ocultarMarcoDomicilio();
    if (domicilioStream) { domicilioStream.getTracks().forEach(t => t.stop()); domicilioStream = null; }
    domicilioTrack = null;
    apagarLinternaReverso();
  }

  async function reintentarDomicilio() { 
    if (domicilioPreview) domicilioPreview.hidden = true; 
    if (domicilioResultado) domicilioResultado.hidden = true; 
    if (domicilioProgress) domicilioProgress.hidden = true; 
    if (btnReintentarDomicilio) btnReintentarDomicilio.hidden = true; 
    if (btnGuardarDomicilio) btnGuardarDomicilio.hidden = true; 
    await abrirModalDomicilio(); 
  }
  
  // ===== PARCHES: reverso, cámara, DNI nuevo =====
  function mostrarDebugOCR(raw) {
    let pre = document.getElementById('dom-debug-pre');
    if (!pre && domicilioResultado) {
      const det = document.createElement('details');
      det.className = 'raw-data';
      det.innerHTML = '<summary>Ver texto leído por el OCR</summary><pre id="dom-debug-pre"></pre>';
      domicilioResultado.appendChild(det);
      pre = det.querySelector('pre');
    }
    if (pre) pre.textContent = raw || '';
  }

  async function esperarVideoDomicilio(ms = 3000) {
    const t0 = Date.now();
    while (domicilioVideo && !domicilioVideo.videoWidth && Date.now() - t0 < ms) {
      await new Promise(r => setTimeout(r, 100));
    }
    return !!(domicilioVideo && domicilioVideo.videoWidth);
  }

  const RATIO_DNI = 1.586;        // proporción de la tarjeta (85,6 x 54 mm)
  const UMBRAL_OSCURO = 85;       // luma media (0-255) por debajo de la cual se prende la linterna
  const UMBRAL_REFLEJO = 0.04;    // fracción de píxeles "quemados" a partir de la cual hay reflejo
  const HINT_OK = 'Encajá el reverso del DNI en el marco';
  let monitorLuz = null, ultimoCambioLinterna = 0, noEncenderHasta = 0, linternaManual = false;

  // ---------- Marco con forma de DNI ----------
  // Zona del video que realmente se ve (si el CSS usa object-fit: contain hay franjas vacías)
  function areaVisible(videoEl) {
    const vr = videoEl.getBoundingClientRect();
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const fit = getComputedStyle(videoEl).objectFit;
    if (vw && vh && (fit === 'contain' || fit === 'scale-down')) {
      const s = Math.min(vr.width / vw, vr.height / vh), w = vw * s, h = vh * s;
      return { left: vr.left + (vr.width - w) / 2, top: vr.top + (vr.height - h) / 2, width: w, height: h };
    }
    return { left: vr.left, top: vr.top, width: vr.width, height: vr.height };
  }

  function marcoClient() {
    const vr = areaVisible(domicilioVideo);
    let w = vr.width * 0.92, h = w / RATIO_DNI;
    if (h > vr.height * 0.92) { h = vr.height * 0.92; w = h * RATIO_DNI; }
    return { left: vr.left + (vr.width - w) / 2, top: vr.top + (vr.height - h) / 2, width: w, height: h };
  }

  // Pasa un rectángulo de pantalla a píxeles del video (respeta object-fit: cover / contain / fill)
  function rectEnVideo(videoEl, m, margen = 0) {
    const vr = videoEl.getBoundingClientRect();
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const fit = getComputedStyle(videoEl).objectFit;
    let sx, sy;
    if (fit === 'cover') sx = sy = Math.max(vr.width / vw, vr.height / vh);
    else if (fit === 'contain' || fit === 'scale-down') sx = sy = Math.min(vr.width / vw, vr.height / vh);
    else { sx = vr.width / vw; sy = vr.height / vh; }
    const offX = (vr.width - vw * sx) / 2, offY = (vr.height - vh * sy) / 2;
    let x = (m.left - vr.left - offX) / sx, y = (m.top - vr.top - offY) / sy;
    let w = m.width / sx, h = m.height / sy;
    const mx = w * margen, my = h * margen;
    x -= mx; y -= my; w += 2 * mx; h += 2 * my;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    return { x: x0, y: y0, w: Math.min(vw, x + w) - x0, h: Math.min(vh, y + h) - y0 };
  }

  function posicionarMarco() {
    const marco = document.getElementById('dni-marco');
    const wrap = document.getElementById('domicilio-camera-wrap');
    if (!marco || !wrap || !domicilioVideo || !domicilioVideo.videoWidth) return;
    const m = marcoClient(), wr = wrap.getBoundingClientRect();
    Object.assign(marco.style, {
      left: (m.left - wr.left) + 'px', top: (m.top - wr.top) + 'px',
      width: m.width + 'px', height: m.height + 'px'
    });
  }

  function prepararMarcoDomicilio() {
    const wrap = document.getElementById('domicilio-camera-wrap');
    if (!wrap) return;
    if (!document.getElementById('dni-marco-css')) {
      const st = document.createElement('style');
      st.id = 'dni-marco-css';
      st.textContent =
        '.dni-marco{position:absolute;z-index:2;display:none;border:2px solid rgba(255,255,255,.95);border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.45);pointer-events:none;transition:border-color .2s}' +
        '.dni-marco.alerta{border-color:#fbbf24}' +
        '.dni-marco-hint{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);white-space:nowrap;max-width:96%;overflow:hidden;text-overflow:ellipsis;background:rgba(0,0,0,.65);color:#fff;font-size:12px;padding:4px 10px;border-radius:12px}';
      document.head.appendChild(st);
    }
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.style.overflow = 'hidden';
    const guia = wrap.querySelector('.domicilio-guia');
    if (guia) guia.style.display = 'none';          // reemplaza la guía vieja de texto
    let marco = document.getElementById('dni-marco');
    if (!marco) {
      marco = document.createElement('div');
      marco.id = 'dni-marco';
      marco.className = 'dni-marco';
      marco.innerHTML = '<span class="dni-marco-hint" id="dni-marco-hint"></span>';
      wrap.appendChild(marco);
    }
    marco.style.display = 'block';
    document.getElementById('dni-marco-hint').textContent = HINT_OK;
    linternaManual = false; noEncenderHasta = 0; ultimoCambioLinterna = 0;
    posicionarMarco();
  }

  function ocultarMarcoDomicilio() {
    const marco = document.getElementById('dni-marco');
    if (marco) marco.style.display = 'none';
  }
  window.addEventListener('resize', posicionarMarco);

  // ---------- Linterna inteligente + aviso de reflejo ----------
  function decidirLuz(e) {
    let accion = null;
    if (e.soportada && !e.manual && e.ahora - e.ultimoCambio > 1500) {
      if (e.encendida && e.quemado > UMBRAL_REFLEJO) accion = 'apagar';          // el flash suele ser la causa del reflejo
      else if (!e.encendida && e.media < UMBRAL_OSCURO && e.ahora >= e.noEncenderHasta) accion = 'encender';
    }
    const hint = e.quemado > UMBRAL_REFLEJO ? 'Hay reflejo: inclinalo un poco'
      : (e.media < 60 ? 'Poca luz: acercate a una lámpara' : HINT_OK);
    return { accion, hint };
  }

  function medirLuz() {
    const r = rectEnVideo(domicilioVideo, marcoClient(), 0);
    if (r.w < 10 || r.h < 10) return null;
    const w = 96, h = Math.max(2, Math.round(w * r.h / r.w));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(domicilioVideo, r.x, r.y, r.w, r.h, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let suma = 0, quemados = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      suma += l; if (l >= 250) quemados++;
    }
    const n = d.length / 4;
    return { media: suma / n, quemado: quemados / n };
  }

  function detenerMonitorLuz() { if (monitorLuz) { clearInterval(monitorLuz); monitorLuz = null; } }

  function iniciarMonitorLuz() {
    detenerMonitorLuz();
    monitorLuz = setInterval(async () => {
      if (!domicilioVideo || !domicilioVideo.videoWidth) return;
      const luz = medirLuz();
      if (!luz) return;
      const ahora = Date.now();
      const { accion, hint } = decidirLuz({
        media: luz.media, quemado: luz.quemado, encendida: domicilioFlashEncendido,
        soportada: domicilioFlashSoportado, manual: linternaManual,
        ahora, ultimoCambio: ultimoCambioLinterna, noEncenderHasta
      });
      if (accion === 'encender') { await activarLinternaReverso(); ultimoCambioLinterna = ahora; }
      if (accion === 'apagar') { await apagarLinternaReverso(); ultimoCambioLinterna = ahora; noEncenderHasta = ahora + 6000; }
      const marco = document.getElementById('dni-marco'), txt = document.getElementById('dni-marco-hint');
      if (txt) txt.textContent = hint;
      if (marco) marco.classList.toggle('alerta', hint !== HINT_OK);
    }, 600);
  }

  // ---------- Alta resolución (mismo campo de visión que la vista previa) ----------
  async function subirResolucion() {
    if (!domicilioTrack || !domicilioTrack.applyConstraints) return;
    try {
      await domicilioTrack.applyConstraints({ width: { ideal: 3840 }, height: { ideal: 2160 } });
      await new Promise(r => setTimeout(r, 600));   // que se estabilice y vuelva a enfocar
      posicionarMarco();
    } catch (e) { /* el teléfono no lo permite: se sigue con la resolución actual */ }
  }

  // ---------- Captura recortada al marco (elige el cuadro más nítido) ----------
  async function capturarMasNitidoRecortado(n = 2, pausaMs = 100) {
    let mejor = null, mejorScore = -1;
    for (let i = 0; i < n; i++) {
      let r = rectEnVideo(domicilioVideo, marcoClient(), 0.03);
      if (r.w < 50 || r.h < 50) r = { x: 0, y: 0, w: domicilioVideo.videoWidth, h: domicilioVideo.videoHeight };
      const c = document.createElement('canvas');
      c.width = Math.round(r.w); c.height = Math.round(r.h);
      c.getContext('2d').drawImage(domicilioVideo, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      const s = nitidez(c);
      if (s > mejorScore) { mejorScore = s; mejor = c; }
      if (i < n - 1) await new Promise(r2 => setTimeout(r2, pausaMs));
    }
    return mejor;
  }
  let modoReversoNuevo = false;
  let ultimaIdentidad = null;

  function datosDesdeIdentidad(id) {
    const apellido = id.apellido || '', nombre = id.nombre || '';
    const hoy = new Date();
    let edad = null;
    if (id.fechaNacimiento) {
      const [y, m, d] = id.fechaNacimiento.split('-').map(Number);
      edad = hoy.getFullYear() - y - ((hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) ? 1 : 0);
    }
    return {
      pais: 'ARG', paisNombre: 'Argentina', metodo: id.fuente === 'qr' ? 'qr' : 'mrz', tipoDocumento: 'DNI (lectura del reverso)',
      tramite: id.tramite || null, ejemplar: id.ejemplar || null, fechaEmision: id.fechaEmision || null,
      dni: id.dni, numero: id.dni, numeroValido: /^\d{7,8}$/.test(id.dni || ''),
      apellido, nombre, nombreCompleto: `${apellido} ${nombre}`.trim(),
      sexo: id.sexo || null, fechaNacimiento: id.fechaNacimiento, edad,
      nacionalidad: id.nacionalidad || 'ARGENTINA', fechaVencimiento: id.fechaVencimiento || null,
      vigente: id.fechaVencimiento ? new Date(id.fechaVencimiento + 'T23:59:59') >= hoy : null,
      mrzVerificada: !!id.verificada, nombreTruncado: !!id.truncado, cruceQRMRZ: id.cruceMRZ == null ? null : id.cruceMRZ
    };
  }

  // Une lo del QR (apellido, nombres, DNI, nacimiento, trámite, ejemplar: más confiable que el OCR)
  // con lo de la MRZ (sexo y vencimiento), y cruza ambos como control.
  function combinarIdentidad(qr, ident) {
    if (!qr) return ident || null;
    const out = Object.assign({}, ident || {}, {
      dni: qr.dni, apellido: qr.apellido, nombre: qr.nombre, truncado: false,
      fechaNacimiento: qr.fechaNacimiento, tramite: qr.tramite, ejemplar: qr.ejemplar,
      fechaEmision: qr.fechaEmision, fuente: 'qr'
    });
    out.cruceMRZ = ident && ident.dni ? (ident.dni === qr.dni && ident.fechaNacimiento === qr.fechaNacimiento) : null;
    out.verificada = ident ? out.cruceMRZ === true : true;
    return out;
  }

  // Botón junto a "Activar cámara / Subir imagen" (se crea por JS, no hace falta tocar el HTML)
  function inyectarBotonDNINuevo() {
    const cont = document.querySelector('.camera-actions');
    if (!cont || document.getElementById('btn-dni-nuevo')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-dni-nuevo'; b.className = 'btn btn-secondary';
    b.innerHTML = '<span>DNI nuevo: leer reverso</span>';
    b.addEventListener('click', abrirReversoDNINuevo);
    cont.appendChild(b);
  }

  async function abrirReversoDNINuevo() {
    detenerCamara();                 // apaga la cámara del frente
    modoReversoNuevo = true;
    await abrirModalDomicilio();
  }

  // Hasta 3 intentos, suma lo que encuentra y corta cuando tiene todo lo necesario.
  async function iniciarAutoScanDomicilio() {
    const MAX_INTENTOS = 3;
    autoScanActivo = true;
    autoScanProcesando = true;
    if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = true;
    if (domicilioProgress) domicilioProgress.hidden = false;

    const campos = ['domicilio', 'lugarNacimiento', 'cuil', 'fechaVencimiento', 'nacionalidad'];
    const acum = {};
    let raw = '', mrzOk = null, mejorCanvas = null, ident = null, qr = null;
    const completo = () => modoReversoNuevo
      ? ((qr || (ident && ident.dni && ident.apellido)) && acum.domicilio && acum.cuil)
      : (acum.domicilio && acum.cuil && acum.fechaVencimiento);

    if (!(await esperarVideoDomicilio())) {
      autoScanActivo = autoScanProcesando = false;
      if (domicilioProgress) domicilioProgress.hidden = true;
      if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false;
      return;
    }
    if (typeof subirResolucion === 'function') await subirResolucion();
    const capturar = () => (typeof capturarMasNitidoRecortado === 'function')
      ? capturarMasNitidoRecortado(2, 100) : capturarMasNitido(domicilioVideo, 2, 100);

    for (let intento = 1; intento <= MAX_INTENTOS && autoScanActivo && !completo(); intento++) {
      if (domicilioProgressText) domicilioProgressText.textContent = `Leyendo el reverso… (${intento}/${MAX_INTENTOS})`;
      if (domicilioProgressFill) domicilioProgressFill.style.width = '0%';
      const c = await capturar();
      mejorCanvas = mejorCanvas || c;
      if (modoReversoNuevo && !qr && typeof QRDNINuevo !== 'undefined') {
        if (domicilioProgressText) domicilioProgressText.textContent = `Leyendo el QR… (${intento}/${MAX_INTENTOS})`;
        const rq = await QRDNINuevo.decodificar(c);
        if (rq) { qr = rq.datos; mejorCanvas = c; }
      }
      try {
        const contexto = { dni: (ultimoResultado && (ultimoResultado.dni || ultimoResultado.numero)) || (ident && ident.dni) || (qr && qr.dni) };
        const res = await DomicilioOCR.leer(c, paisSeleccionado, (p) => {
          if (domicilioProgressFill) domicilioProgressFill.style.width = (p * 100) + '%';
        }, contexto);
        if (!autoScanActivo) break;

        let nuevo = false;
        ['domicilio', 'lugarNacimiento', 'cuil'].forEach(k => { if (!acum[k] && res[k]) { acum[k] = res[k]; nuevo = true; } });
        if (res.fechaVencimiento && (res.mrzVerificada || !acum.fechaVencimiento)) {
          acum.fechaVencimiento = res.fechaVencimiento; acum.nacionalidad = res.nacionalidad;
          mrzOk = res.mrzVerificada === true; nuevo = true;
        }
        const mejor = DomicilioOCR.mejorIdentidad(ident, res.identidad);
        if (mejor !== ident) { ident = mejor; nuevo = true; }
        if (nuevo) mejorCanvas = c;
        raw += `\n===== intento ${intento} =====\n` + (res.raw || '');
      } catch (e) {
        console.warn('OCR reverso:', e);
      }
    }

    autoScanProcesando = false;
    if (!autoScanActivo) return;
    autoScanActivo = false;

    const hayIdentidad = modoReversoNuevo && (qr || (ident && (ident.dni || ident.apellido)));
    if (!hayIdentidad && !campos.some(k => acum[k])) {
      if (domicilioProgress) domicilioProgress.hidden = true;
      if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false;
      mostrarToast('No se pudo leer. Acomodá el DNI y tocá "Capturar y leer".', 'error');
      return;
    }

    ultimaIdentidad = hayIdentidad ? combinarIdentidad(qr, ident) : null;
    detenerCamaraModal();
    if (domicilioPreview && mejorCanvas) { domicilioPreview.src = mejorCanvas.toDataURL('image/jpeg', 0.7); domicilioPreview.hidden = false; }
    if (domicilioVideo) domicilioVideo.hidden = true;
    if (domInputDomicilio) domInputDomicilio.value = acum.domicilio || '';
    if (domInputNacimiento) domInputNacimiento.value = acum.lugarNacimiento || '';
    if (domInputCuil) domInputCuil.value = acum.cuil || '';
    if (domInputVencimiento) domInputVencimiento.value = acum.fechaVencimiento || (ident && ident.fechaVencimiento) || '';
    if (domInputNacionalidad) domInputNacionalidad.value = acum.nacionalidad || (ident && ident.nacionalidad) || '';
    if (domicilioProgress) domicilioProgress.hidden = true;
    if (domicilioResultado) domicilioResultado.hidden = false;
    if (btnGuardarDomicilio) btnGuardarDomicilio.hidden = false;
    if (btnReintentarDomicilio) btnReintentarDomicilio.hidden = false;
    mostrarDebugOCR(raw);

    const info = document.querySelector('.domicilio-info');
    const u = ultimaIdentidad;
    if (info && u) {
      const estadoId = u.fuente === 'qr'
        ? (u.cruceMRZ === true ? '✓ QR leído y coincide con la MRZ' : u.cruceMRZ === false ? '⚠ el QR no coincide con la MRZ: revisá' : '✓ QR leído')
        : (u.verificada ? '✓ MRZ verificada' : '⚠ revisá los datos');
      info.textContent = `${u.apellido || '?'} ${u.nombre || ''} · DNI ${u.dni || '?'} · ${estadoId}${u.truncado ? ' · nombre cortado por la MRZ' : ''}`;
    }

    if (modoReversoNuevo && !(u && u.dni && u.apellido)) mostrarToast('No se leyeron bien las líneas con < : probá de nuevo con más luz.', 'error');
    else if (!acum.domicilio) mostrarToast('No se leyó el domicilio: escribilo a mano o tocá Reintentar.', 'error');
    else if (acum.fechaVencimiento && mrzOk === false) mostrarToast('✓ Detectado · revisá el vencimiento', 'error');
    else mostrarToast('✓ Datos detectados', 'success');
  }

  // Si no hubo escaneo del frente (DNI nuevo), el resultado se arma desde la MRZ del reverso.
  function guardarDomicilioDesdeModal() {
    if (!ultimoResultado && ultimaIdentidad) ultimoResultado = datosDesdeIdentidad(ultimaIdentidad);
    if (!ultimoResultado) return;
    const val = (el) => ((el && el.value) || '').trim();

    const domicilio = val(domInputDomicilio);
    const nacimiento = val(domInputNacimiento);
    const cuil = val(domInputCuil);
    const vencISO = aISO(val(domInputVencimiento));
    const nacionalidad = val(domInputNacionalidad);

    const usaBarras = /\//.test(ultimoResultado.fechaNacimiento || '');
    const fmt = (iso) => (usaBarras ? iso.split('-').reverse().join('/') : iso);

    const origen = ultimoResultado.origenOCR = ultimoResultado.origenOCR || {};
    let actualizados = 0;
    const poner = (campo, valor, siempre) => {
      if (!valor || ultimoResultado[campo] === valor) return;
      if (siempre || !ultimoResultado[campo] || origen[campo]) {
        ultimoResultado[campo] = valor; origen[campo] = true; actualizados++;
      }
    };

    poner('domicilio', domicilio, true);
    poner('lugarNacimiento', nacimiento, true);
    poner('cuil', cuil);
    poner('nacionalidad', nacionalidad);
    if (vencISO) {
      poner('fechaVencimiento', fmt(vencISO));
      if (ultimoResultado.fechaVencimiento === fmt(vencISO)) {
        ultimoResultado.vigente = new Date(vencISO + 'T23:59:59') >= new Date();
      }
    }

    render(ultimoResultado);
    if (modoReversoNuevo) {
      if (estado) { estado.textContent = '✓ ' + (ultimoResultado.nombreCompleto || 'Documento'); estado.classList.remove('error'); estado.classList.add('ok'); }
      if (btnRepetir) btnRepetir.hidden = false;
    }
    mostrarToast(actualizados > 0 ? `✓ ${actualizados} campo(s) agregado(s)` : 'Datos cargados', 'success');
    cerrarModalDomicilio();
  }
  let detectorNuevoActivo = false;
  let procesandoDNINuevo = false;

  function capturarFrame(videoEl) {
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0, c.width, c.height);
    return c;
  }

  function recortarRect(c, r) {
    const o = document.createElement('canvas');
    o.width = Math.round(r.w); o.height = Math.round(r.h);
    o.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, o.width, o.height);
    return o;
  }

  function canvasDesdeImagen(im) {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
    c.getContext('2d').drawImage(im, 0, 0);
    return c;
  }

  function detenerDeteccionDNINuevo() { detectorNuevoActivo = false; }

  function iniciarDeteccionDNINuevo() {
    if (typeof QRDNINuevo === 'undefined' || paisSeleccionado !== 'arg') return;
    detectorNuevoActivo = true;
    procesandoDNINuevo = false;
    // El motor de OCR se carga en segundo plano mientras el usuario encuadra
    if (typeof DomicilioOCR !== 'undefined' && DomicilioOCR.precargar) DomicilioOCR.precargar().catch(() => {});

    const tick = async () => {
      if (!detectorNuevoActivo) return;
      if (stream && video && video.videoWidth && paisSeleccionado === 'arg' && !document.hidden) {
        try {
          const frame = capturarFrame(video);
          const r = await QRDNINuevo.decodificar(frame, { modo: 'frame' });
          if (r && detectorNuevoActivo) { detectorNuevoActivo = false; exitoDNINuevo(r, frame); return; }
        } catch (e) { log(e); }
      }
      if (detectorNuevoActivo) setTimeout(tick, 1300);
    };
    setTimeout(tick, 1200);
  }

  async function exitoDNINuevo(r, frame) {
    if (procesandoDNINuevo) return;
    procesandoDNINuevo = true;
    detectorNuevoActivo = false;
    if (stopScan) { stopScan(); stopScan = null; }
    if (cameraHint) cameraHint.style.opacity = '0';
    setEstadoMarco('ok'); animarCaptura();
    if (flashEncendido && trackActual) {
      trackActual.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      flashEncendido = false; autoFlashActivo = false; if (btnFlash) btnFlash.classList.remove('encendido');
    }
    const dataUrl = frame.toDataURL('image/jpeg', 0.8);
    ultimaFotoDataUrl = dataUrl;
    if (img) { img.src = dataUrl; img.hidden = false; } if (video) video.hidden = true;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null; if (zoomControl) zoomControl.hidden = true;
    if (scanFrame) scanFrame.classList.remove('activo');

    // 1) Resultado inmediato con lo que trae el QR
    render(datosDesdeIdentidad(combinarIdentidad(r.datos, null)));
    if (estado) { estado.textContent = '✓ DNI nuevo: ' + (ultimoResultado.nombreCompleto || ''); estado.classList.remove('error'); estado.classList.add('ok'); }
    setStatus('DNI nuevo detectado', 'active'); reproducirSonidoExito(); vibrarExito();
    if (btnRepetir) btnRepetir.hidden = false;

    // 2) Se completa leyendo el reverso de la MISMA foto (recortada a la tarjeta según dónde está el QR)
    if (escaneoEstado) escaneoEstado.textContent = '🔍 Leyendo domicilio, CUIL y vencimiento…';
    try {
      const rect = QRDNINuevo.rectTarjeta(r.ubicacion, frame.width, frame.height);
      const tarjeta = rect ? recortarRect(frame, rect) : frame;
      const res = await DomicilioOCR.leer(tarjeta, 'arg', (p) => {
        if (escaneoEstado) escaneoEstado.textContent = '🔍 Leyendo el reverso… ' + Math.round(p * 100) + '%';
      }, { dni: r.datos.dni });

      // La MRZ solo se usa si sus fechas pasan el control (si no, mejor dejar el campo vacío)
      const m = res.identidad;
      const mrzBuena = m && m.checks && m.checks.nacimiento && m.checks.vencimiento ? m : null;
      const id = combinarIdentidad(r.datos, mrzBuena);
      const datos = datosDesdeIdentidad(id);
      if (res.domicilio) datos.domicilio = res.domicilio;
      if (res.lugarNacimiento) datos.lugarNacimiento = res.lugarNacimiento;
      if (res.cuil) datos.cuil = res.cuil;
      render(datos);

      const faltan = [!datos.domicilio && 'domicilio', !datos.cuil && 'CUIL', !datos.fechaVencimiento && 'vencimiento'].filter(Boolean);
      if (escaneoEstado) escaneoEstado.textContent = faltan.length
        ? '⚠ No se leyó: ' + faltan.join(', ') + '. Podés completarlo con "Leer reverso".'
        : '✅ Escaneo completo';
      if (id.cruceMRZ === false) mostrarToast('El QR no coincide con la MRZ: revisá los datos', 'error');
    } catch (e) {
      console.warn('OCR del reverso:', e);
      if (escaneoEstado) escaneoEstado.textContent = '⚠ No se pudo leer el reverso. Usá "Leer reverso".';
    }
    procesandoDNINuevo = false;
  }

  // ===== Cámara profesional: ajustes del sensor, guía en vivo y lectura automática del frente =====
  let monitorCalidad = null, ocrFrenteEnCurso = false;
  let camInicioMs = 0, estableDesdeMs = 0, ultimoIntentoFrenteMs = 0, intentosFrenteAuto = 0, pausadaPorSegundoPlano = false;
  let cvMuestra = null, grisPrevio = null;
  const HINT_BASE = 'Encuadrá el código del documento dentro del marco';

  // Enfoque, exposición y balance de blancos continuos (solo lo que el teléfono soporta)
  function optimizarTrack(track, caps) {
    if (!track || !track.applyConstraints) return;
    const adv = {};
    if ((caps.focusMode || []).includes('continuous')) adv.focusMode = 'continuous';
    if ((caps.exposureMode || []).includes('continuous')) adv.exposureMode = 'continuous';
    if ((caps.whiteBalanceMode || []).includes('continuous')) adv.whiteBalanceMode = 'continuous';
    if (Object.keys(adv).length) track.applyConstraints({ advanced: [adv] }).catch(() => {});
  }

  // Muestrea el video en miniatura (barato): luz, reflejo y movimiento
  function muestrearVideo() {
    if (!video || !video.videoWidth) return null;
    const w = 64, h = 48;
    if (!cvMuestra) { cvMuestra = document.createElement('canvas'); cvMuestra.width = w; cvMuestra.height = h; }
    const x = cvMuestra.getContext('2d', { willReadFrequently: true });
    x.drawImage(video, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const gris = new Uint8Array(w * h);
    let suma = 0, quemados = 0, dif = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      gris[p] = l; suma += l; if (l >= 250) quemados++;
      if (grisPrevio) dif += Math.abs(l - grisPrevio[p]);
    }
    const n = w * h, mov = grisPrevio ? dif / n : 0;
    grisPrevio = gris;
    return { media: suma / n, quemado: quemados / n, mov };
  }

  function detenerMonitorCalidad() {
    if (monitorCalidad) { clearInterval(monitorCalidad); monitorCalidad = null; }
    grisPrevio = null; estableDesdeMs = 0;
  }

  function iniciarMonitorCalidad() {
    detenerMonitorCalidad();
    camInicioMs = Date.now(); estableDesdeMs = 0; intentosFrenteAuto = 0; ultimoIntentoFrenteMs = 0;
    monitorCalidad = setInterval(() => {
      if (!stream) { detenerMonitorCalidad(); return; }
      if (document.hidden || ocrFrenteEnCurso || procesandoDNINuevo) return;
      const m = muestrearVideo();
      if (!m) return;
      const ahora = Date.now();
      let hint = HINT_BASE, alerta = true;
      if (m.media < 55) hint = flashSoportado ? 'Poca luz: encendé la linterna 🔦' : 'Poca luz: acercate a una lámpara';
      else if (m.quemado > 0.06) hint = 'Hay reflejo: inclinalo un poco';
      else if (m.mov > 9) hint = 'Mantené quieto el celular';
      else { alerta = false; }
      if (cameraHint) {
        if (cameraHint.textContent !== hint) cameraHint.textContent = hint;
        cameraHint.classList.toggle('alerta', alerta);
      }
      // Imagen estable y con buena luz
      const estable = m.mov < 4 && m.media >= 55 && m.quemado <= 0.06;
      if (estable) { if (!estableDesdeMs) estableDesdeMs = ahora; } else estableDesdeMs = 0;

      // Sin código tras unos segundos con el DNI quieto: se prueba el frente del DNI nuevo por OCR
      if (paisSeleccionado === 'arg' && detectorNuevoActivo && estableDesdeMs && ahora - estableDesdeMs > 1800 &&
          ahora - camInicioMs > 7000 && ahora - ultimoIntentoFrenteMs > 12000 && intentosFrenteAuto < 3 &&
          typeof FrenteDNI !== 'undefined' && typeof DomicilioOCR !== 'undefined' && DomicilioOCR.leerTexto) {
        intentosFrenteAuto++; ultimoIntentoFrenteMs = ahora;
        leerFrenteOCR({ auto: true });
      }
    }, 500);
  }

  // Al salir de la app o cambiar de pestaña se libera la cámara (batería y rendimiento) y se retoma al volver
  document.addEventListener('visibilitychange', () => {
    const modalAbierto = modalDomicilio && !modalDomicilio.hidden;
    if (document.hidden) {
      if (stream && !modalAbierto && !ocrFrenteEnCurso) { pausadaPorSegundoPlano = true; detenerMonitorCalidad(); detenerCamara(); }
    } else if (pausadaPorSegundoPlano) {
      pausadaPorSegundoPlano = false;
      if (!stream && !modalAbierto && img && img.hidden) iniciarCamara();
    }
  });

  // ===== DNI nuevo: lectura del FRENTE por OCR =====
  async function leerFrenteOCR(opts) {
    const auto = !!(opts && opts.auto);
    if (ocrFrenteEnCurso) return;
    ocrFrenteEnCurso = true;
    try { await leerFrenteOCRInterno(auto); } finally { ocrFrenteEnCurso = false; }
  }

  async function leerFrenteOCRInterno(auto) {
    if (typeof FrenteDNI === 'undefined' || typeof DomicilioOCR === 'undefined') { mostrarToast('Falta cargar el lector del frente', 'error'); return; }
    if (!stream || !video || !video.videoWidth) { mostrarToast('Primero iniciá la cámara y apuntá al frente del DNI', 'error'); return; }
    detenerDeteccionDNINuevo();
    if (stopScan) { stopScan(); stopScan = null; }
    const btnF = document.getElementById('btn-dni-frente'); if (btnF) btnF.disabled = true;
    setEstadoMarco('detectando'); setStatus('Leyendo el frente…');
    if (escaneoEstado) escaneoEstado.textContent = auto ? '🔍 DNI detectado: leyendo el frente… mantené quieto' : '🔍 Leyendo el frente del DNI… mantené quieto';
    let datosF = null, canvasF = null;
    try {
      for (let intento = 1; intento <= 2 && !datosF; intento++) {
        canvasF = await capturarMasNitido(video, 3, 120);
        const textos = await DomicilioOCR.leerTexto(canvasF, (p) => {
          if (escaneoEstado) escaneoEstado.textContent = `🔍 Leyendo el frente… ${Math.round(p * 100)}% (${intento}/2)`;
        });
        datosF = FrenteDNI.parsearVarios(textos);
      }
    } catch (e) { console.warn('OCR frente:', e); }
    if (btnF) btnF.disabled = false;
    if (!datosF) {
      setEstadoMarco('buscando'); setStatus('Cámara activa', 'active');
      if (escaneoEstado) escaneoEstado.textContent = auto ? '🔍 Buscando código…' : '⚠ No se pudo leer el frente. Más luz, sin reflejos, todo el DNI dentro del marco.';
      if (!auto) mostrarToast('No se pudo leer el frente. Probá de nuevo.', 'error');
      iniciarEscaneoContinuo(); iniciarDeteccionDNINuevo();
      return;
    }
    setEstadoMarco('ok'); animarCaptura();
    ultimaFotoDataUrl = canvasF.toDataURL('image/jpeg', 0.8);
    if (img) { img.src = ultimaFotoDataUrl; img.hidden = false; } if (video) video.hidden = true;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } trackActual = null; if (zoomControl) zoomControl.hidden = true;
    if (scanFrame) scanFrame.classList.remove('activo');
    const id = Object.assign({ fuente: 'ocr', verificada: false }, datosF);
    if (id.sexo === 'M') id.sexo = 'Masculino'; else if (id.sexo === 'F') id.sexo = 'Femenino';
    const datos = datosDesdeIdentidad(id);
    datos.metodo = 'ocr frente'; datos.tipoDocumento = 'DNI nuevo (frente, por OCR)'; datos.mrzVerificada = false;
    render(datos);
    if (estado) { estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni || 'Documento') + ' · verificá los datos'; estado.classList.remove('error'); estado.classList.add('ok'); }
    const faltan = [!datos.dni && 'DNI', !datos.apellido && 'apellido', !datos.nombre && 'nombre', !datos.fechaNacimiento && 'nacimiento', !datos.sexo && 'sexo'].filter(Boolean);
    if (escaneoEstado) escaneoEstado.textContent = faltan.length ? '⚠ No se leyó: ' + faltan.join(', ') + '. Completalo con "leer reverso".' : '✅ Frente leído por OCR: verificá los datos';
    setStatus('Frente leído', 'active'); reproducirSonidoExito(); vibrarExito();
    if (btnRepetir) btnRepetir.hidden = false;
  }

  function inyectarBotonFrente() {
    const cont = document.querySelector('.camera-actions');
    if (!cont || document.getElementById('btn-dni-frente')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-dni-frente'; b.className = 'btn btn-secondary';
    b.innerHTML = '<span>DNI nuevo: leer frente</span>';
    b.addEventListener('click', leerFrenteOCR);
    cont.insertBefore(b, document.getElementById('btn-dni-nuevo') || null);
  }

  if (btnCamara) btnCamara.addEventListener('click', iniciarCamara);
  if (btnRetryCamara) btnRetryCamara.addEventListener('click', iniciarCamara);
  if (btnRepetir) { btnRepetir.addEventListener('click', async () => { if (resultado) resultado.hidden = true; if (img) { img.hidden = true; img.src = ''; } if (video) video.hidden = false; btnRepetir.hidden = true; if (estado) { estado.textContent = 'Apuntá al código del documento.'; estado.classList.remove('ok', 'error'); } if (escaneoEstado) escaneoEstado.textContent = ''; await iniciarCamara(); }); }
  if (btnFlash) { btnFlash.addEventListener('click', async () => { if (!trackActual || !flashSoportado) return; try { flashEncendido = !flashEncendido; await trackActual.applyConstraints({ advanced: [{ torch: flashEncendido }] }); btnFlash.classList.toggle('encendido', flashEncendido); autoFlashActivo = false; } catch (e) {} }); }
  if (btnUpload) btnUpload.addEventListener('click', () => fileInput.click());
  if (fileInput) { fileInput.addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; procesarImagen(file); fileInput.value = ''; }); }
  if (btnCopiar) btnCopiar.addEventListener('click', copiarDatos);
  if (btnDescargar) btnDescargar.addEventListener('click', descargarJSON);
  if (btnGuardarHistorial) btnGuardarHistorial.addEventListener('click', guardarEnHistorial);
  if (btnHistorial) btnHistorial.addEventListener('click', abrirHistorial);
  if (btnCerrarHistorial) btnCerrarHistorial.addEventListener('click', cerrarHistorial);
  if (btnLimpiarHistorial) { btnLimpiarHistorial.addEventListener('click', () => { if (confirm('¿Borrar todo el historial?')) { escribirHistorial([]); renderHistorial(); actualizarContadorHistorial(); } }); }
  if (modalHistorial) { modalHistorial.addEventListener('click', (e) => { if (e.target === modalHistorial) cerrarHistorial(); }); }
  if (btnDomicilio) btnDomicilio.addEventListener('click', abrirModalDomicilio);
  if (btnCerrarModalDomicilio) btnCerrarModalDomicilio.addEventListener('click', cerrarModalDomicilio);
  if (btnCancelarDomicilio) btnCancelarDomicilio.addEventListener('click', cerrarModalDomicilio);
  if (btnReintentarDomicilio) btnReintentarDomicilio.addEventListener('click', reintentarDomicilio);
  if (btnGuardarDomicilio) btnGuardarDomicilio.addEventListener('click', guardarDomicilioDesdeModal);
  if (domicilioFlashBtn) domicilioFlashBtn.addEventListener('click', () => { linternaManual = true; toggleLinternaReverso(); });
  if (btnCapturarDomicilio) btnCapturarDomicilio.addEventListener('click', iniciarAutoScanDomicilio);
  if (modalDomicilio) { modalDomicilio.addEventListener('click', (e) => { if (e.target === modalDomicilio) cerrarModalDomicilio(); }); }

  window.addEventListener('beforeunload', () => { if (stream) stream.getTracks().forEach(t => t.stop()); if (domicilioStream) domicilioStream.getTracks().forEach(t => t.stop()); if (stopScan) stopScan(); });
  if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); }); }

  inicializarTema();
  inyectarBotonDNINuevo();
  inyectarBotonFrente();
  actualizarContadorHistorial();
  inicializarSelectorPais();

  setTimeout(iniciarCamara, 300);
})();