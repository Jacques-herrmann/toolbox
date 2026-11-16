// Modèle du répertoire + import/export PGN + répétition espacée.
//
// Un chapitre = un graphe de positions (gère les transpositions) :
//   chapter = { id, name, color: 'w'|'b', start: fen, moves: { [posKey]: [{ san, c?: commentaire }] } }
// Une « carte » = une position du chapitre où c'est à moi de jouer et où le répertoire a un coup.
//   srs[chapterId][posKey] = { stage, due, reps, lapses, last }

import { Chess } from './vendor/chess.js';

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Clé de position : pièces + trait + roques (sans en-passant ni compteurs → transpositions OK)
export const posKey = (fen) => fen.split(' ').slice(0, 3).join(' ');

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newChapter(name, color = 'w', start = START) {
  return { id: uid(), name, color, start, moves: {}, created: Date.now() };
}

export function game(fen) { return new Chess(fen); }

export function addMove(ch, fenBefore, san) {
  const k = posKey(fenBefore);
  const list = ch.moves[k] || (ch.moves[k] = []);
  let e = list.find((m) => m.san === san);
  if (!e) { e = { san }; list.push(e); }
  return e;
}

export function movesAt(ch, fen) { return ch.moves[posKey(fen)] || []; }

export function removeMove(ch, fen, san, srs) {
  const k = posKey(fen);
  ch.moves[k] = (ch.moves[k] || []).filter((m) => m.san !== san);
  if (!ch.moves[k].length) delete ch.moves[k];
  gc(ch, srs);
}

// Supprime les positions devenues inaccessibles depuis le départ (et leurs cartes).
export function gc(ch, srs) {
  const reach = new Set();
  walk(ch, (g, k) => { reach.add(k); });
  for (const k of Object.keys(ch.moves)) if (!reach.has(k)) delete ch.moves[k];
  const cards = srs && srs[ch.id];
  if (cards) for (const k of Object.keys(cards)) if (!reach.has(k) || !ch.moves[k]) delete cards[k];
}

// Parcours en profondeur de toutes les positions accessibles (chacune une seule fois).
export function walk(ch, visit) {
  const seen = new Set();
  const stack = [ch.start];
  while (stack.length) {
    const fen = stack.pop();
    const k = posKey(fen);
    if (seen.has(k)) continue;
    seen.add(k);
    const g = new Chess(fen);
    visit(g, k);
    for (const m of ch.moves[k] || []) {
      const g2 = new Chess(fen);
      try { g2.move(m.san); stack.push(g2.fen()); } catch { /* coup devenu illégal : ignoré */ }
    }
  }
}

// Toutes les cartes d'un chapitre : [{ key, fen, expected: [san] }]
export function cardsOf(ch) {
  const out = [];
  walk(ch, (g, k) => {
    if (g.turn() === ch.color && ch.moves[k]?.length) out.push({ key: k, fen: g.fen(), expected: ch.moves[k].map((m) => m.san) });
  });
  return out;
}

export function countPositions(ch) { let n = 0; walk(ch, () => n++); return n; }

// ---------------- Répétition espacée ----------------
const MIN = 60e3, H = 60 * MIN, D = 24 * H;
export const INTERVALS = [10 * MIN, 4 * H, D, 3 * D, 7 * D, 14 * D, 30 * D, 90 * D, 180 * D];
export const MASTERED = 5;

export function grade(srs, chId, key, ok, now = Date.now()) {
  const cards = srs[chId] || (srs[chId] = {});
  const c = cards[key] || { stage: -1, reps: 0, lapses: 0 };
  if (ok) c.stage = Math.min(c.stage + 1, INTERVALS.length - 1);
  else { c.stage = c.stage >= 3 ? 1 : 0; c.lapses++; }
  c.stage = Math.max(c.stage, ok ? 1 : 0);
  c.reps++;
  c.last = now;
  c.due = now + INTERVALS[c.stage];
  cards[key] = c;
  return c;
}

export function cardState(srs, chId, key) { return srs[chId]?.[key] || null; }

export function chapterStats(ch, srs, now = Date.now()) {
  const s = { total: 0, fresh: 0, learning: 0, mastered: 0, due: 0, due24: 0 };
  for (const c of cardsOf(ch)) {
    s.total++;
    const st = cardState(srs, ch.id, c.key);
    if (!st) { s.fresh++; continue; }
    if (st.stage >= MASTERED) s.mastered++; else s.learning++;
    if (st.due <= now) s.due++;
    else if (st.due <= now + D) s.due24++;
  }
  return s;
}

