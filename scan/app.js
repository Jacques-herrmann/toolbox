import { store } from '../shared/store.js';
import { detectCorners, defaultCorners, process, loadCV } from './detect.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm';
const db = store('scan');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
};

/** @type {{src: HTMLCanvasElement, corners: {x:number,y:number}[], filter: string, out: HTMLCanvasElement, thumb: string}[]} */
let pages = [];

function busy(text, sub = '') {
  $('#busy').classList.toggle('hidden', !text);
  if (text) { $('#busyText').textContent = text; $('#busySub').textContent = sub; }
}

// ---------- Réglages & état de connexion ----------
const settings = () => ({ url: (db.get('url', '') || '').replace(/\/+$/, ''), key: db.get('key', '') });
function setDest(state, text) {
  const d = $('#dest');
  d.classList.toggle('on', state === 'on');
  d.querySelector('span').textContent = text;
}
async function checkConnection(verbose = false) {
  const { url, key } = settings();
  if (!url || !key) { setDest('off', 'non configuré'); return; }
  try {
    const r = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `erreur ${r.status}`);
    if (j.twake) setDest('on', `Twake · ${j.root}`);
    else setDest('off', 'Twake à connecter');
    if (verbose) {
      $('#sStatus').innerHTML = j.twake
        ? `<b>✓ Tout est prêt.</b> Les documents iront dans <code>${esc(j.root)}</code> sur ${esc(j.instance.replace('https://', ''))}.`
        : `Serveur joignable, mais Twake n'est pas encore connecté. <a href="${esc(url)}/setup?key=${encodeURIComponent(key)}" target="_blank" rel="noopener">Connecter Twake →</a>`;
    }
  } catch (e) {
    setDest('off', 'hors ligne');
    if (verbose) $('#sStatus').textContent = `✕ ${e.message}`;
  }
}
$('#openSettings').onclick = () => $('#settings').classList.toggle('hidden');
$('#sUrl').value = settings().url;
$('#sKey').value = settings().key;
if (!settings().url) $('#settings').classList.remove('hidden');
const saveSettings = () => { db.set('url', $('#sUrl').value.trim()); db.set('key', $('#sKey').value.trim()); };
$('#sSave').onclick = async () => { saveSettings(); $('#sStatus').textContent = 'Enregistré, vérification…'; await checkConnection(true); };
$('#sTest').onclick = async () => { saveSettings(); $('#sStatus').textContent = 'Vérification…'; await checkConnection(true); };

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
    busy('Lecture de la photo…');
    try {
      const src = await fileToCanvas(file);
      busy('Détection de la feuille…', 'Recherche des bords du document');
      let corners = null;
      try { corners = await detectCorners(src); } catch (e) { console.warn(e); }
      busy(null);
      const page = await edit({ src, corners: corners || defaultCorners(src.width, src.height), filter: db.get('filter', 'auto') });
      if (page) { pages.push(page); $('#result').classList.add('hidden'); renderPages(); }
    } catch (e) {
      busy(null);
      alert(`Impossible de lire l'image : ${e.message}`);
    }
  }
}
$('#camera').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#import').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
setTimeout(() => loadCV().catch(() => {}), 800); // préchargement d'OpenCV

