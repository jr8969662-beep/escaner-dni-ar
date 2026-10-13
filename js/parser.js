/**
 * Parser DNI argentino - Extracción completa
 * Soporta: QR nuevo DNI, PDF417 viejo, MRZ del dorso
 */

const DNIParser = (() => {

  // ==========================================
  // HELPERS COMUNES
  // ==========================================
  function fechaDMYtoISO(fechaStr) {
    if (!fechaStr) return null;
    const limpio = String(fechaStr).trim();
    const m = limpio.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return null;
    let [, dd, mm, aa] = m;
    let anio = aa;
    if (aa.length === 2) anio = parseInt(aa) > 50 ? '19' + aa : '20' + aa;
    return `${anio}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  function fechaYYMMDDtoISO(s) {
    if (!/^\d{6}$/.test(s)) return null;
    const yy = parseInt(s.substring(0, 2), 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${s.substring(2, 4)}-${s.substring(4, 6)}`;
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

  // ==========================================
  // DETECCIÓN DE PAÍS - ¿ES ARGENTINO?
  // ==========================================
  function esDeEstePais(texto) {
    if (!texto) return false;
    const t = String(texto).trim();

    // 🚫 Señales fuertes de OTROS países → NO es argentino
    if (/IDURY|IDPRY|IDPER|IDBOL|IDCOL|IDECU|IDCHL/i.test(t)) return false;

    // 🚫 Chile: nro trámite con muchos ceros al inicio
    if (/^0{4,}\d+@/.test(t)) return false;

    // ✅ Señales explícitas argentinas
    if (/IDARG/i.test(t.replace(/\s/g, ''))) return true;
    if (/@ARG@|\bARGENTINA\b/.test(t)) return true;

    // ✅ MRZ argentina: empieza con IDARG
    if (/^IDARG/i.test(t.replace(/\s/g, '').substring(0, 6))) return true;

    // ✅ QR nuevo del DNI argentino
    const partes = t.split('@').map(p => p.trim());
    if (partes.length >= 7) {
      const [nroTramite, apellido, nombre, sexo, dni] = partes;
      // Nro trámite argentino: 10-14 dígitos, NO empieza con 5+ ceros
      if (/^\d{10,14}$/.test(nroTramite) &&
          !/^0{4,}/.test(nroTramite) &&
          /^[MF]$/i.test(sexo) &&
          /^\d{7,8}$/.test(dni)) {
        return true;
      }
    }

    // ✅ PDF417 viejo argentino: señales típicas
    if (/EJEMPLAR|TRAMITE|TRÁMITE/i.test(t) && /\b\d{7,8}\b/.test(t)) {
      return true;
    }

    return false;
  }

  // ==========================================
  // PARSER QR DEL NUEVO DNI
  // ==========================================
  function parsearQR(texto) {
    const contenido = String(texto || '').trim().replace(/^\uFEFF/, '');
    if (!contenido) return null;

    // 🚫 Rechazar si es de otro país
    if (!esDeEstePais(contenido)) return null;

    const partes = contenido.split('@').map(p => p.trim());
    if (partes.length < 7) return null;

    const [
      nroTramite, apellido, nombre, sexo, dni, ejemplar,
      fechaNacDMY, fechaEmisionDMY, ...resto
    ] = partes;

    if (!/^\d{7,8}$/.test(dni)) return null;
    if (!/^\d{10,14}$/.test(nroTramite)) return null;
    if (/^0{4,}/.test(nroTramite)) return null;
    if (!/^[MF]$/i.test(sexo)) return null;

    let cuil = null;
    for (const campo of resto) {
      const m = String(campo).match(/^(\d{2})[-\s]?(\d{8})[-\s]?(\d)$/);
      if (m) { cuil = `${m[1]}-${m[2]}-${m[3]}`; break; }
    }

    const fechaNacimiento = fechaDMYtoISO(fechaNacDMY);
    const fechaEmision = fechaDMYtoISO(fechaEmisionDMY);

    return {
      metodo: 'qr',
      raw: contenido,
      dni: dni,
      apellido: apellido || null,
      nombre: nombre || null,
      nombreCompleto: `${apellido || ''} ${nombre || ''}`.trim() || null,
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

    // 🚫 Rechazar si es de otro país
    if (!esDeEstePais(contenido)) return null;

    const partes = contenido.split(/[@\r\n]+/).map(p => p.trim()).filter(Boolean);

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

    for (const parte of partes) {
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
        if (mC) { datos.cuil = `${mC[1]}-${mC[2]}-${mC[3]}`; continue; }
      }
      if (!datos.tramite && /^\d{10,14}$/.test(parte) && parte !== datos.dni) {
        datos.tramite = parte; continue;
      }
      if (/^(DNI|LC|LE|CI|PASAPORTE)$/i.test(parte)) {
        datos.tipoDocumento = normalizarTipoDoc(parte); continue;
      }
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s]{3,}$/.test(parte) &&
          !/^(ARGENTINA|ARG|REPUBLICA|REPÚBLICA|EJEMPLAR|TRAMITE|TRÁMITE|NACIONALIDAD|MERCOSUR|IDARG|DNI|APELLIDO|NOMBRE)$/i.test(parte)) {
        const up = parte.toUpperCase().trim();
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
      datos.nombreCompleto = `${datos.apellido || ''} ${datos.nombre || ''}`.trim();
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
    // 🚫 Solo aceptar MRZ argentina
    if (!/IDARG/i.test(String(texto).replace(/\s/g, ''))) return null;

    const lineasLimp = String(texto).split(/[\n\r]+/)
      .map(l => l.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
      .filter(l => l.length >= 20);

    let lineasMRZ = [];
    if (lineasLimp.length >= 3) {
      lineasMRZ = lineasLimp.slice(0, 3);
    } else {
      const todo = lineasLimp.join('');
      if (todo.length < 60) return null;
      lineasMRZ = [todo.substring(0, 30), todo.substring(30, 60), todo.substring(60, 90) || ''];
    }
    lineasMRZ = lineasMRZ.map(l => (l + '<'.repeat(30)).substring(0, 30));

    let [l1, l2, l3] = lineasMRZ;
    if (!/^IDARG/.test(l1)) {
      const idx = lineasMRZ.findIndex(l => /^IDARG/.test(l));
      if (idx > 0) {
        [l1, l2, l3] = [lineasMRZ[idx], lineasMRZ[idx + 1] || '', lineasMRZ[idx + 2] || ''];
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
      datos.nombreCompleto = `${datos.apellido || ''} ${datos.nombre || ''}`.trim();
    }

    datos.edad = calcularEdad(datos.fechaNacimiento);
    datos.vigente = estaVigente(datos.fechaVencimiento);

    return datos;
  }

  function parsear(texto) {
    if (!texto) return null;

    // 🚫 Rechazar si es de otro país conocido
    if (/IDURY|IDPRY|IDPER|IDBOL|IDCOL|IDECU|IDCHL/i.test(texto)) return null;
    if (/^0{4,}\d+@/.test(texto.trim())) return null;

    // 1. QR
    const porQR = parsearQR(texto);
    if (porQR) return porQR;

    // 2. MRZ argentina
    if (esMRZ(texto) && /IDARG/i.test(texto.replace(/\s/g, ''))) {
      const porMRZ = parsearMRZ(texto);
      if (porMRZ) return porMRZ;
    }

    // 3. PDF417 argentino
    const porPDF = parsearPDF417(texto);
    if (porPDF) return porPDF;

    return null;
  }

  return {
    parsear,
    parsearQR,
    parsearPDF417,
    parsearMRZ,
    esMRZ,
    esDeEstePais
  };
})();

console.log('✅ parser.js cargado');
