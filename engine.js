// ---------- Slot engine (pure logic) ----------
// 5 reels x 5 rows. Wins are shapes made of one symbol: lines of 3, 4 or 5 (across, down or diagonal), squares,
// crosses, groups of 6 or more touching, V lines across all five reels, and the rare wanted shapes.
// Every shape pays the symbol's value times the shape's multiplier, and all shapes on a spin add up.
// The Wanted wild counts as every symbol.
// Corruption: DNA goo pays nothing by itself. When 3 or more goo symbols touch along their sides, the patch
// spreads: it and every symbol touching it become corrupted ('X'). Corrupted symbols are eaten: they no longer count
// as what they were. Instead the corruption pays by how many symbols it covers. A Rift is corruption that stretches
// unbroken from reel 1 to reel 5, and pays extra.
// Void bombs explode: each blows up the 8 symbols around it (duel targets are safe), and every symbol blown up
// pays its value. A bomb caught in a blast goes off too. Then the symbols above each hole fall into it, and new
// symbols drop in from the top.
// Duel targets hold reels: when the reels stop, the reel with the rightmost duel target and every reel left of it are
// held and the rest spin again, as long as new duel targets keep landing (spinBoard). 3 or more start the bonus.
// Order on every spin: reels land (with respins), bomb blasts and refills, then corruption spreads, then shapes
// pay on the final board.
const REELS = 5, ROWS = 5;
const COIN = 50;      // values are in coins of bet / 50
// value: what a Line of 3 pays, in coins
const SYMBOLS = {
  W:     { name: 'Wanted (wild)', weight: 5.0, value: 0 },
  STAR:  { name: 'Sheriff star',  weight: 3,   value: 120 },
  BAG:   { name: 'Gold sack',     weight: 4,   value: 40 },
  SHOE:  { name: 'Horseshoe',     weight: 5,   value: 15 },
  CACTUS:{ name: 'Cactus',        weight: 7,   value: 6.5 },
  A:     { name: 'Ace',           weight: 11,  value: 3 },
  K:     { name: 'King',          weight: 15,  value: 2.5 },
  Q:     { name: 'Queen',         weight: 23,  value: 1.5 },
  J:     { name: 'Jack',          weight: 26,  value: 1.5 },
  S:     { name: 'Duel (bonus)',  weight: 0,   value: 0 },
  GOO:   { name: 'DNA goo',       weight: 8.8, value: 0, corrupt: true },
  BOMB:  { name: 'Void bomb',     weight: 0.45, value: 0, corrupt: true },
};
const CORRUPT_MIN = 3; // touching goo needed to spread
const CORRUPTION = {
  // coins paid for corruption covering 3, 4, 5 ... 15 or more symbols (the last entry covers bigger patches too)
  pays: [8, 12, 16, 22, 30, 38, 50, 60, 75, 95, 115, 150, 200],
  rift: 850, // extra coins when it stretches from reel 1 to reel 5
};
const isCorrupt = s => s === 'GOO'; // the symbols that spread
// what a symbol pays when a bomb blows it up, in coins: its value, or these for symbols without one
const BLAST = { W: 20, GOO: 5, mult: 1 };
const blastValue = s => (s in BLAST ? BLAST[s] : (SYMBOLS[s] && SYMBOLS[s].value) || 0) * BLAST.mult;
// mult: times the symbol's value. A group's multiplier depends on its size: 6, 7, 8, 9, 10, 11, 12 or more.
const PATTERNS = {
  line3:   { name: 'Line of 3',    mult: 1 },
  line4:   { name: 'Line of 4',    mult: 5 },
  square:  { name: 'Square',       mult: 5 },
  line5:   { name: 'Line of 5',    mult: 30 },
  cross:   { name: 'Cross',        mult: 30 },
  group:   { name: 'Group',        mult: [5, 8, 12, 20, 30, 50, 75] },
  v:       { name: 'V line',       mult: 50 },
  corners: { name: 'Four corners', mult: 50 },
  x:       { name: 'Big X',        mult: 500 },
  frame:   { name: 'Frame',        mult: 1000 },
};
const GROUP_MIN = 6;
const SCATTER_CHANCE = 0.0202; // per cell (the bonus comes about 1 in 30 spins once respins are counted)
const BUY = { price: 10.3 }; // bonus buy price, x total bet
const PREMIUM = ['STAR', 'BAG', 'SHOE']; // symbols that make the last reels slow down and glow
const REG = Object.keys(SYMBOLS).filter(k => SYMBOLS[k].weight > 0);
const PAYERS = REG.filter(k => k !== 'W' && !SYMBOLS[k].corrupt);
const PLAIN = REG.filter(k => !SYMBOLS[k].corrupt);
let W_ALL = REG.reduce((s, k) => s + SYMBOLS[k].weight, 0), W_PLAIN = PLAIN.reduce((s, k) => s + SYMBOLS[k].weight, 0);
function randSymbol(rng = Math.random, reel = 0, scatter = true) {
  if (scatter && rng() < SCATTER_CHANCE) return 'S';
  let r = rng() * W_ALL;
  for (const k of REG) { r -= SYMBOLS[k].weight; if (r < 0) return k; }
  return 'J';
}
// a plain symbol: no duel targets and no corruption (used under the bounty spins)
const randRegular = (rng = Math.random, reel = 0) => { let r = rng() * W_PLAIN; for (const k of PLAIN) { r -= SYMBOLS[k].weight; if (r < 0) return k; } return 'J'; };
// grid[reel][row]
function spinGrid(rng = Math.random) {
  return Array.from({ length: REELS }, (_, r) => Array.from({ length: ROWS }, () => randSymbol(rng, r)));
}
// A base spin with duel target respins: when the reels stop, the reel with the rightmost duel target and every reel
// left of it are held, and the reels to its right spin again. If that respin shows a new duel target, the same happens
// from that reel, until a respin shows none (or the target is on the last reel).
// stages[0] is the first landing; each later stage lists the reels it spun (cols) and the reel the hold reaches (held).
const rightmostTarget = g => { for (let x = REELS - 1; x >= 0; x--) if (g[x].includes('S')) return x; return -1; };
function spinBoard(rng) {
  const g = spinGrid(rng), stages = [{ cols: [0, 1, 2, 3, 4], held: -1, grid: g.map(c => c.slice()) }];
  for (let held = rightmostTarget(g); held >= 0 && held < REELS - 1;) {
    const fresh = spinGrid(rng), cols = [];
    for (let x = held + 1; x < REELS; x++) { g[x] = fresh[x]; cols.push(x); }
    stages.push({ cols, held, grid: g.map(c => c.slice()) });
    const next = rightmostTarget(g);
    if (next <= held) break;
    held = next;
  }
  return { grid: g, stages };
}
// Cents, so small wins add up exactly
const toCents = v => Math.round(v * 100) / 100;
const shapeMult = (shape, size) => { const m = PATTERNS[shape].mult; return Array.isArray(m) ? m[Math.min(size - GROUP_MIN, m.length - 1)] : m; };
const payFor = (k, shape, size) => SYMBOLS[k].value * shapeMult(shape, size);

