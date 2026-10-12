(() => {
  'use strict';
  console.log('🚀 main.js iniciando');

  const captura = document.getElementById('captura-dni');
  const video = captura.querySelector('video');
  const canvas = captura.querySelector('canvas');
  const img = captura.querySelector('img');
  const estado = captura.querySelector('.captura-estado');
  const escaneoEstado = captura.querySelector('.escaneo-estado');
  const marcoDni = captura.querySelector('.marco-dni');
  const scanIndicador = captura.querySelector('.scan-indicador');
  const btnCamara = captura.querySelector('.btn-camara');
  const btnRepetir = captura.querySelector('.btn-repetir');
  const btnFlash = captura.querySelector('.btn-flash');

  const resultado = document.getElementById('resultado');
  const badgeMetodo = document.getElementById('badge-metodo');

  let stream = null;
  let trackActual = null;
  let flashEncendido = false;
  let flashSoportado = false;
  let stopScan = null;

  // Iniciar cámara al cargar
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(iniciarCamara, 300);
  });

  async function iniciarCamara() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      estado.textContent = 'Este navegador no permite acceder a la cámara.';
      estado.classList.add('error');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      video.srcObject = stream;
      video.hidden = false;
      img.hidden = true;
      marcoDni.classList.add('activo');
      scanIndicador.classList.add('activo');
      btnCamara.hidden = true;
      btnRepetir.hidden = true;
      estado.textContent = 'Apuntá al código del DNI. Se escaneará automáticamente.';
      estado.classList.remove('ok', 'error');

      trackActual = stream.getVideoTracks()[0];
      const caps = trackActual.getCapabilities ? trackActual.getCapabilities() : {};
      flashSoportado = !!caps.torch;
      if (flashSoportado) btnFlash.classList.add('activo');

      iniciarEscaneoContinuo();
    } catch (err) {
      console.error('❌ getUserMedia falló:', err);
      let msg = 'No se pudo acceder a la cámara.';
      if (err.name === 'NotAllowedError') msg = 'Permiso de cámara denegado. Habilitalo en el navegador.';
      else if (err.name === 'NotFoundError') msg = 'No se encontró cámara.';
      estado.textContent = msg;
      estado.classList.add('error');
    }
  }

  function detenerCamara() {
    if (stopScan) { stopScan(); stopScan = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null;
    flashEncendido = false;
    if (btnFlash) btnFlash.classList.remove('encendido', 'activo');
  }

  function iniciarEscaneoContinuo() {
    if (stopScan) stopScan();
    escaneoEstado.textContent = '🔍 Buscando código…';
    stopScan = DNIScanner.escanearContinuo(
      video,
      canvas,
      (texto) => {
        console.log('🎯 Código detectado:', texto);
        exitoEscaneo(texto);
      },
      () => {
        escaneoEstado.textContent = '⏱ No se detectó. Probá con más luz o acercate.';
      },
      { intervaloMs: 400, timeoutMs: 20000, anchoMax: 1280 }
    );
  }

  async function exitoEscaneo(texto) {
    // Detener
    if (stopScan) { stopScan(); stopScan = null; }
    scanIndicador.classList.remove('activo');
    marcoDni.classList.remove('activo');
    if (flashEncendido && trackActual) {
      trackActual.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      flashEncendido = false;
      btnFlash.classList.remove('encendido');
    }

    // Capturar imagen final
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    img.src = dataUrl;
    img.hidden = false;
    video.hidden = true;

    // Detener tracks
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null;

    // Parsear
    const datos = DNIParser.parsear(texto);
    console.log('🧩 Datos parseados:', datos);

    if (!datos || (!datos.dni && !datos.apellido && !datos.nombre)) {
      estado.textContent = '⚠️ Código detectado pero no se pudieron extraer datos.';
      estado.classList.add('error');
      escaneoEstado.textContent = 'Texto crudo: ' + texto.substring(0, 80);
      btnRepetir.hidden = false;
      return;
    }

    // Render
    render(datos);
    estado.textContent = `✓ ${datos.nombreCompleto || datos.dni || 'DNI escaneado'}`;
    estado.classList.add('ok');
    estado.classList.remove('error');
    escaneoEstado.textContent = '✅ Escaneo completado';
    btnRepetir.hidden = false;
  }

  function render(d) {
    badgeMetodo.textContent = (d.metodo || 'código').toUpperCase();
    document.getElementById('r-dni').textContent = d.dni || '—';
    document.getElementById('r-apellido').textContent = d.apellido || '—';
    document.getElementById('r-nombre').textContent = d.nombre || '—';
    document.getElementById('r-sexo').textContent = d.sexo || '—';
    document.getElementById('r-nacimiento').textContent = d.fechaNacimiento || '—';
    document.getElementById('r-emision').textContent = d.fechaEmision || '—';
    document.getElementById('r-tramite').textContent = d.tramite || '—';
    document.getElementById('r-tipo').textContent = d.tipoDocumento || '—';
    document.getElementById('r-raw').textContent = d.raw || '—';
    resultado.hidden = false;
    resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Eventos
  btnCamara.addEventListener('click', iniciarCamara);

  btnRepetir.addEventListener('click', async () => {
    resultado.hidden = true;
    img.hidden = true;
    img.src = '';
    video.hidden = false;
    btnRepetir.hidden = true;
    estado.textContent = 'Apuntá al código del DNI.';
    estado.classList.remove('ok', 'error');
    escaneoEstado.textContent = '';
    await iniciarCamara();
  });

  btnFlash.addEventListener('click', async () => {
    if (!trackActual || !flashSoportado) return;
    try {
      flashEncendido = !flashEncendido;
      await trackActual.applyConstraints({ advanced: [{ torch: flashEncendido }] });
      btnFlash.classList.toggle('encendido', flashEncendido);
    } catch (e) {}
  });

  window.addEventListener('beforeunload', detenerCamara);

  console.log('✅ main.js listo');
})();