// ---------- Éditeur de coins ----------
function edit(page) {
  return new Promise((resolve) => {
    let { src, corners, filter } = page;
    corners = corners.map((p) => ({ ...p }));
    const canvas = $('#edCanvas'), svg = $('#edSvg');
    const r = () => Math.max(src.width, src.height) / 38;
    const draw = () => {
      canvas.width = src.width; canvas.height = src.height;
      canvas.getContext('2d').drawImage(src, 0, 0);
      svg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      drawOverlay();
    };
    const drawOverlay = () => {
      const pts = corners.map((p) => `${p.x},${p.y}`).join(' ');
      const W = src.width, H = src.height, s = r();
      svg.innerHTML =
        `<path d="M0 0H${W}V${H}H0Z M${pts.split(' ').join(' L')} Z" fill="rgba(0,0,0,.5)" fill-rule="evenodd"/>` +
        `<polygon points="${pts}" fill="none" stroke="#4fc192" stroke-width="${s / 4}" stroke-linejoin="round"/>` +
        corners.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${s}" fill="rgba(79,193,146,.25)" stroke="#fff" stroke-width="${s / 4.5}"/><circle cx="${p.x}" cy="${p.y}" r="${s / 4}" fill="#fff"/>`).join('');
    };
    const setFilterButtons = () => document.querySelectorAll('#filters button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === filter));

    let dragging = null;
    const toLocal = (e) => {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.min(src.width, Math.max(0, pt.x)), y: Math.min(src.height, Math.max(0, pt.y)) };
    };
    svg.onpointerdown = (e) => {
      const p = toLocal(e);
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
      const H = src.height; // rotation 90° horaire : (x, y) → (H − y, x)
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
      busy('Redressement…', 'Perspective et nettoyage des ombres');
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
  const s = 360 / Math.max(canvas.width, canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

// ---------- Pages ----------
function renderPages() {
  const has = pages.length > 0;
  $('#empty').classList.toggle('hidden', has || !$('#result').classList.contains('hidden'));
  $('#doc').classList.toggle('hidden', !has);
  $('#quickSend').disabled = !has;
  $('#dockLabel').textContent = has ? 'Ajouter une page' : 'Scanner';
  $('#count').textContent = has ? `${pages.length} page${pages.length > 1 ? 's' : ''}` : '';
  const box = $('#pages');
  box.innerHTML = '';
  pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page';
    el.style.animationDelay = `${i * 40}ms`;
    el.innerHTML = `<img alt="Page ${i + 1}" src="${p.thumb}"><span class="n">${String(i + 1).padStart(2, '0')}</span><button class="x" aria-label="Retirer la page">${ICON.x}</button>`;
    el.onclick = async () => { const np = await edit(p); if (np) { pages[i] = np; renderPages(); } };
    el.querySelector('.x').onclick = (e) => { e.stopPropagation(); pages.splice(i, 1); renderPages(); };
    box.append(el);
  });
  if (has) {
    const add = document.createElement('label');
    add.className = 'page add';
    add.innerHTML = `<div>${ICON.plus}Ajouter<br>une page</div>`;
    add.onclick = () => $('#camera').click();
    box.append(add);
  }
}
$('#clear').onclick = () => { if (confirm('Effacer toutes les pages ?')) { pages = []; renderPages(); } };

// ---------- PDF ----------
async function buildPdf() {
  const { jsPDF } = await import(JSPDF_URL);
  let pdf = null;
  for (const p of pages) {
    const landscape = p.out.width > p.out.height;
    const [pw, ph] = landscape ? [297, 210] : [210, 297];
    if (!pdf) pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'l' : 'p', compress: true });
    else pdf.addPage('a4', landscape ? 'l' : 'p');
    const maxW = landscape ? 2339 : 1654; // ~200 dpi sur A4
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
async function send() {
  if (!pages.length) return;
  const { url, key } = settings();
  if (!url || !key) { $('#settings').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  busy('Création du PDF…');
  try {
    const blob = await buildPdf();
    busy('Lecture par l’IA…', 'Type de document, émetteur, date, dossier');
    const r = await fetch(`${url}/scan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/pdf', 'X-Note': encodeURIComponent($('#note').value.trim()) },
      body: blob,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    const hist = db.get('history', []);
    hist.unshift({ at: Date.now(), path: j.path, name: j.filename, link: j.link });
    db.set('history', hist.slice(0, 20));
    pages = []; $('#note').value = '';
    showResult(j);
    renderPages(); renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    alert(`Envoi impossible : ${e.message}\n\nTes pages sont conservées : tu peux réessayer ou télécharger le PDF.`);
  } finally { busy(null); }
}
$('#send').onclick = send;
$('#quickSend').onclick = send;

const CONF = { high: 'sûr', medium: 'probable', low: 'à vérifier' };
function crumbs(path) {
  return `<span class="crumbs">${String(path).split('/').filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('')}</span>`;
}
function showResult(j) {
  const box = $('#result');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="ok"><i>${ICON.check}</i><div><b>Rangé dans Twake</b><small>${new Date().toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</small></div></div>
    <hr>
    <dl>
      <dt>Dossier</dt><dd>${crumbs(j.path)}${j.createdFolder ? '<span class="pill">nouveau</span>' : ''}</dd>
      <dt>Fichier</dt><dd>${esc(j.filename)}</dd>
      <dt>Type</dt><dd>${esc(j.docType)}${j.confidence ? `<span class="pill">${esc(CONF[j.confidence] || j.confidence)}</span>` : ''}</dd>
      <dt>Résumé</dt><dd>${esc(j.summary)}</dd>
    </dl>
    ${j.link ? `<a class="open" href="${esc(j.link)}" target="_blank" rel="noopener">Ouvrir le dossier ${ICON.ext}</a>` : ''}`;
  // le reçu s'efface dès qu'on recommence un scan
  $('#empty').classList.add('hidden');
}

function renderHistory() {
  const hist = db.get('history', []);
  $('#historyBox').classList.toggle('hidden', !hist.length);
  $('#history').innerHTML = hist.map((h) => {
    const inner = `<span class="fi">${ICON.folder}</span>
      <span class="meta"><div class="name">${esc(h.name)}</div><div class="where">${esc(h.path)}</div></span>
      <time>${new Date(h.at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</time>`;
    return `<li>${h.link ? `<a href="${esc(h.link)}" target="_blank" rel="noopener" style="display:contents">${inner}</a>` : inner}</li>`;
  }).join('');
}

renderPages();
renderHistory();
checkConnection();
