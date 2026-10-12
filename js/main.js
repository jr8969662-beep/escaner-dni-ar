(() => {
  'use strict';

  // ==========================================
  // DEBUG
  // ==========================================
  const DEBUG = true; // ← después lo ponés en false

  function log(msg, color = '#4ade80') {
    if (!DEBUG) return;
    console.log(msg);
    const debugLog = document.getElementById('video-debug');
    if (!debugLog) return;
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = msg;
    debugLog.appendChild(line);
    debugLog.scrollTop = debugLog.scrollHeight;
  }

  function crearPanelDebugVideo() {
    if (!DEBUG) return;
    const vp = document.querySelector('.camera-viewport');
    if (!vp || document.getElementById('video-debug-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'video-debug-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 8px; left: 8px; right: 8px;
      max-height: 45%;
      overflow-y: auto;
      background: rgba(0,0,0,0.85);
      color: #4ade80;
      font-family: monospace;
      font-size: 10px;
      padding: 6px 8px;
      border-radius: 8px;
      z-index: 9999;
      line-height: 1.35;
      border: 1px solid #4ade80;
    `;
    overlay.innerHTML = '<div style="color:#fff;font-weight:bold;margin-bottom:3px;">📹 Diagnóstico de cámara</div><div id="video-debug"></div>';
    vp.appendChild(overlay);
  }

  // ==========================================
  // DOM
  // ==========================================
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
  const fileInput = document.getElementById('file-input');
  const resultado = document.getElementById('resultado');
  const badgeMetodo = document.getElementById('badge-metodo');
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

  let stream = null;
  let trackActual = null;
  let flashEncendido = false;
  let flashSoportado = false;
  let stopScan = null;
  let ultimoResultado = null;
  let debugInterval = null;

  // ==========================================
  // HELPERS
  // ==========================================
  function setStatus(texto, tipo = 'idle') {
    if (statusText) statusText.textContent = texto;
    if (statusPill) {
      statusPill.classList.remove('active', 'error');
      if (tipo === 'active') statusPill.classList.add('active');
      if (tipo === 'error') statusPill.classList.add('error');
    }
  }

  function mostrarToast(msg, tipo = 'success') {
    if (!toast) return;
    toast.className = 'toast ' + tipo;
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 2500);
  }

  function mostrarErrorCamara(msg) {
    if (cameraError) cameraError.hidden = false;
    if (cameraErrorText) cameraErrorText.textContent = msg;
    if (scanFrame) scanFrame.classList.remove('activo');
    if (cameraHint) cameraHint.style.opacity = '0';
  }

  function ocultarErrorCamara() {
    if (cameraError) cameraError.hidden = true;
  }

  // ==========================================
  // DEBUG EN VIVO
  // ==========================================
  function iniciarDebugVideo() {
    if (!DEBUG) return;
    if (debugInterval) clearInterval(debugInterval);
    debugInterval = setInterval(() => {
      if (!video) return;
      const info = [
        `videoWidth: ${video.videoWidth}`,
        `videoHeight: ${video.videoHeight}`,
        `readyState: ${video.readyState}/4`,
        `paused: ${video.paused}`,
        `hidden: ${video.hidden}`,
        `display: ${getComputedStyle(video).display}`,
        `stream: ${stream ? 'activo' : 'null'}`,
        `tracks: ${stream ? stream.getVideoTracks().length : 0}`
      ];
      const debugLog = document.getElementById('video-debug');
      if (debugLog) {
        debugLog.innerHTML = info.map(line => {
          const color = line.includes('null') || line.includes('0') || line.includes('true') || line.includes(': 0') ? '#ef4444' : '#4ade80';
          return `<div style="color:${color}">${line}</div>`;
        }).join('');
      }
    }, 500);
  }

  // ==========================================
  // CÁMARA - VERSIÓN ROBUSTA
  // ==========================================
  async function iniciarCamara() {
    if (stream) {
      log('ℹ️ Ya hay stream activo');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarErrorCamara('Este navegador no permite acceder a la cámara.');
      setStatus('Sin cámara', 'error');
      return;
    }

    // Intentar varias configuraciones, de más específica a más genérica
    const configuraciones = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      { video: true, audio: false }
    ];

    let ultimoError = null;

    for (let i = 0; i < configuraciones.length; i++) {
      try {
        log(`🎥 Intento ${i + 1}/${configuraciones.length}…`, '#f59e0b');
        setStatus('Iniciando cámara…');

        stream = await navigator.mediaDevices.getUserMedia(configuraciones[i]);
        log(`✅ Stream OK con config ${i + 1}`, '#4ade80');
        break;
      } catch (err) {
        ultimoError = err;
        log(`❌ Config ${i + 1} falló: ${err.name}`, '#f59e0b');
        stream = null;
      }
    }

    if (!stream) {
      let msg = 'No se pudo acceder a la cámara.';
      if (ultimoError) {
        if (ultimoError.name === 'NotAllowedError') msg = 'Permiso denegado. Habilitá la cámara.';
        else if (ultimoError.name === 'NotFoundError') msg = 'No hay cámara disponible.';
        else if (ultimoError.name === 'NotReadableError') msg = 'La cámara está en uso.';
      }
      mostrarErrorCamara(msg);
      setStatus('Error cámara', 'error');
      log('❌ Ninguna configuración funcionó', '#ef4444');
      return;
    }

    // ====== ASIGNAR AL VIDEO ======
    try {
      video.srcObject = stream;
      video.hidden = false;
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.muted = true;

      // Forzar play explícito (algunos navegadores no respetan autoplay)
      try {
        await video.play();
        log('▶️ video.play() OK', '#4ade80');
      } catch (playErr) {
        log('⚠️ video.play() falló: ' + playErr.message, '#f59e0b');
        // Reintentar después de un delay
        setTimeout(async () => {
          try { await video.play(); log('▶️ play() retry OK', '#4ade80'); } catch (e) {}
        }, 500);
      }

      // Esperar a que el video tenga dimensiones
      await new Promise((resolve) => {
        if (video.videoWidth > 0) return resolve();
        const check = setInterval(() => {
          if (video.videoWidth > 0) {
            clearInterval(check);
            log(`📐 Video listo: ${video.videoWidth}x${video.videoHeight}`, '#4ade80');
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 3000);
      });

      ocultarErrorCamara();
      if (img) img.hidden = true;
      if (scanFrame) scanFrame.classList.add('activo');
      if (cameraHint) cameraHint.style.opacity = '1';
      if (btnCamara) btnCamara.hidden = true;
      if (btnRepetir) btnRepetir.hidden = true;
      if (estado) estado.textContent = 'Apuntá al código del DNI.';
      setStatus('Cámara activa', 'active');

      trackActual = stream.getVideoTracks()[0];
      const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
      flashSoportado = !!caps.torch;
      if (flashSoportado && btnFlash) btnFlash.classList.add('activo');

      iniciarDebugVideo();
      iniciarEscaneoContinuo();
    } catch (err) {
      log('❌ Error al asignar video: ' + err.message, '#ef4444');
      mostrarErrorCamara('Error al mostrar el video.');
      setStatus('Error', 'error');
    }
  }

  function detenerCamara() {
    if (debugInterval) { clearInterval(debugInterval); debugInterval = null; }
    if (stopScan) { stopScan(); stopScan = null; }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    trackActual = null;
    flashEncendido = false;
    if (btnFlash) btnFlash.classList.remove('encendido', 'activo');
  }

  function iniciarEscaneoContinuo() {
    if (stopScan) stopScan();
    if (escaneoEstado) escaneoEstado.textContent = '🔍 Buscando código…';

    stopScan = DNIScanner.escanearContinuo(
      video,
      canvas,
      (texto) => exitoEscaneo(texto),
      () => {
        if (escaneoEstado) escaneoEstado.textContent = '⏱ No se detectó. Acercate más.';
        setStatus('Sin detección');
      },
      { intervaloMs: 400, timeoutMs: 20000, anchoMax: 1280 }
    );
  }

  async function exitoEscaneo(texto) {
    if (stopScan) { stopScan(); stopScan = null; }
    if (scanFrame) scanFrame.classList.remove('activo');
    if (cameraHint) cameraHint.style.opacity = '0';
    if (flashEncendido && trackActual) {
      trackActual.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      flashEncendido = false;
      if (btnFlash) btnFlash.classList.remove('encendido');
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (img) { img.src = dataUrl; img.hidden = false; }
    video.hidden = true;

    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null;
    if (debugInterval) { clearInterval(debugInterval); debugInterval = null; }

    const datos = DNIParser.parsear(texto);
    log('🧩 Datos: ' + JSON.stringify(datos).substring(0, 100), '#4ade80');

    if (!datos || (!datos.dni && !datos.apellido && !datos.nombre)) {
      if (estado) { estado.textContent = '⚠️ No se extrajeron datos'; estado.classList.add('error'); }
      if (escaneoEstado) escaneoEstado.textContent = 'Texto: ' + texto.substring(0, 60);
      setStatus('Sin datos', 'error');
      if (btnRepetir) btnRepetir.hidden = false;
      return;
    }

    render(datos);
    if (estado) {
      estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni);
      estado.classList.remove('error');
      estado.classList.add('ok');
    }
    if (escaneoEstado) escaneoEstado.textContent = '✅ Escaneo OK';
    setStatus('Escaneo OK', 'active');
    if (btnRepetir) btnRepetir.hidden = false;
  }

  // ==========================================
  // RENDER
  // ==========================================
  function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (valor === null || valor === undefined || valor === '') ? '—' : String(valor);
    el.classList.remove('ok', 'err');
  }

  function setBool(id, valor, textoSi, textoNo) {
    const el = document.getElementById(id);
    if (!el) return;
    if (valor === true) { el.textContent = textoSi; el.classList.add('ok'); el.classList.remove('err'); }
    else if (valor === false) { el.textContent = textoNo; el.classList.add('err'); el.classList.remove('ok'); }
    else { el.textContent = '—'; el.classList.remove('ok', 'err'); }
  }

  function render(d) {
    ultimoResultado = d;
    if (badgeMetodo) badgeMetodo.textContent = (d.metodo || 'código').toUpperCase();

    setTexto('r-dni', d.dni);
    setTexto('r-apellido', d.apellido);
    setTexto('r-nombre', d.nombre);
    setTexto('r-nombreCompleto', d.nombreCompleto);
    setTexto('r-sexo', d.sexo);
    setTexto('r-nacimiento', d.fechaNacimiento);
    setTexto('r-edad', d.edad != null ? d.edad + ' años' : null);
    setTexto('r-nacionalidad', d.nacionalidad);
    setTexto('r-lugarNacimiento', d.lugarNacimiento);
    setTexto('r-tipo', d.tipoDocumento);
    setTexto('r-ejemplar', d.ejemplar);
    setTexto('r-tramite', d.tramite);
    setTexto('r-cuil', d.cuil);
    setTexto('r-emision', d.fechaEmision);
    setTexto('r-vencimiento', d.fechaVencimiento);
    setBool('r-vigente', d.vigente, '✅ Vigente', '❌ Vencido');
    setTexto('r-pais', d.pais);
    setTexto('r-domicilio', d.domicilio);
    setBool('r-val-dni', d.dni ? /^\d{7,8}$/.test(d.dni) : null, '✅ Válido', '❌ Inválido');
    setBool('r-val-cuil', d.cuil ? Validators.validarCUIL(d.cuil) : null, '✅ Válido', '❌ Inválido');
    setTexto('r-val-mrz', d.metodo === 'mrz' ? 'Sin verificar' : '—');
    setTexto('r-raw', d.raw);

    if (resultado) {
      resultado.hidden = false;
      setTimeout(() => resultado.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }

  // ==========================================
  // COPIAR / DESCARGAR
  // ==========================================
  function datosComoTexto(d) {
    if (!d) return '';
    return [
      'DATOS DEL DNI', '================',
      `DNI: ${d.dni || '—'}`,
      `Nombre: ${d.nombreCompleto || '—'}`,
      `Sexo: ${d.sexo || '—'}`,
      `Fecha nacimiento: ${d.fechaNacimiento || '—'}`,
      `Edad: ${d.edad != null ? d.edad + ' años' : '—'}`,
      `Nacionalidad: ${d.nacionalidad || '—'}`,
      `Tipo: ${d.tipoDocumento || '—'}`,
      `Ejemplar: ${d.ejemplar || '—'}`,
      `Nro trámite: ${d.tramite || '—'}`,
      `CUIL: ${d.cuil || '—'}`,
      `Emisión: ${d.fechaEmision || '—'}`,
      `Vencimiento: ${d.fechaVencimiento || '—'}`,
      `País: ${d.pais || '—'}`,
      `Método: ${d.metodo || '—'}`
    ].join('\n');
  }

  async function copiarDatos() {
    if (!ultimoResultado) return;
    const texto = datosComoTexto(ultimoResultado);
    try {
      await navigator.clipboard.writeText(texto);
      mostrarToast('✓ Datos copiados', 'success');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); mostrarToast('✓ Copiado', 'success'); }
      catch (err) { mostrarToast('No se pudo copiar', 'error'); }
      document.body.removeChild(ta);
    }
  }

  function descargarJSON() {
    if (!ultimoResultado) return;
    const json = JSON.stringify(ultimoResultado, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dni-${ultimoResultado.dni || 'escaneo'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarToast('✓ JSON descargado', 'success');
  }

  // ==========================================
  // HISTORIAL
  // ==========================================
  const STORAGE_KEY = 'escaner_dni_historial';
  const MAX_HISTORIAL = 50;

  function leerHistorial() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function escribirHistorial(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function actualizarContadorHistorial() {
    const arr = leerHistorial();
    if (historialCount) historialCount.textContent = arr.length;
    if (btnHistorial) btnHistorial.style.display = arr.length > 0 ? 'flex' : 'none';
  }

  function guardarEnHistorial() {
    if (!ultimoResultado) return;
    const arr = leerHistorial();
    arr.unshift({ id: Date.now(), fecha: new Date().toISOString(), datos: ultimoResultado });
    if (arr.length > MAX_HISTORIAL) arr.length = MAX_HISTORIAL;
    escribirHistorial(arr);
    actualizarContadorHistorial();
    mostrarToast('✓ Guardado en historial', 'success');
  }

  function renderHistorial() {
    if (!historialLista) return;
    const arr = leerHistorial();
    if (arr.length === 0) {
      historialLista.innerHTML = '<p class="empty-state">No hay escaneos guardados</p>';
      return;
    }
    historialLista.innerHTML = arr.map(item => {
      const d = item.datos;
      const fecha = new Date(item.fecha).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="historial-item" data-id="${item.id}">
          <div class="historial-info">
            <div class="historial-nombre">${d.nombreCompleto || 'Sin nombre'}</div>
            <div class="historial-meta">DNI ${d.dni || '—'} · ${fecha}</div>
          </div>
          <div class="historial-actions">
            <button class="historial-btn" data-action="ver" data-id="${item.id}">👁</button>
            <button class="historial-btn delete" data-action="borrar" data-id="${item.id}">✕</button>
          </div>
        </div>
      `;
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

  // ==========================================
  // SUBIR IMAGEN
  // ==========================================
  async function procesarImagen(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const src = e.target.result;
      const imageEl = new Image();
      imageEl.onload = async () => {
        if (img) { img.src = src; img.hidden = false; }
        if (video) video.hidden = true;
        if (scanFrame) scanFrame.classList.remove('activo');
        if (cameraHint) cameraHint.style.opacity = '0';
        detenerCamara();
        setStatus('Procesando imagen…');
        if (escaneoEstado) escaneoEstado.textContent = '🔍 Analizando…';

        const texto = await DNIScanner.escanearImagen(imageEl);

        if (texto) {
          const datos = DNIParser.parsear(texto);
          if (datos && (datos.dni || datos.apellido || datos.nombre)) {
            render(datos);
            if (estado) {
              estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni);
              estado.classList.remove('error');
              estado.classList.add('ok');
            }
            if (escaneoEstado) escaneoEstado.textContent = '✅ Escaneo OK';
            setStatus('Escaneo OK', 'active');
            if (btnRepetir) btnRepetir.hidden = false;
            return;
          }
        }
        if (estado) { estado.textContent = '⚠️ No se detectó código'; estado.classList.add('error'); }
        if (escaneoEstado) escaneoEstado.textContent = 'Probá con una imagen más nítida';
        setStatus('Sin código', 'error');
        if (btnRepetir) btnRepetir.hidden = false;
      };
      imageEl.src = src;
    };
    reader.readAsDataURL(file);
  }

  // ==========================================
  // EVENTOS
  // ==========================================
  if (btnCamara) btnCamara.addEventListener('click', iniciarCamara);
  if (btnRetryCamara) btnRetryCamara.addEventListener('click', iniciarCamara);

  if (btnRepetir) {
    btnRepetir.addEventListener('click', async () => {
      if (resultado) resultado.hidden = true;
      if (img) { img.hidden = true; img.src = ''; }
      if (video) video.hidden = false;
      btnRepetir.hidden = true;
      if (estado) { estado.textContent = 'Apuntá al código del DNI.'; estado.classList.remove('ok', 'error'); }
      if (escaneoEstado) escaneoEstado.textContent = '';
      await iniciarCamara();
    });
  }

  if (btnFlash) {
    btnFlash.addEventListener('click', async () => {
      if (!trackActual || !flashSoportado) return;
      try {
        flashEncendido = !flashEncendido;
        await trackActual.applyConstraints({ advanced: [{ torch: flashEncendido }] });
        btnFlash.classList.toggle('encendido', flashEncendido);
      } catch (e) {}
    });
  }

  if (btnUpload) btnUpload.addEventListener('click', () => fileInput.click());
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      procesarImagen(file);
      fileInput.value = '';
    });
  }

  if (btnCopiar) btnCopiar.addEventListener('click', copiarDatos);
  if (btnDescargar) btnDescargar.addEventListener('click', descargarJSON);
  if (btnGuardarHistorial) btnGuardarHistorial.addEventListener('click', guardarEnHistorial);
  if (btnHistorial) btnHistorial.addEventListener('click', abrirHistorial);
  if (btnCerrarHistorial) btnCerrarHistorial.addEventListener('click', cerrarHistorial);
  if (btnLimpiarHistorial) {
    btnLimpiarHistorial.addEventListener('click', () => {
      if (confirm('¿Borrar todo el historial?')) {
        escribirHistorial([]);
        renderHistorial();
        actualizarContadorHistorial();
      }
    });
  }
  if (modalHistorial) {
    modalHistorial.addEventListener('click', (e) => {
      if (e.target === modalHistorial) cerrarHistorial();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (stopScan) stopScan();
    if (debugInterval) clearInterval(debugInterval);
  });

  // ==========================================
  // SERVICE WORKER
  // ==========================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ==========================================
  // INIT
  // ==========================================
  crearPanelDebugVideo();
  actualizarContadorHistorial();
  log('=== Iniciando ===', '#fff');
  log('DNIScanner: ' + typeof DNIScanner, typeof DNIScanner === 'object' ? '#4ade80' : '#ef4444');

  setTimeout(iniciarCamara, 300);
})();
