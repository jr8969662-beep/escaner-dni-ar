/**
 * Parsers de documentos de identidad de países sudamericanos.
 * Cada parser valida ESTRICTAMENTE si el texto pertenece a su país.
 * Si no lo reconoce, devuelve null.
 *
 * El DNI argentino está en js/parser.js (por separado, ya funcionando).
 */

// ============================================================
// HELPERS COMPARTIDOS
// ============================================================
const ParserHelpers = (() => {

  function yymmddToISO(yymmdd) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${yymmdd.substring(2, 4)}-${yymmdd.substring(4, 6)}`;
  }

  function ddmmyyyyToISO(fecha) {
    if (!fecha) return null;
    const m = String(fecha).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
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

  function formatearConPuntos(numero) {
    return String(numero).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function estaVigente(fechaISO) {
    if (!fechaISO) return null;
    const venc = new Date(fechaISO);
    if (isNaN(venc)) return null;
    return venc > new Date();
  }

  /**
   * Extrae las 3 líneas MRZ (30 chars cada una) de un texto.
   * Devuelve un array o null.
   */
  function extraerMRZ(texto, prefijo) {
    const limpio = texto.toUpperCase().replace(/[^A-Z0-9<]/g, '');
    if (limpio.length < 60) return null;

    // Buscar la posición del prefijo (IDXXX)
    const idx = limpio.indexOf(prefijo);
    if (idx < 0) return null;

    // Extraer desde ahí, en bloques de 30
    const desdeAqui = limpio.substring(idx);
    if (desdeAqui.length < 60) return null;

    const l1 = (desdeAqui.substring(0, 30) + '<'.repeat(30)).substring(0, 30);
    const l2 = (desdeAqui.substring(30, 60) + '<'.repeat(30)).substring(0, 30);
    const l3 = (desdeAqui.substring(60, 90) + '<'.repeat(30)).substring(0, 30);

    return [l1, l2, l3];
  }

  /**
   * Parser MRZ estándar (formato TD1 - 3 líneas de 30 caracteres).
   * Devuelve los campos comunes que aplican a casi todos los países.
   */
  function parsearMRZBasico(texto, prefijoPais, codigoPais) {
    const lineas = extraerMRZ(texto, prefijoPais);
    if (!lineas) return null;

    const [l1, l2, l3] = lineas;

    // Línea 1: número de documento
    const numDocRaw = l1.substring(5, 14).replace(/</g, '');
    if (!/^\d{6,10}[A-Z]?$/.test(numDocRaw) && !/^\d{6,10}$/.test(numDocRaw)) return null;

    // Línea 2: fechas + sexo + nacionalidad
    const fechaNacRaw = l2.substring(0, 6);
    const sexoRaw = l2.charAt(7);
    const fechaVencRaw = l2.substring(8, 14);
    const nacionalidad = l2.substring(15, 18).replace(/</g, '');

    // Línea 3: apellidos << nombres
    const l3clean = l3.replace(/<+$/, '');
    const partes = l3clean.split('<<');
    const apellidos = partes[0] ? partes[0].replace(/</g, ' ').trim() : null;
    const nombres = partes[1] ? partes[1].replace(/</g, ' ').trim() : null;
    const nombreCompleto = `${apellidos || ''} ${nombres || ''}`.trim() || null;

    return {
      numDocRaw,
      fechaNacimiento: yymmddToISO(fechaNacRaw),
      fechaVencimiento: yymmddToISO(fechaVencRaw),
      sexo: sexoRaw === 'M' ? 'Masculino' : sexoRaw === 'F' ? 'Femenino' : (sexoRaw === '<' ? 'No especificado' : sexoRaw),
      nacionalidad,
      apellidos,
      nombres,
      nombreCompleto,
      codigoPais,
      lineas
    };
  }

  return {
    yymmddToISO,
    ddmmyyyyToISO,
    calcularEdad,
    formatearConPuntos,
    estaVigente,
    extraerMRZ,
    parsearMRZBasico
  };
})();


// ============================================================
// 🇨🇱 CHILE - Cédula de Identidad (PDF417)
// PDF417: NroTramite@Apellidos@Nombres@Sexo@RUN@Ejemplar@FechaNac@FechaEmision@...
// ============================================================
const ChileParser = (() => {

  function esDeEstePais(texto) {
    const t = String(texto || '').trim();
    if (/^0{4,}\d+@/.test(t)) return true;
    if (/@CHL@/.test(t)) return true;
    if (/IDCHL/i.test(t.replace(/\s/g, ''))) return true;
    return false;
  }

  function calcularDV(run) {
    let suma = 0, mult = 2;
    for (let i = run.length - 1; i >= 0; i--) {
      suma += parseInt(run.charAt(i), 10) * mult;
      mult = mult === 7 ? 2 : mult + 1;
    }
    const resto = suma % 11;
    const dv = 11 - resto;
    if (dv === 11) return '0';
    if (dv === 10) return 'K';
    return dv.toString();
  }

  function formatearRUN(run, dv) {
    const limpio = String(run).replace(/\D/g, '');
    return limpio.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const contenido = texto.trim();
    const partes = contenido.split('@').map(p => p.trim());
    if (partes.length < 8) return null;

    const [
      nroTramite, apellido, nombre, sexo, run, ejemplar,
      fechaNacDMY, fechaEmisionDMY
    ] = partes;

    if (!/^\d{7,8}$/.test(run)) return null;
    if (!/^[MF]$/i.test(sexo)) return null;
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(fechaNacDMY)) return null;

    const dvCalculado = calcularDV(run);
    const runFormateado = formatearRUN(run, dvCalculado);
    const fechaNacimiento = ParserHelpers.ddmmyyyyToISO(fechaNacDMY);
    const fechaEmision = ParserHelpers.ddmmyyyyToISO(fechaEmisionDMY);
    const edad = ParserHelpers.calcularEdad(fechaNacimiento);

    return {
      pais: 'CHL',
      paisNombre: 'Chile',
      tipoDocumento: 'Cédula de Identidad',
      metodo: 'pdf417',
      raw: contenido,

      numero: runFormateado,
      run: runFormateado,
      runNumero: run,
      dv: dvCalculado,
      tramite: nroTramite || null,

      apellido: apellido || null,
      nombre: nombre || null,
      nombreCompleto: `${apellido || ''} ${nombre || ''}`.trim() || null,
      sexo: sexo.toUpperCase() === 'M' ? 'Masculino' : 'Femenino',
      fechaNacimiento: fechaNacimiento,
      edad: edad,
      nacionalidad: 'CHILENA',
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: ejemplar || null,
      fechaEmision: fechaEmision,
      fechaVencimiento: null,
      vigente: null,

      numeroValido: true,
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, calcularDV, esDeEstePais };
})();


// ============================================================
// 🇺🇾 URUGUAY - Cédula de Identidad (MRZ TD1)
// ============================================================
const UruguayParser = (() => {

  function esDeEstePais(texto) {
    return /IDURY/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function calcularDV(ci) {
    const pesos = [2, 9, 8, 7, 6, 3, 4];
    const ciPadded = String(ci).padStart(7, '0');
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      suma += parseInt(ciPadded.charAt(i), 10) * pesos[i];
    }
    return ((10 - (suma % 10)) % 10).toString();
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDURY', 'URY');
    if (!mrz) return null;

    const ciBase = mrz.numDocRaw.slice(0, -1);
    const dvLeido = mrz.numDocRaw.slice(-1);
    const dvCalculado = calcularDV(ciBase);
    const ciFormateado = ParserHelpers.formatearConPuntos(ciBase) + '-' + dvCalculado;

    return {
      pais: 'URY',
      paisNombre: 'Uruguay',
      tipoDocumento: 'Cédula de Identidad',
      metodo: 'mrz',
      raw: texto,

      numero: ciFormateado,
      ci: ciFormateado,
      ciBase: ciBase,
      dv: dvCalculado,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'URY' ? 'URUGUAYA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: dvCalculado === dvLeido,
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, calcularDV, esDeEstePais };
})();


// ============================================================
// 🇵🇾 PARAGUAY - Cédula de Identidad Civil (MRZ TD1)
// ============================================================
const ParaguayParser = (() => {

  function esDeEstePais(texto) {
    return /IDPRY/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function calcularDV(ci) {
    const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
    const ciPadded = String(ci).padStart(8, '0');
    let suma = 0;
    for (let i = 0; i < 8; i++) {
      const digito = parseInt(ciPadded.charAt(7 - i), 10);
      suma += digito * pesos[i];
    }
    const resto = suma % 11;
    const dv = 11 - resto;
    if (dv === 11) return '0';
    if (dv === 10) return '1';
    return dv.toString();
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDPRY', 'PRY');
    if (!mrz) return null;

    const ciBase = mrz.numDocRaw.slice(0, -1);
    const dvLeido = mrz.numDocRaw.slice(-1);
    const dvCalculado = calcularDV(ciBase);
    const ciFormateado = ParserHelpers.formatearConPuntos(ciBase) + '-' + dvCalculado;

    return {
      pais: 'PRY',
      paisNombre: 'Paraguay',
      tipoDocumento: 'Cédula de Identidad Civil',
      metodo: 'mrz',
      raw: texto,

      numero: ciFormateado,
      ci: ciFormateado,
      ciBase: ciBase,
      dv: dvCalculado,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'PRY' ? 'PARAGUAYA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: dvCalculado === dvLeido,
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, calcularDV, esDeEstePais };
})();


// ============================================================
// 🇵🇪 PERÚ - DNI Electrónico (MRZ TD1)
// ============================================================
const PeruParser = (() => {

  function esDeEstePais(texto) {
    return /IDPER/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDPER', 'PER');
    if (!mrz) return null;

    const dniFormateado = mrz.numDocRaw; // Perú: 8 dígitos sin DV en la MRZ

    return {
      pais: 'PER',
      paisNombre: 'Perú',
      tipoDocumento: 'DNI Electrónico',
      metodo: 'mrz',
      raw: texto,

      numero: dniFormateado,
      dni: dniFormateado,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'PER' ? 'PERUANA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: /^\d{8}$/.test(mrz.numDocRaw),
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// 🇧🇴 BOLIVIA - Cédula de Identidad (MRZ TD1)
// ============================================================
const BoliviaParser = (() => {

  function esDeEstePais(texto) {
    return /IDBOL/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDBOL', 'BOL');
    if (!mrz) return null;

    return {
      pais: 'BOL',
      paisNombre: 'Bolivia',
      tipoDocumento: 'Cédula de Identidad',
      metodo: 'mrz',
      raw: texto,

      numero: mrz.numDocRaw,
      ci: mrz.numDocRaw,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'BOL' ? 'BOLIVIANA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: /^\d{6,8}$/.test(mrz.numDocRaw),
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// 🇨🇴 COLOMBIA - Cédula de Ciudadanía (MRZ TD1)
// Nota: Colombia tiene PDF417 binario en algunos modelos; usamos MRZ como fallback
// ============================================================
const ColombiaParser = (() => {

  function esDeEstePais(texto) {
    return /IDCOL/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDCOL', 'COL');
    if (!mrz) return null;

    return {
      pais: 'COL',
      paisNombre: 'Colombia',
      tipoDocumento: 'Cédula de Ciudadanía',
      metodo: 'mrz',
      raw: texto,

      numero: mrz.numDocRaw,
      cc: mrz.numDocRaw,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'COL' ? 'COLOMBIANA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: /^\d{6,10}$/.test(mrz.numDocRaw),
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// 🇪🇨 ECUADOR - Cédula de Ciudadanía (MRZ TD1)
// ============================================================
const EcuadorParser = (() => {

  function esDeEstePais(texto) {
    return /IDECU/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDECU', 'ECU');
    if (!mrz) return null;

    return {
      pais: 'ECU',
      paisNombre: 'Ecuador',
      tipoDocumento: 'Cédula de Ciudadanía',
      metodo: 'mrz',
      raw: texto,

      numero: mrz.numDocRaw,
      ci: mrz.numDocRaw,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'ECU' ? 'ECUATORIANA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: /^\d{10}$/.test(mrz.numDocRaw),
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// 🇻🇪 VENEZUELA - Cédula de Identidad (MRZ TD1)
// ============================================================
const VenezuelaParser = (() => {

  function esDeEstePais(texto) {
    return /IDVEN/i.test(String(texto || '').replace(/\s/g, ''));
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const mrz = ParserHelpers.parsearMRZBasico(texto, 'IDVEN', 'VEN');
    if (!mrz) return null;

    return {
      pais: 'VEN',
      paisNombre: 'Venezuela',
      tipoDocumento: 'Cédula de Identidad',
      metodo: 'mrz',
      raw: texto,

      numero: mrz.numDocRaw,
      ci: mrz.numDocRaw,
      tramite: null,

      apellido: mrz.apellidos,
      nombre: mrz.nombres,
      nombreCompleto: mrz.nombreCompleto,
      sexo: mrz.sexo,
      fechaNacimiento: mrz.fechaNacimiento,
      edad: ParserHelpers.calcularEdad(mrz.fechaNacimiento),
      nacionalidad: mrz.nacionalidad === 'VEN' ? 'VENEZOLANA' : mrz.nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: mrz.fechaVencimiento,
      vigente: ParserHelpers.estaVigente(mrz.fechaVencimiento),

      numeroValido: /^\d{6,9}$/.test(mrz.numDocRaw),
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// 🇧🇷 BRASIL - Pasaporte (MRZ TD3) y RG (varía por estado)
// Nota: el RG brasileño varía mucho entre estados, solo detectamos pasaporte por MRZ.
// ============================================================
const BrasilParser = (() => {

  function esDeEstePais(texto) {
    const t = String(texto || '').replace(/\s/g, '').toUpperCase();
    // Pasaporte brasileño: MRZ empieza con BR + número
    if (/^BR\d{8,}/.test(t)) return true;
    if (/IDBRA/i.test(t)) return true;
    return false;
  }

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    // Intentar MRZ de pasaporte (formato TD3: 2 líneas de 44 chars)
    const limpio = texto.toUpperCase().replace(/[^A-Z0-9<]/g, '');

    // Formato TD3 del pasaporte: "P<BRA..." seguido de 2 líneas de 44
    const matchPasaporte = limpio.match(/P<BRA(.{0,88})/);
    if (matchPasaporte) {
      // Parsear solo la línea de datos (segunda línea de 44 chars)
      const resto = matchPasaporte[1];
      if (resto.length >= 88) {
        const l1 = resto.substring(0, 44);
        const l2 = resto.substring(44, 88);

        const numPasaporte = l1.substring(0, 9).replace(/</g, '');
        const nacionalidad = l1.substring(10, 13).replace(/</g, '');
        const fechaNacRaw = l1.substring(13, 19);
        const sexoRaw = l1.charAt(20);
        const fechaVencRaw = l1.substring(21, 27);

        // Línea 2: APELLIDO<<NOMBRE
        const l2clean = l2.replace(/<+$/, '');
        const partes = l2clean.split('<<');
        const apellidos = partes[0] ? partes[0].replace(/</g, ' ').trim() : null;
        const nombres = partes[1] ? partes[1].replace(/</g, ' ').trim() : null;
        const nombreCompleto = `${apellidos || ''} ${nombres || ''}`.trim() || null;

        return {
          pais: 'BRA',
          paisNombre: 'Brasil',
          tipoDocumento: 'Pasaporte',
          metodo: 'mrz',
          raw: texto,

          numero: numPasaporte,
          pasaporte: numPasaporte,
          tramite: null,

          apellido: apellidos,
          nombre: nombres,
          nombreCompleto: nombreCompleto,
          sexo: sexoRaw === 'M' ? 'Masculino' : sexoRaw === 'F' ? 'Femenino' : sexoRaw,
          fechaNacimiento: ParserHelpers.yymmddToISO(fechaNacRaw),
          edad: ParserHelpers.calcularEdad(ParserHelpers.yymmddToISO(fechaNacRaw)),
          nacionalidad: nacionalidad === 'BRA' ? 'BRASILEÑA' : nacionalidad,
          lugarNacimiento: null,
          domicilio: null,

          ejemplar: null,
          fechaEmision: null,
          fechaVencimiento: ParserHelpers.yymmddToISO(fechaVencRaw),
          vigente: ParserHelpers.estaVigente(ParserHelpers.yymmddToISO(fechaVencRaw)),

          numeroValido: true,
          cuil: null,
          cuilValido: null
        };
      }
    }

    // RG brasileño no tiene formato estandarizado, devolvemos null
    return null;
  }

  return { parsear, esDeEstePais };
})();


// ============================================================
// REGISTRO DE PARSERS
// ============================================================
const ParsersMundo = {
  chl: { nombre: 'Chile', parser: ChileParser, implementado: true },
  ury: { nombre: 'Uruguay', parser: UruguayParser, implementado: true },
  pry: { nombre: 'Paraguay', parser: ParaguayParser, implementado: true },
  per: { nombre: 'Perú', parser: PeruParser, implementado: true },
  bol: { nombre: 'Bolivia', parser: BoliviaParser, implementado: true },
  col: { nombre: 'Colombia', parser: ColombiaParser, implementado: true },
  ecu: { nombre: 'Ecuador', parser: EcuadorParser, implementado: true },
  ven: { nombre: 'Venezuela', parser: VenezuelaParser, implementado: true },
  bra: { nombre: 'Brasil', parser: BrasilParser, implementado: true },

  parsear(pais, texto) {
    const config = this[pais];
    if (!config || !config.implementado || !config.parser) return null;
    return config.parser.parsear(texto);
  },

  detectarPais(texto) {
    if (!texto) return null;
    for (const [codigo, config] of Object.entries(this)) {
      if (config.implementado && config.parser && config.parser.esDeEstePais) {
        if (config.parser.esDeEstePais(texto)) return codigo;
      }
    }
    return null;
  }
};

console.log('✅ parsers-mundo.js cargado con ' + Object.keys(ParsersMundo).filter(k => ParsersMundo[k].implementado).length + ' países');
