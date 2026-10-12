/**
 * Parser del DNI argentino
 * Convierte el texto crudo (PDF417 u OCR) en un objeto estructurado
 *
 * El formato del PDF417 del DNI argentino varía según el modelo,
 * por eso se aplican múltiples heurísticas y fallbacks.
 */

const DNIParser = (() => {

  /**
   * Parser principal del PDF417
   * El formato conocido suele ser:
   *   @campo1@campo2@...@  (delimitado por @)
   * con campos en un orden más o menos fijo
   */
  function parsearPDF417(texto) {
    if (!texto) return null;

    // Limpiar y normalizar
    let raw = String(texto).trim();
    // Algunos lectores devuelven saltos de línea, otros el string completo
    raw = raw.replace(/\r/g, '');

    // Dividir por @ (delimitador típico del PDF417 del DNI AR)
    let campos = raw.split('@').map(c => c.trim());

    // Eliminar campos vacíos al inicio/fin
    while (campos.length && !campos[0]) campos.shift();
    while (campos.length && !campos[campos.length - 1]) campos.pop();

    const data = {
      metodo: 'pdf417',
      raw: texto,
      dni: null,
      apellido: null,
      nombre: null,
      sexo: null,
      fechaNacimiento: null,
      fechaEmision: null,
      fechaVencimiento: null,
      ejemplar: null,
      tramite: null,
      cuil: null,
      nacionalidad: 'ARGENTINA'
    };

    // --- Estrategia 1: buscar por posición conocida ---
    // Formato típico (varía):
    //   [0] = número de trámite (a veces)
    //   [1] = apellido
    //   [2] = nombre
    //   [3] = sexo (M/F)
    //   [4] = número de DNI
    //   [5] = ejemplar
    //   [6] = fecha nacimiento
    //   [7] = fecha emisión
    for (const campo of campos) {
      // Número de DNI (7-8 dígitos, sin otro contexto)
      if (!data.dni && /^\d{7,8}$/.test(campo)) data.dni = campo;

      // Sexo (M o F solos)
      if (!data.sexo && /^[MF]$/i.test(campo)) data.sexo = campo.toUpperCase();

      // Ejemplar (letra sola A-Z, típicamente A/B/C)
      if (!data.ejemplar && /^[A-Z]$/.test(campo) && campo !== 'M' && campo !== 'F') {
        data.ejemplar = campo;
      }

      // Fechas (diversos formatos)
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(campo)) {
        if (!data.fechaNacimiento) data.fechaNacimiento = campo;
        else if (!data.fechaEmision) data.fechaEmision = campo;
        else if (!data.fechaVencimiento) data.fechaVencimiento = campo;
      }

      // CUIL (XX-XXXXXXXX-X o 11 dígitos corridos)
      if (!data.cuil && /^\d{2}-?\d{8}-?\d$/.test(campo)) data.cuil = campo;

      // Número de trámite (11 dígitos o alfanumérico largo)
      if (!data.tramite && /^\d{11}$/.test(campo) && campo !== data.dni) {
        data.tramite = campo;
      }

      // Apellido/nombre: campos alfabéticos largos
      if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/i.test(campo) && !/^\d+$/.test(campo)) {
        const up = campo.toUpperCase();
        // Ignorar palabras clave del documento
        if (/ARGENTINA|REPUBLICA|DNI|EJEMPLAR|TRAMITE|NACIONALIDAD/.test(up)) continue;
        if (!data.apellido) data.apellido = up;
        else if (!data.nombre) data.nombre = up;
      }
    }

    // --- Estrategia 2: fallbacks con regex sobre el raw ---
    if (!data.dni) {
      const m = raw.match(/\b(\d{7,8})\b/);
      if (m) data.dni = m[1];
    }

    if (!data.cuil && data.dni) {
      // Construir CUIL tentativo con prefijo 20 (hombre) o 27 (mujer)
      // OJO: solo es un cálculo tentativo, no reemplaza la lectura real
      // No lo asignamos automáticamente para no meter datos falsos
    }

    // --- Normalizar fechas ---
    data.fechaNacimiento = Validators.normalizarFecha(data.fechaNacimiento);
    data.fechaEmision    = Validators.normalizarFecha(data.fechaEmision);
    data.fechaVencimiento= Validators.normalizarFecha(data.fechaVencimiento);

    // --- Validaciones ---
    data.validaciones = {
      dni: Validators.validarDNI(data.dni),
      cuil: data.cuil ? Validators.validarCUIL(data.cuil) : null,
      fechaNacimiento: data.fechaNacimiento ? Validators.validarFecha(data.fechaNacimiento) : null,
      edad: data.fechaNacimiento ? Validators.calcularEdad(data.fechaNacimiento) : null
    };

    return data;
  }

  /**
   * Parser del OCR del anverso (menos fiable)
   */
  function parsearOCR(texto) {
    if (!texto) return null;
    const raw = texto.replace(/\s+/g, ' ').trim();
    const upper = raw.toUpperCase();

    const data = {
      metodo: 'ocr',
      raw: texto,
      dni: null,
      apellido: null,
      nombre: null,
      sexo: null,
      fechaNacimiento: null,
      fechaEmision: null,
      fechaVencimiento: null,
      ejemplar: null,
      tramite: null,
      cuil: null,
      nacionalidad: null,
      validaciones: {}
    };

    // Número de DNI
    const mDni = upper.match(/\bDNI[:\s]*(\d{7,8})\b/) || upper.match(/\b(\d{8})\b/);
    if (mDni) data.dni = mDni[1];

    // Fechas
    const fechas = upper.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g) || [];
    if (fechas[0]) data.fechaNacimiento = fechas[0];
    if (fechas[1]) data.fechaEmision = fechas[1];
    if (fechas[2]) data.fechaVencimiento = fechas[2];

    // Sexo
    if (/\bMASCULINO\b|\bM\b(?=\s*\d)/.test(upper)) data.sexo = 'M';
    else if (/\bFEMENINO\b|\bF\b(?=\s*\d)/.test(upper)) data.sexo = 'F';

    // Nacionalidad
    if (/ARGENTIN/.test(upper)) data.nacionalidad = 'ARGENTINA';

    // Ejemplar
    const mEj = upper.match(/EJEMPLAR[:\s]*([A-Z])\b/);
    if (mEj) data.ejemplar = mEj[1];

    // Trámite
    const mTr = upper.match(/TR[AÁ]MITE[:\s]*(\d{11})/);
    if (mTr) data.tramite = mTr[1];

    // CUIL
    const mCuil = upper.match(/\b(\d{2}[-\s]?\d{8}[-\s]?\d)\b/);
    if (mCuil) data.cuil = mCuil[1];

    // Apellido / nombre: buscar líneas en mayúsculas
    const lineas = raw.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    const candidatos = lineas.filter(l =>
      /^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(l.toUpperCase()) &&
      !/ARGENTINA|REPUBLICA|DNI|EJEMPLAR|TRAMITE|NACIONALIDAD|MASCULINO|FEMENINO/.test(l.toUpperCase())
    );
    if (candidatos[0]) data.apellido = candidatos[0].toUpperCase();
    if (candidatos[1]) data.nombre = candidatos[1].toUpperCase();

    // Normalizar fechas
    data.fechaNacimiento = Validators.normalizarFecha(data.fechaNacimiento);
    data.fechaEmision    = Validators.normalizarFecha(data.fechaEmision);
    data.fechaVencimiento= Validators.normalizarFecha(data.fechaVencimiento);

    // Validaciones
    data.validaciones = {
      dni: Validators.validarDNI(data.dni),
      cuil: data.cuil ? Validators.validarCUIL(data.cuil) : null,
      fechaNacimiento: data.fechaNacimiento ? Validators.validarFecha(data.fechaNacimiento) : null,
      edad: data.fechaNacimiento ? Validators.calcularEdad(data.fechaNacimiento) : null
    };

    return data;
  }

  return { parsearPDF417, parsearOCR };
})();
