import { store } from '../shared/store.js';

const db = store('rounds');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Modes & réglages ----------
const MODES = {
  intervals: { label: 'Intervalles', defaults: { rounds: 8, work: 20, rest: 10, prep: 10, warn: 0, custom: false, perRound: [] } },
  boxe:      { label: 'Boxe',        defaults: { rounds: 4, work: 180, rest: 60, prep: 10, warn: 10, custom: false, perRound: [] } },
  emom:      { label: 'EMOM',        defaults: { rounds: 10, every: 60, prep: 10, warn: 0 } },
  amrap:     { label: 'AMRAP',       defaults: { duration: 720, prep: 10, warn: 60 } },
  fortime:   { label: 'For Time',    defaults: { cap: 0, prep: 10 } },
};
const FIELDS = {
  intervals: [['rounds', 'Rounds', 'count'], ['work', 'Effort', 'time'], ['rest', 'Repos', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte', 'time', 'avant la fin du round']],
  emom:      [['rounds', 'Rounds', 'count'], ['every', 'Toutes les', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte', 'time', 'avant la fin de la minute']],
  amrap:     [['duration', 'Durée', 'time'], ['prep', 'Préparation', 'time'], ['warn', 'Alerte', 'time', 'avant la fin']],
  fortime:   [['cap', 'Time cap', 'time', '0 = sans limite'], ['prep', 'Préparation', 'time']],
};
FIELDS.boxe = FIELDS.intervals;

let mode = db.get('mode', 'boxe');
if (!MODES[mode]) mode = 'boxe';
const configs = db.get('configs', {});
for (const m in MODES) configs[m] = { ...structuredClone(MODES[m].defaults), ...(configs[m] || {}) };
const cfg = () => configs[mode];
const persist = () => { db.set('mode', mode); db.set('configs', configs); };

// ---------- Temps ----------
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const short = (sec) => (sec < 60 ? `${sec}s` : sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec / 60}min`);
const parseTime = (str) => {
  str = String(str).trim();
  if (!str) return 0;
  if (str.includes(':')) return str.split(':').map((p) => parseInt(p, 10) || 0).reduce((a, p) => a * 60 + p, 0);
  return parseInt(str, 10) || 0; // sans « : » → secondes
};
const stepOf = (v) => (v < 60 ? 5 : v < 300 ? 15 : 30);

const ICON_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

function stepper(value, kind, onChange, { small = false } = {}) {
  const max = kind === 'count' ? 99 : 5999;
  const el = document.createElement('div');
  el.className = `stepper${small ? ' sm' : ''}`;
  el.innerHTML = `<button type="button" aria-label="Moins">${ICON_MINUS}</button><input inputmode="numeric" aria-label="Valeur"><button type="button" aria-label="Plus">${ICON_PLUS}</button>`;
  const [minus, input, plus] = el.children;
  const show = () => (input.value = kind === 'count' ? value : fmt(value));
  const set = (v) => { value = Math.min(max, Math.max(kind === 'count' ? 1 : 0, v)); show(); onChange(value); };
  const dec = () => set(value - (kind === 'count' ? 1 : stepOf(Math.max(0, value - 1))));
  const inc = () => set(value + (kind === 'count' ? 1 : stepOf(value)));
  // appui = un pas ; appui long = répétition (sans pas supplémentaire au relâchement)
  for (const [btn, act] of [[minus, dec], [plus, inc]]) {
    let t = null, repeated = false;
    btn.onpointerdown = () => { repeated = false; t = setTimeout(function rep() { repeated = true; act(); t = setTimeout(rep, 90); }, 450); };
    btn.onpointerup = btn.onpointerleave = btn.onpointercancel = () => clearTimeout(t);
    btn.onclick = () => { if (repeated) { repeated = false; return; } act(); };
  }
  input.onchange = () => set(kind === 'count' ? parseInt(input.value, 10) || 1 : parseTime(input.value));
  input.onfocus = () => input.select();
  show();
  return el;
}

// ---------- Séquence ----------
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

function describe(m, c) {
  switch (m) {
    case 'intervals': case 'boxe':
      return c.custom ? `${c.rounds} rounds · perso` : `${c.rounds} × ${short(c.work)} / ${short(c.rest)}`;
    case 'emom': return `${c.rounds} × ${short(c.every)}`;
    case 'amrap': return `${short(c.duration)}`;
    case 'fortime': return c.cap ? `cap ${short(c.cap)}` : 'sans limite';
  }
}

// ---------- Rendu de la configuration ----------
function renderModes() {
  const box = $('#modes');
  box.innerHTML = '';
  for (const m in MODES) {
    const b = document.createElement('button');
    b.className = 'mode';
    b.setAttribute('aria-pressed', m === mode);
    b.innerHTML = `<b>${MODES[m].label}</b><span>${esc(describe(m, configs[m]))}</span>`;
    b.onclick = () => { mode = m; persist(); render(); };
    box.append(b);
  }
  box.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function refresh() { // après un changement de valeur
  persist();
  renderHero();
  const active = $('#modes [aria-pressed="true"] span');
  if (active) active.textContent = describe(mode, cfg());
}

function row(label, hint, control) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<div class="row-label">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
  r.append(control);
  return r;
}

function renderForm() {
  const c = cfg();
  const form = $('#form');
  form.innerHTML = '';
  for (const [key, label, kind, hint] of FIELDS[mode]) {
    if (c.custom && (key === 'work' || key === 'rest')) continue;
    form.append(row(label, hint, stepper(c[key], kind, (v) => {
      c[key] = v;
      if (key === 'rounds' && c.custom) { syncPerRound(c); renderForm(); }
      refresh();
    })));
  }

  if (mode === 'intervals' || mode === 'boxe') {
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = '<input type="checkbox" aria-label="Personnaliser chaque round"><span></span>';
    const cb = sw.querySelector('input');
    cb.checked = !!c.custom;
    cb.onchange = () => {
      c.custom = cb.checked;
      if (c.custom) { c.perRound = []; syncPerRound(c); }
      renderForm(); refresh();
    };
    form.append(row('Round par round', 'Effort et repos différents par round', sw));

    if (c.custom) {
      syncPerRound(c);
      const box = document.createElement('div');
      box.className = 'per-round';
      box.innerHTML = '<div class="pr-head"><span></span><span>Effort</span><span>Repos après</span></div>';
      c.perRound.forEach((r, i) => {
        const line = document.createElement('div');
        line.className = 'pr-row';
        line.innerHTML = `<b>R${i + 1}</b>`;
        line.append(stepper(r.work, 'time', (v) => { r.work = v; refresh(); }, { small: true }));
        if (i === c.rounds - 1) line.insertAdjacentHTML('beforeend', '<span class="end">Fin 🏁</span>');
        else line.append(stepper(r.rest, 'time', (v) => { r.rest = v; refresh(); }, { small: true }));
        box.append(line);
      });
      form.append(box);
    }
  }
}

function renderHero() {
  const segs = build(mode, cfg());
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const finite = Number.isFinite(total);
  $('#total').textContent = finite ? fmt(total / 1000) : '∞';
  const works = segs.filter((s) => s.phase === 'work').length;
  $('#meta').textContent = {
    amrap: 'Un maximum de rounds dans le temps imparti',
    fortime: cfg().cap ? `Le plus vite possible · cap ${fmt(cfg().cap)}` : 'Chrono libre, le plus vite possible',
  }[mode] || `${works} round${works > 1 ? 's' : ''} d’effort`;
  const tl = $('#timeline');
  tl.innerHTML = '';
  segs.forEach((s, i) => {
    const el = document.createElement('i');
    if (Number.isFinite(s.dur)) { el.className = s.phase; el.style.flex = `${s.dur} 0 0`; }
    else el.className = 'open';
    el.style.animationDelay = `${Math.min(i * 25, 400)}ms`;
    tl.append(el);
  });
}

function renderPresets() {
  const list = db.get('presets', []);
  const box = $('#presets');
  box.innerHTML = list.length ? '' : '<span class="empty">Sauvegarde tes séances favorites pour les relancer en un geste.</span>';
  list.forEach((p, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<button class="go">${esc(p.name)}<small>${esc(MODES[p.mode]?.label ?? '')}</small></button><button class="del" aria-label="Supprimer">✕</button>`;
    chip.querySelector('.go').onclick = () => { mode = p.mode; configs[mode] = structuredClone(p.config); persist(); render(); };
    chip.querySelector('.del').onclick = () => { if (confirm(`Supprimer « ${p.name} » ?`)) { list.splice(i, 1); db.set('presets', list); renderPresets(); } };
    box.append(chip);
  });
}
$('#savePreset').onclick = () => {
  const name = prompt('Nom du preset ?', `${MODES[mode].label} ${describe(mode, cfg())}`);
  if (!name) return;
  const list = db.get('presets', []);
  list.push({ name, mode, config: structuredClone(cfg()) });
  db.set('presets', list);
  renderPresets();
};

function render() { renderModes(); renderForm(); renderHero(); renderPresets(); }

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
const PAUSE_ICON = '<rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/>';
const PLAY_ICON = '<path d="M8 4.5v15a1 1 0 0 0 1.5.86l11-7.5a1 1 0 0 0 0-1.72l-11-7.5A1 1 0 0 0 8 4.5z"/>';
const PHASE_LABEL = { prep: 'Prêt ?', work: 'Effort', rest: 'Repos' };

let run = null;
let wakeLock = null;
async function lockScreen() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (run && !run.done && document.visibilityState === 'visible') lockScreen(); });

