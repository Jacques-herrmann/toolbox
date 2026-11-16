// Échiquier tactile maison : tap-tap ou glisser-déposer, coups légaux, promotion,
// flèches, surbrillances, animation du dernier coup. Pièces : sprite SVG (vendor/pieces.svg).

const FILES = 'abcdefgh';
const NS = 'http://www.w3.org/2000/svg';
let spritePromise;
let boardCount = 0;

function loadSprite() {
  if (!spritePromise) {
    spritePromise = fetch(new URL('./vendor/pieces.svg', import.meta.url)).then((r) => r.text()).then((txt) => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      holder.innerHTML = txt.replace(/<\?xml[^>]*>/, '');
      document.body.prepend(holder);
    });
  }
  return spritePromise;
}

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.orientation = opts.orientation || 'w';
    this.onMove = opts.onMove || (() => {});
    this.movable = opts.movable ?? 'both';   // 'w' | 'b' | 'both' | 'none'
    this.chess = null;
    this.selected = null;
    this.lastMove = null;
    this.arrows = [];
    this.marks = {};    // { square: 'good' | 'bad' | 'hint' }
    this.build();
    loadSprite().then(() => this.render());
  }

  build() {
    this.el.classList.add('board');
    this.uid = 'b' + (++boardCount);
    this.el.innerHTML = `<div class="b-squares"></div><div class="b-pieces"></div>
      <svg class="b-arrows" viewBox="0 0 8 8"><defs>
        ${['g', 'b', 'r', 'y'].map((c) => `<marker id="${this.uid}-ah-${c}" class="ah-${c}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z"/></marker>`).join('')}
      </defs><g></g></svg><div class="b-promo hidden"></div>`;
    this.sqLayer = this.el.querySelector('.b-squares');
    this.pcLayer = this.el.querySelector('.b-pieces');
    this.arLayer = this.el.querySelector('.b-arrows g');
    this.promoEl = this.el.querySelector('.b-promo');
    this.squares = {};
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      this.sqLayer.appendChild(d);
    }
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- coordonnées ----------
  xy(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  sqAt(clientX, clientY) {
    const b = this.el.getBoundingClientRect();
    const x = Math.floor(((clientX - b.left) / b.width) * 8), y = Math.floor(((clientY - b.top) / b.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  // ---------- API ----------
  setPosition(chess, { lastMove = null, animate = false } = {}) {
    this.chess = chess;
    this.lastMove = lastMove;
    this.selected = null;
    this.marks = {};
    this.render(animate ? lastMove : null);
  }
  setOrientation(c) { this.orientation = c; this.render(); }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }
  setMovable(m) { this.movable = m; this.selected = null; this.renderSquares(); }
  setArrows(arrows) { this.arrows = arrows || []; this.renderArrows(); }
  setMarks(marks) { this.marks = marks || {}; this.renderSquares(); }

  // ---------- rendu ----------
  render(anim = null) {
    this.renderSquares();
    this.renderPieces(anim);
    this.renderArrows();
  }

  renderSquares() {
    const cells = this.sqLayer.children;
    const dests = this.selected ? this.legalFrom(this.selected).map((m) => m.to) : [];
    let checkSq = null;
    if (this.chess && this.chess.isCheck()) {
      const t = this.chess.turn();
      for (const row of this.chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === t) checkSq = p.square;
    }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
      const d = cells[y * 8 + x];
      const light = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      let cls = 'sq ' + (light ? 'l' : 'd');
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to)) cls += ' last';
      if (sq === this.selected) cls += ' sel';
      if (dests.includes(sq)) cls += this.chess.get(sq) ? ' cap' : ' dest';
      if (sq === checkSq) cls += ' check';
      if (this.marks[sq]) cls += ' m-' + this.marks[sq];
      d.className = cls;
      let coord = '';
      if (x === 0) coord += `<i class="rank">${sq[1]}</i>`;
      if (y === 7) coord += `<i class="file">${sq[0]}</i>`;
      d.innerHTML = coord;
    }
  }

  renderPieces(anim) {
    this.pcLayer.innerHTML = '';
    if (!this.chess) return;
    for (const row of this.chess.board()) for (const p of row) {
      if (!p) continue;
      const el = this.pieceEl(p.color + p.type);
      el.dataset.sq = p.square;
      this.place(el, p.square);
      if (anim && p.square === anim.to) {
        const [fx, fy] = this.xy(anim.from), [tx, ty] = this.xy(anim.to);
        el.style.transition = 'none';
        el.style.transform = `translate(${fx * 100}%, ${fy * 100}%)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = `translate(${tx * 100}%, ${ty * 100}%)`;
        }));
      }
      this.pcLayer.appendChild(el);
    }
  }
  pieceEl(code) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.classList.add('pc');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#' + code);
    svg.appendChild(use);
    return svg;
  }
  place(el, sq) {
    const [x, y] = this.xy(sq);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  }

  renderArrows() {
    this.arLayer.innerHTML = '';
    for (const a of this.arrows) {
      const [x1, y1] = this.xy(a.from), [x2, y2] = this.xy(a.to);
      const cx1 = x1 + .5, cy1 = y1 + .5, cx2 = x2 + .5, cy2 = y2 + .5;
      const len = Math.hypot(cx2 - cx1, cy2 - cy1);
      const k = (len - .32) / len; // la pointe s'arrête avant le centre
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', cx1); line.setAttribute('y1', cy1);
      line.setAttribute('x2', cx1 + (cx2 - cx1) * k); line.setAttribute('y2', cy1 + (cy2 - cy1) * k);
      line.setAttribute('class', 'ar ar-' + (a.color || 'g'));
      if (a.opacity) line.style.opacity = a.opacity;
      line.setAttribute('marker-end', `url(#${this.uid}-ah-${a.color || 'g'})`);
      this.arLayer.appendChild(line);
    }
  }

  // ---------- interaction ----------
  canMove(color) { return this.movable === 'both' || this.movable === color; }
  legalFrom(sq) {
    if (!this.chess) return [];
    return this.chess.moves({ square: sq, verbose: true });
  }

  down(e) {
    if (!this.chess || this.movable === 'none' || e.button > 0) return;
    if (!this.promoEl.classList.contains('hidden')) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    const piece = this.chess.get(sq);
    const turn = this.chess.turn();

    // tap sur une destination légale de la pièce sélectionnée
    if (this.selected && this.legalFrom(this.selected).some((m) => m.to === sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (piece && piece.color === turn && this.canMove(turn)) {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.renderSquares();
      this.startDrag(e, sq, wasSelected);
    } else if (this.selected) {
      this.selected = null;
      this.renderSquares();
    }
  }

  startDrag(e, from, wasSelected) {
    const pieceEl = this.pcLayer.querySelector(`[data-sq="${from}"]`);
    if (!pieceEl) return;
    const b = this.el.getBoundingClientRect();
    const size = b.width / 8;
    let moved = false;
    const sx = e.clientX, sy = e.clientY;
    this.el.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      pieceEl.classList.add('drag');
      pieceEl.style.transition = 'none';
      const px = (ev.clientX - b.left) / size - .5, py = (ev.clientY - b.top) / size - .5;
      pieceEl.style.transform = `translate(${px * 100}%, ${py * 100}%) scale(1.15)`;
    };
    const up = (ev) => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      pieceEl.classList.remove('drag');
      pieceEl.style.transition = '';
      if (!moved) {
        if (wasSelected) { this.selected = null; this.renderSquares(); } // re-tap = désélection
        return;
      }
      const to = this.sqAt(ev.clientX, ev.clientY);
      if (to && to !== from && this.legalFrom(from).some((m) => m.to === to)) {
        pieceEl.style.transition = 'none';
        this.place(pieceEl, to);
        this.tryMove(from, to);
      } else {
        this.place(pieceEl, from);
      }
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  tryMove(from, to) {
    const legal = this.legalFrom(from).filter((m) => m.to === to);
    if (!legal.length) return;
    this.selected = null;
    if (legal.some((m) => m.promotion)) {
      this.askPromotion(from, to, legal[0].color);
    } else {
      this.onMove(from, to);
    }
  }

  askPromotion(from, to, color) {
    const p = this.promoEl;
    p.innerHTML = '';
    p.classList.remove('hidden');
    for (const t of ['q', 'n', 'r', 'b']) {
      const btn = document.createElement('button');
      btn.appendChild(this.pieceEl(color + t));
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        p.classList.add('hidden');
        this.onMove(from, to, t);
      });
      p.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'promo-cancel';
    cancel.textContent = 'Annuler';
    cancel.addEventListener('click', (ev) => { ev.stopPropagation(); p.classList.add('hidden'); this.render(); });
    p.appendChild(cancel);
  }
}