// Fixed shapes on the 5 x 5 board, as [reel, row] cells
const LINES = (() => { // every straight line of 3 or more cells: rows, columns and both diagonals
  const out = [];
  for (let i = 0; i < 5; i++) { out.push([0, 1, 2, 3, 4].map(j => [j, i])); out.push([0, 1, 2, 3, 4].map(j => [i, j])); }
  for (let d = -2; d <= 2; d++) {
    const a = [], b = [];
    for (let x = 0; x < 5; x++) { const y = x + d; if (y >= 0 && y < 5) a.push([x, y]); const y2 = 4 - x + d; if (y2 >= 0 && y2 < 5) b.push([x, y2]); }
    out.push(a, b);
  }
  return out;
})();
const VS = [[0, 1, 2, 1, 0], [1, 2, 3, 2, 1], [2, 3, 4, 3, 2], [4, 3, 2, 3, 4], [3, 2, 1, 2, 3], [2, 1, 0, 1, 2]].map(v => v.map((y, x) => [x, y]));
const DIAG1 = [0, 1, 2, 3, 4].map(i => [i, i]), DIAG2 = [0, 1, 2, 3, 4].map(i => [i, 4 - i]);
const XCELLS = DIAG1.concat(DIAG2.filter(([x]) => x !== 2));
const CORNERS = [[0, 0], [4, 0], [0, 4], [4, 4]];
const FRAME = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i === 0 || j === 0 || i === 4 || j === 4) FRAME.push([i, j]);