function start() {
  const segs = build(mode, cfg());
  if (!segs.length) return;
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  const total = segs.find((s) => s.total)?.total || 0;
  run = { segs, idx: -1, segStart: 0, pausedAt: null, count: 0, timer: null, total };
  $('#setup').classList.add('hidden');
  $('#startbar').classList.add('hidden');
  const r = $('#run');
  r.classList.remove('hidden', 'paused');
  $('#rCount').textContent = '0';
  $('#rDots').innerHTML = total > 1 && total <= 40 ? '<i></i>'.repeat(total) : '';
  ['#rSkip', '#rPause'].forEach((s) => $(s).classList.remove('hidden'));
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
  const seg = run.segs[run.idx];
  const remaining = seg.dur - (performance.now() - run.segStart);
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
  el.dataset.warn = seg.phase === 'work' && seg.warn > 0 && seg.dur > seg.warn && seg.dur - elapsed <= seg.warn && !run.pausedAt ? '1' : '0';
  el.classList.toggle('paused', !!run.pausedAt);

  $('#rPhase').textContent = seg.phase === 'work' && seg.label ? seg.label : PHASE_LABEL[seg.phase];
  $('#rRound').innerHTML = seg.round
    ? (seg.phase === 'rest' ? `prochain<b>${seg.round + 1}/${seg.total}</b>` : `round<b>${seg.round}/${seg.total}</b>`)
    : seg.counter && seg.phase === 'work' ? `rounds<b>${run.count}</b>` : '';

  const clock = seg.countUp ? fmt(elapsed / 1000) : fmt(Math.ceil((seg.dur - elapsed) / 1000));
  const c = $('#rClock');
  c.textContent = clock;
  c.classList.toggle('long', clock.length > 5);
  $('#rBar').style.width = Number.isFinite(seg.dur) ? `${Math.min(100, (elapsed / seg.dur) * 100)}%` : '0%';

  const dots = $('#rDots').children;
  for (let i = 0; i < dots.length; i++) {
    const r = i + 1;
    const doneRound = seg.round ? (r < seg.round || (r === seg.round && seg.phase === 'rest')) : false;
    dots[i].className = doneRound ? 'done' : r === seg.round && seg.phase === 'work' ? 'now' : '';
  }

  const after = run.segs[run.idx + 1];
  $('#rNext').innerHTML = after
    ? `Ensuite · <b>${after.phase === 'rest' ? 'Repos' : after.round ? `Round ${after.round}` : 'Go'}</b> ${Number.isFinite(after.dur) ? fmt(after.dur / 1000) : ''}`
    : seg.phase === 'work' ? '<b>Dernier effort 🔥</b>' : '';
  const left = run.segs.slice(run.idx + 1).reduce((a, s) => a + s.dur, 0) + (seg.dur - elapsed);
  $('#rLeft').textContent = Number.isFinite(left) ? `reste ${fmt(left / 1000)}` : '';
  $('#rPauseIcon').innerHTML = run.pausedAt ? PLAY_ICON : PAUSE_ICON;
}

