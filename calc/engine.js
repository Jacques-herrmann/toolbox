// Évaluateur d'expressions (pas d'eval) : + − × ÷ ^ ! % ( ), fonctions, π, e, Ans,
// multiplication implicite (2π, 3(4+1), 2sin(30)), parenthèses auto-fermées.

const FUNCS = {
  sin: (x, d) => Math.sin(d ? x * Math.PI / 180 : x),
  cos: (x, d) => Math.cos(d ? x * Math.PI / 180 : x),
  tan: (x, d) => {
    if (d && Math.abs(x % 180) === 90) return NaN;
    return Math.tan(d ? x * Math.PI / 180 : x);
  },
  asin: (x, d) => d ? Math.asin(x) * 180 / Math.PI : Math.asin(x),
  acos: (x, d) => d ? Math.acos(x) * 180 / Math.PI : Math.acos(x),
  atan: (x, d) => d ? Math.atan(x) * 180 / Math.PI : Math.atan(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  exp: (x) => Math.exp(x),
  abs: (x) => Math.abs(x),
};

function factorial(n) {
  if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === 'E' && /[-+0-9]/.test(src[j + 1] || '')) { // notation 1.2E-5
        j++;
        if (/[-+]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const s = src.slice(i, j);
      if ((s.match(/\./g) || []).length > 1) throw new Error('nombre');
      out.push({ k: 'num', v: s === '.' ? 0 : parseFloat(s) });
      i = j; continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const w = src.slice(i, j);
      if (w in FUNCS) out.push({ k: 'fn', v: w });
      else if (w === 'pi') out.push({ k: 'num', v: Math.PI });
      else if (w === 'e') out.push({ k: 'num', v: Math.E });
      else if (w === 'Ans') out.push({ k: 'ans' });
      else throw new Error('inconnu ' + w);
      i = j; continue;
    }
    if (c === 'π') { out.push({ k: 'num', v: Math.PI }); i++; continue; }
    if ('+-*/^!%()²³'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error('caractère ' + c);
  }
  return out;
}

export function evaluate(src, { deg = true, ans = 0 } = {}) {
  const t = tokenize(src);
  // auto-fermeture des parenthèses
  let depth = 0;
  for (const x of t) {
    if (x.v === '(') depth++;
    if (x.v === ')') depth--;
    if (depth < 0) throw new Error('parenthèse');
  }
  while (depth-- > 0) t.push({ k: 'op', v: ')' });

  let p = 0;
  const peek = () => t[p];
  const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
  const startsPrimary = () => {
    const x = peek();
    return x && (x.k === 'num' || x.k === 'fn' || x.k === 'ans' || (x.k === 'op' && x.v === '('));
  };

  // Renvoie { v, pct } : pct = le terme se termine par % (pour a + b% = a + a·b/100)
  function expr() {
    let left = term().v;
    while (isOp('+') || isOp('-')) {
      const op = t[p++].v;
      const r = term();
      const rv = r.pct ? left * r.v : r.v;
      left = op === '+' ? left + rv : left - rv;
    }
    return { v: left };
  }
  function term() {
    let res = unary();
    while (true) {
      if (isOp('*') || isOp('/')) {
        const op = t[p++].v;
        const r = unary().v;
        res = { v: op === '*' ? res.v * r : res.v / r };
      } else if (startsPrimary()) {
        res = { v: res.v * unary().v };
      } else break;
    }
    return res;
  }
  function unary() {
    if (isOp('-')) { p++; const r = unary(); return { v: -r.v, pct: r.pct }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp('^')) {
      p++;
      const e = unary().v;
      return { v: Math.pow(base.v, e) };
    }
    return base;
  }
  function postfix() {
    let r = { v: primary() };
    while (peek() && peek().k === 'op' && '!%²³'.includes(peek().v)) {
      const op = t[p++].v;
      if (op === '!') r = { v: factorial(r.v) };
      else if (op === '²') r = { v: r.v * r.v };
      else if (op === '³') r = { v: r.v * r.v * r.v };
      else r = { v: r.v / 100, pct: true };
    }
    return r;
  }
  function primary() {
    const x = t[p++];
    if (!x) throw new Error('incomplet');
    if (x.k === 'num') return x.v;
    if (x.k === 'ans') return ans;
    if (x.k === 'fn') {
      if (!isOp('(')) throw new Error('(');
      p++;
      const a = expr().v;
      if (!isOp(')')) throw new Error(')');
      p++;
      return FUNCS[x.v](a, deg);
    }
    if (x.v === '(') {
      const v = expr().v;
      if (!isOp(')')) throw new Error(')');
      p++;
      return v;
    }
    throw new Error('inattendu ' + x.v);
  }

  const r = expr().v;
  if (p !== t.length) throw new Error('reste');
  return r;
}

// Affichage à la française : 1 234,5 — notation scientifique pour les extrêmes.
export function format(n) {
  if (Number.isNaN(n)) return 'Erreur';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
  if (Object.is(n, -0) || Math.abs(n) < 1e-15) n = 0;
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) {
    const [m, e] = n.toExponential(9).split('e');
    const mant = String(parseFloat(m)).replace('.', ',').replace('-', '−');
    const sup = String(parseInt(e, 10)).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
    return `${mant} × 10${sup}`;
  }
  const rounded = parseFloat(n.toPrecision(12));
  return rounded.toLocaleString('fr-FR', { maximumFractionDigits: 10 }).replace('-', '−');
}
