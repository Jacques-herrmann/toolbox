import { store } from '../shared/store.js';
import { evaluate, format } from './engine.js';

const db = store('calc');
const $ = (id) => document.getElementById(id);

const state = {
  tokens: [],          // [{ d: affichage, v: source pour le moteur }]
  ans: db.get('ans', 0),
  deg: db.get('deg', true),
  sci: db.get('sci', false),
  second: false,
  justEvaluated: false,
  history: db.get('history', []),
};

// ---------- Définition des touches ----------
const num = (n) => ({ label: n, cls: 'num', tok: { d: n, v: n } });
const op = (d, v, cls = 'op') => ({ label: d, cls, tok: { d: ` ${d} `, v }, isOp: true });
const fn = (label, name, alt) => ({ label, cls: 'fn', tok: { d: `${label}(`, v: `${name}(` }, alt });

const BASIC = [
  { label: 'AC', cls: 'util', act: 'clear' },
  { label: '⌫', cls: 'util', act: 'back', aria: 'Effacer' },
  { label: '%', cls: 'util', tok: { d: '%', v: '%' } },
  op('÷', '/'),
  num('7'), num('8'), num('9'), op('×', '*'),
  num('4'), num('5'), num('6'), op('−', '-'),
  num('1'), num('2'), num('3'), op('+', '+'),
  { label: '±', cls: 'num', act: 'neg', aria: 'Changer le signe' },
  num('0'),
  { label: ',', cls: 'num', tok: { d: ',', v: '.' } },
  { label: '=', cls: 'eq', act: 'eq' },
];

const SCI = [
  { label: '2nd', cls: 'mod', act: 'second' },
  { label: 'DEG', cls: 'mod', act: 'angle', id: 'angleKey' },
  { label: '(', cls: 'fn', tok: { d: '(', v: '(' } },
  { label: ')', cls: 'fn', tok: { d: ')', v: ')' } },
  { label: 'Ans', cls: 'fn', tok: { d: 'Ans', v: 'Ans' } },
  fn('sin', 'sin', fn('sin⁻¹', 'asin')),
  fn('cos', 'cos', fn('cos⁻¹', 'acos')),
  fn('tan', 'tan', fn('tan⁻¹', 'atan')),
  fn('ln', 'ln', { label: 'eˣ', cls: 'fn', tok: { d: 'e^(', v: 'e^(' } }),
  fn('log', 'log', { label: '10ˣ', cls: 'fn', tok: { d: '10^(', v: '10^(' } }),
  fn('√', 'sqrt', fn('∛', 'cbrt')),
  { label: 'x²', cls: 'fn', tok: { d: '²', v: '²' }, alt: { label: 'x³', cls: 'fn', tok: { d: '³', v: '³' } } },
  { label: 'xʸ', cls: 'fn', tok: { d: '^', v: '^' }, alt: { label: 'ʸ√x', cls: 'fn', tok: { d: '^(1÷', v: '^(1/' } } },
  { label: 'x!', cls: 'fn', tok: { d: '!', v: '!' }, alt: { label: '1/x', cls: 'fn', tok: { d: '^(−1)', v: '^(-1)' } } },
  { label: 'π', cls: 'fn', tok: { d: 'π', v: 'π' }, alt: { label: 'e', cls: 'fn', tok: { d: 'e', v: 'e' } } },
];

function renderKeys(container, keys) {
  container.innerHTML = '';
  keys.forEach((k, i) => {
    const b = document.createElement('button');
    b.className = `key ${k.cls}`;
    b.dataset.i = i;
    if (k.id) b.id = k.id;
    if (k.aria) b.setAttribute('aria-label', k.aria);
    b.innerHTML = `<span class="main">${k.label}</span>${k.alt ? `<span class="alt">${k.alt.label}</span>` : ''}`;
    b.addEventListener('click', () => press(k));
    container.appendChild(b);
  });
}

// ---------- Logique ----------
const src = () => state.tokens.map((t) => t.v).join('');
const disp = () => state.tokens.map((t) => t.d).join('');

function press(k) {
  if (navigator.vibrate) navigator.vibrate(4);
  if (state.second && k.alt) k = k.alt;
  if (k.act) return action(k.act);
  const t = k.tok;
  if (state.justEvaluated) {
    // Après « = » : un opérateur continue avec Ans, un chiffre repart de zéro.
    const continues = k.isOp || ['%', '²', '³', '^', '!', '^(-1)', '^(1/'].includes(t.v);
    state.tokens = continues ? [{ d: 'Ans', v: 'Ans' }] : [];
    state.justEvaluated = false;
  }
  // Remplacer un opérateur par un autre (sauf « − » qui peut être un signe)
  const last = state.tokens[state.tokens.length - 1];
  if (k.isOp && last && ['+', '-', '*', '/'].includes(last.v) && t.v !== '-') state.tokens.pop();
  state.tokens.push(t);
  if (state.second) toggleSecond(false);
  update();
}

