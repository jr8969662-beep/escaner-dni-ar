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

  // Corrige confusiones típicas del OCR dentro de un nombre (0→O, 1→I, 5→S, 8→B, 6→G) y saca símbolos sueltos
  function normalizarNombre(n) {
    if (!n) return null;
    const t = String(n).toUpperCase().replace(/[0]/g, 'O').replace(/[1|!]/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B').replace(/6/g, 'G')
      .replace(/[^A-ZÁÉÍÓÚÜÑ '\-]/g, ' ').replace(/\s+/g, ' ').replace(/(^| )[-']+|[-']+( |$)/g, ' ').trim();
    return t.length >= 2 ? t : null;
  }
  function distancia(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function similitud(a, b) {
    // letras Y números: antes se borraban los números y dos DNI iguales daban 0 (los datos del reverso no se unían)
    a = sinTildes(String(a || '')).toUpperCase().replace(/[^A-Z0-9]/g, ''); b = sinTildes(String(b || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!a || !b) return 0;
    return 1 - distancia(a, b) / Math.max(a.length, b.length);
  }

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

  const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const MESES_EN = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DEC: 12 };
  function mesDe(t) {   // exacto: una palabra parecida pero distinta ("FEO") suele ser ruido y daría una fecha falsa
    const i = MESES.indexOf(t);
    return i >= 0 ? i + 1 : (MESES_EN[t] || 0);
  }

  // Todas las fechas de una línea (numéricas "26.02.1976" o con mes "15 AGO/ AUG 2002"), con su posición.
  // El OCR suele cambiar un 1 por un 4 en el día ("45 AGO"): se repara; si no se puede, la fecha queda como ilegible (null).
  function fechasEnLinea(linea) {
    const L = sinTildes(linea).toUpperCase(), out = [];
    const arreglarDia = (d) => (d >= 1 && d <= 31) ? d : (d >= 40 && d <= 49 ? d - 30 : 0);
    let m;
    const reNum = /(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{4})(?!\d)/g;
    while ((m = reNum.exec(L))) out.push({ i: m.index, iso: fechaValida(arreglarDia(+m[1]), +m[2], +m[3]) });
    const reTxt = /(\d{1,3})[.,]?\s*([A-Z]{3})[^0-9\n]{0,14}?(\d{4})(?!\d)/g;
    while ((m = reTxt.exec(L))) {
      const mes = mesDe(m[2]); if (!mes) continue;
      const dia = arreglarDia(+m[1].slice(-2));
      out.push({ i: m.index, iso: dia ? fechaValida(dia, mes, +m[3]) : null });
    }
    // fecha con el día ilegible ("NE/ JAN 2021"): no se usa, pero ocupa su lugar (si no, la etiqueta toma la fecha siguiente)
    const reParcial = /([A-Z]{3})[^0-9\n]{0,10}?((?:19|20)\d{2})(?!\d)/g;
    while ((m = reParcial.exec(L))) {
      const j = m.index;
      if (!mesDe(m[1]) || out.some((o) => Math.abs(o.i - j) < 14 || (j > o.i && j < o.i + 22))) continue;
      out.push({ i: j, iso: null });
    }
    return out.sort((x, y) => x.i - y.i);
  }

  function etiquetasEnLinea(linea) {
    const L = sinTildes(linea).toUpperCase(), out = [];
    [['nac', /NACIM|BIRTH/g], ['emi', /\bEMI|ISSU/g], ['ven', /\bV[AE]NC|EXPIR/g]].forEach(([k, re]) => {
      let m; while ((m = re.exec(L))) out.push({ i: m.index, k });
    });
    return out.sort((x, y) => x.i - y.i);
  }

  const anioDe = (f) => +f.slice(0, 4);
  function ordenValido(f) {
    const v = [f.nac, f.emi, f.ven].filter(Boolean);
    return v.every((x, i) => i === 0 || x > v[i - 1]);
  }
  // El vencimiento del DNI es 15 años después de la emisión (8 para menores): corrige un año mal leído
  function ajustarVencimiento(f) {
    if (f.emi && f.ven && f.emi.slice(5) === f.ven.slice(5)) {
      const dy = anioDe(f.ven) - anioDe(f.emi);
      if (dy >= 12 && dy <= 19 && dy !== 15) f.ven = (anioDe(f.emi) + 15) + f.ven.slice(4);
      else if (dy >= 5 && dy <= 11 && dy !== 8) f.ven = (anioDe(f.emi) + 8) + f.ven.slice(4);
    }
    return f;
  }

  function leerFechas(lineas) {
    // 1) por etiqueta: cada etiqueta (nacimiento / emisión / vencimiento) se asigna a la fecha que la sigue
    const cola = [], por = { nac: null, emi: null, ven: null }, todas = [];
    let ultima = null;
    lineas.forEach((l) => {
      const ev = etiquetasEnLinea(l).map((e) => ({ i: e.i, tipo: 'e', k: e.k }))
        .concat(fechasEnLinea(l).map((d) => ({ i: d.i, tipo: 'd', iso: d.iso }))).sort((x, y) => x.i - y.i);
      ev.forEach((e) => {
        if (e.tipo === 'e') { if (e.k !== ultima) { cola.push(e.k); ultima = e.k; } }
        else { if (e.iso) todas.push(e.iso); const k = cola.shift(); if (k && e.iso && !por[k]) por[k] = e.iso; ultima = null; }
      });
    });
    const porEtiqueta = ordenValido(por) && (por.nac || por.emi || por.ven) ? por : null;
    // 2) por lógica: emisión y vencimiento (mismo día y mes, 15 u 8 años), nacimiento = la más antigua
    const u = [...new Set(todas)].sort(), out = { nac: null, emi: null, ven: null };
    for (let i = 0; i < u.length && !out.emi; i++) for (let j = i + 1; j < u.length; j++) {
      const dy = anioDe(u[j]) - anioDe(u[i]);
      if (u[i].slice(5) === u[j].slice(5) && (dy === 15 || dy === 8)) { out.emi = u[i]; out.ven = u[j]; break; }
    }
    const resto = u.filter((f) => f !== out.emi && f !== out.ven);
    if (out.emi) out.nac = resto.find((f) => f < out.emi) || null;
    else if (u.length >= 3) { out.nac = u[0]; out.emi = u[1]; out.ven = u[2]; }
    else if (u.length >= 1 && !porEtiqueta) out.nac = u[0];
    if (!porEtiqueta) return ajustarVencimiento(out);
    // lo leído por etiqueta manda; lo que falte se completa con la lógica si mantiene el orden nacimiento < emisión < vencimiento
    const f = Object.assign({}, porEtiqueta);
    ['nac', 'emi', 'ven'].forEach((k) => { if (!f[k] && out[k] && Object.values(f).indexOf(out[k]) < 0) { const p = Object.assign({}, f, { [k]: out[k] }); if (ordenValido(p)) f[k] = out[k]; } });
    return ajustarVencimiento(f);
  }

  const PALABRAS_ETIQUETA = /(SEXO|SEX|NACIONAL|NATIONAL|DOCUMENT|APELLID|SURNAME|NOMBRE|NAME|FECHA|DATE|EJEMPLAR|BIRTH|ISSUE|EXPIR|REPUBLICA|MERCOSUR|REGISTRO|MINISTERIO|IDENTIDAD)/;

  function comoNombre(linea) {
    const letras = (linea.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length, digitos = (linea.match(/\d/g) || []).length;
    if (letras >= 4 && digitos > 0 && digitos <= 2) linea = linea.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B').replace(/6/g, 'G');
    // "RAMlRO", "VELAZQUEz": palabras casi todas en mayúsculas con alguna letra confundida -> todo en mayúsculas
    linea = linea.split(/\s+/).map((w) => {
      const L = w.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || [], up = w.match(/[A-ZÁÉÍÓÚÜÑ]/g) || [];
      return (L.length >= 4 && up.length / L.length >= 0.6) ? w.replace(/[l|]/g, 'I').toUpperCase() : w;
    }).join(' ');
    // fuera las "palabras" de ruido: sin letras, o con minúsculas y cortas (e, sll, Ha...)
    const toks = linea.split(/\s+/).filter((w) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(w) && !(/[a-záéíóúüñ]/.test(w) && w.length <= 3))
      .map((w) => w.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/g, ''));
    const t = limpiar(toks.join(' '));
    if (!t || /[a-záéíóúüñ]/.test(t)) return null;            // los nombres vienen en mayúsculas
    if (!/^[A-ZÁÉÍÓÚÜÑ]+(?: [A-ZÁÉÍÓÚÜÑ]+)*$/.test(t)) return null;
    if (t.replace(/ /g, '').length < 3 || PALABRAS_ETIQUETA.test(sinTildes(t))) return null;
    if (t.split(' ').some((w) => w.length === 1)) return null;
    return t;
  }

  function tieneEtiqueta(l, palabras, excluir) {
    const toks = sinTildes(l).toUpperCase().split(/[^A-Z]+/).filter((t) => t.length >= 4);
    if (excluir && toks.some((t) => excluir.some((p) => similitud(t, p) >= 0.75))) return false;
    return toks.some((t) => palabras.some((p) => similitud(t, p) >= (p.length <= 4 ? 1 : 0.72)));
  }
  const ES_APELLIDO = (l) => tieneEtiqueta(l, ['APELLIDO', 'APELLIDOS', 'SURNAME']);
  const ES_NOMBRE = (l) => tieneEtiqueta(l, ['NOMBRE', 'NOMBRES', 'NAME'], ['SURNAME', 'APELLIDO']);
  // fila de Sexo/Nacionalidad: la etiqueta o, si no se leyó, el valor ("M  ARGENTINA  B") o la fecha de nacimiento
  const ES_FILA_SEXO = (l) => { const U = sinTildes(l).toUpperCase();
    return /\bSEXO\b|\bSEX\b|NACIONAL|NATIONAL|NACIMIENTO|BIRTH/.test(U) || /^\W*[MFX]\s+ARGENTIN/.test(U) ||
      (/^\W*ARGENTIN[AO]\W*$/.test(U)) || /^\W*\d{1,2}\s+[A-Z]{3}\s*\/\s*[A-Z]{3}\s+(19|20)\d\d/.test(U); };

  function buscarNombres(lineas) {
    const plano = lineas.map((l) => sinTildes(l).toUpperCase());
    const ini = plano.findIndex((l, i) => ES_APELLIDO(lineas[i]));
    if (ini < 0) {
      // sin etiqueta: líneas en mayúsculas entre el encabezado "IDENTIDAD" y la fila de Sexo/Nacionalidad
      let cab = -1; plano.forEach((l, i) => { if (/IDENTIDAD|REPUBLICA|MERCOSUR|REGISTRO|PERSONAS/.test(l) && i < 6) cab = i; });
      const sx = plano.findIndex((l, i) => i > cab && ES_FILA_SEXO(l));
      if (sx < 0) return { apellido: null, nombre: null };
      // sin encabezado: hasta 3 líneas con forma de nombre justo antes de la fila de Sexo
      const desde = cab >= 0 ? cab + 1 : Math.max(0, sx - 6);
      // si se leyó la etiqueta "Nombre": lo de arriba es el apellido y lo de abajo el nombre
      const lblN = plano.findIndex((l, i) => i >= desde && i < sx && (ES_NOMBRE(lineas[i]) || /MBRE\/|\/NAME/.test(l)));
      if (lblN > desde) {
        // (el apellido a veces sale en minúsculas por el OCR: "Lopez" -> "LOPEZ")
        const nom2 = (l) => comoNombre(l) || comoNombre(String(l).replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]/g, ' ').trim().split(/\s+/).filter((w) => (/^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}$/.test(w) || /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(w)) && !['APELLIDO', 'SURNAME'].some((e) => similitud(w, e) >= 0.55)).join(' ').toUpperCase());
        const a = [], b = [];
        for (let i = desde; i < lblN; i++) { const n = nom2(lineas[i]); if (n && !ES_APELLIDO(lineas[i])) a.push(n); }
        for (let i = lblN + 1; i < sx; i++) { const n = comoNombre(lineas[i]); if (n) b.push(n); }
        if (a.length || b.length) return { apellido: a.slice(-2).join(' ') || null, nombre: b.join(' ') || null };
      }
      const c = []; for (let i = desde; i < sx; i++) { const n = comoNombre(lineas[i]); if (n) c.push(n); }
      if (cab < 0 && c.length > 3) c.splice(0, c.length - 3);
      return { apellido: c[0] || null, nombre: c.slice(1).join(' ') || null };
    }
    let fin = plano.findIndex((l, i) => i > ini && ES_FILA_SEXO(l));
    if (fin < 0) fin = Math.min(lineas.length, ini + 8);
    const lblNombre = plano.findIndex((l, i) => i > ini && i < fin && (ES_NOMBRE(lineas[i]) || /MBRE\/|\/NAME/.test(l)));
    const tomar = (a, b) => { const r = []; for (let i = a; i < b; i++) { const n = comoNombre(lineas[i]); if (n) r.push(n); } return r; };
    // valor en la misma línea de la etiqueta ("Apellido/Surname PEREZ")
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
    const f = leerFechas(lineas);
    const n = buscarNombres(lineas);
    const sn = buscarSexoNacionalidad(lineas);
    // ejemplar: primero la fila "M ARGENTINA B" (sexo, nacionalidad, ejemplar); si no, la letra en el MISMO renglón que la
    // etiqueta "Ejemplar" (en el renglón de abajo suele venir el sexo, no el ejemplar)
    // (sin pasar a mayúsculas: una "r" minúscula es ruido del fondo, no el ejemplar R)
    const fila = /(?:^|[^A-Za-z])[MFX][ \t]+ARGENTIN[AO](?:[ \t]+[^A-Za-z0-9\s]+)*[ \t]+([A-Z0-9cosvwxz])\b/.exec(sinTildes(lineas.join('\n')));
    const letraEj = fila ? ({ '8': 'B', '0': 'D', '6': 'G', '5': 'S', '1': 'I' }[fila[1]] || fila[1].toUpperCase()) : null;
    let ej = letraEj && /^[A-Z]$/.test(letraEj) ? [null, letraEj] : /EJEMPLAR[ \t]*[:\-]?[ \t]*([A-Z])\b(?![ \t]+ARGENTIN)/.exec(plano);
    const tram = /(?<!\d)(\d{11})(?!\d)/.exec(plano);
    const r = {
      dni: buscarDNI(lineas), apellido: normalizarNombre(n.apellido), nombre: normalizarNombre(n.nombre), sexo: sn.sexo, nacionalidad: sn.nac,
      fechaNacimiento: f.nac, fechaEmision: f.emi, fechaVencimiento: f.ven, ejemplar: ej ? ej[1] : null, tramite: tram ? tram[1] : null
    };
    return Object.keys(r).filter((k) => r[k]).length >= 3 ? r : null;
  }

  // Combina varias lecturas OCR: cada dato se decide por votación entre las lecturas (gana el que más se repite)
  // Elige un nombre entre varias lecturas: agrupa las parecidas (SANCHEZ / SANCHES) y gana el grupo más votado;
  // dentro del grupo, la escritura que más se repite.
  // Palabras del encabezado de la tarjeta ("REPÚBLICA ARGENTINA - MERCOSUR", "REGISTRO NACIONAL DE LAS PERSONAS"):
  // con la foto borrosa el OCR a veces las toma como apellido ("REPUBL", "REENTINA")
  const ENCABEZADO = ['REPUBLICA', 'ARGENTINA', 'MERCOSUR', 'REGISTRO', 'NACIONAL', 'PERSONAS', 'DOCUMENTO', 'NACIONALIDAD', 'IDENTIDAD', 'MINISTERIO'];
  function esEncabezado(x) {
    return sinTildes(x).split(/\s+/).some((t) => t.length >= 4 &&
      ENCABEZADO.some((h) => similitud(t, h) >= 0.7 || (t.length >= 5 && h.startsWith(t))));
  }
  // Qué tan "nombre" parece una lectura: castiga pedazos sueltos de 1-2 letras (OCR que partió una palabra: "CARI OS")
  const PARTICULAS = /^(DE|LA|EL|Y|DI|DA|DO|LE|DU|DEL|LAS|LOS|SAN|VON|VAN)$/;
  const calidadNombre = (x) => -x.split(' ').filter((t) => t.length <= 2 && !PARTICULAS.test(t)).length;
  function elegirNombre(cands) {
    // fuera un primer pedazo que es la etiqueta mal leída ("APERSO DE LA CRUZ" = "Apellido" + nombre)
    const sinEtiqueta = (x) => { const t = (x || '').split(' '); return t.length > 1 && t[0].length >= 4 && ['APELLIDO', 'SURNAME', 'NOMBRE', 'NOMBRES'].some((e) => similitud(t[0], e) >= 0.5) ? t.slice(1).join(' ') : x; };
    let v = cands.map(normalizarNombre).map(sinEtiqueta).filter((x) => x && x.replace(/ /g, '').length >= 3 && !esEncabezado(x));
    if (!v.length) return null;
    // "ACT GONZALEZ" / "GONZALEZ ACT": si otra lectura es la misma sin un pedazo corto de ruido, vale como esa
    v = v.map((x) => v.find((y) => y !== x && y.length >= 3 && ((x.endsWith(' ' + y) && x.length - y.length <= 7) || (x.startsWith(y + ' ') && x.length - y.length <= 4))) || x);
    const grupos = [];
    v.forEach((x) => {
      const g = grupos.find((gr) => similitud(gr[0], x) >= 0.8);
      if (g) g.push(x); else grupos.push([x]);
    });
    // "RAMIRO" y "RAMIRO ERNESTO": la lectura corta es la larga con un nombre perdido (el OCR cortó el renglón),
    // no otro nombre. Sus votos pasan al grupo largo: si no, ganaba el nombre solo y se perdía el segundo.
    const extiende = (x, y) => x.startsWith(y + ' ') && x.slice(y.length + 1).split(' ').every((t) => t.length >= 3 || PARTICULAS.test(t));
    grupos.forEach((gc) => {
      const largo = grupos.find((gl) => gl !== gc && gl.length && extiende(gl[0], gc[0]));
      if (largo) { gc.forEach(() => largo.push(largo[0])); gc.length = 0; }
    });
    grupos.sort((a, b) => b.length - a.length);
    const g = grupos[0], cuenta = {};
    g.forEach((x) => { cuenta[x] = (cuenta[x] || 0) + 1; });
    return Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a] || calidadNombre(b) - calidadNombre(a) || b.length - a.length)[0];
  }

  // Combina varias lecturas OCR: cada dato se decide por votación entre las lecturas (gana el que más se repite).
  // textos.nombres = { apellido: [...], nombre: [...] } suma lecturas sueltas de las zonas de nombres.
  function parsearVarios(textos) {
    const extra = (textos && textos.nombres) || { apellido: [], nombre: [] };
    // el renglón "M ARGENTINA B" leído aparte cuenta como una lectura más (aporta sexo, nacionalidad y ejemplar)
    const filas = ((textos && textos.zonas && textos.zonas.fila) || []).map((t) => {
      const sn = buscarSexoNacionalidad(String(t).split(/\r?\n/).map(limpiar).filter(Boolean));
      const f = /(?:^|[^A-Za-z])[MFX][ \t]+ARGENTIN[AO](?:[ \t]+[^A-Za-z0-9\s]+)*[ \t]+([A-Z0-9cosvwxz])\b/.exec(sinTildes(String(t)));
      const ej = f ? ({ '8': 'B', '0': 'D', '6': 'G', '5': 'S', '1': 'I', '4': 'A' }[f[1]] || f[1].toUpperCase()) : null;
      return { sexo: sn.sexo, nacionalidad: sn.nac, ejemplar: ej && /^[A-Z]$/.test(ej) ? ej : null };
    }).filter((r) => r.sexo || r.ejemplar);
    const rs = (textos || []).map(parsear).filter(Boolean).concat(filas);
    if (!rs.length && !extra.apellido.length && !Object.values((textos && textos.zonas) || {}).some((z) => z.length)) return null;
    const out = {};
    const zonas = (textos && textos.zonas) || {};
    const deZona = { dni: [], fechaNacimiento: [], fechaEmision: [], fechaVencimiento: [], tramite: [], ejemplar: [] };
    (zonas.ejcombo || []).forEach((t) => {   // renglón armado "ARGENTINA  B"
      const m = /(?:ARGENTIN[AO]|INA)\W*\s+([A-Z0-9cosvwxz])[a-z]{0,2}\W*$/.exec(String(t).trim());
      const v = m ? ({ '8': 'B', '0': 'D', '6': 'G', '5': 'S', '1': 'I', '4': 'A' }[m[1]] || m[1].toUpperCase()) : null;
      if (v && /^[A-Z]$/.test(v)) deZona.ejemplar.push(v, v);   // vale doble: es la lectura más limpia de la letra
    });
    (zonas.ejemplar || []).forEach((t) => {
      // renglón "ARGENTINA  B": la letra suelta al final
      // (a veces la letra viene con basura del fondo pegada en minúscula: "Coma" -> C)
      // renglón con texto, un hueco grande y una letra sola al final; mejor si es el de "...NA" (ARGENTINA)
      const cand = String(t).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
        .map((x) => ({ x, m: /\S\s{4,}([A-Z0-9cosvwxz])[a-z]{0,3}\W*$/.exec(x) })).filter((c) => c.m);
      const elegido = cand.find((c) => /ARGENT|GENTIN|NA\b/i.test(c.x)) || (cand.length === 1 ? cand[0] : null);
      const m = (elegido && elegido.m) || /^\W*([A-Z0-9])\W*$/.exec(String(t).trim().toUpperCase());
      const v = m ? ({ '8': 'B', '0': 'D', '6': 'G', '5': 'S', '1': 'I', '4': 'A' }[m[1]] || m[1].toUpperCase()) : null;
      if (v && /^[A-Z]$/.test(v)) deZona.ejemplar.push(v);
    });
    const primeraFecha = (t) => { for (const l of String(t).split(/\r?\n/)) { const f = fechasEnLinea(l).find((x) => x.iso); if (f) return f.iso; } return null; };
    (zonas.nac || []).forEach((t) => { const v = primeraFecha(t); if (v) deZona.fechaNacimiento.push(v); });
    (zonas.emi || []).forEach((t) => { const v = primeraFecha(t); if (v) deZona.fechaEmision.push(v); });
    (zonas.ven || []).forEach((t) => { const v = primeraFecha(t); if (v) deZona.fechaVencimiento.push(v); });
    (zonas.doc || []).forEach((t) => { const v = buscarDNI(String(t).split(/\r?\n/)) || (/(?<!\d)(\d{7,8})(?!\d)/.exec(String(t).replace(/[.\s]/g, '')) || [])[1]; if (v) deZona.dni.push(v); });
    (zonas.tramite || []).forEach((t) => { const m = /(?<!\d)(\d{11})(?!\d)/.exec(String(t).replace(/[OQD]/g, '0')); if (m) deZona.tramite.push(m[1]); });
    ['dni', 'sexo', 'nacionalidad', 'fechaNacimiento', 'fechaEmision', 'fechaVencimiento', 'ejemplar', 'tramite'].forEach((k) => {
      const c = new Map();
      rs.forEach((r) => { if (r[k]) c.set(r[k], (c.get(r[k]) || 0) + 1); });
      (deZona[k] || []).forEach((v) => c.set(v, (c.get(v) || 0) + (k === 'dni' ? 1 : k === 'ejemplar' ? 3 : 2)));   // el número se lee mejor en la imagen completa
      if (k === 'dni') {   // "2789012" (cortado) suma sus votos a "27890123"
        [...c.keys()].forEach((v) => { const largo = [...c.keys()].find((x) => x !== v && x.length > v.length && x.startsWith(v)); if (largo) { c.set(largo, c.get(largo) + c.get(v)); c.delete(v); } });
      }
      let mv = null, mn = 0;
      c.forEach((n, v) => { if (n > mn || (n === mn && String(v).length > String(mv).length)) { mn = n; mv = v; } });
      out[k] = mv;
    });
    out.apellido = elegirNombre(rs.map((r) => r.apellido).filter(Boolean).concat(extra.apellido.map(comoNombre).filter(Boolean)));
    out.nombre = elegirNombre(rs.map((r) => r.nombre).filter(Boolean).concat(extra.nombre.map(comoNombre).filter(Boolean)));
    // "SANCHEZ CARLOS ALBERTO" como nombre: se le saca el apellido de adelante
    if (out.apellido && out.nombre && out.nombre.startsWith(out.apellido + ' ')) out.nombre = out.nombre.slice(out.apellido.length + 1);
    // coherencia de fechas: nacimiento < emisión < vencimiento y vencimiento = emisión + 15 (u 8) años
    const f = ajustarVencimiento({ nac: out.fechaNacimiento, emi: out.fechaEmision, ven: out.fechaVencimiento });
    if (!ordenValido(f)) {
      // se descarta la fecha que rompe el orden, empezando por la de menos votos
      if (f.emi && f.ven && f.emi >= f.ven) { f.emi = null; }
      if (f.nac && f.emi && f.nac >= f.emi) f.nac = null;
    }
    out.fechaNacimiento = f.nac; out.fechaEmision = f.emi; out.fechaVencimiento = f.ven;
    return Object.keys(out).filter((k) => out[k]).length >= 3 ? out : null;
  }

  // Cruza lo leído por OCR (frente) con una fuente más confiable (QR o MRZ con dígitos de control).
  // Corrige errores de OCR cuando las lecturas se parecen y avisa cuando no coinciden. Devuelve la lista de avisos.
  function reconciliar(datos, ident) {
    const avisos = [];
    if (!datos || !ident) return avisos;
    // Qué tan confiable es cada dato del reverso: el QR es exacto; de la MRZ, solo lo que pasa el dígito de control
    const qr = ident.fuente === 'qr', c = ident.checks || {};
    const fiable = { dni: qr || c.documento === true, nombres: qr, nac: qr || c.nacimiento === true, ven: c.vencimiento === true || (qr && ident.verificada) };
    const poner = (k, v) => { datos[k] = v; if (k === 'dni') datos.numero = v; };

    if (ident.dni && datos.dni && ident.dni !== datos.dni) {
      if (similitud(ident.dni, datos.dni) < 0.75) { avisos.push('El DNI del frente no coincide con el del reverso: ¿son del mismo documento?'); return avisos; }
      if (fiable.dni) poner('dni', ident.dni);
    }
    if (!datos.dni && ident.dni) poner('dni', ident.dni);

    ['apellido', 'nombre'].forEach((campo) => {
      const ref = ident[campo], act = datos[campo];
      if (!ref) return;
      if (!act) { datos[campo] = ref; return; }
      if (!fiable.nombres) {
        // la MRZ leída por OCR confunde '<' con 'S': en general manda el frente... salvo que el frente tenga un pedazo
        // suelto típico de OCR ("CARI OS ALBERTC") y la MRZ diga casi lo mismo sin ese corte
        const cortos = (x) => x.split(' ').filter((t) => t.length <= 2 && !/^(DE|LA|EL|Y|DI|DA|DO|LE|DU)$/.test(t)).length;
        if (!ident.truncado && cortos(act) > cortos(ref) && similitud(ref, act) >= 0.75) datos[campo] = ref;
        // el frente leyó un nombre solo y la MRZ trae ese mismo más otro ("RAMIRO" → "RAMIRO ERNESTO"): se completa
        else if (campo === 'nombre' && ref.startsWith(act + ' ') && ref.slice(act.length + 1).split(' ').every((t) => t.length >= 3)) datos[campo] = ref;
        return;
      }
      if (similitud(ref, act) >= 0.6) datos[campo] = ref;
      else avisos.push('El ' + campo + ' del frente (' + act + ') no coincide con el del reverso (' + ref + '): revisalo.');
    });
    datos.nombreCompleto = ((datos.apellido || '') + ' ' + (datos.nombre || '')).trim();

    if (ident.fechaNacimiento && (fiable.nac || !datos.fechaNacimiento)) {
      if (datos.fechaNacimiento && datos.fechaNacimiento !== ident.fechaNacimiento) avisos.push('La fecha de nacimiento del frente no coincide con el reverso: se usó la del reverso.');
      datos.fechaNacimiento = ident.fechaNacimiento;
    }
    if (ident.fechaVencimiento && (fiable.ven || !datos.fechaVencimiento)) {
      if (datos.fechaVencimiento && datos.fechaVencimiento !== ident.fechaVencimiento && fiable.ven) avisos.push('El vencimiento del frente no coincide con el reverso: se usó el del reverso.');
      datos.fechaVencimiento = ident.fechaVencimiento;
    }
    if (datos.fechaVencimiento) datos.vigente = new Date(datos.fechaVencimiento + 'T23:59:59') >= new Date();
    // sexo: la MRZ lo trae entre dos dígitos de control; si los dos cierran, manda la MRZ
    if (ident.sexo && (!datos.sexo || (c.nacimiento === true && c.vencimiento === true))) datos.sexo = ident.sexo;
    // el QR trae exactos el trámite, el ejemplar y la emisión: corrigen lo leído por OCR en el frente
    ['fechaEmision', 'tramite', 'ejemplar', 'nacionalidad'].forEach((k) => { if (ident[k] && (!datos[k] || (qr && k !== 'nacionalidad'))) datos[k] = ident[k]; });
    return avisos;
  }

  // ¿La lectura tiene todo y es coherente? (permite cortar el OCR antes y que el escaneo sea más rápido)
  function completo(r) {
    return !!(r && r.dni && r.apellido && r.nombre && r.sexo && r.fechaNacimiento && r.fechaEmision && r.fechaVencimiento &&
      (anioDe(r.fechaVencimiento) - anioDe(r.fechaEmision) === 15 || anioDe(r.fechaVencimiento) - anioDe(r.fechaEmision) === 8));
  }

  return { parsear, parsearVarios, reconciliar, similitud, normalizarNombre, completo, comoNombre, tieneEtiqueta };
})();
