import { store } from '../shared/store.js';
import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import * as R from './repertoire.js';
import * as E from './engine.js';

const db = store('chess');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ local

let chapters = db.get('chapters', []);
let srs = db.get('srs', {});
let log = db.get('log', {});
const settings = Object.assign({ newPerSession: 5, reviewLimit: 30, speed: 500, sound: true, explorer: true }, db.get('settings', {}));
function save() { db.set('chapters', chapters); db.set('srs', srs); db.set('log', log); db.set('settings', settings); }
const chById = (id) => chapters.find((c) => c.id === id);
function bump(field, n = 1) { const d = (log[today()] ||= { ok: 0, ko: 0, learned: 0 }); d[field] += n; }

// ---------------- Sons (WebAudio, aucun fichier) ----------------
let actx;
function tone(freqs, dur = .07, type = 'triangle', vol = .08) {
  if (!settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const f of [].concat(freqs)) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
      t += dur * .8;
    }
  } catch {}
}
const sndMove = () => tone(180, .05, 'square', .04);
const sndOk = () => tone([660, 880], .08);
const sndKo = () => tone([220, 160], .12, 'sawtooth', .05);

// ---------------- UI génériques ----------------
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2200);
}
function sheet(html, onMount) {
  $('sheet').innerHTML = html;
  $('sheetBg').classList.remove('hidden');
  onMount?.($('sheet'));
}
function closeSheet() { $('sheetBg').classList.add('hidden'); }
$('sheetBg').addEventListener('click', (e) => { if (e.target === $('sheetBg')) closeSheet(); });

// ---------------- Navigation ----------------
let currentTab = 'home';
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const el = $('v-' + view);
  el.classList.remove('hidden');
  const full = el.classList.contains('full');
  $('tabbar').classList.toggle('hidden', full);
  if (el.dataset.tab) {
    currentTab = el.dataset.tab;
    document.querySelectorAll('#tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.go === currentTab));
  }
  if (view !== 'analyse') E.stopLocal();
  window.scrollTo(0, 0);
}
function go(tab) {
  if (tab === 'home') renderHome();
  if (tab === 'train') renderTrain();
  if (tab === 'stats') renderStats();
  if (tab === 'analyse') openAnalyse();
  show(tab);
}
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

function dueTotal() {
  let n = 0;
  for (const ch of chapters) n += R.chapterStats(ch, srs).due;
  return n;
}
function updateBadge() {
  const n = dueTotal();
  $('dueBadge').textContent = n;
  $('dueBadge').classList.toggle('hidden', !n);
}

// =====================================================================
//  RÉPERTOIRE
// =====================================================================
const STARTERS = [
  { name: 'Italienne', color: 'w', pgn: '1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) (2... Nf6 3. d3) 3. Bc4 Bc5 (3... Nf6 4. d3 Be7 (4... Bc5 5. c3) 5. O-O) 4. c3 Nf6 (4... d6 5. d4 exd4 6. cxd4 Bb6 7. Nc3) 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 *' },
  { name: 'Caro-Kann', color: 'b', pgn: '1. e4 c6 2. d4 (2. Nc3 d5 3. Nf3 Bg4) 2... d5 3. Nc3 (3. e5 Bf5 4. Nf3 e6 5. Be2 c5) (3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6) (3. Nd2 dxe4 4. Nxe4 Bf5) 3... dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 e6 *' },
];

function renderHome() {
  updateBadge();
  const due = dueTotal();
  let fresh = 0, mastered = 0, total = 0;
  const stats = chapters.map((ch) => { const s = R.chapterStats(ch, srs); fresh += s.fresh; mastered += s.mastered; total += s.total; return s; });
  const streak = calcStreak();
  $('homeHero').innerHTML = chapters.length ? `
    <div class="hero-main">
      <div class="hero-num">${due}</div>
      <div class="hero-txt">${due ? `position${due > 1 ? 's' : ''} à réviser maintenant` : 'Tout est à jour. Rien à réviser pour l\'instant.'}</div>
    </div>
    <div class="hero-stats">
      <span><b>${mastered}</b>/${total} maîtrisés</span>
      <span><b>${fresh}</b> à apprendre</span>
      <span><b>${streak}</b> j de série</span>
    </div>
    ${due ? '<button class="big-btn" id="heroGo">Réviser</button>' : fresh ? '<button class="big-btn" id="heroLearn">Apprendre de nouveaux coups</button>' : ''}`
    : `<div class="empty-hero">
        <h1>Mémorise ton répertoire,<br><em>pour de bon.</em></h1>
        <p>Construis tes ouvertures coup par coup (ou colle un PGN), puis révise-les en répétition espacée : l'app te fait rejouer chaque position au bon moment, juste avant que tu l'oublies.</p>
        <div class="row-btns"><button class="pill-btn solid" id="starters">Commencer avec des exemples</button></div>
      </div>`;
  $('heroGo')?.addEventListener('click', () => startSession('due'));
  $('heroLearn')?.addEventListener('click', () => startSession('learn'));
  $('starters')?.addEventListener('click', () => {
    for (const s of STARTERS) { const ch = R.newChapter(s.name, s.color); R.mergePgn(ch, s.pgn); chapters.push(ch); }
    save(); renderHome(); toast('2 ouvertures d\'exemple ajoutées');
  });

  const list = $('chapters');
  list.innerHTML = '';
  if (!chapters.length) list.innerHTML = '<p class="muted small center">Aucune ouverture pour l\'instant.</p>';
  chapters.forEach((ch, i) => {
    const s = stats[i];
    const pct = (n) => (s.total ? (n / s.total) * 100 : 0);
    const el = document.createElement('button');
    el.className = 'chapter';
    el.innerHTML = `
      <span class="side side-${ch.color}">${ch.color === 'w' ? 'Blancs' : 'Noirs'}</span>
      <span class="ch-name">${esc(ch.name)}</span>
      <span class="ch-meta">${s.total} position${s.total > 1 ? 's' : ''} à jouer${s.due ? ` · <b class="due">${s.due} à réviser</b>` : ''}</span>
      <span class="meter"><i class="m-mast" style="width:${pct(s.mastered)}%"></i><i class="m-learn" style="width:${pct(s.learning)}%"></i></span>`;
    el.addEventListener('click', () => openEditor(ch.id));
    list.appendChild(el);
  });
}

function calcStreak() {
  let n = 0;
  const d = new Date();
  if (!log[today()]) d.setDate(d.getDate() - 1); // la série tient tant qu'on a joué hier
  for (;;) {
    const k = d.toLocaleDateString('sv-SE');
    if (!log[k] || !(log[k].ok + log[k].ko + log[k].learned)) break;
    n++; d.setDate(d.getDate() - 1);
  }
  return n;
}

