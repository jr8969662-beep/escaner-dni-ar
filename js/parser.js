/**
 * Parser del DNI argentino
 */

const DNIParser = (() => {

  function parsearPDF417(texto) {
    if (!texto) return null;

    let raw = String(texto).trim().replace(/\r/g, '');
    let campos = raw.split('@').map(c => c.trim());
    while (campos.length && !campos[0]) campos.shift();
    while (campos.length && !campos[campos.length - 1]) campos.pop();

    const data = {
      metodo: 'pdf417',
      raw: texto,
      dni: null, apellido: null, nombre: null, sexo: null,
      fechaNacimiento: null, fechaEmision: null, fechaVencimiento: null,
      ejemplar: null, tramite: null, cuil: null,
      nacionalidad: 'ARGENTINA'
    };

    for (const campo of campos) {
      if (!data.dni && /^\d{7,8}$/.test(campo)) data.dni = campo;
      if (!data.sexo && /^[MF]$/i.test(campo)) data.sexo = campo.toUpperCase();
      if (!data.ejemplar && /^[A-Z]$/.test(campo) && campo !== 'M' && campo !== 'F') {
        data.ejemplar = campo;
      }
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(campo)) {
        if (!data.fechaNacimiento) data.fechaNacimiento = campo;
        else if (!data.fechaEmision) data.fechaEmision = campo;
        else if (!data.fechaVencimiento) data.fechaVencimiento = campo;
      }
      if (!data.cuil && /^\d{2}-?\d{8}-?\d$/.test(campo)) data.cuil = campo;
      if (!data.tramite && /^\d{11}$/.test(campo) && campo !== data.dni) {
        data.tramite = campo;
      }
      if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/i.test(campo) && !/^\d+$/.test(campo)) {
        const up = campo.toUpperCase();
        if (/ARGENTINA|REPUBLICA|DNI|EJEMPLAR|TRAMITE|NACIONALIDAD/.test(up)) continue;
        if (!data.apellido) data.apellido = up;
        else if (!data.nombre) data.nombre = up;
      }
    }

    if (!data.dni) {
      const m = raw.match(/\b(\d{7,8})\b/);
      if (m) data.dni = m[1];
    }

    data.fechaNacimiento = Validators.normalizarFecha(data.fechaNacimiento);
    data.fechaEmision    = Validators.normalizarFecha(data.fechaEmision);
    data.fechaVencimiento= Validators.normalizarFecha(data.fechaVencimiento);

    data.validaciones = {
      dni: Validators.validarDNI(data.dni),
      cuil: data.cuil ? Validators.validarCUIL(data.cuil) : null,
      fechaNacimiento: data.fechaNacimiento ? Validators.validarFecha(data.fechaNacimiento) : null,
      edad: data.fechaNacimiento ? Validators.calcularEdad(data.fechaNacimiento) : null
    };

    return data;
  }

  function parsearOCR(texto) {
    if (!texto) return null;
    const raw = texto.replace(/\s+/g, ' ').trim();
    const upper = raw.toUpperCase();

    const data = {
      metodo: 'ocr', raw: texto,
      dni: null, apellido: null, nombre: null, sexo: null,
      fechaNacimiento: null, fechaEmision: null, fechaVencimiento: null,
      ejemplar: null, tramite: null, cuil: null,
      nacionalidad: null, validaciones: {}
    };

    const mDni = upper.match(/\bDNI[:\s]*(\d{7,8})\b/) || upper.match(/\b(\d{8})\b/);
    if (mDni) data.dni = mDni[1];

    const fechas = upper.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g) || [];
    if (fechas[0]) data.fechaNacimiento = fechas[0];
    if (fechas[1]) data.fechaEmision = fechas[1];
    if (fechas[2]) data.fechaVencimiento = fechas[2];

    if (/\bMASCULINO\b|\bM\b(?=\s*\d)/.test(upper)) data.sexo = 'M';
    else if (/\bFEMENINO\b|\bF\b(?=\s*\d)/.test(upper)) data.sexo = 'F';

    if (/ARGENTIN/.test(upper)) data.nacionalidad = 'ARGENTINA';

    const mEj = upper.match(/EJEMPLAR[:\s]*([A-Z])\b/);
    if (mEj) data.ejemplar = mEj[1];

    const mTr = upper.match(/TR[AÁ]MITE[:\s]*(\d{11})/);
    if (mTr) data.tramite = mTr[1];

    const mCuil = upper.match(/\b(\d{2}[-\s]?\d{8}[-\s]?\d)\b/);
    if (mCuil) data.cuil = mCuil[1];

    const lineas = raw.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    const candidatos = lineas.filter(l =>
      /^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(l.toUpperCase()) &&
      !/ARGENTINA|REPUBLICA|DNI|EJEMPLAR|TRAMITE|NACIONALIDAD|MASCULINO|FEMENINO/.test(l.toUpperCase())
    );
    if (candidatos[0]) data.apellido = candidatos[0].toUpperCase();
    if (candidatos[1]) data.nombre = candidatos[1].toUpperCase();

    data.fechaNacimiento = Validators.normalizarFecha(data.fechaNacimiento);
    data.fechaEmision    = Validators.normalizarFecha(data.fechaEmision);
    data.fechaVencimiento= Validators.normalizarFecha(data.fechaVencimiento);

    data.validaciones = {
      dni: Validators.validarDNI(data.dni),
      cuil: data.cuil ? Validators.validarCUIL(data.cuil) : null,
      fechaNacimiento: data.fechaNacimiento ? Validators.validarFecha(data.fechaNacimiento) : null,
      edad: data.fechaNacimiento ? Validators.calcularEdad(data.fechaNacimiento) : null
    };

    return data;
  }

  return { parsearPDF417, parsearOCR };
})();
