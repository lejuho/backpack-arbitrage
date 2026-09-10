import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');

/** Summarize data/gaps.jsonl per symbol × session: observations, positive-edge counts, best/median edges. */
export function report({ edgeBps = CFG.EDGE_BPS } = {}) {
  const rows = readJsonl(path.join(CFG.DATA_DIR, 'gaps.jsonl'));
  const ticks = readJsonl(path.join(CFG.DATA_DIR, 'ticks.jsonl'));
  if (!rows.length) { console.log('no data/gaps.jsonl yet'); return; }
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.symbol}|${r.session}|${r.dexProvider}|${r.qty}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const q = (arr, p) => { const a = arr.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : null; };
  const out = [];
  for (const [k, g] of groups) {
    const [symbol, session, provider, qty] = k.split('|');
    const a = g.map((r) => r.dexToBpBps), b = g.map((r) => r.bpToDexBps);
    out.push({
      symbol, session, provider, qty, n: g.length, from: g[0].ts.slice(5, 16), to: g[g.length - 1].ts.slice(5, 16),
      'A max': q(a, 1)?.toFixed(1), 'A med': q(a, 0.5)?.toFixed(1), 'A>0': pct(a.filter((x) => x > 0).length, a.filter((x) => x != null).length), [`A>${edgeBps}`]: a.filter((x) => x >= edgeBps).length,
      'B max': q(b, 1)?.toFixed(1), 'B med': q(b, 0.5)?.toFixed(1), 'B>0': pct(b.filter((x) => x > 0).length, b.filter((x) => x != null).length), [`B>${edgeBps}`]: b.filter((x) => x >= edgeBps).length,
      partial: g.filter((r) => r.bpPartial).length, dexErr: g.filter((r) => r.dexErrors).length,
    });
  }
  console.log(`gaps.jsonl: ${rows.length} rows, ${rows[0].ts} → ${rows[rows.length - 1].ts}   (A = DEX→Backpack, B = Backpack→DEX, bps net of costs)`);
  console.table(out.sort((x, y) => x.symbol.localeCompare(y.symbol) || x.session.localeCompare(y.session)));
  if (ticks.length) {
    const sp = ticks.filter((t) => t.stream.startsWith('stockPrice.'));
    const bySess = {};
    for (const t of sp) bySess[t.session || 'null'] = (bySess[t.session || 'null'] || 0) + 1;
    const ext = ticks.filter((t) => t.stream.startsWith('externalTicker.')).length;
    console.log(`ticks.jsonl: ${ticks.length} rows (stockPrice ${sp.length} by session ${JSON.stringify(bySess)}, externalTicker ${ext}, bookTicker ${ticks.length - sp.length - ext})`);
  }
}
