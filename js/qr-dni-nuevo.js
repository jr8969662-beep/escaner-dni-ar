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

  // Para el video en vivo (la tarjeta puede estar en cualquier parte del cuadro): cuadro entero
  const INTENTOS_FRAME = [{ x: 0, y: 0, w: 1, h: 1, anchos: [1920, 2800] }];

  // opciones.modo === 'frame' -> busca en todo el cuadro (cámara en vivo). Por defecto asume tarjeta encuadrada.
  // opciones.anchos -> anchos de trabajo en px (para fotos subidas conviene el tamaño original).
  async function decodificar(canvas, opciones = {}) {
    if (typeof jsQR === 'undefined' || !canvas) return null;
    const lista = opciones.modo === 'frame' ? INTENTOS_FRAME : INTENTOS;
    for (const it of lista) {
      const sx = Math.round(canvas.width * it.x), sy = Math.round(canvas.height * it.y);
      const sw = Math.round(canvas.width * it.w), sh = Math.round(canvas.height * it.h);
      for (const ancho of (opciones.anchos || it.anchos)) {
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
          if (datos) {
            const L = res.location, mp = (q) => ({ x: sx + q.x / esc, y: sy + q.y / esc });
            return {
              texto: res.data, datos,
              ubicacion: L ? { tl: mp(L.topLeftCorner), tr: mp(L.topRightCorner), br: mp(L.bottomRightCorner), bl: mp(L.bottomLeftCorner) } : null
            };
          }
        }
      }
    }
    return null;
  }

  // Estima dónde está la tarjeta a partir del QR (que está siempre en el mismo lugar del dorso).
  // Medido en un DNI nuevo real: el QR mide 0,2015 del ancho de la tarjeta y su centro cae en (0,8556; 0,4067).
  // Devuelve un rectángulo {x, y, w, h} en píxeles del cuadro, con margen, o null si no es creíble.
  function rectTarjeta(u, W, H, margen = 0.08) {
    if (!u) return null;
    const qrW = Math.hypot(u.tr.x - u.tl.x, u.tr.y - u.tl.y);
    if (!(qrW > 20)) return null;
    const cx = (u.tl.x + u.tr.x + u.br.x + u.bl.x) / 4, cy = (u.tl.y + u.tr.y + u.br.y + u.bl.y) / 4;
    const cw = qrW / 0.2015, ch = cw / 1.586;
    let x = cx - 0.8556 * cw, y = cy - 0.4067 * ch, w = cw, h = ch;
    x -= w * margen; y -= h * margen; w *= 1 + 2 * margen; h *= 1 + 2 * margen;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const r = { x: x0, y: y0, w: Math.min(W, x + w) - x0, h: Math.min(H, y + h) - y0 };
    return r.w > 100 && r.h > 60 ? r : null;
  }

  return { decodificar, parsear, rectTarjeta };
})();
