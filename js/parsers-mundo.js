/**
 * Parsers de documentos de identidad de otros países.
 * Cada parser valida ESTRICTAMENTE si el texto pertenece a su país.
 * Si no lo reconoce, devuelve null.
 */

// ============================================================
// 🇨🇱 CHILE - Cédula de Identidad
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

  function fechaDMYtoISO(fechaStr) {
    if (!fechaStr) return null;
    const m = String(fechaStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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
    const fechaNacimiento = fechaDMYtoISO(fechaNacDMY);
    const fechaEmision = fechaDMYtoISO(fechaEmisionDMY);
    const edad = calcularEdad(fechaNacimiento);

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
// 🇺🇾 URUGUAY - Cédula de Identidad (MRZ, formato TD1)
// ============================================================
const UruguayParser = (() => {

  function esDeEstePais(texto) {
    const t = String(texto || '').toUpperCase().replace(/\s/g, '');
    return /IDURY/.test(t);
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

  function formatearCI(ci, dv) {
    const base = String(ci).replace(/\D/g, '');
    return base.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  }

  function yymmddToISO(yymmdd) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${yymmdd.substring(2, 4)}-${yymmdd.substring(4, 6)}`;
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

  function parsear(texto) {
    if (!texto || typeof texto !== 'string') return null;
    if (!esDeEstePais(texto)) return null;

    const limpio = texto.toUpperCase().replace(/[^A-Z0-9<]/g, '');
    if (limpio.length < 60) return null;

    const lineas = [
      limpio.substring(0, 30),
      limpio.substring(30, 60),
      limpio.substring(60, 90)
    ];

    if (!/^IDURY/.test(lineas[0])) return null;

    const l1 = lineas[0];
    const l2 = lineas[1];
    const l3 = lineas[2];

    const numDocRaw = l1.substring(5, 14).replace(/</g, '');
    if (!/^\d{7,8}$/.test(numDocRaw)) return null;

    const ciBase = numDocRaw.slice(0, -1);
    const dvLeido = numDocRaw.slice(-1);
    const dvCalculado = calcularDV(ciBase);
    const ciFormateado = formatearCI(ciBase, dvCalculado);

    const fechaNacRaw = l2.substring(0, 6);
    const sexoRaw = l2.charAt(7);
    const fechaVencRaw = l2.substring(8, 14);
    const nacionalidad = l2.substring(15, 18).replace(/</g, '');

    const fechaNacimiento = yymmddToISO(fechaNacRaw);
    const fechaVencimiento = yymmddToISO(fechaVencRaw);
    const edad = calcularEdad(fechaNacimiento);

    const l3clean = l3.replace(/<+$/, '');
    const partes = l3clean.split('<<');
    const apellidos = partes[0] ? partes[0].replace(/</g, ' ').trim() : null;
    const nombres = partes[1] ? partes[1].replace(/</g, ' ').trim() : null;
    const nombreCompleto = `${apellidos || ''} ${nombres || ''}`.trim() || null;

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

      apellido: apellidos,
      nombre: nombres,
      nombreCompleto: nombreCompleto,
      sexo: sexoRaw === 'M' ? 'Masculino' : sexoRaw === 'F' ? 'Femenino' : (sexoRaw === '<' ? 'No especificado' : sexoRaw),
      fechaNacimiento: fechaNacimiento,
      edad: edad,
      nacionalidad: nacionalidad === 'URY' ? 'URUGUAYA' : nacionalidad,
      lugarNacimiento: null,
      domicilio: null,

      ejemplar: null,
      fechaEmision: null,
      fechaVencimiento: fechaVencimiento,
      vigente: fechaVencimiento ? new Date(fechaVencimiento) > new Date() : null,

      numeroValido: dvCalculado === dvLeido,
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, calcularDV, esDeEstePais };
})();

// ============================================================
// Registro de parsers por país
// ============================================================
const ParsersMundo = {
  chl: { nombre: 'Chile', parser: ChileParser, implementado: true },
  ury: { nombre: 'Uruguay', parser: UruguayParser, implementado: true },

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

console.log('✅ parsers-mundo.js cargado');
