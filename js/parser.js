/**
 * Parser DNI argentino
 * - QR nuevo DNI: tramite@apellido@nombre@dni@tipoDoc@fechaNac@fechaEmision
 * - PDF417 formato @
 * - MRZ (dorso)
 */

const DNIParser = (() => {

  // ============ QR DEL NUEVO DNI ============
  function parsearQR(texto) {
    const contenido = String(texto || '').trim().replace(/^\uFEFF/, '');
    if (!contenido) return null;

    const match = contenido.match(
      /^(\d{10,14})@([^@]+)@([^@]+)@(\d{6,9})@([A-Za-z])@([^@]+?)(?:@([^@]+?))?(?:@(.+))?$/
    );
    if (!match) return null;

    const [, nroTramite, apellido, nombre, dni, tipoDoc, fechaNacDMY, fechaEmisionDMY] = match;
    if (!/^\d{7,8}$/.test(dni)) return null;

    function convertirFecha(fechaStr) {
      if (!fechaStr) return '';
      const limpio = String(fechaStr).trim();
      if (!/^\d{2}\/\d{2}\/\d{2,4}$/.test(limpio)) return '';
      const [dd, mm, aa] = limpio.split('/');
      let anio = aa;
      if (aa.length === 2) anio = parseInt(aa) > 50 ? '19' + aa : '20' + aa;
      return `${anio}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    const tipos = { D: 'DNI', C: 'LC', E: 'LE', P: 'Pasaporte', I: 'CI' };

    return {
      metodo: 'qr',
      raw: contenido,
      dni: dni,
      apellido: apellido.trim(),
      nombre: nombre.trim(),
      nombreCompleto: `${apellido.trim()} ${nombre.trim()}`.trim(),
      sexo: null,
      fechaNacimiento: convertirFecha(fechaNacDMY),
      fechaEmision: convertirFecha(fechaEmisionDMY),
      fechaVencimiento: null,
      tramite: nroTramite,
      tipoDocumento: tipos[tipoDoc.toUpperCase()] || tipoDoc.toUpperCase(),
      esNuevoDNI: true
    };
  }

  // ============ MRZ (dorso) ============
  function esMRZ(texto) {
    const limpio = String(texto || '').toUpperCase();
    const tieneID = /ID[A-Z]{3}\d{6,}/.test(limpio.replace(/[\s<]/g, ''));
    const tieneFillers = /<{5,}/.test(limpio);
    return tieneID || (tieneFillers && /\d{6}[0-9<][MF<]/.test(limpio.replace(/\s/g, '')));
  }

  function parsearMRZ(texto) {
    const lineasLimp = String(texto).split(/[\n\r]+/)
      .map(l => l.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
      .filter(l => l.length >= 20);

    let lineasMRZ = [];
    if (lineasLimp.length >= 3) {
      lineasMRZ = lineasLimp.slice(0, 3);
    } else {
      const todo = lineasLimp.join('');
      if (todo.length < 60) return null;
      lineasMRZ = [todo.substring(0,30), todo.substring(30,60), todo.substring(60,90) || ''];
    }
    lineasMRZ = lineasMRZ.map(l => (l + '<'.repeat(30)).substring(0, 30));

    let [l1, l2, l3] = lineasMRZ;
    if (!/^ID/.test(l1)) {
      const idx = lineasMRZ.findIndex(l => /^ID[A-Z]{3}/.test(l));
      if (idx > 0) { [l1, l2, l3] = [lineasMRZ[idx], lineasMRZ[idx+1] || '', lineasMRZ[idx+2] || '']; }
    }

    function yymmddToISO(s) {
      if (!/^\d{6}$/.test(s)) return null;
      const yy = parseInt(s.substring(0,2), 10);
      const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
      return `${yyyy}-${s.substring(2,4)}-${s.substring(4,6)}`;
    }

    const data = {
      metodo: 'mrz',
      raw: texto,
      dni: l1.substring(5, 14).replace(/</g, '') || null,
      apellido: null,
      nombre: null,
      nombreCompleto: null,
      sexo: l2.charAt(7) === 'M' ? 'Masculino' : l2.charAt(7) === 'F' ? 'Femenino' : null,
      fechaNacimiento: yymmddToISO(l2.substring(0, 6)),
      fechaEmision: null,
      fechaVencimiento: yymmddToISO(l2.substring(8, 14)),
      tramite: null,
      tipoDocumento: 'DNI'
    };

    const l3clean = l3.replace(/<+$/, '');
    const partes = l3clean.split('<<');
    if (partes[0]) data.apellido = partes[0].replace(/</g, ' ').trim();
    if (partes[1]) data.nombre = partes[1].replace(/</g, ' ').trim();
    if (data.apellido || data.nombre) {
      data.nombreCompleto = `${data.apellido || ''} ${data.nombre || ''}`.trim();
    }

    return data;
  }

  // ============ PDF417 formato @ genérico ============
  function parsearPDF417Generico(texto) {
    const contenido = String(texto || "").replace(/[\r\n]+/g, "@");
    const partes = contenido.split("@").map(p => p.trim()).filter(Boolean);
    const dniMatch = contenido.match(/\b\d{7,8}\b/);
    const dni = dniMatch ? dniMatch[0] : "";

    let sexo = "";
    const sexoParte = partes.map(p => p.toUpperCase()).find(p =>
      p === "M" || p === "F" || p === "X" || p === "MASCULINO" || p === "FEMENINO"
    );
    if (sexoParte === "M" || sexoParte === "MASCULINO") sexo = "Masculino";
    else if (sexoParte === "F" || sexoParte === "FEMENINO") sexo = "Femenino";

    const candidatos = partes
      .filter(p => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{3,}$/.test(p))
      .filter(p => !/^(ARG|ARGENTINA|IDARG|DNI|EJEMPLAR|NACIONALIDAD|APELLIDO|NOMBRE|MERCOSUR)$/i.test(p));

    const nombre = candidatos.slice(0, 2).join(" ").trim();

    let fechaISO = "";
    const fechaParte = partes.find(p => /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(p) || /^\d{8}$/.test(p));
    if (fechaParte) {
      const nums = fechaParte.replace(/\D/g, "");
      if (nums.length === 8) {
        const empiezaAnio = /^(19|20)\d{2}/.test(nums);
        const anio = empiezaAnio ? nums.slice(0, 4) : nums.slice(4, 8);
        const mes = empiezaAnio ? nums.slice(4, 6) : nums.slice(2, 4);
        const dia = empiezaAnio ? nums.slice(6, 8) : nums.slice(0, 2);
        fechaISO = `${anio}-${mes}-${dia}`;
      }
    }

    if (!dni && !nombre) return null;

    return {
      metodo: 'pdf417',
      raw: texto,
      dni: dni,
      apellido: null,
      nombre: nombre || null,
      nombreCompleto: nombre,
      sexo: sexo,
      fechaNacimiento: fechaISO,
      fechaEmision: null,
      fechaVencimiento: null,
      tramite: null,
      tipoDocumento: 'DNI'
    };
  }

  // ============ Detector universal ============
  function parsear(texto) {
    if (!texto) return null;
    return parsearQR(texto)
        || (esMRZ(texto) ? parsearMRZ(texto) : null)
        || parsearPDF417Generico(texto)
        || null;
  }

  return { parsear, parsearQR, parsearMRZ, parsearPDF417Generico, esMRZ };
})();
