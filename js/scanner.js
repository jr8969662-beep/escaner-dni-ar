const DNIScanner = (() => {
  let barcodeDetector = null;
  let zxingReader = null;
  const barcodeDisponible = typeof BarcodeDetector !== 'undefined';
  const zxingDisponible = typeof ZXing !== 'undefined';
  const jsQRDisponible = typeof jsQR === 'function';

  const FORMATOS = ['pdf417', 'qr_code', 'code_128', 'code_39', 'data_matrix', 'aztec'];
  if (barcodeDisponible) {
    try {
      barcodeDetector = new BarcodeDetector({ formats: FORMATOS });
    } catch (e) { barcodeDetector = null; }
  }
  // v46: si el detector propio del navegador no lee PDF417 (o no hay), se usa ZXing-C++ (barcode-detector, WebAssembly)
  const ZXCpp = typeof BarcodeDetectionAPI !== 'undefined' && BarcodeDetectionAPI.BarcodeDetector;
  if (ZXCpp) {
    const usarZX = () => { try { barcodeDetector = new ZXCpp({ formats: FORMATOS }); } catch (e) { /* queda el que había */ } };
    if (!barcodeDetector) usarZX();
    else if (barcodeDetector.constructor !== ZXCpp && typeof BarcodeDetector.getSupportedFormats === 'function') {
      BarcodeDetector.getSupportedFormats().then((f) => { if (!f || !f.includes('pdf417')) usarZX(); }).catch(usarZX);
    }
  }
  if (zxingDisponible) {
    try {
      const hints = new Map();
      // Solo PDF417 (DNI viejo y cédulas): con menos formatos ZXing es mucho más rápido y la cámara no se traba.
      // Los QR los leen jsQR y el lector del DNI nuevo.
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.PDF_417
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 500 });
    } catch (e) { zxingReader = null; }
  }

  // Lector en un hilo aparte (no traba la cámara). Si no se puede crear, se usan ZXing/jsQR en el hilo principal.
  let lectorHilo = null;
  try { if (typeof Decodificador !== 'undefined' && Decodificador.soportado) lectorHilo = Decodificador.crear(); } catch (e) { lectorHilo = null; }
  const hiloOk = () => !!(lectorHilo && lectorHilo.disponible());
  let vueltaVariante = 0;

  // Función para saber si es el link del gobierno y descartarlo
  function esURLInvalida(txt) {
    return /^https?:\/\//i.test(txt) || /argentina\.gob\.ar/i.test(txt);
  }

  function extraerROI(canvasOriginal) {
    const w = canvasOriginal.width, h = canvasOriginal.height;
    // zona amplia: con el DNI llenando el marco el código queda cerca del borde inferior (un recorte chico lo cortaba)
    const roiW = Math.round(w * 0.94), roiH = Math.round(h * 0.9);
    const roiX = Math.round((w - roiW) / 2), roiY = Math.round((h - roiH) / 2);
    const roi = document.createElement('canvas');
    roi.width = roiW; roi.height = roiH;
    const ctx = roi.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvasOriginal, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
    return roi;
  }

  function medirBrillo(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height, paso = 20;
    const imgData = ctx.getImageData(0, 0, w, h), data = imgData.data;
    let suma = 0, muestras = 0;
    for (let y = 0; y < h; y += paso) {
      for (let x = 0; x < w; x += paso) {
        const i = (y * w + x) * 4;
        suma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        muestras++;
      }
    }
    return muestras > 0 ? suma / muestras : 0;
  }

  // Brillo del cuadro actual con una miniatura (antes se leían los píxeles del cuadro entero: ~8 MB cada vez)
  let cvBrillo = null;
  function medirBrilloVideo(video) {
    if (!cvBrillo) { cvBrillo = document.createElement('canvas'); cvBrillo.width = 48; cvBrillo.height = 27; }
    const cx = cvBrillo.getContext('2d', { willReadFrequently: true });
    cx.drawImage(video, 0, 0, 48, 27);
    const d = cx.getImageData(0, 0, 48, 27).data;
    let suma = 0; for (let i = 0; i < d.length; i += 4) suma += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return suma / (d.length / 4);
  }

  // Cámara en vivo, camino liviano: el navegador recorta y achica el cuadro (ImageBitmap) y el hilo aparte lo lee.
  // La hoja principal no dibuja ni copia píxeles: la imagen de la cámara se mueve fluida. Si el lector está ocupado, no se hace nada.
  async function escanearVideoEnHilo(video, anchoMax) {
    if (!lectorHilo.libre()) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (barcodeDetector) {
      try {
        const codigos = await barcodeDetector.detect(video);
        for (const cod of codigos || []) if (!esURLInvalida(cod.rawValue)) return cod.rawValue;
      } catch (e) {}
    }
    const escala = Math.min(1, anchoMax / vw);
    // zona del código (94 % x 90 % centrada); en cada cuadro una variante distinta: todo, mitad de abajo, abajo ampliado, todo ampliado
    const rx = Math.round(vw * 0.03), ry = Math.round(vh * 0.05), rw = Math.round(vw * 0.94), rh = Math.round(vh * 0.9);
    const variante = vueltaVariante++ % 4;
    let sy = ry, sh = rh, esc = 1;
    if (variante) {
      esc = variante === 1 ? 1 : variante === 2 ? 1.5 : 1.3;
      if (variante !== 3) { const off = Math.round(rh * 0.45); sy = ry + off; sh = rh - off; }
    }
    const k = escala * esc;
    const r = await lectorHilo.leerRegion(video, { sx: rx, sy, sw: rw, sh, w: rw * k, h: sh * k }, ['pdf417', 'qr'], 6000, false);   // en vivo sin el realce del QR (es lo más lento y acá no hace falta)
    if (r && r.texto && !esURLInvalida(r.texto)) return r.texto;
    return null;
  }
  const usaBitmap = () => !!(lectorHilo && lectorHilo.bitmapOk && lectorHilo.bitmapOk());

  // enVivo: si el lector del hilo aparte está ocupado se saltea el cuadro (no se acumulan pedidos ni se traba nada)
  async function escanearFrame(canvas, usarROI = true, enVivo = false) {
    const canvasEscaneo = usarROI ? extraerROI(canvas) : canvas;
    const ctx = canvasEscaneo.getContext('2d', { willReadFrequently: true });

    if (barcodeDetector) {
      try {
        const codigos = await barcodeDetector.detect(canvasEscaneo);
        for (const cod of codigos || []) if (!esURLInvalida(cod.rawValue)) return cod.rawValue;
      } catch (e) {}
    }
    if (hiloOk()) {
      if (enVivo && !lectorHilo.libre()) return null;
      // ZXing acierta o falla según el recorte y la escala: en cada cuadro se prueba una variante distinta
      // (todo, mitad de abajo donde está el código, mitad de abajo ampliada, todo ampliado)
      const variante = enVivo ? (vueltaVariante++ % 4) : 0;
      let img = canvasEscaneo;
      if (variante) {
        const W = canvasEscaneo.width, H = canvasEscaneo.height;
        const abajo = variante !== 3, esc = variante === 1 ? 1 : variante === 2 ? 1.5 : 1.3;
        const sy = abajo ? Math.round(H * 0.45) : 0, sh = H - sy;
        img = document.createElement('canvas');
        img.width = Math.round(W * esc); img.height = Math.round(sh * esc);
        const c2 = img.getContext('2d', { willReadFrequently: true }); c2.imageSmoothingQuality = 'high';
        c2.drawImage(canvasEscaneo, 0, sy, W, sh, 0, 0, img.width, img.height);
      }
      const r = await lectorHilo.leer(img, ['pdf417', 'qr']);
      if (r && r.texto && !esURLInvalida(r.texto)) return r.texto;
      if (hiloOk()) return null;   // si el hilo se cayó, sigue con los lectores de siempre
    }

    if (zxingReader) {
      try {
        const resultado = await zxingReader.decodeFromCanvas(canvasEscaneo);
        if (resultado && resultado.getText) {
          const txt = resultado.getText();
          if (!esURLInvalida(txt)) return txt;
        }
      } catch (e) {}
    }

    if (jsQRDisponible) {
      try {
        const imageData = ctx.getImageData(0, 0, canvasEscaneo.width, canvasEscaneo.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data && !esURLInvalida(qr.data)) return qr.data;
      } catch (e) {}
    }

    return null;
  }

  // Foto más nítida: al leer el código se miran unos pocos cuadros seguidos de la cámara y se queda el más definido
  // (el que tiene bordes más marcados en la zona del documento). Tarda ~150 ms y solo pasa una vez, al detectar.
  let cvNitidez = null;
  function nitidezCuadro(fuente) {
    if (!cvNitidez) { cvNitidez = document.createElement('canvas'); cvNitidez.width = 320; cvNitidez.height = 180; }
    const sw = fuente.width || fuente.videoWidth, sh = fuente.height || fuente.videoHeight;
    const cx = cvNitidez.getContext('2d', { willReadFrequently: true });
    cx.drawImage(fuente, sw * 0.2, sh * 0.2, sw * 0.6, sh * 0.6, 0, 0, 320, 180);
    const d = cx.getImageData(0, 0, 320, 180).data;
    let suma = 0;
    for (let y = 1; y < 179; y += 2) for (let x = 1; x < 319; x += 2) {
      const i = (y * 320 + x) * 4;   // canal verde: diferencia con el vecino de la derecha/izquierda y de abajo/arriba
      const gx = d[i + 5] - d[i - 3], gy = d[i + 1281] - d[i - 1279];
      suma += gx * gx + gy * gy;
    }
    return suma;
  }
  async function cuadroMasNitido(video, canvas, anchoMax) {
    const esc = Math.min(1, anchoMax / video.videoWidth);
    const w = Math.round(video.videoWidth * esc), h = Math.round(video.videoHeight * esc);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    let mejor = -1;
    try { mejor = nitidezCuadro(canvas); } catch (e) { return; }
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    for (let n = 0; n < 3; n++) {
      await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 40)));
      if (!video.srcObject || video.readyState < 2) break;
      tctx.drawImage(video, 0, 0, w, h);
      const v = nitidezCuadro(tmp);
      if (v > mejor) { mejor = v; ctx.drawImage(tmp, 0, 0); }
    }
  }

  function escanearContinuo(video, canvas, onDetected, onTimeout, opciones = {}) {
    const intervaloMs = opciones.intervaloMs || 300;
    const timeoutMs = opciones.timeoutMs || 20000;
    const anchoMax = opciones.anchoMax || 1920;
    const usarROI = opciones.usarROI !== false;
    const onBrillo = opciones.onBrillo;
    const framesConfirmacion = opciones.framesConfirmacion || 2;
    
    let activo = true, intentos = 0, ultimoTextoDetectado = null, framesConfirmados = 0, ultimoBrillo = 0;
    // con el lector en el hilo aparte la página no hace trabajo pesado: se puede mirar la cámara más seguido sin trabar nada
    // (si el lector todavía está ocupado con el cuadro anterior, la vuelta no hace nada)
    const esperaHilo = Math.min(intervaloMs, opciones.intervaloHiloMs || 100);
    const timer = setTimeout(() => { if (activo) { activo = false; if (onTimeout) onTimeout(); } }, timeoutMs);

    async function loop() {
      if (!activo) return;
      try {
        if (video.srcObject && video.readyState >= 2 && video.videoWidth && usaBitmap()) {
          const ahora = performance.now();
          if (onBrillo && ahora - ultimoBrillo > 1000) { ultimoBrillo = ahora; try { onBrillo(medirBrilloVideo(video)); } catch (e) {} }
          const texto = await escanearVideoEnHilo(video, anchoMax);
          if (texto && activo) {
            if (texto === ultimoTextoDetectado) framesConfirmados++; else { ultimoTextoDetectado = texto; framesConfirmados = 1; }
            if (framesConfirmados >= framesConfirmacion) {
              // el resto de la app usa este canvas como foto del documento: se dibuja el cuadro (una sola vez, al detectar)
              activo = false; clearTimeout(timer);
              try { await cuadroMasNitido(video, canvas, anchoMax); }
              catch (e) { const esc1 = Math.min(1, anchoMax / video.videoWidth); canvas.width = Math.round(video.videoWidth * esc1); canvas.height = Math.round(video.videoHeight * esc1); canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height); }
              onDetected(texto); return;
            }
          } else { ultimoTextoDetectado = null; framesConfirmados = 0; }
          intentos++;
        } else if (video.srcObject && video.readyState >= 2 && video.videoWidth) {
          const escala = Math.min(1, anchoMax / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * escala);
          canvas.height = Math.round(video.videoHeight * escala);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          if (intentos % 3 === 0 && onBrillo) {
            try { onBrillo(medirBrillo(canvas)); } catch (e) {}
          }

          const texto = await escanearFrame(canvas, usarROI, true);

          if (texto && activo) {
            if (texto === ultimoTextoDetectado) {
              framesConfirmados++;
            } else {
              ultimoTextoDetectado = texto;
              framesConfirmados = 1;
            }
            if (framesConfirmados >= framesConfirmacion) {
              activo = false; clearTimeout(timer); onDetected(texto); return;
            }
          } else {
            ultimoTextoDetectado = null; framesConfirmados = 0;
          }
          intentos++;
        }
      } catch (e) {}
      if (activo) setTimeout(() => requestAnimationFrame(loop), usaBitmap() ? esperaHilo : intervaloMs);
    }
    loop();
    return () => { activo = false; clearTimeout(timer); };
  }

  async function escanearImagen(imgElement) {
    const maxAncho = 1920, escala = Math.min(1, maxAncho / imgElement.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imgElement.width * escala);
    canvas.height = Math.round(imgElement.height * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    
    let texto = await escanearFrame(canvas, true);
    if (texto) return texto;
    if (hiloOk()) { for (let v = 1; v < 4; v++) { texto = await escanearFrame(canvas, true, true); if (texto) return texto; } }
    
    const c2 = document.createElement('canvas');
    c2.width = canvas.width * 2; c2.height = canvas.height * 2;
    const ctx2 = c2.getContext('2d', { willReadFrequently: true });
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(canvas, 0, 0, c2.width, c2.height);
    
    return await escanearFrame(c2, false);
  }

  return { escanearContinuo, escanearImagen, medirBrillo };
})();