$('newChBtn').addEventListener('click', () => newChapterSheet());
function newChapterSheet(prefill) {
  sheet(`
    <h2>Nouvelle ouverture</h2>
    <label class="field"><span>Nom</span><input id="ncName" placeholder="ex. Sicilienne Najdorf" value="${esc(prefill?.name || '')}"></label>
    <div class="field"><span>Je joue avec</span>
      <div class="seg" id="ncColor"><button data-c="w" aria-pressed="true">Les Blancs</button><button data-c="b" aria-pressed="false">Les Noirs</button></div>
    </div>
    <label class="field"><span>PGN (facultatif — variantes et commentaires acceptés)</span><textarea id="ncPgn" rows="4" placeholder="1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5) 3. d4 …"></textarea></label>
    <div class="sheet-actions"><button class="pill-btn" data-close>Annuler</button><button class="pill-btn solid" id="ncOk">Créer</button></div>`, (s) => {
    let color = prefill?.color || 'w';
    const seg = s.querySelector('#ncColor');
    const setC = (c) => { color = c; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === c)); };
    setC(color);
    seg.addEventListener('click', (e) => e.target.dataset.c && setC(e.target.dataset.c));
    s.querySelector('[data-close]').onclick = closeSheet;
    s.querySelector('#ncOk').onclick = () => {
      const name = s.querySelector('#ncName').value.trim() || 'Sans nom';
      const ch = R.newChapter(name, color);
      const pgn = s.querySelector('#ncPgn').value.trim();
      if (prefill?.lines) for (const l of prefill.lines) R.mergePgn(ch, l);
      if (pgn) {
        let errs = [];
        for (const g of R.splitPgn(pgn)) errs = errs.concat(R.mergePgn(ch, g.movetext, g.headers.FEN || R.START).errors);
        if (errs.length) toast(`Coups ignorés : ${errs.slice(0, 4).join(', ')}`);
      }
      chapters.push(ch); save(); closeSheet(); openEditor(ch.id);
    };
    setTimeout(() => s.querySelector('#ncName').focus(), 50);
  });
}

$('importBtn').addEventListener('click', () => {
  sheet(`
    <h2>Importer un PGN</h2>
    <p class="muted small">Colle un PGN (export Lichess, Chess.com, ChessBase…) ou choisis un fichier. Chaque partie devient une ouverture ; les variantes et commentaires sont conservés.</p>
    <textarea id="ipPgn" rows="7" placeholder="[Event &quot;Ma Sicilienne&quot;]&#10;&#10;1. e4 c5 2. Nf3 d6 …"></textarea>
    <div class="row-btns"><label class="pill-btn file-btn">Fichier .pgn<input type="file" accept=".pgn,.txt" id="ipFile" hidden></label></div>
    <div class="field"><span>Je joue avec</span><div class="seg" id="ipColor"><button data-c="w" aria-pressed="true">Les Blancs</button><button data-c="b" aria-pressed="false">Les Noirs</button></div></div>
    <label class="check"><input type="checkbox" id="ipMerge"> Tout fusionner dans une seule ouverture</label>
    <div class="sheet-actions"><button class="pill-btn" data-close>Annuler</button><button class="pill-btn solid" id="ipOk">Importer</button></div>`, (s) => {
    let color = 'w';
    const seg = s.querySelector('#ipColor');
    seg.addEventListener('click', (e) => { if (!e.target.dataset.c) return; color = e.target.dataset.c; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === color)); });
    s.querySelector('[data-close]').onclick = closeSheet;
    s.querySelector('#ipFile').onchange = async (e) => { const f = e.target.files[0]; if (f) s.querySelector('#ipPgn').value = await f.text(); };
    s.querySelector('#ipOk').onclick = () => {
      const games = R.splitPgn(s.querySelector('#ipPgn').value);
      if (!games.length) return toast('Rien à importer');
      const merge = s.querySelector('#ipMerge').checked;
      let made = 0, added = 0, errs = [];
      let target = null;
      for (const g of games) {
        if (!target || !merge) {
          const name = g.headers.Event && g.headers.Event !== '?' ? g.headers.Event : g.headers.Opening || `Import ${chapters.length + 1}`;
          target = R.newChapter(name, color, g.headers.FEN || R.START);
          chapters.push(target); made++;
        }
        const r = R.mergePgn(target, g.movetext, g.headers.FEN || target.start);
        added += r.added; errs = errs.concat(r.errors);
      }
      save(); closeSheet(); renderHome();
      toast(`${made} ouverture${made > 1 ? 's' : ''}, ${added} coups importés${errs.length ? ` (${errs.length} ignorés)` : ''}`);
    };
  });
});

// =====================================================================
//  ÉDITEUR
// =====================================================================
const ed = { ch: null, fens: [], sans: [], i: 0, board: null };

function openEditor(id) {
  ed.ch = chById(id);
  ed.fens = [ed.ch.start]; ed.sans = []; ed.i = 0;
  if (!ed.board) {
    ed.board = new Board($('edBoard'), { onMove: edMove });
  }
  ed.board.setOrientation(ed.ch.color);
  $('edName').value = ed.ch.name;
  show('editor');
  edRender();
}

function edGame() { return new Chess(ed.fens[ed.i]); }

function edMove(from, to, promotion) {
  const g = edGame();
  let mv;
  try { mv = g.move({ from, to, promotion }); } catch { return; }
  const fenBefore = ed.fens[ed.i];
  const isNew = !R.movesAt(ed.ch, fenBefore).some((m) => m.san === mv.san);
  R.addMove(ed.ch, fenBefore, mv.san);
  edGoto(fenBefore, mv.san, g.fen());
  if (isNew) { save(); sndMove(); }
}
function edGoto(fenBefore, san, fenAfter) {
  ed.fens = ed.fens.slice(0, ed.i + 1); ed.sans = ed.sans.slice(0, ed.i);
  ed.fens.push(fenAfter); ed.sans.push(san); ed.i++;
  edRender(true);
}
function edPlaySan(san) {
  const g = edGame();
  const before = g.fen();
  g.move(san);
  edGoto(before, san, g.fen());
}

function lastMoveOf(fenBefore, san) {
  if (!san) return null;
  try { const m = new Chess(fenBefore).move(san); return { from: m.from, to: m.to }; } catch { return null; }
}

function edRender(animate = false) {
  const g = edGame();
  const fen = ed.fens[ed.i];
  const lm = ed.i ? lastMoveOf(ed.fens[ed.i - 1], ed.sans[ed.i - 1]) : null;
  ed.board.setPosition(g, { lastMove: lm, animate });
  const here = R.movesAt(ed.ch, fen);
  const mine = g.turn() === ed.ch.color;
  ed.board.setArrows(here.map((m) => {
    const mv = new Chess(fen).move(m.san);
    return { from: mv.from, to: mv.to, color: mine ? 'g' : 'b', opacity: .75 };
  }));

  $('edTurn').textContent = mine ? 'À toi de jouer' : 'Coups adverses';
  $('edTurn').className = 'turn-badge ' + (mine ? 'mine' : 'theirs');
  $('edHereTitle').textContent = mine ? 'Ta réponse' : 'Réponses adverses préparées';
  const hereEl = $('edHere');
  hereEl.innerHTML = '';
  if (!here.length) {
    hereEl.innerHTML = `<p class="muted small">${mine ? 'Joue ton coup sur l\'échiquier pour l\'ajouter.' : 'Joue les coups adverses que tu veux préparer (un ou plusieurs).'}</p>`;
  }
  here.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'here-move';
    row.innerHTML = `<button class="hm-play"><b>${esc(moveLabel(fen, m.san))}</b>${m.c ? `<span>${esc(m.c)}</span>` : ''}</button><button class="hm-del" aria-label="Supprimer ${esc(m.san)} et la suite">×</button>`;
    row.querySelector('.hm-play').onclick = () => edPlaySan(m.san);
    row.querySelector('.hm-del').onclick = () => {
      if (!confirm(`Supprimer ${m.san} et toute la suite de cette ligne ?`)) return;
      R.removeMove(ed.ch, fen, m.san, srs); save(); edRender();
    };
    hereEl.appendChild(row);
  });
  if (mine && here.length > 1) hereEl.insertAdjacentHTML('beforeend', '<p class="warn small">Plusieurs coups pour toi ici : tous seront acceptés à l\'entraînement.</p>');

  // Commentaire du coup qui mène ici
  const wrap = $('edCommentWrap');
  if (ed.i > 0) {
    const edge = R.movesAt(ed.ch, ed.fens[ed.i - 1]).find((m) => m.san === ed.sans[ed.i - 1]);
    wrap.classList.toggle('hidden', !edge);
    if (edge) {
      $('edCommentMove').textContent = moveLabel(ed.fens[ed.i - 1], edge.san);
      $('edComment').value = edge.c || '';
      $('edComment').oninput = (e) => { edge.c = e.target.value.trim() || undefined; if (!edge.c) delete edge.c; save(); };
    }
  } else wrap.classList.add('hidden');

  renderLine($('edLine'), ed.fens, ed.sans, ed.i, (i) => { ed.i = i; edRender(); });
  if (settings.explorer) renderExplorer(fen, $('edExplorer'), $('edExTotal'), $('edOpening'), (san) => { const mv = edGame().move(san); edMove(mv.from, mv.to, mv.promotion); });
  else { $('edExplorer').innerHTML = '<p class="muted small">Explorateur désactivé dans les réglages.</p>'; }
}

