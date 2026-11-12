/**
 * Encuadre automático: busca los 4 bordes del DNI en la foto y lo deja derecho y recortado (como escaneado),
 * aunque la foto se haya sacado torcida o en ángulo.
 *
 * Uso:  const r = Encuadre.enderezar(canvas, zona);   // zona opcional { x, y, w, h } donde se espera el DNI
 *       r = { canvas, esquinas } o null si no encontró los bordes con seguridad (entonces se usa la foto como está).
 *
 * Cómo: achica la foto, marca los bordes (Sobel), busca líneas casi horizontales y casi verticales (Hough),
 * prueba combinaciones de 4 líneas y se queda con el rectángulo que tiene la forma de un DNI (85,6 x 54 mm).
 * Después corrige la perspectiva sobre la foto en tamaño completo.
 */
'use strict';
const Encuadre = (() => {
  const PROP = 85.6 / 54;   // proporción del DNI (tarjeta ID-1)
  const ANCHO_TRABAJO = 360;

  function grises(c, zona) {
    const k = ANCHO_TRABAJO / zona.w, W = ANCHO_TRABAJO, H = Math.max(40, Math.round(zona.h * k));
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const cx = t.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(c, zona.x, zona.y, zona.w, zona.h, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { g, W, H, k };
  }

  function suavizar(g, W, H) {   // dos pasadas de caja 3x3 (≈ gaussiano): saca la textura fina del fondo y del DNI
    const a = Float32Array.from(g), b = new Float32Array(g.length);
    for (let p = 0; p < 2; p++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const x0 = x > 0 ? x - 1 : x, x1 = x < W - 1 ? x + 1 : x, o = y * W;
        b[o + x] = (a[o + x0] + a[o + x] + a[o + x1]) / 3;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const y0 = y > 0 ? y - 1 : y, y1 = y < H - 1 ? y + 1 : y;
        a[y * W + x] = (b[y0 * W + x] + b[y * W + x] + b[y1 * W + x]) / 3;
      }
    }
    return a;
  }

  // Hough limitado: solo líneas a ±25° de horizontal o vertical, y cada borde vota solo cerca de su propia dirección
  function lineas(s, W, H) {
    const mag = new Float32Array(W * H), ang = new Float32Array(W * H);
    let max = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (s[i - W + 1] + 2 * s[i + 1] + s[i + W + 1]) - (s[i - W - 1] + 2 * s[i - 1] + s[i + W - 1]);
      const gy = (s[i + W - 1] + 2 * s[i + W] + s[i + W + 1]) - (s[i - W - 1] + 2 * s[i - W] + s[i - W + 1]);
      const m = Math.hypot(gx, gy); mag[i] = m; ang[i] = Math.atan2(gy, gx); if (m > max) max = m;
    }
    if (max < 20) return null;
    // umbral: el 10 % de los píxeles con más borde
    const hist = new Uint32Array(256);
    for (let i = 0; i < mag.length; i++) hist[Math.min(255, Math.floor(mag[i] / max * 255))]++;
    let acum = 0, um = 255; const meta = mag.length * 0.10;
    for (let b = 255; b >= 0; b--) { acum += hist[b]; if (acum >= meta) { um = b; break; } }
    const umbral = Math.max(um / 255 * max, max * 0.08);

    const RMAX = Math.ceil(Math.hypot(W, H)), NR = 2 * RMAX + 1;
    const grados = []; for (let t = -25; t <= 25; t++) grados.push(t);
    const fam = { h: grados.map((t) => (90 + t) * Math.PI / 180), v: grados.map((t) => t * Math.PI / 180) };
    const acc = { h: new Float32Array(grados.length * NR), v: new Float32Array(grados.length * NR) };
    const trig = { h: fam.h.map((t) => [Math.cos(t), Math.sin(t)]), v: fam.v.map((t) => [Math.cos(t), Math.sin(t)]) };
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mag[i]; if (m < umbral) continue;
      let a = ang[i]; if (a < 0) a += Math.PI;   // dirección del gradiente (normal de la línea), 0..180°
      const gr = a * 180 / Math.PI;
      let f, centro;
      if (Math.abs(gr - 90) <= 30) { f = 'h'; centro = gr - 90; }
      else if (gr <= 30) { f = 'v'; centro = gr; } else if (gr >= 150) { f = 'v'; centro = gr - 180; }
      else continue;
      const t0 = Math.max(0, Math.round(centro) + 25 - 6), t1 = Math.min(grados.length - 1, Math.round(centro) + 25 + 6);
      const A = acc[f], T = trig[f];
      for (let t = t0; t <= t1; t++) {
        const r = Math.round(x * T[t][0] + y * T[t][1]) + RMAX;
        A[t * NR + r] += m;
      }
    }
    // picos (supresión de no-máximos)
    const picos = (f) => {
      const A = acc[f], out = [];
      for (let t = 0; t < grados.length; t++) for (let r = 1; r < NR - 1; r++) {
        const v = A[t * NR + r]; if (v <= 0) continue;
        let esMax = true;
        for (let dt = -3; dt <= 3 && esMax; dt++) for (let dr = -5; dr <= 5; dr++) {
          const tt = t + dt, rr = r + dr; if (tt < 0 || tt >= grados.length || rr < 0 || rr >= NR || (!dt && !dr)) continue;
          if (A[tt * NR + rr] > v) { esMax = false; break; }
        }
        if (esMax) out.push({ th: fam[f][t], rho: r - RMAX, v });
      }
      out.sort((a, b) => b.v - a.v);
      return out.slice(0, 14);
    };
    return { h: picos('h'), v: picos('v'), max, mag, ang, umbral };
  }

  const cruce = (a, b) => {
    const c1 = Math.cos(a.th), s1 = Math.sin(a.th), c2 = Math.cos(b.th), s2 = Math.sin(b.th), det = c1 * s2 - s1 * c2;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (a.rho * s2 - b.rho * s1) / det, y: (b.rho * c1 - a.rho * c2) / det };
  };
  const yEn = (l, x) => (l.rho - x * Math.cos(l.th)) / Math.sin(l.th);
  const xEn = (l, y) => (l.rho - y * Math.sin(l.th)) / Math.cos(l.th);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  // fracción del lado p→q que tiene borde de verdad (fuerte y con la dirección del lado), mirando ±2 px de costado
  function apoyo(L, W, H, p, q) {
    const n = 48, lx = q.x - p.x, ly = q.y - p.y, len = Math.hypot(lx, ly) || 1, nx = -ly / len, ny = lx / len;
    const normal = Math.atan2(ny, nx);
    let si = 0, total = 0;
    for (let k = 2; k < n - 2; k++) {
      const t = k / (n - 1), x = p.x + lx * t, y = p.y + ly * t;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
      total++;
      for (let o = -2; o <= 2; o++) {
        const xi = Math.round(x + nx * o), yi = Math.round(y + ny * o), i = yi * W + xi;
        if (xi < 1 || yi < 1 || xi > W - 2 || yi > H - 2 || L.mag[i] < L.umbral * 0.6) continue;
        let d = Math.abs(L.ang[i] - normal) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d;
        if (d < 0.35) { si++; break; }
      }
    }
    return total < n / 3 ? 0 : si / total;
  }

  function mejorCuadro(L, W, H) {
    const cx = W / 2, cy = H / 2;
    const arr = L.h.filter((l) => yEn(l, cx) < cy).slice(0, 5), aba = L.h.filter((l) => yEn(l, cx) >= cy).slice(0, 5);
    const izq = L.v.filter((l) => xEn(l, cy) < cx).slice(0, 5), der = L.v.filter((l) => xEn(l, cy) >= cx).slice(0, 5);
    if (!arr.length || !aba.length || !izq.length || !der.length) return null;
    const vmax = Math.max(...L.h.map((l) => l.v), ...L.v.map((l) => l.v));
    let mejor = null;
    for (const a of arr) for (const b of aba) for (const i of izq) for (const d of der) {
      const p = [cruce(a, i), cruce(a, d), cruce(b, d), cruce(b, i)];   // sup-izq, sup-der, inf-der, inf-izq
      if (p.some((q) => !q || q.x < -W * 0.04 || q.x > W * 1.04 || q.y < -H * 0.04 || q.y > H * 1.04)) continue;
      const ancho = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2, alto = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2;
      if (alto < 20) continue;
      const prop = ancho / alto;
      if (prop < 1.3 || prop > 1.95) continue;
      // los lados opuestos tienen que medir parecido (la perspectiva de una foto de mano es leve)
      if (Math.min(dist(p[0], p[1]), dist(p[3], p[2])) / Math.max(dist(p[0], p[1]), dist(p[3], p[2])) < 0.75) continue;
      if (Math.min(dist(p[0], p[3]), dist(p[1], p[2])) / Math.max(dist(p[0], p[3]), dist(p[1], p[2])) < 0.75) continue;
      const area = ancho * alto / (W * H);
      if (area < 0.28) continue;
      const ap = [apoyo(L, W, H, p[0], p[1]), apoyo(L, W, H, p[1], p[2]), apoyo(L, W, H, p[2], p[3]), apoyo(L, W, H, p[3], p[0])];
      if (Math.min(...ap) < 0.45) continue;
      // cuánto borde real hay a lo largo de cada lado (largo de borde relativo): evita líneas sueltas del fondo
      const fuerza = (a.v / dist(p[0], p[1]) + b.v / dist(p[3], p[2]) + i.v / dist(p[0], p[3]) + d.v / dist(p[1], p[2]));
      const forma = Math.exp(-Math.pow((prop - PROP) / 0.18, 2));
      const puntaje = fuerza * forma * Math.sqrt(area) * (0.6 + 0.4 * Math.min(a.v, b.v, i.v, d.v) / vmax);
      if (!mejor || puntaje > mejor.puntaje) mejor = { p, puntaje, prop, area, fuerza, apoyo: Math.min(...ap) };
    }
    return mejor;
  }

  // homografía que lleva el rectángulo de salida (0,0)-(w,h) a las 4 esquinas de la foto
  function homografia(w, h, q) {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
    const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x, c = p0.x;
    const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y, f = p0.y;
    return (u, v) => { const s = u / w, t = v / h, z = g * s + hh * t + 1; return [(a * s + b * t + c) / z, (d * s + e * t + f) / z]; };
  }

  // Corrige la perspectiva con la placa de video (rápido): la salida se divide en una grilla de celdas chicas y cada celda
  // se dibuja con una transformación afín (en celdas chicas la diferencia con la perspectiva exacta no se ve).
  function afin(s0, s1, s2, d0, d1, d2) {   // transformación que lleva el triángulo s al triángulo d
    const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(den) < 1e-9) return null;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
    const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
    return [a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y];
  }
  function rectificar(c, q) {
    const ancho = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    const W = Math.max(500, Math.min(1800, Math.round(ancho))), H = Math.round(W / PROP);
    const o = document.createElement('canvas'); o.width = W; o.height = H;
    const cx = o.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    const M = homografia(W, H, q), NX = 24, NY = 15;
    const P = (u, v) => { const [x, y] = M(u, v); return { x, y }; };
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const u0 = Math.floor(W * i / NX), u1 = Math.ceil(W * (i + 1) / NX), v0 = Math.floor(H * j / NY), v1 = Math.ceil(H * (j + 1) / NY);
      const T = afin(P(u0, v0), P(u1, v0), P(u0, v1), { x: u0, y: v0 }, { x: u1, y: v0 }, { x: u0, y: v1 });
      if (!T) continue;
      cx.save();
      cx.beginPath(); cx.rect(u0, v0, u1 - u0 + (i < NX - 1 ? 1 : 0), v1 - v0 + (j < NY - 1 ? 1 : 0)); cx.clip();
      cx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
      cx.drawImage(c, 0, 0);
      cx.restore();
    }
    return o;
  }

  function enderezar(c, zona) {
    try {
      if (!c || !c.width || !c.height) return null;
      // zona de búsqueda: la indicada (agrandada un poco por si el DNI se sale del marco) o toda la foto
      let z = { x: 0, y: 0, w: c.width, h: c.height };
      if (zona && zona.w > 50 && zona.h > 30) {
        const mx = zona.w * 0.12, my = zona.h * 0.12;
        const x0 = Math.max(0, zona.x - mx), y0 = Math.max(0, zona.y - my);
        const x1 = Math.min(c.width, zona.x + zona.w + mx), y1 = Math.min(c.height, zona.y + zona.h + my);
        z = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      const { g, W, H, k } = grises(c, z);
      const L = lineas(suavizar(g, W, H), W, H);
      if (!L) return null;
      const m = mejorCuadro(L, W, H);
      if (!m) return null;
      // esquinas en la foto completa, apenas hacia adentro para no dejar fondo en las puntas
      const cen = { x: (m.p[0].x + m.p[1].x + m.p[2].x + m.p[3].x) / 4, y: (m.p[0].y + m.p[1].y + m.p[2].y + m.p[3].y) / 4 };
      const esquinas = m.p.map((p) => ({
        x: Math.max(0, Math.min(c.width - 1, z.x + (p.x + (cen.x - p.x) * 0.004) / k)),
        y: Math.max(0, Math.min(c.height - 1, z.y + (p.y + (cen.y - p.y) * 0.004) / k)),
      }));
      return { canvas: rectificar(c, esquinas), esquinas, prop: m.prop, area: m.area, apoyo: m.apoyo };
    } catch (e) { return null; }
  }

  return { enderezar };
})();
if (typeof window !== 'undefined') window.Encuadre = Encuadre;
