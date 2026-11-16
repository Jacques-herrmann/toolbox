import { store } from '../shared/store.js';

const db = store('rounds');
const $ = (s) => document.querySelector(s);

// ---------- Modes & réglages ----------
const MODES = {
  intervals: { label: 'Intervalles', defaults: { rounds: 8, work: 20, rest: 10, prep: 10, warn: 0, custom: false, perRound: [] } },
  boxe:      { label: 'Boxe',        defaults: { rounds: 4, work: 180, rest: 60, prep: 10, warn: 10, custom: false, perRound: [] } },
  emom:      { label: 'EMOM',        defaults: { rounds: 10, every: 60, prep: 10, warn: 0 } },
  amrap:     { label: 'AMRAP',       defaults: { duration: 720, prep: 10, warn: 60 } },
  fortime:   { label: 'For Time',    defaults: { cap: 0, prep: 10 } },
};
const FIELDS = {
  intervals: [['rounds', 'Rounds', 'count'], ['work', 'Travail', 'time'], ['rest', 'Repos', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte avant la fin', 'time']],
  emom:      [['rounds', 'Rounds', 'count'], ['every', 'Toutes les', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte avant la fin', 'time']],
  amrap:     [['duration', 'Durée', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte avant la fin', 'time']],
  fortime:   [['cap', 'Time cap (0 = aucun)', 'time'], ['prep', 'Préparation', 'time']],
};
FIELDS.boxe = FIELDS.intervals;

let mode = db.get('mode', 'boxe');
let configs = db.get('configs', {});
for (const m in MODES) configs[m] = { ...structuredClone(MODES[m].defaults), ...(configs[m] || {}) };
const cfg = () => configs[mode];
const persist = () => { db.set('mode', mode); db.set('configs', configs); };

// ---------- Utilitaires temps ----------
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const parseTime = (str) => {
  str = String(str).trim();
  if (!str) return 0;
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseInt(p, 10) || 0);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return parseInt(str, 10) || 0; // sans « : » → secondes
};
const stepFor = (v, dir) => (v + (dir > 0 ? 0 : -1) < 60 ? 5 : v + (dir > 0 ? 0 : -1) < 300 ? 15 : 30);

function stepper(value, kind, onChange, max = kind === 'count' ? 99 : 5999) {
  const el = document.createElement('div');
  el.className = 'stepper';
  el.innerHTML = `<button type="button" aria-label="moins">−</button><input inputmode="numeric"><button type="button" aria-label="plus">+</button>`;
  const [minus, input, plus] = el.children;
  const show = () => (input.value = kind === 'count' ? value : fmt(value));
  const set = (v) => { value = Math.min(max, Math.max(kind === 'count' ? 1 : 0, v)); show(); onChange(value); };
  minus.onclick = () => set(value - (kind === 'count' ? 1 : stepFor(value, -1)));
  plus.onclick = () => set(value + (kind === 'count' ? 1 : stepFor(value, 1)));
  input.onchange = () => set(kind === 'count' ? parseInt(input.value, 10) || 1 : parseTime(input.value));
  input.onfocus = () => input.select();
  show();
  return el;
}

// ---------- Construction de la séquence ----------
function syncPerRound(c) {
  c.perRound = c.perRound || [];
  while (c.perRound.length < c.rounds) c.perRound.push({ work: c.work, rest: c.rest });
  c.perRound.length = c.rounds;
}

function build(m, c) {
  const segs = [];
  if (c.prep > 0) segs.push({ phase: 'prep', dur: c.prep * 1000 });
  if (m === 'intervals' || m === 'boxe') {
    if (c.custom) syncPerRound(c);
    for (let i = 0; i < c.rounds; i++) {
      const w = c.custom ? c.perRound[i].work : c.work;
      const r = c.custom ? c.perRound[i].rest : c.rest;
      if (w > 0) segs.push({ phase: 'work', dur: w * 1000, round: i + 1, total: c.rounds, warn: c.warn * 1000 });
      if (i < c.rounds - 1 && r > 0) segs.push({ phase: 'rest', dur: r * 1000, round: i + 1, total: c.rounds });
    }
  } else if (m === 'emom') {
    for (let i = 0; i < c.rounds; i++) segs.push({ phase: 'work', dur: c.every * 1000, round: i + 1, total: c.rounds, warn: c.warn * 1000 });
  } else if (m === 'amrap') {
    segs.push({ phase: 'work', dur: c.duration * 1000, warn: c.warn * 1000, counter: true, label: 'AMRAP' });
  } else if (m === 'fortime') {
    segs.push({ phase: 'work', dur: c.cap > 0 ? c.cap * 1000 : Infinity, countUp: true, counter: true, label: 'For Time', warn: c.cap > 60 ? 60000 : 0 });
  }
  return segs;
}

// ---------- Formulaire ----------
function renderTabs() {
  $('#tabs').innerHTML = '';
  for (const m in MODES) {
    const b = document.createElement('button');
    b.textContent = MODES[m].label;
    b.setAttribute('aria-pressed', m === mode);
    b.onclick = () => { mode = m; persist(); render(); };
    $('#tabs').append(b);
  }
}

function renderForm() {
  const c = cfg();
  const form = $('#form');
  form.innerHTML = '';
  for (const [key, label, kind] of FIELDS[mode]) {
    if (c.custom && (key === 'work' || key === 'rest')) continue;
    const row = document.createElement('label');
    row.className = 'field';
    row.innerHTML = `<span>${label}</span>`;
    row.append(stepper(c[key], kind, (v) => {
      c[key] = v;
      if (key === 'rounds' && c.custom) { syncPerRound(c); persist(); renderForm(); }
      persist(); renderSummary();
    }));
    form.append(row);
  }

  if (mode === 'intervals' || mode === 'boxe') {
    const toggle = document.createElement('label');
    toggle.className = 'field';
    toggle.innerHTML = `<span>Personnaliser chaque round</span><input type="checkbox" style="width:auto;transform:scale(1.4)">`;
    const cb = toggle.querySelector('input');
    cb.checked = !!c.custom;
    cb.onchange = () => {
      c.custom = cb.checked;
      if (c.custom) { c.perRound = []; syncPerRound(c); }
      persist(); renderForm(); renderSummary();
    };
    form.append(toggle);

    if (c.custom) {
      syncPerRound(c);
      const list = document.createElement('div');
      list.className = 'rounds-list';
      list.innerHTML = `<span></span><span class="muted">Travail</span><span class="muted">Repos après</span>`;
      c.perRound.forEach((r, i) => {
        const name = document.createElement('strong');
        name.textContent = `R${i + 1}`;
        const w = stepper(r.work, 'time', (v) => { r.work = v; persist(); renderSummary(); });
        const last = i === c.rounds - 1;
        const rest = last ? Object.assign(document.createElement('span'), { className: 'muted', textContent: 'fin' })
          : stepper(r.rest, 'time', (v) => { r.rest = v; persist(); renderSummary(); });
        list.append(name, w, rest);
      });
      form.append(list);
    }
  }
}

function renderSummary() {
  const segs = build(mode, cfg());
  const total = segs.reduce((a, s) => a + s.dur, 0);
  $('#summary').textContent = Number.isFinite(total) ? `Durée totale : ${fmt(total / 1000)}` : 'Chrono sans limite';
}

// ---------- Presets ----------
function renderPresets() {
  const list = db.get('presets', []);
  const box = $('#presets');
  box.innerHTML = list.length ? '' : '<span class="muted">Aucun preset.</span>';
  list.forEach((p, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const name = document.createElement('button');
    name.textContent = `${p.name} · ${MODES[p.mode]?.label ?? ''}`;
    name.onclick = () => { mode = p.mode; configs[mode] = structuredClone(p.config); persist(); render(); };
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Supprimer');
    del.onclick = () => { if (confirm(`Supprimer « ${p.name} » ?`)) { list.splice(i, 1); db.set('presets', list); renderPresets(); } };
    chip.append(name, del);
    box.append(chip);
  });
}
$('#savePreset').onclick = () => {
  const name = prompt('Nom du preset ?', MODES[mode].label);
  if (!name) return;
  const list = db.get('presets', []);
  list.push({ name, mode, config: structuredClone(cfg()) });
  db.set('presets', list);
  renderPresets();
};

function render() { renderTabs(); renderForm(); renderSummary(); renderPresets(); }

// ---------- Sons ----------
let ctx = null;
function tone(freq, dur, when = 0, vol = 0.35) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const vib = (p) => navigator.vibrate?.(p);
const sounds = {
  tick: () => { tone(660, 0.12); vib(60); },
  go:   () => { tone(990, 0.7); vib(400); },
  rest: () => { tone(520, 0.25); tone(520, 0.25, 0.3); vib([150, 80, 150]); },
  warn: () => { [0, 0.18, 0.36].forEach((w) => tone(880, 0.1, w)); vib([80, 60, 80, 60, 80]); },
  end:  () => { [0, 0.35, 0.7].forEach((w) => tone(990, 0.3, w)); tone(1320, 0.9, 1.05); vib([300, 100, 300, 100, 600]); },
};

// ---------- Moteur ----------
let run = null;
let wakeLock = null;
async function lockScreen() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (run && document.visibilityState === 'visible') lockScreen(); });

function start() {
  const segs = build(mode, cfg());
  if (!segs.length) return;
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  run = { segs, idx: -1, segStart: 0, pausedAt: null, count: 0, timer: null };
  $('#setup').classList.add('hidden');
  $('#run').classList.remove('hidden');
  $('#rCount').textContent = '0';
  lockScreen();
  next(performance.now());
  run.timer = setInterval(tick, 100);
}

function next(at) {
  run.idx++;
  const seg = run.segs[run.idx];
  if (!seg) return finish();
  run.segStart = at;
  run.lastSec = null;
  run.warned = false;
  if (seg.phase === 'work') sounds.go();
  else if (seg.phase === 'rest') sounds.rest();
  $('#rCounter').classList.toggle('hidden', !seg.counter);
  draw();
}

function tick() {
  if (!run || run.pausedAt) return;
  const now = performance.now();
  const seg = run.segs[run.idx];
  const elapsed = now - run.segStart;
  const remaining = seg.dur - elapsed;
  if (remaining <= 0) { next(run.segStart + seg.dur); return; }
  const secLeft = Math.ceil(remaining / 1000);
  if (secLeft !== run.lastSec) {
    run.lastSec = secLeft;
    if (secLeft <= 3 && seg.dur >= 4000) sounds.tick();
  }
  if (!run.warned && seg.warn > 0 && seg.dur > seg.warn && remaining <= seg.warn) { run.warned = true; sounds.warn(); }
  draw();
}

function draw() {
  const seg = run.segs[run.idx];
  if (!seg) return;
  const now = run.pausedAt ?? performance.now();
  const elapsed = now - run.segStart;
  const el = $('#run');
  el.dataset.phase = seg.phase;
  el.dataset.warn = seg.warn > 0 && seg.dur - elapsed <= seg.warn && seg.phase === 'work' ? '1' : '0';

  $('#rPhase').textContent = seg.phase === 'prep' ? 'Prépare-toi' : seg.phase === 'rest' ? 'Repos' : seg.label || 'Travail';
  $('#rRound').textContent = seg.round ? (seg.phase === 'rest' ? `Prochain : round ${seg.round + 1} / ${seg.total}` : `Round ${seg.round} / ${seg.total}`) : '';
  $('#rClock').textContent = seg.countUp ? fmt(elapsed / 1000) : fmt(Math.ceil((seg.dur - elapsed) / 1000));
  $('#rBar').style.width = Number.isFinite(seg.dur) ? `${Math.min(100, (elapsed / seg.dur) * 100)}%` : '0%';

  const after = run.segs[run.idx + 1];
  const left = run.segs.slice(run.idx + 1).reduce((a, s) => a + s.dur, 0) + (seg.dur - elapsed);
  const parts = [];
  if (after) parts.push(`Ensuite : ${after.phase === 'rest' ? 'repos' : after.round ? `round ${after.round}` : 'go'} ${Number.isFinite(after.dur) ? fmt(after.dur / 1000) : ''}`);
  if (Number.isFinite(left)) parts.push(`reste ${fmt(left / 1000)}`);
  $('#rNext').textContent = parts.join(' · ');
  $('#rPause').textContent = run.pausedAt ? 'Reprendre' : 'Pause';
}

function finish() {
  clearInterval(run.timer);
  sounds.end();
  const el = $('#run');
  el.dataset.phase = 'done'; el.dataset.warn = '0';
  $('#rPhase').textContent = 'Terminé 💪';
  $('#rRound').textContent = run.segs.some((s) => s.counter) ? `${run.count} round${run.count > 1 ? 's' : ''}` : '';
  const last = run.segs[run.segs.length - 1];
  if (last?.countUp) $('#rRound').textContent += ` · ${$('#rClock').textContent}`;
  else $('#rClock').textContent = '00:00';
  $('#rBar').style.width = '100%';
  $('#rNext').textContent = '';
  $('#rPause').classList.add('hidden');
  $('#rSkip').classList.add('hidden');
  $('#rStop').textContent = 'Fermer';
  run.done = true;
}

function stop() {
  if (run) clearInterval(run.timer);
  run = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  $('#run').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  $('#rPause').classList.remove('hidden');
  $('#rSkip').classList.remove('hidden');
  $('#rStop').textContent = 'Stop';
}

$('#start').onclick = start;
$('#rPause').onclick = () => {
  if (!run || run.done) return;
  if (run.pausedAt) { run.segStart += performance.now() - run.pausedAt; run.pausedAt = null; }
  else run.pausedAt = performance.now();
  draw();
};
$('#rSkip').onclick = () => {
  if (!run || run.done) return;
  const seg = run.segs[run.idx];
  // For Time : « Suivant » = terminer le chrono
  if (seg.countUp) { run.pausedAt = null; return finish(); }
  run.pausedAt = null;
  next(performance.now());
};
$('#rStop').onclick = () => { if (run?.done || confirm('Arrêter la séance ?')) stop(); };
$('#rCounter').onclick = () => { if (!run || run.done) return; run.count++; $('#rCount').textContent = run.count; tone(1200, 0.08); vib(40); };

render();
