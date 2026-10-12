/**
 * Parser del DNI argentino
 * Soporta: MRZ (dorso), PDF417 (frente), QR verificación y OCR
 */

const DNIParser = (() => {

  // ==========================================
  // PARSER UNIVERSAL
  // ==========================================
  function parsearUniversal(texto) {
    if (!texto || !texto.trim()) return null;
    const t = texto.trim();

    // 1) PDF417 con @ como delimitador
    if (t.includes('@')) return parsearPDF417(t);

    // 2) MRZ (buscar antes que URL/JSON)
    if (esMRZ(t)) return parsearMRZ(t);

    // 3) URL de verificación
    if (/^https?:\/\//i.test(t)) return parsearURL(t);

    // 4) JSON
    if (t.startsWith('{') && t.endsWith('}')) {
      try { return parsearJSON(JSON.parse(t)); } catch (e) {}
    }

    // 5) Fallback OCR
    return parsearOCR(t);
  }

  // ==========================================
  // DETECTOR MRZ
  // ==========================================
  function esMRZ(texto) {
    if (!texto) return false;
    const limpio = texto.toUpperCase();
    const tieneID = /ID[A-Z]{3}\d{6,}/.test(limpio.replace(/[\s<]/g, ''));
    const tieneFillers = /<{5,}/.test(limpio);
    const tieneFecha = /\d{6}[0-9<][MF<]/.test(limpio.replace(/\s/g, ''));
    return tieneID || (tieneFillers && tieneFecha);
  }

  // ==========================================
  // PARSER MRZ (robusto contra ruido del OCR)
  // ==========================================
  function parsearMRZ(texto) {
    const lineasRaw = texto.split(/[\n\r]+/);

    // Limpiar cada línea: solo A-Z, 0-9 y <
    const lineasLimp = lineasRaw
      .map(l => l.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
      .filter(l => l.length >= 20);

    let lineasMRZ = [];

    if (lineasLimp.length >= 3) {
      lineasMRZ = lineasLimp.slice(0, 3);
    } else if (lineasLimp.length >= 1) {
      const todo = lineasLimp.join('');
      if (todo.length >= 90) {
        lineasMRZ = [
          todo.substring(0, 30),
          todo.substring(30, 60),
          todo.substring(60, 90)
        ];
      } else if (todo.length >= 60) {
        lineasMRZ = [
          todo.substring(0, 30),
          todo.substring(30, 60),
          ''
        ];
      } else {
        return null;
      }
    } else {
      return null;
    }

    lineasMRZ = lineasMRZ.map(l => padRight(l.substring(0, 30), 30, '<'));

    let l1 = lineasMRZ[0], l2 = lineasMRZ[1], l3 = lineasMRZ[2];

    // Si la primera línea no empieza con ID, buscar la correcta
    if (!/^ID/.test(l1)) {
      const idx = lineasMRZ.findIndex(l => /^ID[A-Z]{3}/.test(l));
      if (idx > 0) {
        lineasMRZ = [...lineasMRZ.slice(idx), ...lineasMRZ.slice(0, idx)];
        l1 = lineasMRZ[0]; l2 = lineasMRZ[1]; l3 = lineasMRZ[2];
      }
    }

    const data = baseData('mrz', texto);
    data.pais = l1.substring(2, 5);

    // Línea 1: número documento (pos 5-13)
    const numDocRaw = l1.substring(5, 14).replace(/</g, '');
    const checkDoc = l1.charAt(14);
    data.dni = numDocRaw || null;

    // Línea 2: fecha nac + sexo + vencimiento + nacionalidad
    const dobRaw = l2.substring(0, 6);
    const dobCheck = l2.charAt(6);
    const sexo = l2.charAt(7);
    const expRaw = l2.substring(8, 14);
    const expCheck = l2.charAt(14);
    const nacionalidad = l2.substring(15, 18).replace(/</g, '');

    data.fechaNacimiento = yymmddToISO(dobRaw);
    data.sexo = sexo === 'M' ? 'M' : sexo === 'F' ? 'F' : null;
    data.fechaVencimiento = yymmddToISO(expRaw);
    data.nacionalidad = nacionalidad === 'ARG' ? 'ARGENTINA' : nacionalidad;

    data.validaciones = data.validaciones || {};
    data.validaciones.checkDoc = checkDigitMRZ(l1.substring(5, 14)) === checkDoc;
    data.validaciones.checkDob = checkDigitMRZ(dobRaw) === dobCheck;
    data.validaciones.checkExp = checkDigitMRZ(expRaw) === expCheck;

    // Línea 3: APELLIDO<<NOMBRE
    const l3clean = l3.replace(/<+$/, '');
    const partes = l3clean.split('<<');
    if (partes[0]) data.apellido = partes[0].replace(/</g, ' ').trim();
    if (partes[1]) data.nombre = partes[1].replace(/</g, ' ').trim();

    data.fechaNacimiento = ajustarSiglo(data.fechaNacimiento);

    return finalizar(data);
  }

  function padRight(str, len, ch) {
    return (str + ch.repeat(len)).substring(0, len);
  }

  function yymmddToISO(yymmdd) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${mm}-${dd}`;
  }

  function ajustarSiglo(fechaISO) {
    if (!fechaISO) return null;
    const hoy = new Date();
    const fecha = new Date(fechaISO);
    if (fecha > hoy) {
      const y = fecha.getFullYear() - 100;
      return `${y}-${fechaISO.substring(5)}`;
    }
    return fechaISO;
  }

  function checkDigitMRZ(str) {
    const weights = [7, 3, 1];
    const valor = (c) => {
      if (c === '<') return 0;
      if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
      if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
      return 0;
    };
    let suma = 0;
    for (let i = 0; i < str.length; i++) {
      suma += valor(str[i]) * weights[i % 3];
    }
    return String(suma % 10);
  }

  // ==========================================
  // PARSER PDF417
  // ==========================================
  function parsearPDF417(texto) {
    if (!texto) return null;
    let raw = String(texto).trim().replace(/\r/g, '');
    let campos = raw.split('@').map(c => c.trim());
    while (campos.length && !campos[0]) campos.shift();
    while (campos.length && !campos[campos.length - 1]) campos.pop();

    const data = baseData('pdf417', texto);

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

    return finalizar(data);
  }

  // ==========================================
  // PARSER URL
  // ==========================================
  function parsearURL(url) {
    const data = baseData('qr', url);
    const esVerif = /^https?:\/\/(www\.)?(argentina\.gob\.ar|dni\.argentina\.gob\.ar|renaper\.gob\.ar)/i.test(url)
                 || /consulta-dni|verificar|verificacion/i.test(url);
    if (esVerif) {
      data.esVerificacion = true;
      return finalizar(data);
    }
    try {
      const u = new URL(url);
      const params = u.searchParams;
      const map = {
        dni: ['dni', 'documento', 'doc', 'nro', 'numero'],
        apellido: ['apellido', 'apellidos', 'surname'],
        nombre: ['nombre', 'nombres', 'name'],
        sexo: ['sexo', 'sex', 'genero'],
        fechaNacimiento: ['nacimiento', 'fechanac', 'birthdate'],
        cuil: ['cuil', 'cuit']
      };
      for (const [key, aliases] of Object.entries(map)) {
        for (const alias of aliases) {
          const v = params.get(alias);
          if (v) { data[key] = v; break; }
        }
      }
    } catch (e) {}
    return finalizar(data);
  }

  function parsearJSON(obj) {
    const data = baseData('qr', JSON.stringify(obj));
    const pick = (aliases) => {
      for (const a of aliases) if (obj[a] != null) return String(obj[a]);
      return null;
    };
    data.dni = pick(['dni', 'documento', 'numero', 'nro']);
    data.apellido = pick(['apellido', 'apellidos', 'surname']);
    data.nombre = pick(['nombre', 'nombres', 'name']);
    data.sexo = pick(['sexo', 'sex', 'genero']);
    data.fechaNacimiento = pick(['fechaNacimiento', 'nacimiento', 'fecha_nac']);
    data.cuil = pick(['cuil', 'cuit']);
    return finalizar(data);
  }

  // ==========================================
  // PARSER OCR (texto libre)
  // ==========================================
  function parsearOCR(texto) {
    if (!texto) return null;

    // ¿Hay MRZ embebida?
    if (esMRZ(texto)) return parsearMRZ(texto);

    const raw = texto.replace(/\s+/g, ' ').trim();
    const upper = raw.toUpperCase();

    const data = baseData('ocr', texto);

    const mDni = upper.match(/\bDNI[:\s]*(\d{7,8})\b/) || upper.match(/\b(\d{8})\b/);
    if (mDni) data.dni = mDni[1];

    const fechas = upper.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g) || [];
    if (fechas[0]) data.fechaNacimiento = fechas[0];
    if (fechas[1]) data.fechaEmision = fechas[1];
    if (fechas[2]) data.fechaVencimiento = fechas[2];

    if (/\bMASCULINO\b/.test(upper)) data.sexo = 'M';
    else if (/\bFEMENINO\b/.test(upper)) data.sexo = 'F';

    if (/ARGENTIN/.test(upper)) data.nacionalidad = 'ARGENTINA';

    const mCuil = upper.match(/\b(\d{2}[-\s]?\d{8}[-\s]?\d)\b/);
    if (mCuil) data.cuil = mCuil[1];

    const mTr = upper.match(/TR[AÁ]MITE\s*N?[°º]?[:\s]*(\d{8,11})/);
    if (mTr) data.tramite = mTr[1];

    const lineas = raw.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    const candidatos = lineas.filter(l =>
      /^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(l.toUpperCase()) &&
      !/ARGENTINA|REPUBLICA|DNI|EJEMPLAR|TRAMITE|NACIONALIDAD|MASCULINO|FEMENINO|DOMICILIO|NACIMIENTO/.test(l.toUpperCase())
    );
    if (candidatos[0]) data.apellido = candidatos[0].toUpperCase();
    if (candidatos[1]) data.nombre = candidatos[1].toUpperCase();

    return finalizar(data);
  }

  // ==========================================
  // HELPERS
  // ==========================================
  function baseData(metodo, raw) {
    return {
      metodo, raw,
      dni: null, apellido: null, nombre: null, sexo: null,
      fechaNacimiento: null, fechaEmision: null, fechaVencimiento: null,
      ejemplar: null, tramite: null, cuil: null,
      nacionalidad: 'ARGENTINA',
      validaciones: {}
    };
  }

  function finalizar(data) {
    data.fechaNacimiento = Validators.normalizarFecha(data.fechaNacimiento);
    data.fechaEmision    = Validators.normalizarFecha(data.fechaEmision);
    data.fechaVencimiento= Validators.normalizarFecha(data.fechaVencimiento);

    if (!data.validaciones) data.validaciones = {};
    data.validaciones.dni = Validators.validarDNI(data.dni);
    data.validaciones.cuil = data.cuil ? Validators.validarCUIL(data.cuil) : null;
    data.validaciones.edad = data.fechaNacimiento ? Validators.calcularEdad(data.fechaNacimiento) : null;

    return data;
  }

  return { parsearUniversal, parsearPDF417, parsearMRZ, parsearOCR, esMRZ };
})();

console.log('✅ parser.js cargado');