function moveLabel(fen, san) {
  const g = new Chess(fen);
  return g.turn() === 'w' ? `${g.moveNumber()}. ${san}` : `${g.moveNumber()}… ${san}`;
}

function renderLine(el, fens, sans, cur, onPick) {
  el.innerHTML = '';
  if (!sans.length) { el.innerHTML = '<span class="muted small">Position de départ</span>'; return; }
  sans.forEach((san, i) => {
    const g = new Chess(fens[i]);
    if (g.turn() === 'w' || i === 0) el.insertAdjacentHTML('beforeend', `<span class="num">${g.moveNumber()}.${g.turn() === 'b' ? '..' : ''}</span>`);
    const b = document.createElement('button');
    b.textContent = san;
    if (i + 1 === cur) b.className = 'cur';
    b.onclick = () => onPick(i + 1);
    el.appendChild(b);
  });
  el.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

$('edBack').onclick = () => { go('home'); };
$('edName').onchange = () => { ed.ch.name = $('edName').value.trim() || 'Sans nom'; save(); };
$('edFirst').onclick = () => { ed.i = 0; edRender(); };
$('edPrev').onclick = () => { if (ed.i > 0) { ed.i--; edRender(); } };
$('edNext').onclick = edNext;
function edNext() {
  if (ed.i < ed.sans.length) { ed.i++; edRender(true); return; }
  const here = R.movesAt(ed.ch, ed.fens[ed.i]);
  if (here.length) edPlaySan(here[0].san);
}
$('edLast').onclick = () => {
  let guard = 0;
  while (guard++ < 300) {
    if (ed.i < ed.sans.length) { ed.i++; continue; }
    const here = R.movesAt(ed.ch, ed.fens[ed.i]);
    if (!here.length) break;
    const g = edGame(); g.move(here[0].san);
    if (ed.fens.includes(g.fen())) break;
    ed.fens.push(g.fen()); ed.sans.push(here[0].san); ed.i++;
  }
  edRender();
};
$('edFlip').onclick = () => ed.board.flip();
$('edTrain').onclick = () => startSession('chapter', [ed.ch.id]);
$('edMenu').onclick = () => {
  const ch = ed.ch;
  sheet(`
    <h2>${esc(ch.name)}</h2>
    <div class="menu">
      <button data-a="color">Je joue avec les ${ch.color === 'w' ? 'Noirs' : 'Blancs'} (changer)</button>
      <button data-a="import">Ajouter des coups depuis un PGN</button>
      <button data-a="copy">Copier le PGN</button>
      <button data-a="dl">Télécharger le PGN</button>
      <button data-a="reset">Remettre la progression à zéro</button>
      <button data-a="del" class="danger">Supprimer l'ouverture</button>
    </div>`, (s) => {
    s.querySelector('.menu').onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'color') { ch.color = ch.color === 'w' ? 'b' : 'w'; delete srs[ch.id]; save(); closeSheet(); openEditor(ch.id); toast('Côté changé, progression remise à zéro'); }
      if (a === 'import') {
        sheet(`<h2>Ajouter un PGN</h2><textarea id="addPgn" rows="7" placeholder="1. e4 e5 2. Nf3 (2. f4) …"></textarea>
          <div class="sheet-actions"><button class="pill-btn" data-close>Annuler</button><button class="pill-btn solid" id="addOk">Ajouter</button></div>`, (s2) => {
          s2.querySelector('[data-close]').onclick = closeSheet;
          s2.querySelector('#addOk').onclick = () => {
            let added = 0, errs = [];
            for (const g of R.splitPgn(s2.querySelector('#addPgn').value)) { const r = R.mergePgn(ch, g.movetext, g.headers.FEN || ch.start); added += r.added; errs = errs.concat(r.errors); }
            save(); closeSheet(); edRender(); toast(`${added} coups ajoutés${errs.length ? ` · ignorés : ${errs.slice(0, 3).join(', ')}` : ''}`);
          };
        });
      }
      if (a === 'copy') { try { await navigator.clipboard.writeText(R.toPgn(ch)); toast('PGN copié'); } catch { toast('Copie impossible'); } closeSheet(); }
      if (a === 'dl') {
        const blob = new Blob([R.toPgn(ch)], { type: 'application/x-chess-pgn' });
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: ch.name.replace(/[^\w\- ]+/g, '') + '.pgn' });
        link.click(); closeSheet();
      }
      if (a === 'reset' && confirm('Effacer toute la progression de cette ouverture ?')) { delete srs[ch.id]; save(); closeSheet(); toast('Progression remise à zéro'); }
      if (a === 'del' && confirm(`Supprimer « ${ch.name} » ?`)) {
        chapters = chapters.filter((c) => c !== ch); delete srs[ch.id]; save(); closeSheet(); go('home');
      }
    };
  });
};

// ---------------- Explorateur (partagé éditeur / analyse) ----------------
let exReq = 0;
async function renderExplorer(fen, el, totalEl, openingEl, onPick) {
  const req = ++exReq;
  el.innerHTML = '<p class="muted small">Chargement…</p>';
  try {
    const j = await E.explore(fen);
    if (req !== exReq) return;
    const total = j.white + j.draws + j.black;
    totalEl.textContent = total ? `${total.toLocaleString('fr-FR')} parties` : '';
    if (openingEl) openingEl.textContent = j.opening ? `${j.opening.eco} · ${j.opening.name}` : openingEl.textContent && fen === R.START ? '' : openingEl.textContent;
    if (!j.moves.length) { el.innerHTML = '<p class="muted small">Aucune partie de maître dans cette position.</p>'; return; }
    el.innerHTML = '';
    for (const m of j.moves) {
      const n = m.white + m.draws + m.black;
      const w = (m.white / n) * 100, d = (m.draws / n) * 100, b = 100 - w - d;
      const row = document.createElement('button');
      row.className = 'ex-row';
      row.innerHTML = `<b>${esc(m.san)}</b><span class="ex-n">${n >= 1000 ? Math.round(n / 1000) + 'k' : n}</span>
        <span class="wdb"><i class="w" style="width:${w}%">${w > 14 ? Math.round(w) + '%' : ''}</i><i class="d" style="width:${d}%">${d > 14 ? Math.round(d) + '%' : ''}</i><i class="b" style="width:${b}%">${b > 14 ? Math.round(b) + '%' : ''}</i></span>`;
      row.onclick = () => onPick(m.san);
      el.appendChild(row);
    }
  } catch {
    if (req === exReq) el.innerHTML = '<p class="muted small">Explorateur indisponible (hors ligne ?).</p>';
  }
}

// =====================================================================
//  ENTRAÎNEMENT
// =====================================================================
let trainFilter = db.get('trainFilter', 'all');

function filteredChapters() {
  return trainFilter === 'all' ? chapters : chapters.filter((c) => c.id === trainFilter);
}