function action(a) {
  switch (a) {
    case 'clear':
      state.tokens = []; state.justEvaluated = false; break;
    case 'back':
      if (state.justEvaluated) { state.tokens = []; state.justEvaluated = false; }
      else state.tokens.pop();
      break;
    case 'neg': {
      if (state.justEvaluated) { state.tokens = [{ d: 'Ans', v: 'Ans' }]; state.justEvaluated = false; }
      // inverse le signe du dernier nombre
      let i = state.tokens.length;
      while (i > 0 && /^[0-9.]$/.test(state.tokens[i - 1].v)) i--;
      const prev = state.tokens[i - 1];
      if (prev && prev.v === '(-') state.tokens.splice(i - 1, 1);
      else state.tokens.splice(i, 0, { d: '(−', v: '(-' });
      break;
    }
    case 'eq': return equals();
    case 'second': return toggleSecond(!state.second);
    case 'angle':
      state.deg = !state.deg; db.set('deg', state.deg); break;
  }
  update();
}

function toggleSecond(on) {
  state.second = on;
  $('calc').classList.toggle('second', on);
  $('secondFlag').classList.toggle('hidden', !on);
  document.querySelector('[data-i="0"].mod')?.setAttribute('aria-pressed', on);
}

function compute() {
  if (!state.tokens.length) return null;
  try { return evaluate(src(), { deg: state.deg, ans: state.ans }); } catch { return undefined; }
}

function equals() {
  if (!state.tokens.length || state.justEvaluated) return;
  const r = compute();
  if (r === undefined || Number.isNaN(r)) {
    $('result').textContent = 'Erreur';
    $('result').classList.add('err');
    return;
  }
  state.history.unshift({ e: disp().trim(), r, at: Date.now() });
  state.history = state.history.slice(0, 60);
  db.set('history', state.history);
  state.ans = r; db.set('ans', r);
  $('expr').textContent = disp() + ' =';
  state.tokens = [{ d: format(r), v: String(r).replace('e', 'E') }];
  state.justEvaluated = true;
  $('result').classList.remove('err', 'preview');
  $('result').textContent = format(r);
  fit();
  renderHistory();
}

function update() {
  $('angleFlag').textContent = state.deg ? 'DEG' : 'RAD';
  const ak = $('angleKey'); if (ak) ak.querySelector('.main').textContent = state.deg ? 'DEG' : 'RAD';
  $('expr').textContent = disp() || ' ';
  const r = compute();
  const el = $('result');
  el.classList.remove('err');
  if (r === null) { el.textContent = '0'; el.classList.remove('preview'); }
  else if (r === undefined) { el.classList.add('preview'); /* garde le dernier aperçu valide */ }
  else { el.textContent = format(r); el.classList.add('preview'); }
  $('expr').scrollLeft = 1e6;
  fit();
}

// Réduit la police si le résultat déborde
function fit() {
  const el = $('result');
  el.style.fontSize = '';
  const max = el.parentElement.clientWidth - 8;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > max && size > 22) { size -= 3; el.style.fontSize = size + 'px'; }
}

// ---------- Mode / historique ----------
function setSci(on) {
  state.sci = on; db.set('sci', on);
  $('calc').classList.toggle('is-sci', on);
  $('modeBasic').setAttribute('aria-pressed', !on);
  $('modeSci').setAttribute('aria-pressed', on);
  if (!on) toggleSecond(false);
  requestAnimationFrame(fit);
}

function renderHistory() {
  const list = $('histList');
  list.innerHTML = '';
  $('histEmpty').classList.toggle('hidden', state.history.length > 0);
  state.history.forEach((h) => {
    const li = document.createElement('li');
    li.innerHTML = `<button><span class="h-e"></span><span class="h-r"></span></button>`;
    li.querySelector('.h-e').textContent = h.e + ' =';
    li.querySelector('.h-r').textContent = format(h.r);
    li.querySelector('button').addEventListener('click', () => {
      if (state.justEvaluated) { state.tokens = []; state.justEvaluated = false; }
      state.tokens.push({ d: format(h.r), v: `(${String(h.r).replace('e', 'E')})` });
      showHistory(false);
      update();
    });
    list.appendChild(li);
  });
}
function showHistory(on) { $('history').classList.toggle('hidden', !on); }

$('modeBasic').addEventListener('click', () => setSci(false));
$('modeSci').addEventListener('click', () => setSci(true));
$('histBtn').addEventListener('click', () => showHistory(true));
$('histClose').addEventListener('click', () => showHistory(false));
$('histClear').addEventListener('click', () => { state.history = []; db.set('history', []); renderHistory(); });

// Copier le résultat d'un appui long / clic sur l'écran
$('result').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('result').textContent.replace(/\s/g, '')); flash('Copié'); } catch {}
});
function flash(msg) {
  const f = document.createElement('div');
  f.className = 'toast'; f.textContent = msg;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
}

// ---------- Clavier physique ----------
const KEYMAP = {
  '+': BASIC[15], '-': BASIC[11], '*': BASIC[7], 'x': BASIC[7], '/': BASIC[3], '%': BASIC[2],
  ',': BASIC[18], '.': BASIC[18], '(': SCI[2], ')': SCI[3], '^': SCI[12], '!': SCI[13],
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) press(num(k));
  else if (KEYMAP[k]) press(KEYMAP[k]);
  else if (k === 'Enter' || k === '=') action('eq');
  else if (k === 'Backspace') action('back');
  else if (k === 'Escape' || k === 'Delete') action('clear');
  else if (k === 'p') press(SCI[14]);
  else return;
  e.preventDefault();
});
addEventListener('resize', fit);

renderKeys($('basicKeys'), BASIC);
renderKeys($('sciKeys'), SCI);
setSci(state.sci);
renderHistory();
update();