// upTo: only look at the first upTo reels (used to show the win building up as the reels stop)
// Each win: { symbol, shape, size, amount, cells, strokes } where strokes are the lines to draw through the cells
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Corruption on a full board: which patches spread, where to, and the board afterwards
function corruption(grid) {
  const patches = [], seen = new Set();
  for (let x = 0; x < REELS; x++) for (let y = 0; y < ROWS; y++) {
    if (!isCorrupt(grid[x][y]) || seen.has(x * 5 + y)) continue;
    const p = [[x, y]]; seen.add(x * 5 + y);
    for (let i = 0; i < p.length; i++) for (const [dx, dy] of SIDES) { const a = p[i][0] + dx, b = p[i][1] + dy;
      if (a >= 0 && a < REELS && b >= 0 && b < ROWS && isCorrupt(grid[a][b]) && !seen.has(a * 5 + b)) { seen.add(a * 5 + b); p.push([a, b]); } }
    patches.push(p);
  }
  const spreading = patches.filter(p => p.length >= CORRUPT_MIN);
  if (!spreading.length) return { patches, spreading, spread: [], mult: 1, after: grid };
  const after = grid.map(c => c.slice()), spread = [];
  for (const p of spreading) for (const [x, y] of p) after[x][y] = 'X';
  // each touching symbol is corrupted once, by the first corrupted neighbour that reaches it
  for (const p of spreading) for (const [x, y] of p) for (const [dx, dy] of SIDES) { const a = x + dx, b = y + dy;
    if (a < 0 || a >= REELS || b < 0 || b >= ROWS) continue;
    const s = after[a][b];
    if (s && s !== 'X' && s !== 'S' && !isCorrupt(s)) { after[a][b] = 'X'; spread.push({ from: [x, y], to: [a, b], was: s }); } }
  return { patches, spreading, spread, mult: 1, after };
}
// Bomb blasts on a full board. Returns each blast in the order it goes off, how the columns fall afterwards, and the
// board at the end. hit: { cell, was, coins, chain } where chain marks a bomb that the blast sets off.
// After the blasts, in every column the symbols left above a hole fall down into it, and new symbols drop in from the
// top. falls: per column { x, rows, moves: [{ from, to, s }], drops: [{ y, s }] }, where rows is how many rows from the
// top change. changed: every cell whose symbol is not the one that landed there. refill: the new symbols.
function explode(grid, rng = Math.random) {
  const after = grid.map(c => c.slice()), blasts = [], empty = new Set(), done = new Set(), pending = [];
  for (let x = 0; x < REELS; x++) for (let y = 0; y < ROWS; y++) if (grid[x][y] === 'BOMB') pending.push([x, y]);
  while (pending.length) {
    const [x, y] = pending.shift(), id = x * 5 + y;
    if (done.has(id)) continue;
    done.add(id); empty.add(id);
    const hit = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = x + dx, b = y + dy, aid = a * 5 + b;
      if ((!dx && !dy) || a < 0 || a >= REELS || b < 0 || b >= ROWS || empty.has(aid)) continue;
      const s = after[a][b];
      if (s === 'S') continue; // duel targets are safe
      if (s === 'BOMB') { if (!done.has(aid)) { hit.push({ cell: [a, b], was: s, coins: 0, chain: true }); pending.unshift([a, b]); } continue; }
      hit.push({ cell: [a, b], was: s, coins: blastValue(s) }); empty.add(aid);
    }
    blasts.push({ at: [x, y], hit, coins: hit.reduce((t, h) => t + h.coins, 0) });
  }
  const refill = [], falls = [], changed = [];
  for (let x = 0; x < REELS; x++) {
    let low = -1, holes = 0;
    for (let y = 0; y < ROWS; y++) if (empty.has(x * 5 + y)) { low = y; holes++; }
    if (low < 0) continue;
    const keep = [];
    for (let y = 0; y <= low; y++) if (!empty.has(x * 5 + y)) keep.push({ from: y, s: after[x][y] });
    const moves = keep.map((k, i) => ({ from: k.from, to: holes + i, s: k.s })), drops = [];
    for (let y = 0; y < holes; y++) { const s = randRegular(rng); drops.push({ y, s }); refill.push({ cell: [x, y], s }); }
    drops.forEach(d => { after[x][d.y] = d.s; }); moves.forEach(m => { after[x][m.to] = m.s; });
    for (let y = 0; y <= low; y++) changed.push([x, y]);
    falls.push({ x, rows: low + 1, moves, drops });
  }
  return { blasts, refill, falls, changed, after };
}
// spread: let corruption spread (only once all five reels have stopped)
function evaluate(grid, totalBet, upTo = REELS, spread = true) {
  const coin = totalBet / COIN, wins = [], scatterCells = [];
  const corrupt = spread && upTo >= REELS ? corruption(grid) : null;
  if (corrupt) grid = corrupt.after;
  const at = (x, y) => (x < upTo && x >= 0 && x < 5 && y >= 0 && y < 5) ? grid[x][y] : null;
  const real = (s, k) => s === k;
  const fits = (s, k) => s === k || s === 'W';
  // the symbol (with at least one real copy) that fills all these cells, if any
  const filled = cells => PAYERS.filter(k => { let r = false; for (const [x, y] of cells) { const s = at(x, y); if (!fits(s, k)) return false; if (real(s, k)) r = true; } return r; });
  const add = (k, shape, size, cells, strokes, coins = payFor(k, shape, size), boost = 1) =>
    wins.push({ symbol: k, shape, size, boost, amount: toCents(coins * coin * boost), cells, strokes });
  for (let x = 0; x < upTo; x++) for (let y = 0; y < ROWS; y++) if (grid[x][y] === 'S') scatterCells.push([x, y]);
  // lines: the longest unbroken run of each symbol along every straight line
  const realOf = real;
  for (const line of LINES) for (const k of PAYERS) {
    let run = [], real = false;
    const flush = () => { if (run.length >= 3 && real) add(k, 'line' + Math.min(5, run.length), run.length, run, [run]); run = []; real = false; };
    for (const [x, y] of line) { const s = at(x, y); if (fits(s, k)) { run.push([x, y]); if (realOf(s, k)) real = true; } else flush(); }
    flush();
  }
  // squares: every 2 x 2 block
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { const c = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]; for (const k of filled(c)) add(k, 'square', 4, c, []); }
  // crosses: a symbol with the same symbol on all four sides
  for (let x = 1; x < 4; x++) for (let y = 1; y < 4; y++) { const c = [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]; for (const k of filled(c)) add(k, 'cross', 5, c, [[[x, y - 1], [x, y], [x, y + 1]], [[x - 1, y], [x, y], [x + 1, y]]]); }
  // groups: 6 or more touching along their sides
  for (const k of PAYERS) {
    const done = new Set();
    for (let x = 0; x < upTo; x++) for (let y = 0; y < ROWS; y++) {
      if (!real(grid[x][y], k) || done.has(x * 5 + y)) continue;
      const comp = [[x, y]], seen = new Set([x * 5 + y]); done.add(x * 5 + y);
      for (let i = 0; i < comp.length; i++) { const [a, b] = comp[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const s = at(a + dx, b + dy), id = (a + dx) * 5 + b + dy;
          if (s && fits(s, k) && !seen.has(id)) { seen.add(id); comp.push([a + dx, b + dy]); if (real(s, k)) done.add(id); } } }
      if (comp.length >= GROUP_MIN) add(k, 'group', comp.length, comp, []);
    }
  }
  // corruption pays by size, doubled by each eye, plus the Rift when it reaches from reel 1 to reel 5
  if (corrupt) {
    const seen = new Set();
    for (let x = 0; x < REELS; x++) for (let y = 0; y < ROWS; y++) {
      if (grid[x][y] !== 'X' || seen.has(x * 5 + y)) continue;
      const comp = [[x, y]]; seen.add(x * 5 + y);
      for (let i = 0; i < comp.length; i++) for (const [dx, dy] of SIDES) { const a = comp[i][0] + dx, b = comp[i][1] + dy;
        if (at(a, b) === 'X' && !seen.has(a * 5 + b)) { seen.add(a * 5 + b); comp.push([a, b]); } }
      const t = CORRUPTION.pays, n = comp.length;
      add('VOID', 'corrupt', n, comp, [], t[Math.max(0, Math.min(n - CORRUPT_MIN, t.length - 1))]);
      if (comp.some(([a]) => a === 0) && comp.some(([a]) => a === REELS - 1)) add('VOID', 'rift', n, comp, [], CORRUPTION.rift);
    }
  }
  // V lines across all five reels, and the wanted shapes
  for (const v of VS) for (const k of filled(v)) add(k, 'v', 5, v, [v]);
  for (const k of filled(CORNERS)) add(k, 'corners', 4, CORNERS, []);
  for (const k of filled(XCELLS)) add(k, 'x', 9, XCELLS, [DIAG1, DIAG2]);
  for (const k of filled(FRAME)) add(k, 'frame', 16, FRAME, []);
  const sc = Math.min(scatterCells.length, 5);
  const bonus = sc >= 3 ? { count: sc, cells: scatterCells } : null;
  return { wins, lineTotal: toCents(wins.reduce((s, w) => s + w.amount, 0)), bonus, corrupt: corrupt && corrupt.spreading.length ? corrupt : null };
}
// A whole spin: bomb blasts and refills first, then corruption spreads, then shapes pay on the final board.
// final: the board as it ends up. blast: what the bombs did (null when none landed).
function spinResult(grid, totalBet, rng = Math.random) {
  const blast = explode(grid, rng), res = evaluate(blast.after, totalBet), coin = totalBet / COIN;
  blast.blasts.forEach(b => { if (b.coins > 0) res.wins.push({ symbol: 'BOMB', shape: 'blast', size: b.hit.filter(h => h.coins > 0).length, boost: 1,
    amount: toCents(b.coins * coin), cells: [b.at].concat(b.hit.map(h => h.cell)), strokes: [] }); });
  res.lineTotal = toCents(res.wins.reduce((t, w) => t + w.amount, 0));
  res.blast = blast.blasts.length ? blast : null;
  res.final = res.corrupt ? res.corrupt.after : blast.after;
  return res;
}
// How many of a symbol (wilds included) are showing on the first upTo reels
function countOf(grid, k, upTo = REELS) {
  let n = 0;
  for (let r = 0; r < upTo; r++) for (const s of grid[r]) if (s === k || s === 'W') n++;
  return n;
}