function renderTrain() {
  updateBadge();
  const f = $('trainFilter');
  f.innerHTML = '';
  const chips = [{ id: 'all', name: 'Tout le répertoire' }, ...chapters];
  if (!chapters.some((c) => c.id === trainFilter)) trainFilter = 'all';
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = c.name;
    b.setAttribute('aria-pressed', c.id === trainFilter);
    b.onclick = () => { trainFilter = c.id; db.set('trainFilter', trainFilter); renderTrain(); };
    f.appendChild(b);
  }
  let due = 0, fresh = 0, weak = 0, total = 0;
  for (const ch of filteredChapters()) {
    const s = R.chapterStats(ch, srs);
    due += s.due; fresh += s.fresh; total += s.total;
    weak += Object.values(srs[ch.id] || {}).filter((c) => c.lapses > 0).length;
  }
  const modes = [
    { m: 'due', t: 'Réviser', d: due ? `${due} position${due > 1 ? 's' : ''} arrivée${due > 1 ? 's' : ''} à échéance` : 'Rien à réviser pour l\'instant', n: due, off: !due, main: due > 0 },
    { m: 'learn', t: 'Apprendre', d: fresh ? `${Math.min(fresh, settings.newPerSession)} nouveaux coups par séance · ${fresh} restants` : 'Tout ton répertoire a été vu', n: fresh, off: !fresh, main: !due && fresh > 0 },
    { m: 'weak', t: 'Points faibles', d: weak ? 'Les positions où tu t\'es déjà trompé' : 'Aucune erreur enregistrée', n: weak, off: !weak },
    { m: 'line', t: 'Ligne au hasard', d: 'Une ligne complète, tous tes coups testés', n: '', off: !total },
    { m: 'blind', t: 'À l\'aveugle', d: 'Ligne au hasard sans voir les pièces', n: '', off: !total },
  ];
  const el = $('trainModes');
  el.innerHTML = '';
  modes.sort((a, b) => !!b.main - !!a.main);
  for (const x of modes) {
    const b = document.createElement('button');
    b.className = 'mode-card' + (x.main ? ' main' : '');
    b.disabled = x.off;
    b.innerHTML = `<span class="mc-t">${x.t}</span><span class="mc-d">${x.d}</span>${x.n !== '' ? `<span class="mc-n">${x.n}</span>` : ''}`;
    b.onclick = () => startSession(x.m, filteredChapters().map((c) => c.id));
    el.appendChild(b);
  }
  if (!chapters.length) el.innerHTML = '<p class="muted center">Ajoute d\'abord une ouverture dans l\'onglet Répertoire.</p>';
  renderPuzzleCard();
}

// ---------------- Séance ----------------
let S = null;     // séance en cours
let sBoard = null;

function buildTargets(mode, chs) {
  const now = Date.now();
  const targets = new Map();
  let budget = mode === 'learn' ? settings.newPerSession : mode === 'due' ? settings.reviewLimit : mode === 'weak' ? 20 : Infinity;
  for (const ch of chs) {
    const set = new Set();
    let cards = R.cardsOf(ch);
    if (mode === 'weak') {
      cards = cards.filter((c) => R.cardState(srs, ch.id, c.key)?.lapses > 0)
        .sort((a, b) => R.cardState(srs, ch.id, b.key).lapses - R.cardState(srs, ch.id, a.key).lapses);
    }
    for (const c of cards) {
      if (budget <= 0) break;
      const st = R.cardState(srs, ch.id, c.key);
      const ok = mode === 'due' ? st && st.due <= now : mode === 'learn' ? !st : true;
      if (ok) { set.add(c.key); budget--; }
    }
    if (set.size) targets.set(ch.id, set);
  }
  return targets;
}

function startSession(mode, ids) {
  ids ||= filteredChapters().map((c) => c.id);
  const chs = ids.map(chById).filter(Boolean);
  if (!chs.length) return toast('Aucune ouverture');
  const S2 = { mode, token: {}, ok: 0, ko: 0, learned: 0, played: 0, blind: mode === 'blind' };
  if (mode === 'line' || mode === 'blind') {
    const withCards = chs.filter((c) => R.cardsOf(c).length);
    if (!withCards.length) return toast('Ce répertoire est vide');
    S2.chQueue = [withCards[Math.floor(Math.random() * withCards.length)]];
    S2.total = null;
  } else {
    S2.targets = buildTargets(mode, chs);
    if (!S2.targets.size) return toast(mode === 'due' ? 'Rien à réviser 🎉' : 'Rien à travailler ici');
    S2.chQueue = chs.filter((c) => S2.targets.has(c.id));
    S2.total = [...S2.targets.values()].reduce((a, s) => a + s.size, 0);
  }
  S2.done = new Map(S2.chQueue.map((c) => [c.id, new Set()]));
  S = S2;
  if (!sBoard) sBoard = new Board($('sBoard'), { onMove: sUserMove, movable: 'none' });
  sBoard.onMove = sUserMove;
  $('sBoard').classList.toggle('blind', !!S.blind);
  show('session');
  nextChapter();
}

function nextChapter() {
  const ch = S.chQueue.shift();
  if (!ch) return finishSession();
  S.ch = ch;
  sBoard.setOrientation(ch.color);
  $('sMeta').innerHTML = `<span class="side side-${ch.color}">${ch.color === 'w' ? 'Blancs' : 'Noirs'}</span> ${esc(ch.name)} · <span class="muted">${modeName(S.mode)}</span>`;
  restartLine();
}
const modeName = (m) => ({ due: 'Révision', learn: 'Apprentissage', weak: 'Points faibles', line: 'Ligne au hasard', blind: 'À l\'aveugle', chapter: 'Chapitre complet', puzzle: 'Puzzle du jour' }[m]);

function restartLine() {
  S.game = new Chess(S.ch.start);
  S.sans = []; S.fens = [S.ch.start];
  S.waiting = null;
  sBoard.setPosition(S.game);
  sBoard.setArrows([]);
  renderSessionLine();
  setTimeout(() => advance(S.token), 250);
}

// Cibles actives (quiz d'apprentissage ou cibles de la séance)
function activeTargets() {
  if (S.quiz) return S.quiz;
  return S.targets?.get(S.ch.id) || null;
}
function activeDone() { return S.quiz ? S.quizDone : S.done.get(S.ch.id); }
function remaining(fen) {
  const t = activeTargets();
  if (!t) return Infinity;
  return R.targetsBelow(S.ch, fen, t, activeDone());
}

async function advance(token) {
  if (!S || S.token !== token) return;
  const fen = S.game.fen();
  const key = R.posKey(fen);
  const opts = R.movesAt(S.ch, fen);
  const mine = S.game.turn() === S.ch.color;
  const isLine = S.mode === 'line' || S.mode === 'blind';

  if (!opts.length || remaining(fen) === 0) return endLine();

  const t = activeTargets();
  if (mine && (isLine || (t.has(key) && !activeDone().has(key)))) {
    return ask(key, opts);
  }
  // Coup joué automatiquement (adversaire, ou mon coup déjà su)
  let choice;
  if (isLine) choice = opts[Math.floor(Math.random() * opts.length)];
  else {
    const scored = opts.map((m) => { const g = new Chess(fen); g.move(m.san); return { m, n: remaining(g.fen()) }; });
    const best = Math.max(...scored.map((x) => x.n));
    const pool = scored.filter((x) => x.n === best);
    choice = pool[Math.floor(Math.random() * pool.length)].m;
  }
  setPrompt(mine ? 'Coup connu…' : 'L\'adversaire joue…', 'wait');
  await sleep(mine ? settings.speed * .6 : settings.speed);
  if (!S || S.token !== token) return;
  playSession(choice.san);
  if (choice.c && !mine) showComment(choice.c);
  advance(token);
}

