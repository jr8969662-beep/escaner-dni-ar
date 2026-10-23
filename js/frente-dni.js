/**
 * Lectura del FRENTE del DNI argentino NUEVO por OCR (el frente no trae código).
 *   FrenteDNI.parsearVarios([textoOCR1, textoOCR2]) -> {dni, apellido, nombre, sexo, nacionalidad,
 *                                                       fechaNacimiento, fechaEmision, fechaVencimiento, ejemplar} o null
 * No depende del orden exacto de las líneas: el número se reconoce por su forma (xx.xxx.xxx), las fechas por su
 * lógica (emisión y vencimiento distan 15 u 8 años; el nacimiento es la más antigua), el sexo y la nacionalidad
 * por la fila "M ARGENTINA", y los nombres por estar en mayúsculas entre las etiquetas Apellido y Sexo.
 */
const FrenteDNI = (() => {
  'use strict';

  const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  function fechaValida(d, m, y) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const t = new Date(y, m - 1, d);
    if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function buscarDNI(lineas) {
    const re = /(?<!\d)(\d{1,2})\s?[.,]\s?(\d{3})\s?[.,]\s?(\d{3})(?!\d)/;
    let primero = null;
    for (let i = 0; i < lineas.length; i++) {
      const m = re.exec(lineas[i]);
      if (!m) continue;
      const n = m[1] + m[2] + m[3];
      if (!/^\d{7,8}$/.test(n)) continue;
      if (/EJEMPLAR|DOCUMENT/i.test(lineas[i] + ' ' + (lineas[i - 1] || ''))) return n;
      if (!primero) primero = n;
    }
    return primero;
  }

  function buscarFechas(texto) {
    const re = /(?<!\d)(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{4})(?!\d)/g;
    const set = new Set(); let m;
    while ((m = re.exec(texto))) { const f = fechaValida(+m[1], +m[2], +m[3]); if (f) set.add(f); }
    return [...set].sort();
  }

  function asignarFechas(fechas, textoPlano) {
    const out = { nac: null, emi: null, ven: null };
    // emisión + vencimiento: mismo día y mes, 15 u 8 años de diferencia
    for (let i = 0; i < fechas.length && !out.emi; i++) {
      for (let j = i + 1; j < fechas.length; j++) {
        const a = fechas[i], b = fechas[j], dy = +b.slice(0, 4) - +a.slice(0, 4);
        if (a.slice(5) === b.slice(5) && (dy === 15 || dy === 8)) { out.emi = a; out.ven = b; break; }
      }
    }
    const resto = fechas.filter((f) => f !== out.emi && f !== out.ven);
    if (out.emi) { out.nac = resto.find((f) => f < out.emi) || null; return out; }
    if (fechas.length >= 3) { out.nac = fechas[0]; out.emi = fechas[1]; out.ven = fechas[2]; return out; }
    if (fechas.length >= 1) out.nac = fechas[0];
    if (fechas.length === 2) {
      if (/VENCIMIENTO|EXPIR/.test(textoPlano) && !/EMISION|ISSUE/.test(textoPlano)) out.ven = fechas[1]; else out.emi = fechas[1];
    }
    return out;
  }

  const PALABRAS_ETIQUETA = /(SEXO|SEX|NACIONAL|NATIONAL|DOCUMENT|APELLID|SURNAME|NOMBRE|NAME|FECHA|DATE|EJEMPLAR|BIRTH|ISSUE|EXPIR|REPUBLICA|MERCOSUR|REGISTRO|MINISTERIO|IDENTIDAD)/;

  function comoNombre(linea) {
    const t = limpiar(linea.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/g, ''));
    if (!t || /[a-záéíóúüñ]/.test(t)) return null;            // los nombres vienen en mayúsculas; el ruido suele traer minúsculas
    if (!/^[A-ZÁÉÍÓÚÜÑ]+(?: [A-ZÁÉÍÓÚÜÑ]+)*$/.test(t)) return null;
    if (t.replace(/ /g, '').length < 3 || PALABRAS_ETIQUETA.test(sinTildes(t))) return null;
    if (t.split(' ').some((w) => w.length === 1)) return null;
    return t;
  }

  function buscarNombres(lineas) {
    const plano = lineas.map((l) => sinTildes(l).toUpperCase());
    const ini = plano.findIndex((l) => /SURNAME|URNAME|APELLID|PELLIDO/.test(l));
    if (ini < 0) return { apellido: null, nombre: null };
    let fin = plano.findIndex((l, i) => i > ini && /\bSEXO\b|\bSEX\b|NACIONAL|NATIONAL|NACIMIENTO|BIRTH/.test(l));
    if (fin < 0) fin = Math.min(lineas.length, ini + 8);
    const lblNombre = plano.findIndex((l, i) => i > ini && i < fin && /\bNOMBRE\b|\bNAME\b|MBRE\/|\/NAME/.test(l));
    const tomar = (a, b) => { const r = []; for (let i = a; i < b; i++) { const n = comoNombre(lineas[i]); if (n) r.push(n); } return r; };
    // valor en la misma línea de la etiqueta ("Apellido/Surname SANCHEZ")
    const resto = (i) => { const m = /(?:SURNAME|APELLIDOS?)\s*[:\/]?\s*(.*)$/i.exec(lineas[i]); return m ? comoNombre(m[1].replace(/^\/?\s*SURNAME\s*/i, '')) : null; };
    let ape, nom;
    if (lblNombre > 0) {
      ape = tomar(ini, lblNombre); const r = resto(ini); if (r) ape.unshift(r);
      nom = tomar(lblNombre, fin);
    } else {
      const todos = tomar(ini, fin); const r = resto(ini); if (r) todos.unshift(r);
      ape = todos.slice(0, 1); nom = todos.slice(1);
    }
    return { apellido: ape.join(' ') || null, nombre: nom.join(' ') || null };
  }

  function buscarSexoNacionalidad(lineas) {
    let sexo = null, nac = null;
    for (const l of lineas) {
      const m = /(?:^|[^A-Za-z])([MFX])\s+(ARGENTIN[AO])\b/i.exec(l);
      if (m) { sexo = m[1].toUpperCase(); nac = 'ARGENTINA'; break; }
    }
    if (!nac) {
      const i = lineas.findIndex((l) => /^\W*ARGENTIN[AO]\W*$/i.test(l));
      if (i >= 0) {
        nac = 'ARGENTINA';
        for (let k = i - 1; k >= Math.max(0, i - 3) && !sexo; k--) { const m = /^\W*([MFX])\W*$/.exec(lineas[k]); if (m) sexo = m[1]; }
      }
    }
    if (!sexo) { // "M" suelta tras la etiqueta Sexo
      const i = lineas.findIndex((l) => /\bSEXO?\b|\bSEX\b/i.test(sinTildes(l)));
      for (let k = i + 1; i >= 0 && k < Math.min(lineas.length, i + 5) && !sexo; k++) { const m = /^\W*([MFX])\W*$/.exec(lineas[k]); if (m) sexo = m[1]; }
    }
    return { sexo, nac };
  }

  function parsear(texto) {
    if (!texto) return null;
    const lineas = String(texto).split(/\r?\n/).map(limpiar).filter(Boolean);
    const plano = sinTildes(lineas.join('\n')).toUpperCase();
    const f = asignarFechas(buscarFechas(lineas.join('\n')), plano);
    const n = buscarNombres(lineas);
    const sn = buscarSexoNacionalidad(lineas);
    const ej = /EJEMPLAR\s*[:\-]?\s*([A-Z])\b/.exec(plano);
    const r = {
      dni: buscarDNI(lineas), apellido: n.apellido, nombre: n.nombre, sexo: sn.sexo, nacionalidad: sn.nac,
      fechaNacimiento: f.nac, fechaEmision: f.emi, fechaVencimiento: f.ven, ejemplar: ej ? ej[1] : null
    };
    return Object.keys(r).filter((k) => r[k]).length >= 3 ? r : null;
  }

  // Combina varias lecturas OCR: toma la más completa y rellena lo que le falte con las demás
  function parsearVarios(textos) {
    const rs = (textos || []).map(parsear).filter(Boolean);
    if (!rs.length) return null;
    const cuenta = (r) => Object.keys(r).filter((k) => r[k]).length;
    rs.sort((a, b) => cuenta(b) - cuenta(a));
    const base = Object.assign({}, rs[0]);
    rs.slice(1).forEach((r) => Object.keys(r).forEach((k) => { if (!base[k] && r[k]) base[k] = r[k]; }));
    return base;
  }

  return { parsear, parsearVarios };
})();
