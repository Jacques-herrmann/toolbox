import { store } from '../shared/store.js';
import { detectCorners, defaultCorners, process, loadCV } from './detect.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm';
const db = store('scan');
const $ = (s) => document.querySelector(s);

/** @type {{src: HTMLCanvasElement, corners: {x:number,y:number}[], filter: string, out: HTMLCanvasElement, thumb: string}[]} */
let pages = [];

// ---------- UI utilitaires ----------
function busy(text) {
  $('#busy').classList.toggle('hidden', !text);
  if (text) $('#busyText').textContent = text;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Réglages ----------
const settings = () => ({ url: (db.get('url', '') || '').replace(/\/+$/, ''), key: db.get('key', '') });
$('#openSettings').onclick = () => $('#settings').classList.toggle('hidden');
$('#sUrl').value = settings().url;
$('#sKey').value = settings().key;
if (!settings().url) $('#settings').classList.remove('hidden');
$('#sSave').onclick = () => {
  db.set('url', $('#sUrl').value.trim());
  db.set('key', $('#sKey').value.trim());
  $('#sStatus').textContent = 'Enregistré.';
};
$('#sTest').onclick = async () => {
  $('#sSave').onclick();
  const { url, key } = settings();
  $('#sStatus').textContent = 'Test…';
  try {
    const r = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    $('#sStatus').innerHTML = j.twake
      ? `✅ Serveur OK, Twake connecté (${esc(j.instance)})`
      : `⚠️ Serveur OK mais Twake pas encore connecté : <a href="${esc(url)}/setup?key=${encodeURIComponent(key)}" target="_blank">connecter Twake</a>`;
  } catch (e) {
    $('#sStatus').textContent = `❌ ${e.message}`;
  }
};

// ---------- Chargement des images ----------
async function fileToCanvas(file, maxSide = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

async function addFiles(files) {
  for (const file of files) {
    busy('Lecture de l’image…');
    try {
      const src = await fileToCanvas(file);
      busy('Détection du document…');
      let corners = null;
      try { corners = await detectCorners(src); } catch (e) { console.warn(e); }
      busy(null);
      const page = await edit({ src, corners: corners || defaultCorners(src.width, src.height), filter: db.get('filter', 'auto') });
      if (page) { pages.push(page); renderPages(); }
    } catch (e) {
      busy(null);
      alert(`Impossible de lire l'image : ${e.message}`);
    }
  }
}
$('#camera').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#import').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
// Précharge OpenCV en arrière-plan
setTimeout(() => loadCV().catch(() => {}), 500);

// ---------- Éditeur de coins ----------
function edit(page) {
  return new Promise((resolve) => {
    let { src, corners, filter } = page;
    corners = corners.map((p) => ({ ...p }));
    const canvas = $('#edCanvas'), svg = $('#edSvg');
    const draw = () => {
      canvas.width = src.width; canvas.height = src.height;
      canvas.getContext('2d').drawImage(src, 0, 0);
      svg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      drawOverlay();
    };
    const r = () => Math.max(src.width, src.height) / 40;
    const drawOverlay = () => {
      const pts = corners.map((p) => `${p.x},${p.y}`).join(' ');
      svg.innerHTML = `<polygon points="${pts}" fill="rgba(62,207,142,.18)" stroke="#3ecf8e" stroke-width="${r() / 4}"/>` +
        corners.map((p, i) => `<circle data-i="${i}" cx="${p.x}" cy="${p.y}" r="${r()}" fill="rgba(62,207,142,.35)" stroke="#fff" stroke-width="${r() / 5}"/>`).join('');
    };
    const setFilterButtons = () => document.querySelectorAll('#filters button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === filter));

    let dragging = null;
    const toLocal = (e) => {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.min(src.width, Math.max(0, pt.x)), y: Math.min(src.height, Math.max(0, pt.y)) };
    };
    svg.onpointerdown = (e) => {
      const p = toLocal(e);
      // coin le plus proche (tolérance large pour les doigts)
      let best = -1, bd = Infinity;
      corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
      if (bd < r() * 4) { dragging = best; svg.setPointerCapture(e.pointerId); }
    };
    svg.onpointermove = (e) => { if (dragging !== null) { corners[dragging] = toLocal(e); drawOverlay(); } };
    svg.onpointerup = svg.onpointercancel = () => { dragging = null; };

    document.querySelectorAll('#filters button').forEach((b) => (b.onclick = () => { filter = b.dataset.f; setFilterButtons(); }));
    $('#edRotate').onclick = () => {
      const c = document.createElement('canvas');
      c.width = src.height; c.height = src.width;
      const ctx = c.getContext('2d');
      ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0);
      // rotation 90° horaire : (x, y) → (H - y, x), puis réordonner
      const H = src.height;
      const rot = corners.map((p) => ({ x: H - p.y, y: p.x }));
      corners = [rot[3], rot[0], rot[1], rot[2]];
      src = c;
      draw();
    };
    $('#edDetect').onclick = async () => {
      busy('Détection…');
      try { corners = (await detectCorners(src)) || defaultCorners(src.width, src.height); } catch (e) { alert(e.message); }
      busy(null); drawOverlay();
    };
    $('#edFull').onclick = () => { corners = [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }]; drawOverlay(); };

    const close = (value) => { $('#editor').classList.add('hidden'); resolve(value); };
    $('#edCancel').onclick = () => close(null);
    $('#edOk').onclick = async () => {
      busy('Traitement…');
      try {
        const out = await process(src, corners, filter);
        db.set('filter', filter);
        close({ src, corners, filter, out, thumb: thumbOf(out) });
      } catch (e) {
        alert(`Erreur de traitement : ${e.message}`);
      } finally { busy(null); }
    };

    setFilterButtons();
    draw();
    $('#editor').classList.remove('hidden');
  });
}