function finish() {
  clearInterval(run.timer);
  sounds.end();
  run.done = true;
  const el = $('#run');
  el.dataset.phase = 'done'; el.dataset.warn = '0'; el.classList.remove('paused');
  const last = run.segs[run.segs.length - 1];
  $('#rPhase').textContent = 'Terminé';
  $('#rRound').innerHTML = run.segs.some((s) => s.counter) ? `rounds<b>${run.count}</b>` : run.total ? `rounds<b>${run.total}</b>` : '';
  if (!last?.countUp) $('#rClock').textContent = '💪';
  $('#rBar').style.width = '100%';
  [...$('#rDots').children].forEach((d) => (d.className = 'done'));
  $('#rNext').innerHTML = last?.countUp ? '<b>Temps final</b>' : '<b>Bien joué.</b>';
  $('#rLeft').textContent = '';
  $('#rCounter').classList.add('hidden');
  $('#rPause').classList.add('hidden');
  $('#rSkip').classList.add('hidden');
  wakeLock?.release?.().catch(() => {});
}

function stop() {
  if (run) clearInterval(run.timer);
  run = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  $('#run').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  $('#startbar').classList.remove('hidden');
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
  if (seg.countUp) { run.pausedAt = null; draw(); return finish(); } // For Time : terminer
  run.pausedAt = null;
  next(performance.now());
};
$('#rStop').onclick = () => { if (run?.done || confirm('Arrêter la séance ?')) stop(); };
$('#rCounter').onclick = () => {
  if (!run || run.done) return;
  run.count++;
  $('#rCount').textContent = run.count;
  tone(1200, 0.08); vib(40);
  draw();
};

render();
