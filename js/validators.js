const Validators = (() => {

  function validarDNI(dni) {
    if (!dni) return false;
    const num = parseInt(String(dni).replace(/\D/g, ''), 10);
    return !isNaN(num) && num >= 1000000 && num <= 99999999;
  }

  function validarCUIL(cuil) {
    if (!cuil) return false;
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

  function normalizarFecha(fecha) {
    if (!fecha) return null;
    const m = String(fecha).match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
    if (!m) return null;
    let dia, mes, anio;
    if (m[1].length === 4) { anio = +m[1]; mes = +m[2]; dia = +m[3]; }
    else { dia = +m[1]; mes = +m[2]; anio = +m[3]; if (anio < 100) anio += anio > 30 ? 1900 : 2000; }
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
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

  return { validarDNI, validarCUIL, normalizarFecha, calcularEdad };
})();

console.log('✅ validators.js cargado');
