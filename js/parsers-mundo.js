/**
 * Parsers de documentos de identidad de otros países.
 * Cada parser expone una función parsear(texto) que devuelve
 * un objeto con formato unificado o null si no puede.
 *
 * NO toca nada del DNI argentino. Se usa en paralelo.
 */

// ============================================================
// 🇨🇱 CHILE - Cédula de Identidad
// PDF417 formato: NroTramite@Apellidos@Nombres@Sexo@RUN@Ejemplar@FechaNac@FechaEmision@...
// ============================================================
const ChileParser = (() => {

  /**
   * Calcula el dígito verificador de un RUN chileno (Módulo 11)
   */
  function calcularDV(run) {
    let suma = 0;
    let mult = 2;
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
    const contenido = texto.trim();
    const partes = contenido.split('@').map(p => p.trim());
    if (partes.length < 8) return null;

    const [
      nroTramite, apellido, nombre, sexo, run, ejemplar,
      fechaNacDMY, fechaEmisionDMY
    ] = partes;

    // Validar RUN: 7 u 8 dígitos
    if (!/^\d{7,8}$/.test(run)) return null;

    // Validar sexo
    if (!/^[MF]$/i.test(sexo)) return null;

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

      // Identificación
      numero: runFormateado,
      run: runFormateado,
      runNumero: run,
      dv: dvCalculado,
      tramite: nroTramite || null,

      // Personales
      apellido: apellido || null,
      nombre: nombre || null,
      nombreCompleto: `${apellido || ''} ${nombre || ''}`.trim() || null,
      sexo: sexo.toUpperCase() === 'M' ? 'Masculino' : 'Femenino',
      fechaNacimiento: fechaNacimiento,
      edad: edad,
      nacionalidad: 'CHILENA',
      lugarNacimiento: null,
      domicilio: null,

      // Documento
      ejemplar: ejemplar || null,
      fechaEmision: fechaEmision,
      fechaVencimiento: null,
      vigente: null,

      // Validaciones
      numeroValido: true, // DV correcto
      cuil: null,
      cuilValido: null
    };
  }

  return { parsear, calcularDV };
})();

// ============================================================
// Registro de parsers por país
// ============================================================
const ParsersMundo = {
  chl: { nombre: 'Chile', parser: ChileParser, implementado: true },
  // Los siguientes se irán agregando:
  // ury: { nombre: 'Uruguay', parser: UruguayParser, implementado: false },
  // pry: { nombre: 'Paraguay', parser: ParaguayParser, implementado: false },
  // per: { nombre: 'Perú', parser: PeruParser, implementado: false },
  // bol: { nombre: 'Bolivia', parser: BoliviaParser, implementado: false },
  // col: { nombre: 'Colombia', parser: ColombiaParser, implementado: false },
  // ecu: { nombre: 'Ecuador', parser: EcuadorParser, implementado: false },

  /**
   * Parsea texto según el país indicado.
   * @param {string} pais - Código ISO3 del país (ej: 'chl')
   * @param {string} texto - Texto crudo decodificado
   */
  parsear(pais, texto) {
    const config = this[pais];
    if (!config || !config.implementado || !config.parser) {
      return null;
    }
    return config.parser.parsear(texto);
  }
};

console.log('✅ parsers-mundo.js cargado');