// Nombre de cartes « cibles » restantes dans le sous-arbre (pour guider le choix des coups en entraînement)
export function targetsBelow(ch, fen, targets, done) {
  let n = 0;
  const seen = new Set();
  const stack = [fen];
  while (stack.length) {
    const f = stack.pop();
    const k = posKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    if (targets.has(k) && !done.has(k)) n++;
    for (const m of ch.moves[k] || []) {
      const g = new Chess(f);
      try { g.move(m.san); stack.push(g.fen()); } catch {}
    }
  }
  return n;
}

// ---------------- PGN ----------------
function tokenizeMovetext(txt) {
  const toks = [];
  const re = /\{([^}]*)\}|;([^\n]*)|(\()|(\))|(\$\d+)|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([^\s(){};]+)/g;
  let m;
  while ((m = re.exec(txt))) {
    if (m[1] !== undefined) toks.push({ t: 'c', v: m[1].trim() });
    else if (m[2] !== undefined) toks.push({ t: 'c', v: m[2].trim() });
    else if (m[3]) toks.push({ t: '(' });
    else if (m[4]) toks.push({ t: ')' });
    else if (m[5] || m[6] || m[7]) continue;
    else if (m[8]) {
      const san = m[8].replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
      if (san) toks.push({ t: 'm', v: san });
    }
  }
  return toks;
}

// Découpe un fichier PGN en parties { headers, movetext }
export function splitPgn(text) {
  const games = [];
  let cur = null;
  const lines = text.replace(/\r/g, '').split('\n');
  for (const line of lines) {
    const h = line.match(/^\s*\[(\w+)\s+"(.*)"\]\s*$/);
    if (h) {
      if (!cur || cur.movetext.trim()) { cur = { headers: {}, movetext: '' }; games.push(cur); }
      cur.headers[h[1]] = h[2];
    } else {
      if (!cur) { cur = { headers: {}, movetext: '' }; games.push(cur); }
      cur.movetext += line + '\n';
    }
  }
  return games.filter((g) => g.movetext.trim() || Object.keys(g.headers).length);
}

// Fusionne une partie PGN (avec variantes) dans un chapitre. Renvoie { added, errors }.
export function mergePgn(ch, movetext, startFen = ch.start) {
  const toks = tokenizeMovetext(movetext);
  let fen = startFen, before = null, lastEdge = null;
  const stack = [];
  let added = 0;
  const errors = [];
  for (const tk of toks) {
    if (tk.t === '(') {
      stack.push({ fen, before, lastEdge });
      if (before) fen = before;
      before = null;
    } else if (tk.t === ')') {
      const s = stack.pop();
      if (s) ({ fen, before, lastEdge } = s);
    } else if (tk.t === 'c') {
      if (lastEdge && tk.v) lastEdge.c = lastEdge.c ? lastEdge.c + ' ' + tk.v : tk.v;
    } else {
      const g = new Chess(fen);
      let mv;
      try { mv = g.move(tk.v); } catch { mv = null; }
      if (!mv) { errors.push(tk.v); continue; }
      const k = posKey(fen);
      const exists = (ch.moves[k] || []).some((m) => m.san === mv.san);
      lastEdge = addMove(ch, fen, mv.san);
      if (!exists) added++;
      before = fen;
      fen = g.fen();
    }
  }
  return { added, errors };
}

// Export PGN avec variantes (arbre depuis le départ ; une transposition déjà écrite n'est pas redéveloppée)
export function toPgn(ch) {
  const seen = new Set();
  const esc = (s) => s.replace(/[{}]/g, '');
  function line(fen, forceNum) {
    const k = posKey(fen);
    const moves = ch.moves[k];
    if (!moves?.length || seen.has(k)) return '';
    seen.add(k);
    const g = new Chess(fen);
    const n = g.moveNumber(), white = g.turn() === 'w';
    const num = (force) => (white ? `${n}. ` : force ? `${n}... ` : '');
    const after = (san) => { const g2 = new Chess(fen); g2.move(san); return g2.fen(); };
    const cm = (m) => (m.c ? ` {${esc(m.c)}}` : '');
    const [main, ...alts] = moves;
    let out = num(forceNum) + main.san + cm(main);
    for (const a of alts) {
      const sub = line(after(a.san), !!a.c);
      out += ` (${num(true)}${a.san}${cm(a)}${sub ? ' ' + sub : ''})`;
    }
    const rest = line(after(main.san), alts.length > 0 || !!main.c);
    return out + (rest ? ' ' + rest : '');
  }
  const headers = [`[Event "${ch.name.replace(/"/g, "'")}"]`, `[Site "Toolbox Gambit"]`, `[Result "*"]`];
  if (ch.start !== START) headers.push(`[SetUp "1"]`, `[FEN "${ch.start}"]`);
  return headers.join('\n') + '\n\n' + (line(ch.start, true) + ' *').trim() + '\n';
}
