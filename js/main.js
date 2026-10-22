  async function iniciarAutoScanDomicilio() {
    autoScanActivo = true;
    autoScanProcesando = true;
    if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = true;
    if (domicilioProgress) domicilioProgress.hidden = false;
    if (domicilioProgressText) domicilioProgressText.textContent = 'Leyendo el reverso...';
    if (domicilioProgressFill) domicilioProgressFill.style.width = '0%';

    const acum = {};
    let mejorCanvas = null;
    const contexto = { dni: ultimoResultado && (ultimoResultado.dni || ultimoResultado.numero) };

    if (!(await esperarVideoDomicilio())) {
      autoScanActivo = autoScanProcesando = false;
      if (domicilioProgress) domicilioProgress.hidden = true;
      if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false;
      return;
    }

    try {
      // Toma 1 sola foto recortada (rapidísimo)
      const c = await capturarMasNitidoRecortado(1, 0);
      mejorCanvas = c;

      // Le pasa la foto al OCR rápido
      const res = await DomicilioOCR.leer(c, paisSeleccionado, (p) => {
        if (domicilioProgressFill) domicilioProgressFill.style.width = (p * 100) + '%';
      }, contexto);

      if (!autoScanActivo) return;
      autoScanActivo = false;

      // Verificamos si sacó algo útil
      if (!res.domicilio && !res.cuil && !res.fechaVencimiento && !res.lugarNacimiento) {
        if (domicilioProgress) domicilioProgress.hidden = true;
        if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false;
        mostrarToast('No se pudo leer. Acomodá el DNI y tocá "Capturar y leer".', 'error');
        return;
      }

      // Mostramos los datos detectados
      detenerCamaraModal();
      if (domicilioPreview && mejorCanvas) { domicilioPreview.src = mejorCanvas.toDataURL('image/jpeg', 0.7); domicilioPreview.hidden = false; }
      if (domicilioVideo) domicilioVideo.hidden = true;
      if (domInputDomicilio) domInputDomicilio.value = res.domicilio || '';
      if (domInputNacimiento) domInputNacimiento.value = res.lugarNacimiento || '';
      if (domInputCuil) domInputCuil.value = res.cuil || '';
      if (domInputVencimiento) domInputVencimiento.value = res.fechaVencimiento || '';
      if (domInputNacionalidad) domInputNacionalidad.value = res.nacionalidad || '';
      
      if (domicilioProgress) domicilioProgress.hidden = true;
      if (domicilioResultado) domicilioResultado.hidden = false;
      if (btnGuardarDomicilio) btnGuardarDomicilio.hidden = false;
      if (btnReintentarDomicilio) btnReintentarDomicilio.hidden = false;

      if (!res.domicilio) mostrarToast('No se leyó el domicilio: escribilo a mano.', 'error');
      else if (res.fechaVencimiento && res.mrzVerificada === false) mostrarToast('✓ Detectado · revisá el vencimiento', 'error');
      else mostrarToast('✓ Datos detectados', 'success');

    } catch (e) {
      console.warn('Error OCR:', e);
      autoScanActivo = false;
      autoScanProcesando = false;
      if (domicilioProgress) domicilioProgress.hidden = true;
      if (btnCapturarDomicilio) btnCapturarDomicilio.hidden = false;
      mostrarToast('Error al procesar. Usá el botón manual.', 'error');
    }
  }