function playSession(san) {
  const before = S.game.fen();
  const mv = S.game.move(san);
  S.sans.push(mv.san); S.fens.push(S.game.fen());
  sBoard.setPosition(S.game, { lastMove: { from: mv.from, to: mv.to }, animate: true });
  sBoard.setArrows([]);
  sndMove();
  renderSessionLine();
  return { mv, before };
}

function ask(key, opts) {
  const st = R.cardState(srs, S.ch.id, key);
  const teach = S.mode === 'learn' && !S.quiz && !st;
  S.waiting = { key, expected: opts.map((m) => m.san), opts, teach, hinted: false, failed: false };
  sBoard.setMovable(S.ch.color);
  $('sComment').classList.add('hidden');
  if (teach) {
    const fen = S.game.fen();
    sBoard.setArrows(opts.map((m) => { const mv = new Chess(fen).move(m.san); return { from: mv.from, to: mv.to, color: 'y' }; }));
    setPrompt(`Nouveau coup : <b>${esc(opts.map((m) => m.san).join(' ou '))}</b> — joue-le`, 'teach');
    const c = opts.find((m) => m.c); if (c) showComment(c.c);
    $('sActions').classList.add('hidden');
  } else {
    setPrompt(S.blind ? `À toi. Dernier coup : <b>${esc(S.sans.at(-1) || '—')}</b>` : 'À toi : quel est ton coup ?', 'ask');
    $('sActions').classList.remove('hidden');
  }
  updateProgress();
}

function sUserMove(from, to, promotion) {
  if (!S?.waiting) return;
  const w = S.waiting;
  const g = new Chess(S.game.fen());
  let mv;
  try { mv = g.move({ from, to, promotion }); } catch { return; }
  const isLine = S.mode === 'line' || S.mode === 'blind';

  if (w.expected.includes(mv.san)) {
    sBoard.setMovable('none');
    S.waiting = null;
    playSession(mv.san);
    sBoard.setMarks({ [mv.to]: 'good' });
    const edge = w.opts.find((m) => m.san === mv.san);
    if (w.teach) {
      (S.quizPending ||= new Set()).add(w.key);
      S.done.get(S.ch.id).add(w.key);
      S.learned++; bump('learned');
      setPrompt('Bien. Retiens-le, il revient dans un instant.', 'good');
    } else if (w.failed || w.hinted) {
      setPrompt(w.hinted && !w.failed ? 'Trouvé avec l\'indice : on le reverra bientôt.' : 'C\'est noté, on le reverra bientôt.', 'bad');
    } else {
      S.ok++; bump('ok');
      if (!isLine || R.cardState(srs, S.ch.id, w.key)?.due <= Date.now()) R.grade(srs, S.ch.id, w.key, true);
      setPrompt(['Exact.', 'Bien joué.', 'Correct.', 'Parfait.'][S.ok % 4], 'good');
      sndOk();
    }
    if (!w.teach) activeDone().add(w.key);
    if (S.quiz) S.quizDone.add(w.key);
    if (edge?.c) showComment(edge.c);
    S.played++;
    save();
    updateProgress();
    setTimeout(() => advance(S?.token), settings.speed);
    return;
  }

  // Mauvais coup
  sndKo();
  sBoard.setPosition(S.game, { lastMove: null });
  sBoard.setMarks({ [from]: 'bad', [to]: 'bad' });
  if (w.teach) { setPrompt(`Pas celui-là : joue <b>${esc(w.expected[0])}</b>`, 'teach'); restoreArrows(w); return; }
  if (!w.failed) {
    w.failed = true;
    S.ko++; bump('ko');
    R.grade(srs, S.ch.id, w.key, false);
    save();
  }
  setPrompt(`${esc(mv.san)} n'est pas dans ton répertoire. Le coup était <b>${esc(w.expected.join(' ou '))}</b> — rejoue-le.`, 'bad');
  restoreArrows(w, 'r');
  const c = w.opts.find((m) => m.c); if (c) showComment(c.c);
}
function restoreArrows(w, color = 'y') {
  const fen = S.game.fen();
  sBoard.setArrows(w.expected.map((san) => { const mv = new Chess(fen).move(san); return { from: mv.from, to: mv.to, color }; }));
}

$('sHint').onclick = () => {
  const w = S?.waiting; if (!w || w.teach) return;
  if (!w.hinted && !w.failed) { w.hinted = true; S.ko++; bump('ko'); R.grade(srs, S.ch.id, w.key, false); save(); }
  const mv = new Chess(S.game.fen()).move(w.expected[0]);
  sBoard.setMarks({ [mv.from]: 'hint' });
  setPrompt('Indice : la pièce à jouer est en surbrillance.', 'ask');
};
$('sShow').onclick = () => {
  const w = S?.waiting; if (!w || w.teach) return;
  if (!w.failed) { w.failed = true; if (!w.hinted) { S.ko++; bump('ko'); R.grade(srs, S.ch.id, w.key, false); save(); } }
  restoreArrows(w, 'r');
  setPrompt(`Le coup était <b>${esc(w.expected.join(' ou '))}</b> — joue-le.`, 'bad');
};
$('sQuit').onclick = () => { if (S) S.token = null; S = null; save(); go(currentTab === 'home' ? 'home' : 'train'); };

function endLine() {
  const isLine = S.mode === 'line' || S.mode === 'blind';
  if (isLine) return finishSession();
  // Apprentissage : quiz immédiat des coups qu'on vient de voir
  if (S.mode === 'learn' && !S.quiz && S.quizPending?.size) {
    S.quiz = S.quizPending; S.quizPending = null; S.quizDone = new Set();
    setPrompt('Quiz : rejoue la ligne de mémoire.', 'teach');
    return setTimeout(restartLine, settings.speed * 1.5);
  }
  if (S.quiz) {
    // Les coups ratés au quiz restent « nouveaux mais vus » : on les note quand même pour qu'ils reviennent vite
    for (const k of S.quiz) if (!R.cardState(srs, S.ch.id, k)) R.grade(srs, S.ch.id, k, false);
    S.quiz = null; save();
  }
  const t = S.targets.get(S.ch.id);
  const left = [...t].filter((k) => !S.done.get(S.ch.id).has(k)).length;
  if (left && R.targetsBelow(S.ch, S.ch.start, t, S.done.get(S.ch.id)) > 0) return restartLine();
  nextChapter();
}

function finishSession() {
  const s = S;
  S.token = null;
  sBoard.setMovable('none');
  updateBadge();
  const isLine = s.mode === 'line' || s.mode === 'blind';
  const total = s.ok + s.ko;
  $('sActions').classList.add('hidden');
  $('sComment').classList.add('hidden');
  setPrompt(`
    <div class="done">
      <h3>${isLine ? 'Ligne terminée' : 'Séance terminée'}</h3>
      <div class="done-stats">
        ${s.learned ? `<span><b>${s.learned}</b> nouveaux</span>` : ''}
        <span><b>${s.ok}</b> justes</span><span><b>${s.ko}</b> erreurs</span>
        ${total ? `<span><b>${Math.round((s.ok / total) * 100)}%</b> réussite</span>` : ''}
      </div>
      <div class="row-btns">
        ${isLine ? `<button class="pill-btn solid" id="again">Une autre ligne</button>` : ''}
        ${!isLine && dueTotal() ? `<button class="pill-btn solid" id="moreDue">Réviser (${dueTotal()})</button>` : ''}
        <button class="pill-btn" id="endBtn">Terminer</button>
      </div>
    </div>`, 'end');
  $('again')?.addEventListener('click', () => startSession(s.mode));
  $('moreDue')?.addEventListener('click', () => startSession('due'));
  $('endBtn').onclick = () => { S = null; go('train'); };
  $('sBar').style.width = '100%';
  if (s.blind) $('sBoard').classList.remove('blind');
}

