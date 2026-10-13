/**
 * Parser DNI argentino - Extracción completa con detección estricta
 * Rechaza documentos de otros países
 */

const DNIParser = (() => {

  // ==========================================
  // HELPERS
  // ==========================================
  function fechaDMYtoISO(fechaStr) {
    if (!fechaStr) return null;
    const limpio = String(fechaStr).trim();
    const m = limpio.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return null;
    const dd = m[1], mm = m[2];
    let aa = m[3];
    let anio = aa;
    if (aa.length === 2) anio = parseInt(aa) > 50 ? '19' + aa : '20' + aa;
    return anio + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0');
  }

  function fechaYYMMDDtoISO(s) {
    if (!/^\d{6}$/.test(s)) return null;
    const yy = parseInt(s.substring(0, 2), 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return yyyy + '-' + s.substring(2, 4) + '-' + s.substring(4, 6);
  }

  function normalizarSexo(s) {
    if (!s) return null;
    const up = String(s).toUpperCase().trim();
    if (up === 'M' || up === 'MASCULINO' || up === 'HOMBRE') return 'Masculino';
    if (up === 'F' || up === 'FEMENINO' || up === 'MUJER') return 'Femenino';
    if (up === 'X') return 'X';
    return up;
  }

  function normalizarTipoDoc(t) {
    const tipos = {
      'D': 'DNI', 'DNI': 'DNI',
      'C': 'LC (Libreta Cívica)', 'LC': 'LC (Libreta Cívica)',
      'E': 'LE (Libreta de Enrolamiento)', 'LE': 'LE (Libreta de Enrolamiento)',
      'P': 'Pasaporte', 'PASAPORTE': 'Pasaporte',
      'I': 'CI (Cédula de Identidad)', 'CI': 'CI (Cédula de Identidad)'
    };
    return tipos[String(t || '').toUpperCase()] || (t || 'DNI');
  }

  function calcularEdad(fechaISO) {
    if (!fechaISO) return null;
    const nac = new Date(fechaISO);
    if (isNaN(nac)) return null;
    const hoy = new Date();
    let edad = hoy.getFullYear() - nac.getFullYear();
    const m = hoy.getMonth() - nac.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
    return edad >= 0 ? edad : null;
  }

  function estaVigente(fechaISO) {
    if (!fechaISO) return null;
    const venc = new Date(fechaISO);
    if (isNaN(venc)) return null;
    return venc > new Date();
  }

  function esNombreValido(s) {
    if (!s) return false;
    // Letras ASCII + Latin-1 Supplement (acentos) + espacio
    return /^[A-Za-z\u00C0-\u00FF\s]{2,}$/.test(s);
  }

  // ==========================================
  // DETECCIÓN: ¿ES DE OTRO PAÍS?
  // ==========================================
  function esDeOtroPais(texto) {
    if (!texto) return false;
    const t = String(texto).trim();

    if (/IDURY|IDPRY|IDPER|IDBOL|IDCOL|IDECU|IDCHL|IDVEN|IDBRA/i.test(t)) return true;
    if (/^0{4,}\d+@/.test(t)) return true;
    if (/^BR\d{11}/i.test(t)) return true;

    return false;
  }

  // ==========================================
  // DETECCIÓN: ¿ES ARGENTINO?
  // ==========================================
  function esDeEstePais(texto) {
    if (!texto) return false;
    if (esDeOtroPais(texto)) return false;

    const t = String(texto).trim();
    const tUpper = t.toUpperCase();

    if (/IDARG/i.test(t.replace(/\s/g, ''))) return true;
    if (tUpper.indexOf('@ARG@') >= 0) return true;
    if (tUpper.indexOf('ARGENTINA') >= 0) return true;

    const lineas = t.split(/[\n\r]+/);
    for (let i = 0; i < lineas.length; i++) {
      if (/^IDARG/i.test(lineas[i].replace(/\s/g, ''))) return true;
    }

    if (t.indexOf('@') >= 0) {
      const partes = t.split('@').map(function(p) { return p.trim(); });
      if (partes.length >= 7) {
        const nroTramite = partes[0];
        const apellido = partes[1];
        const nombre = partes[2];
        const sexo = partes[3];
        const dni = partes[4];

        const tramiteValido = /^\d{10,14}$/.test(nroTramite);
        const noEsChileno = !/^0{4,}/.test(nroTramite);
        const sexoValido = /^[MF]$/i.test(sexo);
        const dniValido = /^\d{7,8}$/.test(dni);

        if (tramiteValido && noEsChileno && sexoValido && dniValido &&
            esNombreValido(apellido) && esNombreValido(nombre)) {
          return true;
        }
      }
    }

    if (/\bEJEMPLAR\b/i.test(t) && /\b\d{7,8}\b/.test(t)) return true;

    return false;
  }

  // ==========================================
  // PARSER QR DEL NUEVO DNI
  // ==========================================
  function parsearQR(texto) {
    const contenido = String(texto || '').trim().replace(/^\uFEFF/, '');
    if (!contenido) return null;
    if (!esDeEstePais(contenido)) return null;

    const partes = contenido.split('@').map(function(p) { return p.trim(); });
    if (partes.length < 7) return null;

    const nroTramite = partes[0];
    const apellido = partes[1];
    const nombre = partes[2];
    const sexo = partes[3];
    const dni = partes[4];
    const ejemplar = partes[5];
    const fechaNacDMY = partes[6];
    const fechaEmisionDMY = partes[7];
    const resto = partes.slice(8);

    if (!/^\d{7,8}$/.test(dni)) return null;
    if (!/^\d{10,14}$/.test(nroTramite)) return null;
    if (/^0{4,}/.test(nroTramite)) return null;
    if (!/^[MF]$/i.test(sexo)) return null;

    let cuil = null;
    for (let i = 0; i < resto.length; i++) {
      const m = String(resto[i]).match(/^(\d{2})[-\s]?(\d{8})[-\s]?(\d)$/);
      if (m) { cuil = m[1] + '-' + m[2] + '-' + m[3]; break; }
    }

    const fechaNacimiento = fechaDMYtoISO(fechaNacDMY);
    const fechaEmision = fechaDMYtoISO(fechaEmisionDMY);

    return {
      metodo: 'qr',
      raw: contenido,
      dni: dni,
      apellido: apellido || null,
      nombre: nombre || null,
      nombreCompleto: (apellido || '') + ' ' + (nombre || ''),
      sexo: normalizarSexo(sexo),
      fechaNacimiento: fechaNacimiento,
      fechaEmision: fechaEmision,
      fechaVencimiento: null,
      edad: calcularEdad(fechaNacimiento),
      nacionalidad: 'ARGENTINA',
      lugarNacimiento: null,
      domicilio: null,
      tramite: nroTramite || null,
      ejemplar: ejemplar || null,
      cuil: cuil,
      tipoDocumento: 'DNI',
      pais: 'ARG',
      esNuevoDNI: true,
      vigente: null
    };
  }

  // ==========================================
  // PARSER PDF417 (DNI viejo)
  // ==========================================
  function parsearPDF417(texto) {
    const contenido = String(texto || '');
    if (!esDeEstePais(contenido)) return null;

    const partes = contenido.split(/[@\r\n]+/).map(function(p) { return p.trim(); }).filter(Boolean);

    const datos = {
      metodo: 'pdf417',
      raw: contenido,
      dni: null, apellido: null, nombre: null, nombreCompleto: null,
      sexo: null, fechaNacimiento: null, fechaEmision: null, fechaVencimiento: null,
      edad: null, nacionalidad: 'ARGENTINA', lugarNacimiento: null, domicilio: null,
      tramite: null, ejemplar: null, cuil: null,
      tipoDocumento: 'DNI', pais: 'ARG', esNuevoDNI: false, vigente: null
    };

    const fechas = [];

    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i];

      if (!datos.dni && /^\d{7,8}$/.test(parte)) { datos.dni = parte; continue; }
      if (!datos.sexo && /^(M|F|X|MASCULINO|FEMENINO)$/i.test(parte)) {
        datos.sexo = normalizarSexo(parte); continue;
      }
      if (!datos.ejemplar && /^[A-Z]$/i.test(parte) && !/^[MFX]$/i.test(parte)) {
        datos.ejemplar = parte.toUpperCase(); continue;
      }
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(parte)) {
        fechas.push(fechaDMYtoISO(parte)); continue;
      }
      if (!datos.cuil) {
        const mC = parte.match(/^(\d{2})[-\s]?(\d{8})[-\s]?(\d)$/);
        if (mC) { datos.cuil = mC[1] + '-' + mC[2] + '-' + mC[3]; continue; }
      }
      if (!datos.tramite && /^\d{10,14}$/.test(parte) && parte !== datos.dni) {
        datos.tramite = parte; continue;
      }
      if (/^(DNI|LC|LE|CI|PASAPORTE)$/i.test(parte)) {
        datos.tipoDocumento = normalizarTipoDoc(parte); continue;
      }
      if (esNombreValido(parte) && !/^\d+$/.test(parte)) {
        const up = parte.toUpperCase();
        if (/^(ARGENTINA|ARG|REPUBLICA|REPUBLICA|EJEMPLAR|TRAMITE|NACIONALIDAD|MERCOSUR|IDARG|DNI|APELLIDO|NOMBRE)$/.test(up)) continue;
        if (!datos.apellido) datos.apellido = up;
        else if (!datos.nombre) datos.nombre = up;
      }
    }

    if (!datos.dni) {
      const m = contenido.match(/\b(\d{7,8})\b/);
      if (m) datos.dni = m[1];
    }

    if (fechas[0]) datos.fechaNacimiento = fechas[0];
    if (fechas[1]) datos.fechaEmision = fechas[1];
    if (fechas[2]) datos.fechaVencimiento = fechas[2];

    if (datos.apellido || datos.nombre) {
      datos.nombreCompleto = (datos.apellido || '') + ' ' + (datos.nombre || '');
      datos.nombreCompleto = datos.nombreCompleto.trim();
    }

    datos.edad = calcularEdad(datos.fechaNacimiento);
    datos.vigente = estaVigente(datos.fechaVencimiento);

    if (!datos.dni && !datos.apellido && !datos.nombre) return null;
    return datos;
  }

  // ==========================================
  // MRZ
  // ==========================================
  function esMRZ(texto) {
    const limpio = String(texto || '').toUpperCase();
    const tieneID = /ID[A-Z]{3}\d{6,}/.test(limpio.replace(/[\s<]/g, ''));
    const tieneFillers = /<{5,}/.test(limpio);
    return tieneID || (tieneFillers && /\d{6}[0-9<][MF<]/.test(limpio.replace(/\s/g, '')));
  }

  function parsearMRZ(texto) {
    const limpio = String(texto).toUpperCase().replace(/\s/g, '');
    if (limpio.indexOf('IDARG') < 0) return null;

    const lineasLimp = String(texto).split(/[\n\r]+/)
      .map(function(l) { return l.toUpperCase().replace(/[^A-Z0-9<]/g, ''); })
      .filter(function(l) { return l.length >= 20; });

    let lineasMRZ = [];
    if (lineasLimp.length >= 3) {
      lineasMRZ = lineasLimp.slice(0, 3);
    } else {
      const todo = lineasLimp.join('');
      if (todo.length < 60) return null;
      lineasMRZ = [todo.substring(0, 30), todo.substring(30, 60), todo.substring(60, 90) || ''];
    }
    lineasMRZ = lineasMRZ.map(function(l) { return (l + '<'.repeat(30)).substring(0, 30); });

    let l1 = lineasMRZ[0], l2 = lineasMRZ[1], l3 = lineasMRZ[2];

    if (!/^IDARG/.test(l1)) {
      let idx = -1;
      for (let i = 0; i < lineasMRZ.length; i++) {
        if (/^IDARG/.test(lineasMRZ[i])) { idx = i; break; }
      }
      if (idx > 0) {
        l1 = lineasMRZ[idx];
        l2 = lineasMRZ[idx + 1] || '';
        l3 = lineasMRZ[idx + 2] || '';
      }
    }

    const datos = {
      metodo: 'mrz',
      raw: texto,
      dni: l1.substring(5, 14).replace(/</g, '') || null,
      apellido: null, nombre: null, nombreCompleto: null,
      sexo: l2.charAt(7) === 'M' ? 'Masculino' : l2.charAt(7) === 'F' ? 'Femenino' : null,
      fechaNacimiento: fechaYYMMDDtoISO(l2.substring(0, 6)),
      fechaEmision: null,
      fechaVencimiento: fechaYYMMDDtoISO(l2.substring(8, 14)),
      edad: null, nacionalidad: 'ARGENTINA', lugarNacimiento: null, domicilio: null,
      tramite: null, ejemplar: null, cuil: null,
      tipoDocumento: 'DNI', pais: 'ARG',
      esNuevoDNI: true, vigente: null
    };

    const nac = l2.substring(15, 18).replace(/</g, '');
    if (nac && nac !== 'ARG') datos.nacionalidad = nac;

    const l3clean = l3.replace(/<+$/, '');
    const partes = l3clean.split('<<');
    if (partes[0]) datos.apellido = partes[0].replace(/</g, ' ').trim();
    if (partes[1]) datos.nombre = partes[1].replace(/</g, ' ').trim();
    if (datos.apellido || datos.nombre) {
      datos.nombreCompleto = ((datos.apellido || '') + ' ' + (datos.nombre || '')).trim();
    }

    datos.edad = calcularEdad(datos.fechaNacimiento);
    datos.vigente = estaVigente(datos.fechaVencimiento);

    return datos;
  }

  // ==========================================
  // PARSER UNIVERSAL
  // ==========================================
  function parsear(texto) {
    if (!texto) return null;
    if (esDeOtroPais(texto)) return null;

    const porQR = parsearQR(texto);
    if (porQR) return porQR;

    if (esMRZ(texto)) {
      const porMRZ = parsearMRZ(texto);
      if (porMRZ) return porMRZ;
    }

    const porPDF = parsearPDF417(texto);
    if (porPDF) return porPDF;

    return null;
  }

  return {
    parsear: parsear,
    parsearQR: parsearQR,
    parsearPDF417: parsearPDF417,
    parsearMRZ: parsearMRZ,
    esMRZ: esMRZ,
    esDeEstePais: esDeEstePais,
    esDeOtroPais: esDeOtroPais
  };
})();

console.log('✅ parser.js cargado');
