/**
 * Validadores para el DNI argentino
 * Todos los algoritmos son públicos y verificables
 */

const Validators = (() => {

  /**
   * Valida un número de DNI argentino.
   * Rango válido histórico: 1.000.000 - 99.999.999
   * (los DNI bajos ya no se emiten, pero existen)
   */
  function validarDNI(dni) {
    if (!dni) return false;
    const num = parseInt(String(dni).replace(/\D/g, ''), 10);
    if (isNaN(num)) return false;
    return num >= 1000000 && num <= 99999999;
  }

  /**
   * Valida un CUIL/CUIT argentino (formato XX-XXXXXXXX-X)
   * Algoritmo: módulo 11 con pesos [5,4,3,2,7,6,5,4,3,2]
   */
  function validarCUIL(cuil) {
    if (!cuil) return false;
    const limpio = String(cuil).replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(limpio)) return false;

    const prefijosValidos = ['20', '23', '24', '27', '30', '33', '34', '50', '51', '55'];
    const prefijo = limpio.substring(0, 2);
    if (!prefijosValidos.includes(prefijo)) return false;

    const digitos = limpio.split('').map(Number);
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) suma += digitos[i] * pesos[i];

    const resto = suma % 11;
    let verificador;
    if (resto === 0) verificador = 0;
    else if (resto === 1) {
      // Casos especiales: para prefijo 20 → 9, para 27 → 4, para otros → 11 - resto
      if (prefijo === '20') verificador = 9;
      else if (prefijo === '27') verificador = 4;
      else return false;
    } else verificador = 11 - resto;

    return verificador === digitos[10];
  }

  /**
   * Valida una fecha en formato DD/MM/YYYY o YYYY-MM-DD
   */
  function validarFecha(fecha) {
    if (!fecha) return false;
    const m = String(fecha).match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
    if (!m) return false;

    let dia, mes, anio;
    // Detectar formato
    if (m[1].length === 4) { anio = +m[1]; mes = +m[2]; dia = +m[3]; }
    else { dia = +m[1]; mes = +m[2]; anio = +m[3]; if (anio < 100) anio += anio > 30 ? 1900 : 2000; }

    if (mes < 1 || mes > 12) return false;
    if (dia < 1 || dia > 31) return false;

    const d = new Date(anio, mes - 1, dia);
    return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia;
  }

  /**
   * Normaliza una fecha al formato ISO (YYYY-MM-DD)
   */
  function normalizarFecha(fecha) {
    if (!fecha) return null;
    const m = String(fecha).match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
    if (!m) return null;
    let dia, mes, anio;
    if (m[1].length === 4) { anio = +m[1]; mes = +m[2]; dia = +m[3]; }
    else { dia = +m[1]; mes = +m[2]; anio = +m[3]; if (anio < 100) anio += anio > 30 ? 1900 : 2000; }
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  /**
   * Calcula la edad a partir de una fecha de nacimiento
   */
  function calcularEdad(fechaNacimiento) {
    const iso = normalizarFecha(fechaNacimiento);
    if (!iso) return null;
    const nac = new Date(iso);
    const hoy = new Date();
    let edad = hoy.getFullYear() - nac.getFullYear();
    const m = hoy.getMonth() - nac.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
    return edad;
  }

  return {
    validarDNI,
    validarCUIL,
    validarFecha,
    normalizarFecha,
    calcularEdad
  };
})();