function setPrompt(html, kind) {
  const p = $('sPrompt');
  p.innerHTML = html;
  p.className = 'prompt ' + (kind || '');
}
function showComment(c) { const el = $('sComment'); el.textContent = c; el.classList.remove('hidden'); }
function updateProgress() {
  if (!S) return;
  if (S.total) {
    const d = [...S.done.values()].reduce((a, s) => a + s.size, 0);
    $('sBar').style.width = Math.min(100, (d / S.total) * 100) + '%';
    $('sCount').textContent = `${Math.min(d, S.total)}/${S.total}`;
  } else {
    $('sBar').style.width = '0%';
    $('sCount').textContent = `${S.ok}✓ ${S.ko}✗`;
  }
}
function renderSessionLine() {
  if (!S) return;
  renderLine($('sLine'), S.fens, S.sans, S.sans.length, () => {});
  $('sLine').classList.toggle('blind-line', !!S.blind);
}

// ---------------- Puzzle du jour ----------------
async function renderPuzzleCard() {
  const el = $('puzzleCard');
  const solved = db.get('puzzleSolved', {});
  el.innerHTML = `<div class="pz"><div><span class="mc-t">Puzzle du jour</span><span class="mc-d">Chargement…</span></div></div>`;
  try {
    const p = await E.dailyPuzzle();
    const done = solved[p.puzzle.id];
    el.innerHTML = `<button class="pz"><div><span class="mc-t">Puzzle du jour</span>
      <span class="mc-d">Classement ${p.puzzle.rating} · ${p.puzzle.themes.slice(0, 3).map(themeFr).join(', ')}</span></div>
      <span class="pz-state ${done ? 'ok' : ''}">${done ? 'Résolu' : 'Jouer'}</span></button>`;
    el.querySelector('button').onclick = () => startPuzzle(p);
  } catch {
    el.innerHTML = `<div class="pz"><div><span class="mc-t">Puzzle du jour</span><span class="mc-d">Indisponible hors ligne.</span></div></div>`;
  }
}
const THEMES = { mateIn1: 'mat en 1', mateIn2: 'mat en 2', mateIn3: 'mat en 3', mateIn4: 'mat en 4', mate: 'mat', fork: 'fourchette', pin: 'clouage', skewer: 'enfilade', sacrifice: 'sacrifice', endgame: 'finale', middlegame: 'milieu de partie', opening: 'ouverture', short: 'court', long: 'long', veryLong: 'très long', deflection: 'déviation', clearance: 'dégagement', discoveredAttack: 'attaque à la découverte', hangingPiece: 'pièce en prise', advantage: 'avantage', crushing: 'écrasant', attraction: 'attraction', promotion: 'promotion', kingsideAttack: 'attaque à l\'aile roi', quietMove: 'coup calme', defensiveMove: 'coup défensif', backRankMate: 'mat du couloir', trappedPiece: 'pièce piégée', zugzwang: 'zugzwang', intermezzo: 'coup intermédiaire', exposedKing: 'roi exposé', doubleCheck: 'double échec' };
const themeFr = (t) => THEMES[t] || t;

function startPuzzle(p) {
  const g = new Chess();
  for (const san of p.game.pgn.split(' ')) g.move(san);
  const hist = g.history({ verbose: true });
  const last = hist[hist.length - 1];
  S = { mode: 'puzzle', token: {}, ok: 0, ko: 0, learned: 0, puzzle: p, step: 0, game: new Chess(g.fen()), sans: [], fens: [g.fen()], done: new Map(), chQueue: [] };
  if (!sBoard) sBoard = new Board($('sBoard'), { onMove: sUserMove, movable: 'none' });
  $('sBoard').classList.remove('blind');
  sBoard.setOrientation(S.game.turn());
  sBoard.setPosition(S.game, { lastMove: { from: last.from, to: last.to } });
  sBoard.setArrows([]);
  sBoard.onMove = puzzleMove;
  $('sMeta').innerHTML = `Puzzle du jour · <span class="muted">${p.puzzle.rating}</span>`;
  $('sCount').textContent = ''; $('sBar').style.width = '0%';
  $('sComment').classList.add('hidden');
  $('sActions').classList.remove('hidden');
  $('sLine').innerHTML = '';
  show('session');
  setPrompt(`Trait aux <b>${S.game.turn() === 'w' ? 'Blancs' : 'Noirs'}</b>. Trouve le meilleur coup.`, 'ask');
  sBoard.setMovable(S.game.turn());
}
function puzzleMove(from, to, promotion) {
  if (S?.mode !== 'puzzle') return sUserMove(from, to, promotion);
  const sol = S.puzzle.puzzle.solution;
  const want = sol[S.step];
  const g = new Chess(S.game.fen());
  let mv; try { mv = g.move({ from, to, promotion }); } catch { return; }
  const uci = mv.from + mv.to + (mv.promotion || '');
  if (uci === want || g.isCheckmate()) {
    S.game = g;
    sBoard.setPosition(S.game, { lastMove: mv, animate: false });
    sBoard.setMarks({ [mv.to]: 'good' }); sndOk();
    S.step += 2;
    $('sBar').style.width = Math.min(100, (S.step / sol.length) * 100) + '%';
    if (S.step >= sol.length || g.isCheckmate()) {
      const solved = db.get('puzzleSolved', {}); solved[S.puzzle.puzzle.id] = Date.now(); db.set('puzzleSolved', solved);
      sBoard.setMovable('none');
      setPrompt(`<div class="done"><h3>Puzzle résolu${S.ko ? '' : ' du premier coup'} !</h3><div class="row-btns"><button class="pill-btn" id="endBtn">Terminer</button></div></div>`, 'end');
      $('sActions').classList.add('hidden');
      $('endBtn').onclick = () => { S = null; sBoard.onMove = sUserMove; go('train'); };
      return;
    }
    setPrompt('Bien vu. Continue…', 'good');
    sBoard.setMovable('none');
    setTimeout(() => {
      if (S?.mode !== 'puzzle') return;
      const r = sol[S.step - 1];
      const m2 = S.game.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] });
      sBoard.setPosition(S.game, { lastMove: m2, animate: true }); sndMove();
      sBoard.setMovable(S.game.turn());
      setPrompt('À toi.', 'ask');
    }, settings.speed);
  } else {
    S.ko++; sndKo();
    sBoard.setPosition(S.game); sBoard.setMarks({ [from]: 'bad', [to]: 'bad' });
    setPrompt('Non, cherche encore.', 'bad');
  }
}
// Indice / solution en mode puzzle
const hintOrig = $('sHint').onclick, showOrig = $('sShow').onclick;
$('sHint').onclick = () => {
  if (S?.mode !== 'puzzle') return hintOrig();
  const w = S.puzzle.puzzle.solution[S.step]; S.ko++;
  sBoard.setMarks({ [w.slice(0, 2)]: 'hint' });
};
$('sShow').onclick = () => {
  if (S?.mode !== 'puzzle') return showOrig();
  const w = S.puzzle.puzzle.solution[S.step]; S.ko++;
  sBoard.setArrows([{ from: w.slice(0, 2), to: w.slice(2, 4), color: 'r' }]);
};
const quitOrig = $('sQuit').onclick;
$('sQuit').onclick = () => { if (sBoard) sBoard.onMove = sUserMove; quitOrig(); };

