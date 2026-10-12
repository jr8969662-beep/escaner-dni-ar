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

  // Auto-iniciar cámara
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
    if (stopScan) { stopScan(); stopScan = null; }
    scanIndicador.classList.remove('activo');
    marcoDni.classList.remove('activo');
    if (flashEncendido && trackActual) {
      trackActual.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      flashEncendido = false;
      btnFlash.classList.remove('encendido');
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    img.src = dataUrl;
    img.hidden = false;
    video.hidden = true;

    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    trackActual = null;

    const datos = DNIParser.parsear(texto);
    console.log('🧩 Datos parseados:', datos);

    if (!datos || (!datos.dni && !datos.apellido && !datos.nombre)) {
      estado.textContent = '⚠️ Código detectado pero no se pudieron extraer datos.';
      estado.classList.add('error');
      escaneoEstado.textContent = 'Texto crudo: ' + texto.substring(0, 80);
      btnRepetir.hidden = false;
      return;
    }

    render(datos);
    estado.textContent = `✓ ${datos.nombreCompleto || datos.dni || 'DNI escaneado'}`;
    estado.classList.add('ok');
    estado.classList.remove('error');
    escaneoEstado.textContent = '✅ Escaneo completado';
    btnRepetir.hidden = false;
  }

  // ==========================================
  // RENDER DE TODOS LOS CAMPOS
  // ==========================================
  function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (valor === null || valor === undefined || valor === '') ? '—' : String(valor);
  }

  function setBool(id, valor, textoSi, textoNo) {
    const el = document.getElementById(id);
    if (!el) return;
    if (valor === true) {
      el.textContent = textoSi;
      el.style.color = '#86efac';
    } else if (valor === false) {
      el.textContent = textoNo;
      el.style.color = '#fca5a5';
    } else {
      el.textContent = '—';
      el.style.color = '';
    }
  }

  function render(d) {
    badgeMetodo.textContent = (d.metodo || 'código').toUpperCase();

    // Datos personales
    setTexto('r-dni', d.dni);
    setTexto('r-apellido', d.apellido);
    setTexto('r-nombre', d.nombre);
    setTexto('r-nombreCompleto', d.nombreCompleto);
    setTexto('r-sexo', d.sexo);
    setTexto('r-nacimiento', d.fechaNacimiento);
    setTexto('r-edad', d.edad != null ? d.edad + ' años' : null);
    setTexto('r-nacionalidad', d.nacionalidad);
    setTexto('r-lugarNacimiento', d.lugarNacimiento);

    // Datos del documento
    setTexto('r-tipo', d.tipoDocumento);
    setTexto('r-ejemplar', d.ejemplar);
    setTexto('r-tramite', d.tramite);
    setTexto('r-cuil', d.cuil);
    setTexto('r-emision', d.fechaEmision);
    setTexto('r-vencimiento', d.fechaVencimiento);
    setBool('r-vigente', d.vigente, '✅ Sí', '❌ Vencido');
    setTexto('r-pais', d.pais);

    // Domicilio
    setTexto('r-domicilio', d.domicilio);

    // Validaciones
    setBool('r-val-dni', d.dni ? /^\d{7,8}$/.test(d.dni) : null, '✅ Válido', '❌ Inválido');
    setBool('r-val-cuil', d.cuil ? validarCUIL(d.cuil) : null, '✅ Válido', '❌ Inválido');

    // MRZ: check digits
    if (d.metodo === 'mrz' && d.validacionesMRZ) {
      const v = d.validacionesMRZ;
      setBool('r-val-mrz',
        v.doc && v.dob && v.exp,
        '✅ Todos OK',
        '⚠️ Alguno falló');
    } else {
      setTexto('r-val-mrz', d.metodo === 'mrz' ? 'Sin verificar' : '—');
    }

    setTexto('r-raw', d.raw);

    resultado.hidden = false;
    resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ==========================================
  // VALIDACIÓN DE CUIL (módulo 11)
  // ==========================================
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

  // ==========================================
  // EVENTOS
  // ==========================================
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
