// Détection des bords du document, redressement et filtres — via OpenCV.js (chargé à la demande).
const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

let cvPromise = null;
export function loadCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENCV_URL;
    s.async = true;
    s.onerror = () => { cvPromise = null; reject(new Error('OpenCV introuvable (hors-ligne ?)')); };
    // L'objet `cv` est un « thenable » Emscripten : l'attendre avec await boucle à l'infini.
    // On attend donc que le runtime soit prêt (cv.Mat défini), puis on retire `then`.
    s.onload = () => {
      const started = Date.now();
      const check = () => {
        const cv = window.cv;
        if (cv && cv.Mat) {
          if (typeof cv.then === 'function') delete cv.then;
          return resolve(cv);
        }
        if (Date.now() - started > 60000) { cvPromise = null; return reject(new Error('OpenCV ne s’initialise pas')); }
        setTimeout(check, 50);
      };
      check();
    };
    document.head.append(s);
  });
  return cvPromise;
}

// Ordonne 4 points : haut-gauche, haut-droite, bas-droite, bas-gauche.
function order(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}

export function defaultCorners(w, h) {
  const m = Math.round(Math.min(w, h) * 0.04);
  return [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }];
}

// Retourne 4 coins en coordonnées du canvas source, ou null si rien trouvé.
export async function detectCorners(canvas) {
  const cv = await loadCV();
  const scale = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
  const src = cv.imread(canvas);
  const small = new cv.Mat(), gray = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try {
    cv.resize(src, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    // Fermeture morphologique : efface le texte pour ne garder que la forme de la feuille
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, k);
    k.delete();
    cv.Canny(gray, edges, 40, 120);
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, k2);
    k2.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minArea = small.cols * small.rows * 0.15;
    let best = null, bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < minArea || area <= bestArea) { c.delete(); continue; }
      const approx = new cv.Mat();
      const peri = cv.arcLength(c, true);
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      let pts = null;
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        pts = [];
        for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
      } else if (area > minArea * 1.5) {
        // Pas un quadrilatère net : on prend le rectangle orienté minimal
        const rect = cv.minAreaRect(c);
        pts = cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y }));
      }
      approx.delete();
      c.delete();
      if (pts) { best = pts; bestArea = area; }
    }
    if (!best) return null;
    return order(best.map((p) => ({
      x: Math.min(canvas.width, Math.max(0, p.x / scale)),
      y: Math.min(canvas.height, Math.max(0, p.y / scale)),
    })));
  } finally {
    src.delete(); small.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Redresse la zone délimitée par les 4 coins et applique un filtre.
// filter : 'auto' (couleur sans ombres), 'gray', 'bw' (noir & blanc), 'none'
export async function process(canvas, corners, filter = 'auto', maxSide = 2000) {
  const cv = await loadCV();
  const [tl, tr, br, bl] = corners;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * s); h = Math.round(h * s);

  const src = cv.imread(canvas);
  const out = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    let result = out;
    if (filter === 'auto') result = removeShadows(cv, out, true);
    else if (filter === 'gray') result = removeShadows(cv, out, false);
    else if (filter === 'bw') {
      const g = new cv.Mat();
      cv.cvtColor(out, g, cv.COLOR_RGBA2GRAY);
      cv.adaptiveThreshold(g, g, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 12);
      result = g;
    }
    const dst = document.createElement('canvas');
    cv.imshow(dst, result);
    if (result !== out) result.delete();
    return dst;
  } finally {
    src.delete(); out.delete(); from.delete(); to.delete(); M.delete();
  }
}

// Estime le fond (papier + ombres) et le divise : fond blanc, encre conservée.
function removeShadows(cv, rgba, keepColor) {
  const rgb = new cv.Mat();
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  const input = new cv.Mat();
  if (keepColor) rgb.copyTo(input); else cv.cvtColor(rgb, input, cv.COLOR_RGB2GRAY);
  rgb.delete();

  const channels = new cv.MatVector();
  cv.split(input, channels);
  const outCh = new cv.MatVector();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  const blurSize = Math.max(21, Math.round(Math.max(input.cols, input.rows) / 40) | 1);
  for (let i = 0; i < channels.size(); i++) {
    const ch = channels.get(i);
    const bg = new cv.Mat();
    cv.dilate(ch, bg, kernel);
    cv.medianBlur(bg, bg, blurSize % 2 ? blurSize : blurSize + 1);
    const norm = new cv.Mat();
    // ch / bg * 255  → supprime les ombres et blanchit le papier
    cv.divide(ch, bg, norm, 255);
    outCh.push_back(norm);
    ch.delete(); bg.delete(); norm.delete();
  }
  const merged = new cv.Mat();
  cv.merge(outCh, merged);
  // léger contraste
  merged.convertTo(merged, -1, 1.15, -20);
  input.delete(); channels.delete(); outCh.delete(); kernel.delete();
  return merged;
}
