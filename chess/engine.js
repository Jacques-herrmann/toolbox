// Analyse : Stockfish (WebAssembly/asm.js, chargé à la demande depuis jsDelivr, tourne sur l'appareil)
// + éval cloud Lichess (instantanée si la position est connue) + explorateur des parties de maîtres.

const SF_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

let worker = null, ready = null, current = null, queued = null;

function boot() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    try {
      const blob = new Blob([`importScripts('${SF_URL}');`], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (e) { reject(e); return; }
    const t = setTimeout(() => reject(new Error('Stockfish ne répond pas')), 20000);
    worker.onerror = (e) => { clearTimeout(t); reject(e); };
    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'uciok') worker.postMessage('isready');
      else if (line === 'readyok') { clearTimeout(t); worker.onmessage = onLine; resolve(); }
    };
    worker.postMessage('uci');
  });
  ready.catch(() => { ready = null; worker = null; });
  return ready;
}

function onLine(e) {
  const line = String(e.data);
  if (!current) return;
  if (line.startsWith('info') && line.includes(' pv ') && !current.stopping) {
    const depth = +line.match(/ depth (\d+)/)?.[1];
    const mp = +(line.match(/ multipv (\d+)/)?.[1] || 1);
    const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/);
    const pv = line.split(' pv ')[1].trim().split(' ');
    const sign = current.turn === 'w' ? 1 : -1; // on ramène tout au point de vue des Blancs
    current.lines[mp - 1] = { depth, pv, cp: cp ? sign * +cp[1] : null, mate: mate ? sign * +mate[1] : null };
    current.cb({ source: 'local', depth, lines: current.lines.filter(Boolean) });
  } else if (line.startsWith('bestmove')) {
    const was = current;
    current = null;
    if (queued) { const q = queued; queued = null; start(q); }
    else if (!was.stopping) was.cb({ source: 'local', done: true, lines: was.lines.filter(Boolean) });
  }
}

function start(job) {
  current = { ...job, lines: [], stopping: false };
  worker.postMessage('setoption name MultiPV value ' + job.multipv);
  worker.postMessage('position fen ' + job.fen);
  worker.postMessage('go depth ' + job.depth);
}

// Lance l'analyse locale ; cb reçoit des mises à jour successives.
export async function analyseLocal(fen, cb, { depth = 20, multipv = 2 } = {}) {
  await boot();
  const job = { fen, cb, depth, multipv, turn: fen.split(' ')[1] };
  if (current) { current.stopping = true; queued = job; worker.postMessage('stop'); }
  else start(job);
}

export function stopLocal() {
  queued = null;
  if (current && worker) { current.stopping = true; worker.postMessage('stop'); }
}

// Éval cloud Lichess (null si inconnue)
const cloudCache = new Map();
export async function cloudEval(fen, multipv = 2) {
  if (cloudCache.has(fen)) return cloudCache.get(fen);
  const r = await fetch(`https://lichess.org/api/cloud-eval?multiPv=${multipv}&fen=${encodeURIComponent(fen)}`);
  if (!r.ok) { cloudCache.set(fen, null); return null; }
  const j = await r.json();
  const res = {
    source: 'cloud', depth: j.depth,
    lines: j.pvs.map((p) => ({ pv: p.moves.split(' '), cp: p.cp ?? null, mate: p.mate ?? null, depth: j.depth })),
  };
  cloudCache.set(fen, res);
  return res;
}

// Explorateur : parties de maîtres (OTB) — gratuit, sans compte
const exCache = new Map();
export async function explore(fen) {
  if (exCache.has(fen)) return exCache.get(fen);
  const r = await fetch(`https://explorer.lichess.ovh/masters?topGames=0&moves=12&fen=${encodeURIComponent(fen)}`);
  if (!r.ok) throw new Error('explorateur ' + r.status);
  const j = await r.json();
  exCache.set(fen, j);
  return j;
}

// Puzzle du jour Lichess
export async function dailyPuzzle() {
  const r = await fetch('https://lichess.org/api/puzzle/daily');
  if (!r.ok) throw new Error('puzzle ' + r.status);
  return r.json();
}

export function fmtEval(l) {
  if (!l) return '–';
  if (l.mate != null) return (l.mate > 0 ? '#' : '#-') + Math.abs(l.mate);
  const v = l.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
// Score → part de la barre blanche (0..1)
export function evalShare(l) {
  if (!l) return .5;
  if (l.mate != null) return l.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-l.cp / 250));
}
