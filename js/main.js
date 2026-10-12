(() => {
  'use strict';

  // ==========================================
  // PANEL DE DEBUG EN PANTALLA
  // ==========================================
  function crearPanelDebug() {
    if (document.getElementById('debug-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-height: 40vh;
      overflow-y: auto;
      background: rgba(0,0,0,0.92);
      color: #4ade80;
      font-family: monospace;
      font-size: 11px;
      padding: 8px 12px;
      z-index: 99999;
      border-top: 2px solid #4ade80;
      line-height: 1.4;
    `;
    panel.innerHTML = '<div style="color:#fff;font-weight:bold;margin-bottom:4px;">🔍 DEBUG (tocá para cerrar)</div><div id="debug-log"></div>';
    panel.addEventListener('click', () => panel.remove());
    document.body.appendChild(panel);
  }

  function log(msg, color = '#4ade80') {
    const debugLog = document.getElementById('debug-log');
    if (!debugLog) return;
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = msg;
    debugLog.appendChild(line);
  }

  crearPanelDebug();
  log('=== main.js iniciando ===', '#fff');

  // ==========================================
  // CHECK DE LIBRERÍAS
  // ==========================================
  log('Validators: ' + (typeof Validators), typeof Validators === 'object' ? '#4ade80' : '#ef4444');
  log('DNIParser: ' + (typeof DNIParser), typeof DNIParser === 'object' ? '#4ade80' : '#ef4444');
  log('DNIScanner: ' + (typeof DNIScanner), typeof DNIScanner === 'object' ? '#4ade80' : '#ef4444');
  log('jsQR: ' + (typeof jsQR), typeof jsQR === 'function' ? '#4ade80' : '#f59e0b');
  log('BarcodeDetector: ' + (typeof BarcodeDetector), typeof BarcodeDetector === 'function' ? '#4ade80' : '#f59e0b');

  // ==========================================
  // REFERENCIAS DOM
  // ==========================================
  const captura = document.getElementById('captura-dni');
  const video = captura ? captura.querySelector('video') : null;
  const canvas = captura ? captura.querySelector('canvas') : null;
  const img = captura ? captura.querySelector('.camera-img') : null;
  const estado = captura ? captura.querySelector('.captura-estado') : null;
  const escaneoEstado = captura ? captura.querySelector('.escaneo-estado') : null;
  const scanFrame = document.getElementById('scan-frame');
  const cameraHint = document.getElementById('camera-hint');
  const btnCamara = captura ? captura.querySelector('.btn-camara') : null;
  const btnRepetir = captura ? captura.querySelector('.btn-repetir') : null;
  const btnFlash = captura ? captura.querySelector('.flash-btn') : null;
  const resultado = document.getElementById('resultado');
  const badgeMetodo = document.getElementById('badge-metodo');
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');

  log('captura: ' + (!!captura), captura ? '#4ade80' : '#ef4444');
  log('video: ' + (!!video), video ? '#4ade80' : '#ef4444');
  log('canvas: ' + (!!canvas), canvas ? '#4ade80' : '#ef4444');
  log('btnCamara: ' + (!!btnCamara), btnCamara ? '#4ade80' : '#ef4444');

  let stream = null;
  let trackActual = null;
  let flashEncendido = false;
  let flashSoportado = false;
  let stopScan = null;

  function setStatus(texto, tipo = 'idle') {
    if (statusText) statusText.textContent = texto;
    if (statusPill) {
      statusPill.classList.remove('active', 'error');
      if (tipo === 'active') statusPill.classList.add('active');
      if (tipo === 'error') statusPill.classList.add('error');
    }
  }

  // Auto-iniciar cámara
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(iniciarCamara, 300);
  });

  // ==========================================
  // CÁMARA
  // ==========================================
  async function iniciarCamara() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('❌ getUserMedia no disponible', '#ef4444');
      if (estado) estado.textContent = 'Este navegador no permite acceder a la cámara.';
      setStatus('Sin cámara', 'error');
      return;
    }
    try {
      log('🎥 Pidiendo cámara…', '#f59e0b');
      setStatus('Iniciando cámara…');

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      log('✅ Stream obtenido', '#4ade80');
      video.srcObject = stream;
      video.hidden = false;
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

      iniciarEscaneoContinuo();
    } catch (err) {
      log('❌ Error cámara: ' + err.name + ' - ' + err.message, '#ef4444');
      let msg = 'No se pudo acceder a la cámara.';
      if (err.name === 'NotAllowedError') msg = 'Permiso denegado.';
      else if (err.name === 'NotFoundError') msg = 'No hay cámara.';
      if (estado) estado.textContent = msg;
      setStatus('Error cámara', 'error');
    }
  }

  function iniciarEscaneoContinuo() {
    if (stopScan) stopScan();
    log('🔍 Iniciando escaneo continuo…', '#f59e0b');
    if (escaneoEstado) escaneoEstado.textContent = '🔍 Buscando código…';

    if (typeof DNIScanner === 'undefined') {
      log('❌ DNIScanner NO está cargado', '#ef4444');
      if (escaneoEstado) escaneoEstado.textContent = '❌ Error: scanner.js no cargó';
      return;
    }

    stopScan = DNIScanner.escanearContinuo(
      video,
      canvas,
      (texto) => {
        log('🎯 ¡DETECTADO! ' + texto.substring(0, 60), '#22c55e');
        exitoEscaneo(texto);
      },
      () => {
        log('⏱ Sin detección en 20s', '#f59e0b');
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
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (img) { img.src = dataUrl; img.hidden = false; }
    video.hidden = true;

    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null;

    log('🧩 Parseando…', '#f59e0b');
    const datos = DNIParser.parsear(texto);
    log('📋 Datos: ' + JSON.stringify(datos).substring(0, 100), '#4ade80');

    if (!datos || (!datos.dni && !datos.apellido && !datos.nombre)) {
      log('⚠️ No se extrajeron datos útiles', '#f59e0b');
      if (estado) estado.textContent = '⚠️ No se extrajeron datos';
      if (escaneoEstado) escaneoEstado.textContent = 'Texto: ' + texto.substring(0, 60);
      setStatus('Sin datos', 'error');
      if (btnRepetir) btnRepetir.hidden = false;
      return;
    }

    render(datos);
    if (estado) estado.textContent = '✓ ' + (datos.nombreCompleto || datos.dni);
    if (escaneoEstado) escaneoEstado.textContent = '✅ Escaneo OK';
    setStatus('Escaneo OK', 'active');
    if (btnRepetir) btnRepetir.hidden = false;
  }

  function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (valor === null || valor === undefined || valor === '') ? '—' : String(valor);
    el.classList.remove('ok', 'err');
  }

  function setBool(id, valor, textoSi, textoNo) {
    const el = document.getElementById(id);
    if (!el) return;
    if (valor === true) {
      el.textContent = textoSi;
      el.classList.add('ok');
    } else if (valor === false) {
      el.textContent = textoNo;
      el.classList.add('err');
    } else {
      el.textContent = '—';
    }
  }

  function render(d) {
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
    setBool('r-val-cuil', d.cuil ? validarCUIL(d.cuil) : null, '✅ Válido', '❌ Inválido');
    setTexto('r-val-mrz', d.metodo === 'mrz' ? 'Sin verificar' : '—');
    setTexto('r-raw', d.raw);

    if (resultado) {
      resultado.hidden = false;
      setTimeout(() => resultado.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }

  function validarCUIL(cuil) {
    if (!cuil) return null;
    const limpio = String(cuil).replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(limpio)) return false;
    const prefijos = ['20', '23', '24', '27', '30', '33', '34', '50', '51', '55'];
    if (!prefijos.includes(limpio.substring(0, 2))) return false;
    const nums = limpio.split('').map(Number);
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) suma += nums[i] * pesos[i];
    const resto = suma % 11;
    let check;
    if (resto === 0) check = 0;
    else if (resto === 1) {
      const pref = limpio.substring(0, 2);
      if (pref === '20') check = 9;
      else if (pref === '27') check = 4;
      else return false;
    } else check = 11 - resto;
    return check === nums[10];
  }

  if (btnCamara) btnCamara.addEventListener('click', iniciarCamara);

  if (btnRepetir) {
    btnRepetir.addEventListener('click', async () => {
      if (resultado) resultado.hidden = true;
      if (img) { img.hidden = true; img.src = ''; }
      video.hidden = false;
      btnRepetir.hidden = true;
      if (estado) estado.textContent = 'Apuntá al código del DNI.';
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

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (stopScan) stopScan();
  });

  log('=== main.js listo ===', '#fff');
})();
