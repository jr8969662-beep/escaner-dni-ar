/**
 * QR del DNI argentino NUEVO (policarbonato, dorso).
 *
 * Formato (verificado decodificando el QR de un DNI nuevo real):
 *   TRÁMITE(11) @ APELLIDO @ NOMBRES @ DNI(8) @ EJEMPLAR(1 letra) @ dd/mm/aa nacimiento @ dd/mm/aa emisión @ FIRMA
 * La firma es un token en base64url (3 partes separadas por "."). NO trae sexo, vencimiento,
 * domicilio ni CUIL: el sexo y el vencimiento salen de la MRZ y el resto del texto impreso (OCR).
 * La firma NO se puede verificar desde acá (no tenemos la clave pública): no asegura autenticidad.
 *
 * El QR es MUY denso (~480 caracteres): con módulos de pocos píxeles jsQR no lo lee. Por eso se prueba
 * en varias zonas y escalas. Usa jsQR (ya cargado en index.html).
 *
 * Uso:  const r = await QRDNINuevo.decodificar(canvasDeLaTarjeta);  // { texto, datos } o null
 *       const datos = QRDNINuevo.parsear(textoDelQR);               // o null si no es de este formato
 */
const QRDNINuevo = (() => {
  'use strict';

  function aISO(s, esNacimiento) {
    const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec((s || '').trim());
    if (!m) return null;
    let y = +m[3];
    if (m[3].length === 2) {
      const actual = new Date().getFullYear() % 100;
      y = esNacimiento ? (y > actual ? 1900 + y : 2000 + y) : 2000 + y;
    }
    return `${y}-${m[2]}-${m[1]}`;
  }

  function parsear(texto) {
    if (!texto || texto.indexOf('@') < 0) return null;
    const c = texto.trim().split('@');
    if (c.length < 7) return null;
    const [tramite, apellido, nombres, dni, ejemplar, nac, emi] = c.map(x => x.trim());
    if (!/^\d{8,11}$/.test(tramite) || !/^\d{7,8}$/.test(dni) || !apellido || !nombres) return null;
    const fechaNacimiento = aISO(nac, true);
    if (!fechaNacimiento) return null;
    return {
      tramite, apellido: apellido.toUpperCase(), nombre: nombres.toUpperCase(), dni,
      ejemplar: /^[A-Z]$/i.test(ejemplar) ? ejemplar.toUpperCase() : null,
      fechaNacimiento, fechaEmision: aISO(emi, false),
      conFirma: c.slice(7).join('@').length > 100
    };
  }

  const pausa = () => new Promise(r => setTimeout(r, 0)); // deja respirar a la interfaz entre intentos

  // Zona del QR en el dorso (arriba a la derecha) y la tarjeta completa, en varias escalas
  const INTENTOS = [
    { x: 0.55, y: 0.08, w: 0.45, h: 0.62, anchos: [1200, 1800] },
    { x: 0, y: 0, w: 1, h: 1, anchos: [2400, 3200] }
  ];

  async function decodificar(canvas) {
    if (typeof jsQR === 'undefined' || !canvas) return null;
    for (const it of INTENTOS) {
      const sx = Math.round(canvas.width * it.x), sy = Math.round(canvas.height * it.y);
      const sw = Math.round(canvas.width * it.w), sh = Math.round(canvas.height * it.h);
      for (const ancho of it.anchos) {
        const esc = ancho / sw;
        const w = Math.round(sw * esc), h = Math.round(sh * esc);
        if (w * h > 9e6) continue;
        await pausa();
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (res && res.data) {
          const datos = parsear(res.data);
          if (datos) return { texto: res.data, datos };
        }
      }
    }
    return null;
  }

  return { decodificar, parsear };
})();
