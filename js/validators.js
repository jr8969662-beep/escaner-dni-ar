const Validators = (() => {
  function validarDNI(dni) {
    if (!dni) return false;
    const num = parseInt(String(dni).replace(/\D/g, ''), 10);
    return !isNaN(num) && num >= 1000000 && num <= 99999999;
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
    const hoy = new Date();
    let edad = hoy.getFullYear() - nac.getFullYear();
    const m = hoy.getMonth() - nac.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
    return edad;
  }
  return { validarDNI, normalizarFecha, calcularEdad };
})();