// =====================================================================
//  ANALYSE
// =====================================================================
const an = { fens: [R.START], sans: [], i: 0, board: null, engineOn: false };

function openAnalyse() {
  if (!an.board) an.board = new Board($('aBoard'), { onMove: anMove });
  anRender();
}
function anGame() { return new Chess(an.fens[an.i]); }
function anMove(from, to, promotion) {
  const g = anGame();
  let mv; try { mv = g.move({ from, to, promotion }); } catch { return; }
  anPush(mv.san, g.fen());
}
function anPush(san, fen) {
  if (an.sans[an.i] === san) { an.i++; return anRender(true); }
  an.fens = an.fens.slice(0, an.i + 1); an.sans = an.sans.slice(0, an.i);
  an.fens.push(fen); an.sans.push(san); an.i++;
  sndMove();
  anRender(true);
}
function anPlaySan(san) { const g = anGame(); g.move(san); anPush(san, g.fen()); }

function anRender(animate = false) {
  const g = anGame();
  const fen = an.fens[an.i];
  an.board.setPosition(g, { lastMove: an.i ? lastMoveOf(an.fens[an.i - 1], an.sans[an.i - 1]) : null, animate });
  an.board.setArrows([]);
  renderLine($('aLine'), an.fens, an.sans, an.i, (i) => { an.i = i; anRender(); });
  if (an.i === 0) $('aOpening').textContent = '';
  renderExplorer(fen, $('aExplorer'), $('aExTotal'), $('aOpening'), anPlaySan);
  if (an.engineOn) runEngine(fen);
  else setEvalBar(null);
}

let engReq = 0;
async function runEngine(fen) {
  const req = ++engReq;
  const g = new Chess(fen);
  if (g.isGameOver()) {
    E.stopLocal();
    $('aLines').innerHTML = `<p class="muted small">${g.isCheckmate() ? 'Échec et mat.' : 'Partie nulle.'}</p>`;
    setEvalBar(g.isCheckmate() ? { cp: g.turn() === 'w' ? -99999 : 99999 } : { cp: 0 });
    $('aEvalTxt').textContent = g.isCheckmate() ? '#' : '½';
    return;
  }
  $('aLines').innerHTML = '<p class="muted small">Analyse…</p>';
  const show = (res) => {
    if (req !== engReq) return;
    const lines = res.lines.slice(0, 3);
    setEvalBar(lines[0]);
    $('aLines').innerHTML = lines.map((l, idx) => {
      const sans = pvToSan(fen, l.pv, 10);
      return `<button class="eng-line" data-i="${idx}"><b>${E.fmtEval(l)}</b><span>${esc(sans.join(' '))}</span></button>`;
    }).join('') + `<p class="eng-src muted small">${res.source === 'cloud' ? 'Éval cloud Lichess' : 'Stockfish sur l\'appareil'} · profondeur ${lines[0]?.depth ?? '–'}</p>`;
    $('aLines').querySelectorAll('.eng-line').forEach((b) => b.onclick = () => {
      const pv = lines[+b.dataset.i].pv[0];
      const mv = new Chess(fen).move({ from: pv.slice(0, 2), to: pv.slice(2, 4), promotion: pv[4] });
      anPlaySan(mv.san);
    });
    const best = lines[0]?.pv[0];
    if (best) an.board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'b', opacity: .8 }]);
  };
  try {
    const cloud = await E.cloudEval(fen, 3);
    if (req !== engReq) return;
    if (cloud) { E.stopLocal(); return show(cloud); }
  } catch {}
  try { await E.analyseLocal(fen, show, { depth: 22, multipv: 3 }); }
  catch { if (req === engReq) $('aLines').innerHTML = '<p class="muted small">Impossible de charger Stockfish (connexion nécessaire la première fois).</p>'; }
}
function pvToSan(fen, pv, max) {
  const g = new Chess(fen); const out = [];
  for (const u of pv.slice(0, max)) {
    try {
      const n = g.moveNumber(), w = g.turn() === 'w';
      const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push((w ? n + '. ' : out.length ? '' : n + '… ') + m.san);
    } catch { break; }
  }
  return out;
}
function setEvalBar(l) {
  const share = E.evalShare(l);
  const bar = $('aEvalBar');
  bar.querySelector('i').style.height = (share * 100) + '%';
  bar.classList.toggle('flipped', an.board?.orientation === 'b');
  $('aEvalTxt').textContent = l ? E.fmtEval(l).replace('+', '') : '';
}

$('aEngine').onchange = (e) => {
  an.engineOn = e.target.checked;
  if (!an.engineOn) { E.stopLocal(); engReq++; $('aLines').innerHTML = '<p class="muted small">Moteur en pause.</p>'; setEvalBar(null); an.board.setArrows([]); }
  else runEngine(an.fens[an.i]);
};
$('aFirst').onclick = () => { an.i = 0; anRender(); };
$('aPrev').onclick = () => { if (an.i > 0) { an.i--; anRender(); } };
$('aNext').onclick = () => { if (an.i < an.sans.length) { an.i++; anRender(true); } };
$('aLast').onclick = () => { an.i = an.sans.length; anRender(); };
$('aFlip').onclick = () => { an.board.flip(); setEvalBar(null); if (an.engineOn) runEngine(an.fens[an.i]); };
$('aMenu').onclick = () => {
  sheet(`<h2>Charger une position</h2>
    <p class="muted small">Colle un FEN ou un PGN (une partie à analyser).</p>
    <textarea id="aIn" rows="5" placeholder="FEN ou PGN"></textarea>
    <div class="sheet-actions"><button class="pill-btn" id="aReset">Position initiale</button><button class="pill-btn solid" id="aLoad">Charger</button></div>`, (s) => {
    s.querySelector('#aReset').onclick = () => { an.fens = [R.START]; an.sans = []; an.i = 0; closeSheet(); anRender(); };
    s.querySelector('#aLoad').onclick = () => {
      const txt = s.querySelector('#aIn').value.trim();
      if (!txt) return;
      if (/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}\s+[wb]/.test(txt)) {
        try { new Chess(txt); an.fens = [txt]; an.sans = []; an.i = 0; } catch { return toast('FEN invalide'); }
      } else {
        const games = R.splitPgn(txt);
        const g = new Chess(games[0]?.headers.FEN || R.START);
        an.fens = [g.fen()]; an.sans = [];
        // ligne principale uniquement
        const mainline = (games[0]?.movetext || txt).replace(/\{[^}]*\}/g, ' ');
        let depth = 0, clean = '';
        for (const ch of mainline) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (!depth) clean += ch; }
        for (const tok of clean.split(/\s+/)) {
          const san = tok.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
          if (!san || /^(1-0|0-1|1\/2-1\/2|\*|\$\d+)$/.test(san)) continue;
          try { g.move(san); an.fens.push(g.fen()); an.sans.push(san); } catch { break; }
        }
        an.i = an.sans.length;
      }
      $('aOpening').textContent = '';
      closeSheet(); anRender();
    };
  });
};
$('aToRep').onclick = () => {
  if (!an.sans.length) return toast('Joue d\'abord une ligne');
  const startFen = an.fens[0];
  sheet(`<h2>Ajouter au répertoire</h2>
    <p class="muted small">${esc(an.sans.slice(0, an.i).join(' '))}</p>
    <div class="menu">${chapters.map((c) => `<button data-id="${c.id}">${esc(c.name)} <span class="muted">(${c.color === 'w' ? 'Blancs' : 'Noirs'})</span></button>`).join('')}
    <button data-id="new">+ Nouvelle ouverture</button></div>`, (s) => {
    s.querySelector('.menu').onclick = (e) => {
      const id = e.target.closest('button')?.dataset.id; if (!id) return;
      const sans = an.sans.slice(0, an.i);
      if (id === 'new') { closeSheet(); return newChapterSheet({ name: $('aOpening').textContent.split(' · ')[1] || '', color: 'w', lines: [sans.join(' ')] }); }
      const ch = chById(id);
      if (ch.start !== startFen) return toast('Cette ouverture part d\'une autre position');
      const r = R.mergePgn(ch, sans.join(' '));
      save(); closeSheet(); toast(`${r.added} coup${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''} à ${ch.name}`);
    };
  });
};

