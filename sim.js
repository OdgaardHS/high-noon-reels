// Whole-game estimate: base game from N spins, bonus value per duel-target count from B bonuses each.
// usage: node sim.js [engine.js] [N spins] [B bonuses]
const E = require(process.argv[2] || './engine.js'); const N = +(process.argv[3] || 1000000), B = +(process.argv[4] || 200000);
// same check as the page: a premium symbol already runs from reel 1 to reel n along a row, long diagonal or V line
const PATHS = [0, 1, 2, 3, 4].map(y => [0, 1, 2, 3, 4].map(x => [x, y])).concat([[0, 1, 2, 3, 4].map(i => [i, i]), [0, 1, 2, 3, 4].map(i => [i, 4 - i])], E.VS);
const lineStart = (g, k, n) => PATHS.some(p => { const part = p.slice(0, n); return part.every(([x, y]) => g[x][y] === k || g[x][y] === 'W') && part.some(([x, y]) => g[x][y] === k); });
let respins = 0, respinStages = 0, line = 0, hits = 0, under = 0, b5 = 0, b15 = 0, b50 = 0, maxw = 0, tease = 0; const cnt = { 3: 0, 4: 0, 5: 0 };
for (let i = 0; i < N; i++) {
  const board = E.spinBoard(), g = board.grid, r = E.spinResult(g, 1), w = r.lineTotal;
  if (board.stages.length > 1) respins++, respinStages += board.stages.length - 1;
  line += w; if (w > 0) hits++; if (w > 0 && w < 1) under++; if (w >= 5) b5++; if (w >= 15) b15++; if (w >= 50) b50++; if (w > maxw) maxw = w;
  if (E.PREMIUM.some(k => lineStart(g, k, 3))) tease++;
  if (r.bonus) cnt[Math.min(5, r.bonus.count)]++;
}
const per = {}; let all = [], won = 0, pot = 0;
for (const c of [3, 4, 5]) { let s = 0; const n = c === 3 ? B : B / 4; for (let i = 0; i < n; i++) { const p = E.playBonus(c); const x = p.payoutUnits * E.BONUS.unit; s += x; if (c === 3) { all.push(x); if (p.won) won++; pot += p.bounty.pot * E.BONUS.unit; } } per[c] = s / n; }
const trig = cnt[3] + cnt[4] + cnt[5], bonusEV = (cnt[3] * per[3] + cnt[4] * per[4] + cnt[5] * per[5]) / N;
all.sort((a, b) => a - b); const T = all.length;
const f = x => x ? '1 in ' + (N / x).toFixed(0) : 'never';
console.log('RTP', (line / N + bonusEV).toFixed(4), '= base', (line / N).toFixed(4), '+ bonus', bonusEV.toFixed(4));
console.log('base: pays on', (hits / N * 100).toFixed(1) + '% of spins (nothing 1 in ' + (N / (N - hits)).toFixed(1) + ') | less than the bet', (under / N * 100).toFixed(0) + '% | 5x+', f(b5), '| 15x+', f(b15), '| 50x+', f(b50), '| top', maxw.toFixed(0) + 'x | premium tease', f(tease), '| respins on', f(respins), 'spins, avg', (respinStages / respins).toFixed(2), 'each');
console.log('bonus: 1 in', (N / trig).toFixed(1), '| avg by targets', per[3].toFixed(2), per[4].toFixed(2), per[5].toFixed(2), '| 3-target median', all[T >> 1].toFixed(2), 'p90', all[Math.floor(T * .9)].toFixed(1), '| < bet', (all.filter(x => x < 1).length / T * 100).toFixed(0) + '% | duel won', (won / T * 100).toFixed(0) + '% | pot', (pot / T).toFixed(2));
console.log('buy at', E.BUY.price + 'x returns', (per[3] / E.BUY.price * 100).toFixed(1) + '%');