function thumbOf(canvas) {
  const s = 300 / Math.max(canvas.width, canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

// ---------- Liste des pages ----------
function renderPages() {
  const box = $('#pages');
  box.innerHTML = '';
  pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = `<img alt="Page ${i + 1}" src="${p.thumb}"><span class="n">${i + 1}</span><button class="x" aria-label="Retirer">✕</button>`;
    el.onclick = async () => { const np = await edit(p); if (np) { pages[i] = np; renderPages(); } };
    el.querySelector('.x').onclick = (e) => { e.stopPropagation(); pages.splice(i, 1); renderPages(); };
    box.append(el);
  });
  $('#sendBox').classList.toggle('hidden', !pages.length);
}
$('#clear').onclick = () => { if (confirm('Effacer toutes les pages ?')) { pages = []; renderPages(); $('#result').classList.add('hidden'); } };

// ---------- PDF ----------
async function buildPdf() {
  const { jsPDF } = await import(JSPDF_URL);
  let pdf = null;
  for (const p of pages) {
    const landscape = p.out.width > p.out.height;
    const [pw, ph] = landscape ? [297, 210] : [210, 297];
    if (!pdf) pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'l' : 'p', compress: true });
    else pdf.addPage('a4', landscape ? 'l' : 'p');
    // JPEG ~200 dpi max sur A4
    const maxW = landscape ? 2339 : 1654;
    const s = Math.min(1, maxW / p.out.width);
    const c = document.createElement('canvas');
    c.width = Math.round(p.out.width * s); c.height = Math.round(p.out.height * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(p.out, 0, 0, c.width, c.height);
    const ratio = Math.min(pw / c.width, ph / c.height);
    const w = c.width * ratio, h = c.height * ratio;
    pdf.addImage(c.toDataURL('image/jpeg', p.filter === 'bw' ? 0.7 : 0.82), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
  }
  return pdf.output('blob');
}

$('#download').onclick = async () => {
  busy('Création du PDF…');
  try {
    const blob = await buildPdf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scan-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) { alert(e.message); } finally { busy(null); }
};

// ---------- Envoi ----------
$('#send').onclick = async () => {
  const { url, key } = settings();
  if (!url || !key) { $('#settings').classList.remove('hidden'); return alert('Configure d’abord le serveur (⚙️).'); }
  busy('Création du PDF…');
  try {
    const blob = await buildPdf();
    busy('Analyse par l’IA et rangement dans Twake…');
    const r = await fetch(`${url}/scan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/pdf',
        'X-Note': encodeURIComponent($('#note').value.trim()),
      },
      body: blob,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    showResult(j);
    const hist = db.get('history', []);
    hist.unshift({ at: Date.now(), path: j.path, name: j.filename, link: j.link });
    db.set('history', hist.slice(0, 20));
    renderHistory();
    pages = []; renderPages(); $('#note').value = '';
  } catch (e) {
    alert(`Envoi impossible : ${e.message}\n\nTes pages sont conservées, tu peux réessayer ou télécharger le PDF.`);
  } finally { busy(null); }
};

function showResult(j) {
  const box = $('#result');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="stack" style="gap:6px">
      <strong>✅ Rangé dans Twake</strong>
      <div>📁 <b>${esc(j.path)}</b>${j.createdFolder ? ' <span class="muted">(nouveau dossier)</span>' : ''}</div>
      <div>📄 ${esc(j.filename)}</div>
      <div class="muted">${esc(j.docType)} — ${esc(j.summary)}</div>
      ${j.link ? `<a href="${esc(j.link)}" target="_blank" rel="noopener">Ouvrir le dossier</a>` : ''}
    </div>`;
}

function renderHistory() {
  const hist = db.get('history', []);
  $('#historyBox').classList.toggle('hidden', !hist.length);
  $('#history').innerHTML = hist.map((h) =>
    `<li>${new Date(h.at).toLocaleDateString('fr-FR')} — ${h.link ? `<a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.path)}</a>` : esc(h.path)} / ${esc(h.name)}</li>`).join('');
}

renderPages();
renderHistory();
