/**
 * Extensión de DNIParser para el DNI argentino NUEVO (policarbonato, 2026).
 * Se carga DESPUÉS de parser.js y ANTES de main.js: no hace falta editar parser.js.
 * El QR del DNI nuevo no trae sexo:  trámite@APELLIDO@NOMBRES@DNI@EJEMPLAR@nac@emisión@firma
 */
(function () {
  'use strict';
  if (typeof DNIParser === 'undefined') return;

  const NOMBRE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ '\-.]{0,60}$/i;

  function trozos(texto) {
    if (!texto || String(texto).indexOf('@') < 0) return null;
    return String(texto).trim().split('@').map(function (x) { return x.trim(); });
  }

  function esFormatoQRNuevo(texto) {
    const p = trozos(texto);
    return !!p && p.length >= 7 && /^\d{8,14}$/.test(p[0]) && !/^0{4,}/.test(p[0]) &&
      NOMBRE.test(p[1]) && NOMBRE.test(p[2]) && /^\d{7,8}$/.test(p[3]) &&
      /^[A-Z]$/i.test(p[4]) && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(p[5]);
  }

  function aISO(s) {
    const m = String(s || '').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return null;
    let y = parseInt(m[3], 10);
    if (m[3].length === 2) y = (2000 + y > new Date().getFullYear()) ? 1900 + y : 2000 + y;
    return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }

  function edadDe(iso) {
    const a = iso.split('-').map(Number), h = new Date();
    return h.getFullYear() - a[0] - ((h.getMonth() + 1 < a[1] || (h.getMonth() + 1 === a[1] && h.getDate() < a[2])) ? 1 : 0);
  }

  function parsearQRNuevo(texto) {
    const p = trozos(texto);
    const nac = aISO(p[5]);
    if (!nac) return null;
    return {
      metodo: 'qr', formatoQR: 'nuevo', raw: texto,
      dni: p[3], apellido: p[1].toUpperCase(), nombre: p[2].toUpperCase(),
      nombreCompleto: (p[1] + ' ' + p[2]).toUpperCase(),
      sexo: null, fechaNacimiento: nac, fechaEmision: aISO(p[6]), fechaVencimiento: null,
      edad: edadDe(nac), nacionalidad: 'ARGENTINA', lugarNacimiento: null, domicilio: null,
      tramite: p[0], ejemplar: p[4].toUpperCase(), cuil: null,
      tipoDocumento: 'DNI', pais: 'ARG', paisNombre: 'Argentina', esNuevoDNI: true, vigente: null,
      numeroValido: true, conFirma: p.slice(7).join('@').length > 100
    };
  }

  // Un vencimiento nunca es 19xx: el corte "yy > 30" de las MRZ lo interpretaba mal (2041 -> 1941)
  function arreglarVencimiento(r) {
    if (r && typeof r.fechaVencimiento === 'string' && /^19\d\d-/.test(r.fechaVencimiento)) {
      r.fechaVencimiento = '20' + r.fechaVencimiento.slice(2);
      r.vigente = new Date(r.fechaVencimiento + 'T23:59:59') >= new Date();
    }
    return r;
  }

  const original = {};
  ['parsear', 'parsearQR', 'esDeEstePais'].forEach(function (k) { original[k] = DNIParser[k]; });

  function envolver(nombre, fn) {
    try { DNIParser[nombre] = fn; } catch (e) { /* objeto congelado: no se puede */ }
  }

  envolver('esDeEstePais', function (texto) {
    return esFormatoQRNuevo(texto) || (original.esDeEstePais ? original.esDeEstePais.apply(this, arguments) : false);
  });
  envolver('parsearQR', function (texto) {
    if (esFormatoQRNuevo(texto)) return parsearQRNuevo(texto);
    return original.parsearQR ? arreglarVencimiento(original.parsearQR.apply(this, arguments)) : null;
  });
  envolver('parsear', function (texto) {
    if (esFormatoQRNuevo(texto)) return parsearQRNuevo(texto);
    return original.parsear ? arreglarVencimiento(original.parsear.apply(this, arguments)) : null;
  });

  DNIParser.esFormatoQRNuevo = esFormatoQRNuevo;
})();