// ---------- Bonus engine ----------
// Stage 0, bounty spins: free spins where cowboy cash symbols land on the reels. Each one adds its value to the pot.
// Stage 1, loading: each six-shooter gets 6 bullets (multipliers and combat bullets), loaded one at a time, alternating.
// Stage 2, showdown: a coin flip picks who shoots first. Each gun fires its bullets in order, chamber 1 to 6, and
// skips chambers that have been shot out, so no turn is wasted. A shot locks the fired bullet in for good, and always
// destroys one of the other cowboy's unfired bullets. It runs until every bullet is fired or destroyed.
// Payout: pot x your locked-in multipliers (x1 if you locked none). It can only go up. Win the duel (more locked-in
// multiplier than Jim, or the same) and his locked-in multipliers are added to yours.
const BONUS = {
  chambers: 6,
  sharp: { player: true, rival: false }, // a sharp shooter always hits the other's best unfired multiplier
  unit: 0.05,   // value units: a cash symbol worth v pays v x unit x bet
  bullets: [
    { k: 'mult', v: 2, w: 12 }, { k: 'mult', v: 3, w: 5 }, { k: 'mult', v: 5, w: 1.6 }, { k: 'mult', v: 10, w: 0.4 },
    { k: 'thief', v: 0, w: 4 }, { k: 'deadeye', v: 0, w: 4 },
  ],
  // Jim's gun never loads Steal bullets, which tips the duel your way (you win about 4 in 5)
  rivalBullets: [
    { k: 'mult', v: 2, w: 12 }, { k: 'mult', v: 3, w: 5 }, { k: 'mult', v: 5, w: 1.6 }, { k: 'mult', v: 10, w: 0.4 },
    { k: 'deadeye', v: 0, w: 4 },
  ],
};
const BOUNTY = {
  spins: { 3: 5, 4: 7, 5: 10 },  // free spins for 3, 4, 5+ duel targets
  cashChance: 0.0702,              // chance each cell shows a cash symbol
  everySpin: true,                 // every bounty spin brings at least one
  // boot 0.05 bet, horseshoe 0.1, hat 0.25, sheriff star 1, gold bars 5, diamonds 25
  cash: [{ v: 1, w: 69 }, { v: 2, w: 29 }, { v: 5, w: 4.5 }, { v: 20, w: 1 }, { v: 100, w: 0.18 }, { v: 500, w: 0.026 }],
};
function pick(list, rng) {
  const tot = list.reduce((s, d) => s + d.w, 0);
  let r = rng() * tot;
  for (const d of list) { r -= d.w; if (r < 0) return d; }
  return list[0];
}
// One bounty spin. Cash cells are written as 'C' + value, e.g. 'C25'.
// If the pot would still be empty after the last spin, that spin is given one cash symbol.
function bountyGrid(rng = Math.random, forceOne = false) {
  const grid = Array.from({ length: REELS }, (_, r) => Array.from({ length: ROWS }, () => randRegular(rng, r)));
  const cash = [];
  for (let r = 0; r < REELS; r++) for (let c = 0; c < ROWS; c++) if (rng() < BOUNTY.cashChance) { const v = pick(BOUNTY.cash, rng).v; grid[r][c] = 'C' + v; cash.push({ reel: r, row: c, v }); }
  if (forceOne && !cash.length) { const r = Math.floor(rng() * REELS), c = Math.floor(rng() * ROWS), v = pick(BOUNTY.cash, rng).v; grid[r][c] = 'C' + v; cash.push({ reel: r, row: c, v }); }
  return { grid, cash, total: cash.reduce((s, x) => s + x.v, 0) };
}
function bountySpins(sc, rng = Math.random) {
  const n = BOUNTY.spins[Math.max(3, Math.min(5, sc))], spins = [];
  let pot = 0;
  for (let i = 0; i < n; i++) { const s = bountyGrid(rng, BOUNTY.everySpin || (i === n - 1 && pot === 0)); pot += s.total; spins.push(s); }
  return { spins, pot };
}
const other = side => side === 'player' ? 'rival' : 'player';
function newBonus(pot, rng = Math.random) {
  return {
    pot,                            // in value units
    cyl: { player: Array(BONUS.chambers).fill(null), rival: Array(BONUS.chambers).fill(null) },
    step: 0,                        // loading step, 0..13
    sure: { player: 0, rival: 0 },  // aimed shots this side has banked
    next: { player: 0, rival: 0 },  // the chamber each gun turns to next
    first: rng() < 0.5 ? 'player' : 'rival', // the coin flip: heads you, tails Jim
    turn: null, over: false,
  };
}
const isValue = b => b && b.k === 'mult';
// still in the drum and not fired yet: can be fired by its owner, or destroyed by the other cowboy
const live = b => b && b.k !== 'gone' && b.k !== 'stolen' && !b.locked;
const canFire = (b, side) => b.cyl[side].some(live);
// The chamber a gun fires next: the first live bullet from its next chamber on, skipping chambers already shot out
function nextLive(b, side) {
  const N = BONUS.chambers;
  for (let k = 0; k < N; k++) { const j = (b.next[side] + k) % N; if (live(b.cyl[side][j])) return j; }
  return -1;
}
// locked: multiplier already fired (safe). unfired: multiplier still in the drum (at risk).
function tally(b, side) {
  let locked = 0, unfired = 0;
  for (const x of b.cyl[side]) { if (!isValue(x)) continue; if (x.locked) locked += x.v; else if (live(x)) unfired += x.v; }
  return { locked, unfired, mult: Math.max(1, locked) };
}
// the most valuable unfired multiplier
function bestChamber(b, side) {
  let best = -1, bv = 0;
  b.cyl[side].forEach((x, i) => { if (isValue(x) && live(x) && x.v > bv) { bv = x.v; best = i; } });
  return best;
}
function loadNext(b, rng = Math.random) {
  const side = b.step % 2 === 0 ? 'player' : 'rival', chamber = Math.floor(b.step / 2), foe = other(side);
  const d = pick(side === 'rival' && BONUS.rivalBullets ? BONUS.rivalBullets : BONUS.bullets, rng), bullet = { k: d.k, v: d.v };
  const ev = { side, chamber, bullet };
  if (bullet.k === 'thief') {
    const ti = bestChamber(b, foe); // steal his best multiplier
    if (ti >= 0) {
      ev.stole = { chamber: ti, bullet: b.cyl[foe][ti] };
      b.cyl[side][chamber] = { ...b.cyl[foe][ti], stolen: true };
      b.cyl[foe][ti] = { k: 'stolen' };
    } else { ev.fizzled = true; b.cyl[side][chamber] = { k: 'thief' }; }
  } else {
    if (bullet.k === 'deadeye') b.sure[side]++;
    b.cyl[side][chamber] = bullet;
  }
  b.step++;
  if (b.step >= BONUS.chambers * 2) b.turn = b.first;
  return ev;
}
const loadingDone = b => b.step >= BONUS.chambers * 2;
// One turn of the showdown. Returns what happened:
// { side, fired, bullet, blank } a blank was fired (locked in, does no damage)
// { side, fired, bullet, miss | chamber+lost (+deadeye), aimed? } a live round was fired
// Every shot hits. Your shots take Jim's best unfired multiplier; his take a random one of your unfired bullets
// (his aimed shots take your best). If there's nothing left to hit, the shot only locks in the fired bullet.
function shoot(b, rng = Math.random) {
  const side = b.turn, foe = other(side);
  const ev = { side };
  // the gun fires its next bullet in order. An aimed shot turns straight to your own best multiplier instead (locking
  // it in) and takes his best one; the order carries on from there.
  const aimed = b.sure[side] > 0;
  if (aimed) { b.sure[side]--; ev.aimed = true; }
  let i = aimed ? bestChamber(b, side) : -1;
  if (i < 0) i = nextLive(b, side);
  b.next[side] = (i + 1) % BONUS.chambers;
  b.cyl[side][i] = { ...b.cyl[side][i], locked: true };
  ev.fired = i; ev.bullet = b.cyl[side][i];
  if (ev.bullet.k === 'blank') ev.blank = true;
  else {
    const best = aimed || BONUS.sharp[side] ? bestChamber(b, foe) : -1;
    if (best >= 0) { ev.chamber = best; if (aimed) ev.deadeye = true; else ev.sharp = true; }
    else {
      const opts = b.cyl[foe].map((x, j) => live(x) ? j : -1).filter(j => j >= 0);
      if (!opts.length) ev.empty = true;
      else ev.chamber = opts[Math.floor(rng() * opts.length)];
    }
    if (ev.chamber !== undefined) {
      ev.lost = b.cyl[foe][ev.chamber];
      b.cyl[foe][ev.chamber] = { k: 'gone', was: ev.lost };
    }
  }
  if (canFire(b, foe)) b.turn = foe;
  else if (canFire(b, side)) b.turn = side;
  else b.over = true;
  return ev;
}
function result(b) {
  const me = tally(b, 'player').locked, him = tally(b, 'rival').locked;
  const won = me > 0 && me >= him, mult = Math.max(1, won ? me + him : me); // you win ties
  return { won, tie: me === him, me, him, mult, payoutUnits: b.pot * mult };
}
// The whole bonus in one go (used by instant mode and the simulator). sc = number of duel targets.
function playBonus(sc = 3, rng = Math.random) {
  const bounty = bountySpins(sc, rng);
  const b = newBonus(bounty.pot, rng);
  while (!loadingDone(b)) loadNext(b, rng);
  while (!b.over) shoot(b, rng);
  return { bounty, b, ...result(b) };
}

if (typeof module !== 'undefined') module.exports = { nextLive, spinBoard, rightmostTarget, SCATTER_CHANCE, SYMBOLS, PATTERNS, GROUP_MIN, CORRUPT_MIN, CORRUPTION, BLAST, isCorrupt, corruption, explode, spinResult, blastValue, REELS, ROWS, COIN, PREMIUM, LINES, VS, spinGrid, evaluate, countOf, payFor, BONUS, BOUNTY, BUY, bountyGrid, bountySpins, newBonus, loadNext, loadingDone, shoot, result, tally, playBonus, live };