// =====================================================================
//  PROGRÈS
// =====================================================================
function renderStats() {
  const now = Date.now(), D = 864e5;
  let tot = { total: 0, fresh: 0, learning: 0, mastered: 0, due: 0 };
  const per = chapters.map((ch) => { const s = R.chapterStats(ch, srs); for (const k in tot) tot[k] += s[k]; return { ch, s }; });
  // Prévision 7 jours
  const fc = Array(7).fill(0);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  for (const ch of chapters) for (const c of Object.values(srs[ch.id] || {})) {
    const dd = new Date(c.due); dd.setHours(0, 0, 0, 0);
    const idx = c.due <= now ? 0 : Math.round((dd - t0) / D);
    if (idx < 7) fc[idx]++;
  }
  const fmax = Math.max(1, ...fc);
  const dayName = (i) => i === 0 ? 'Auj.' : new Date(now + i * D).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
  // 12 semaines d'activité
  const cells = [];
  const start = new Date(); start.setDate(start.getDate() - 83);
  for (let i = 0; i < 84; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const l = log[d.toLocaleDateString('sv-SE')];
    const n = l ? l.ok + l.ko + l.learned : 0;
    cells.push(`<i class="lv${n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4}" title="${d.toLocaleDateString('fr-FR')} : ${n}"></i>`);
  }
  let ok = 0, ko = 0;
  for (const v of Object.values(log)) { ok += v.ok; ko += v.ko; }
  // positions les plus ratées
  const weak = [];
  for (const ch of chapters) for (const [k, c] of Object.entries(srs[ch.id] || {})) if (c.lapses) weak.push({ ch, k, c });
  weak.sort((a, b) => b.c.lapses - a.c.lapses);

  $('statsBody').innerHTML = `
    <div class="kpis">
      <div><b>${tot.mastered}</b><span>maîtrisés</span></div>
      <div><b>${tot.learning}</b><span>en cours</span></div>
      <div><b>${tot.fresh}</b><span>à apprendre</span></div>
      <div><b>${calcStreak()}</b><span>jours de série</span></div>
    </div>
    <div class="card"><div class="card-head"><h3>À réviser ces 7 jours</h3></div>
      <div class="forecast">${fc.map((n, i) => `<div><span class="fv">${n || ''}</span><i style="height:${(n / fmax) * 100}%"></i><span class="fd">${dayName(i)}</span></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><h3>Activité</h3><span class="muted small">${ok + ko ? Math.round((ok / (ok + ko)) * 100) + ' % de réussite' : ''}</span></div>
      <div class="heat">${cells.join('')}</div></div>
    <div class="card"><div class="card-head"><h3>Par ouverture</h3></div>
      ${per.length ? per.map(({ ch, s }) => `<div class="per"><span><span class="side side-${ch.color}">${ch.color === 'w' ? 'B' : 'N'}</span> ${esc(ch.name)}</span>
        <span class="meter"><i class="m-mast" style="width:${s.total ? (s.mastered / s.total) * 100 : 0}%"></i><i class="m-learn" style="width:${s.total ? (s.learning / s.total) * 100 : 0}%"></i></span>
        <span class="muted small">${s.mastered}/${s.total}</span></div>`).join('') : '<p class="muted small">Pas encore d\'ouverture.</p>'}
      <div class="legend"><span class="lg-m">Maîtrisé</span><span class="lg-l">En cours</span><span class="lg-f">Nouveau</span></div>
    </div>
    ${weak.length ? `<div class="card"><div class="card-head"><h3>Positions les plus ratées</h3></div>
      ${weak.slice(0, 6).map((w) => `<div class="per"><span>${esc(w.ch.name)}</span><span class="muted small">${R.movesAt(w.ch, w.k + ' - 0 1').map((m) => m.san).join(' / ')}</span><span class="bad-n">${w.c.lapses}×</span></div>`).join('')}
      <button class="pill-btn solid" id="weakGo" style="margin-top:12px">Travailler ces positions</button></div>` : ''}
    <div class="card"><div class="card-head"><h3>Sauvegarde</h3></div>
      <p class="muted small">Tout est stocké sur cet appareil. Exporte une sauvegarde pour la garder (ou la mettre dans Twake).</p>
      <div class="row-btns"><button class="pill-btn" id="bkExport">Exporter</button><label class="pill-btn file-btn">Restaurer<input type="file" accept=".json" id="bkImport" hidden></label></div>
    </div>`;
  $('weakGo')?.addEventListener('click', () => startSession('weak', chapters.map((c) => c.id)));
  $('bkExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'gambit', v: 1, at: new Date().toISOString(), chapters, srs, log, settings }, null, 1)], { type: 'application/json' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `gambit-sauvegarde-${today()}.json` }).click();
  };
  $('bkImport').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'gambit') throw 0;
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
      chapters = j.chapters; srs = j.srs; log = j.log || {}; Object.assign(settings, j.settings || {});
      save(); renderStats(); toast('Sauvegarde restaurée');
    } catch { toast('Fichier invalide'); }
  };
}

// =====================================================================
//  RÉGLAGES
// =====================================================================
$('settingsBtn').onclick = () => {
  sheet(`<h2>Réglages</h2>
    <label class="field"><span>Nouveaux coups par séance d'apprentissage</span><input type="number" id="stNew" min="1" max="50" value="${settings.newPerSession}" inputmode="numeric"></label>
    <label class="field"><span>Maximum de révisions par séance</span><input type="number" id="stRev" min="5" max="500" value="${settings.reviewLimit}" inputmode="numeric"></label>
    <div class="field"><span>Vitesse de l'adversaire</span><div class="seg" id="stSpeed">
      ${[[250, 'Rapide'], [500, 'Normale'], [900, 'Lente']].map(([v, l]) => `<button data-v="${v}" aria-pressed="${settings.speed === v}">${l}</button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="stSound" ${settings.sound ? 'checked' : ''}> Sons</label>
    <label class="check"><input type="checkbox" id="stEx" ${settings.explorer ? 'checked' : ''}> Explorateur des parties de maîtres (Lichess, en ligne)</label>
    <p class="muted small">Intervalles de révision : 10 min → 4 h → 1 j → 3 j → 1 sem → 2 sem → 1 mois → 3 mois → 6 mois. Une erreur fait redescendre la position.</p>
    <div class="sheet-actions"><button class="pill-btn solid" id="stOk">OK</button></div>`, (s) => {
    s.querySelector('#stSpeed').onclick = (e) => { const v = +e.target.dataset.v; if (!v) return; settings.speed = v; s.querySelectorAll('#stSpeed button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.v === v)); };
    s.querySelector('#stOk').onclick = () => {
      settings.newPerSession = Math.max(1, Math.min(50, +s.querySelector('#stNew').value || 5));
      settings.reviewLimit = Math.max(5, Math.min(500, +s.querySelector('#stRev').value || 30));
      settings.sound = s.querySelector('#stSound').checked;
      settings.explorer = s.querySelector('#stEx').checked;
      save(); closeSheet(); renderHome();
    };
  });
};

// ---------------- Démarrage ----------------
window.gambit = { get session() { return S; } }; // inspection depuis la console
go('home');
