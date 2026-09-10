/**
 * Candle-level backtest (fidelity level 1): DEX pool candles vs US-market reference candles vs Backpack native book candles.
 * Produces "raw gap" -> "cost-adjusted" -> "cost+delay-adjusted" series on a 5-minute grid.
 * Historical bid/ask does not exist for Backpack weekdays, so spreads are constants measured on 2026-09-08/09.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { getJSON, sleep } from './util/http.js';
import { bpTokenizedStocks } from './backpack/public.js';

const H = path.join(CFG.DATA_DIR, 'hist');
const B = CFG.BP_BASE;
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
const save = (name, obj) => { fs.mkdirSync(H, { recursive: true }); fs.writeFileSync(path.join(H, name), JSON.stringify(obj)); };
const load = (name) => JSON.parse(fs.readFileSync(path.join(H, name), 'utf8'));
const toSec = (s) => Math.floor(Date.parse(s.replace(' ', 'T') + 'Z') / 1000);

// ---------- fetch ----------
export async function fetchBackpackKlines(symbol, { interval = '5m', from, external = false, chunkDays = 7 }) {
  const out = [];
  let start = from, now = Math.floor(Date.now() / 1000);
  while (start < now) {
    const end = Math.min(now, start + chunkDays * 86400);
    const r = await getJSON(`${B}/api/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${end}${external ? '&source=External' : ''}`);
    if (Array.isArray(r)) for (const k of r) out.push({ t: toSec(k.start), o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume, n: +(k.trades || 0) });
    start = end; await sleep(150);
  }
  const seen = new Set(); return out.filter((k) => !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
}

export async function fetchGeckoPools(mint) {
  const r = await getJSON(`${GT}/tokens/${mint}/pools?page=1`);
  return r.data.map((p) => ({ id: p.id.replace('solana_', ''), name: p.attributes.name, dex: p.relationships.dex.data.id, liq: +p.attributes.reserve_in_usd, vol24h: +p.attributes.volume_usd.h24, created: p.attributes.pool_created_at }));
}

/** Minute candles paged backwards (1000/call, ~30 calls/min limit). */
export async function fetchGeckoOhlcv(pool, { tf = 'minute', from, onPage = () => {} }) {
  const out = []; let before = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 400; i++) {
    let r;
    for (let a = 0; a < 5; a++) {
      try { r = await getJSON(`${GT}/pools/${pool}/ohlcv/${tf}?limit=1000&before_timestamp=${before}&currency=usd`, { retries: 0 }); break; }
      catch (e) { if (String(e).includes('429')) { await sleep(20e3); continue; } throw e; }
    }
    const l = r?.data?.attributes?.ohlcv_list || [];
    if (!l.length) break;
    for (const [t, o, h, low, c, v] of l) out.push({ t, o, h, l: low, c, v });
    before = l[l.length - 1][0] - 1; onPage(out.length, before);
    if (before < from) break;
    await sleep(2200);
  }
  const seen = new Set(); return out.filter((k) => k.t >= from && !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
}

export async function fetchAll({ symbol = 'SPCX.US', from = '2026-06-12', tf = 'minute' }) {
  const [tok] = (await bpTokenizedStocks()).filter((t) => t.symbol === symbol);
  const fromS = Math.floor(Date.parse(from + 'T00:00:00Z') / 1000);
  console.log(`[bt] ${symbol} mint ${tok.mint} from ${from}`);
  const ext = await fetchBackpackKlines(`${symbol}_USDC`, { interval: '5m', from: fromS, external: true, chunkDays: 30 });
  save(`${symbol}.external5m.json`, ext); console.log(`[bt] external 5m: ${ext.length}`);
  const spot = await fetchBackpackKlines(`${symbol}_USDC`, { interval: '5m', from: fromS, chunkDays: 3 });
  save(`${symbol}.spot5m.json`, spot); console.log(`[bt] backpack book 5m: ${spot.length} (with trades ${spot.filter((k) => k.v > 0).length})`);
  const pools = await fetchGeckoPools(tok.mint); save(`${symbol}.pools.json`, pools);
  const usdcPools = pools.filter((p) => /USDC/.test(p.name)).sort((a, b) => b.liq - a.liq);
  console.log(`[bt] pools: ${usdcPools.map((p) => `${p.dex}(${Math.round(p.liq / 1e3)}k)`).join(', ')}`);
  const top = usdcPools[0];
  const dex = await fetchGeckoOhlcv(top.id, { tf, from: fromS, onPage: (n, b) => process.stdout.write(`\r[bt] dex ${tf}: ${n} candles, back to ${new Date(b * 1000).toISOString().slice(0, 16)}   `) });
  console.log(); save(`${symbol}.dex${tf}.json`, { pool: top, candles: dex }); console.log(`[bt] dex ${tf}: ${dex.length} from ${top.dex}`);
}

// ---------- run ----------
const etSession = (tSec) => {
  const d = new Date(tSec * 1000);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday]; const m = (+o.hour % 24) * 60 + +o.minute;
  if (wd === 6 || (wd === 0 && m < 1200) || (wd === 5 && m >= 1200)) return 'WEEKEND';
  if (m >= 570 && m < 960) return 'REGULAR';
  if (m >= 240 && m < 570) return 'PRE';
  if (m >= 960 && m < 1200) return 'POST';
  return 'OVERNIGHT';
};

/**
 * cost model (bps unless noted): bpSpread = full spread of Backpack venue (half applied per side),
 * dexSpread = DEX effective spread for ~1 share, wdFeeSh = withdrawal fee in shares, txUsd = per-tx cost.
 */
export function runBacktest({ symbol = 'SPCX.US', qty = 1, bpSpreadBps = 30, dexSpreadBps = 2, wdFeeSh = 0.004, txUsd = 0.05, delayBuckets = 1, thresholdBps = 20, bpSource = 'external', quiet = false }) {
  const ext = load(`${symbol}.external5m.json`), spot = load(`${symbol}.spot5m.json`);
  const dexFile = fs.existsSync(path.join(H, `${symbol}.dexminute.json`)) ? `${symbol}.dexminute.json` : `${symbol}.dexhour.json`;
  const { pool, candles: dex } = load(dexFile);
  // Compare at candle END: minute candles collapse to the 5-minute bucket they close in (last minute wins);
  // hour candles (start t, close t+3600) are keyed to the 5-minute bucket that also closes at t+3600.
  const step = dex.length > 1 ? Math.min(...dex.slice(0, 50).map((k, i, a) => (i ? k.t - a[i - 1].t : 1e9))) : 60;
  const bucket = (t) => Math.floor(t / 300) * 300;
  const dexBy = new Map(); for (const k of dex) dexBy.set(step >= 3600 ? k.t + step - 300 : bucket(k.t), k);
  const extBy = new Map(ext.map((k) => [k.t, k]));
  const spotBy = new Map(spot.filter((k) => k.v > 0).map((k) => [k.t, k]));
  const bpBy = bpSource === 'spot' ? spotBy : extBy;
  const rows = [];
  const keys = [...dexBy.keys()].sort((a, b) => a - b);
  for (const t of keys) {
    const d = dexBy.get(t), b = bpBy.get(t); if (!b) continue;
    const bLater = bpBy.get(t + 300 * delayBuckets) || b, dLater = dexBy.get(t + 300 * delayBuckets) || d;
    const dexPx = d.c, bpPx = b.c;
    const half = bpSpreadBps / 2e4, dhalf = dexSpreadBps / 2e4;
    // raw
    const rawA = (bpPx - dexPx) / dexPx * 1e4, rawB = (dexPx - bpPx) / bpPx * 1e4;
    // cost (same-time)
    const costA = (qty * bpPx * (1 - half) - qty * dexPx * (1 + dhalf) - 2 * txUsd) / (qty * dexPx * (1 + dhalf)) * 1e4;
    const costB = ((qty - wdFeeSh) * dexPx * (1 - dhalf) - qty * bpPx * (1 + half) - txUsd) / (qty * bpPx * (1 + half)) * 1e4;
    // cost + delay (sell leg uses the later bucket)
    const delayA = (qty * bLater.c * (1 - half) - qty * dexPx * (1 + dhalf) - 2 * txUsd) / (qty * dexPx * (1 + dhalf)) * 1e4;
    const delayB = ((qty - wdFeeSh) * dLater.c * (1 - dhalf) - qty * bpPx * (1 + half) - txUsd) / (qty * bpPx * (1 + half)) * 1e4;
    rows.push({ t, iso: new Date(t * 1000).toISOString(), session: etSession(t), dexPx, bpPx, rawA, rawB, costA, costB, delayA, delayB });
  }
  const csv = ['t,iso,session,dexPx,bpPx,rawA,rawB,costA,costB,delayA,delayB', ...rows.map((r) => [r.t, r.iso, r.session, r.dexPx, r.bpPx, r.rawA, r.rawB, r.costA, r.costB, r.delayA, r.delayB].map((x) => typeof x === 'number' ? x.toFixed(4) : x).join(','))].join('\n');
  const out = path.join(CFG.DATA_DIR, `backtest.${symbol}.${bpSource}.csv`); if (!quiet) fs.writeFileSync(out, csv);
  // summary: (1) raw gap distribution, (2) cost-adjusted at decision time t, (3) trades SIGNALED at t (cost >= threshold)
  // evaluated with the sell leg at t+delay (realized). Counting realized outcomes without a decision rule would
  // just count volatility, so "delay" is always conditional on the signal.
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : null; };
  const f1 = (x) => (x == null ? '-' : x.toFixed(1));
  const summarize = (list, label) => {
    const row = { label, n: list.length };
    for (const dir of ['A', 'B']) {
      const raw = list.map((r) => r['raw' + dir]), cost = list.map((r) => r['cost' + dir]);
      const sig = list.filter((r) => r['cost' + dir] >= thresholdBps), real = sig.map((r) => r['delay' + dir]);
      row[`raw${dir} pos%/med/p95/max`] = `${(100 * raw.filter((x) => x > 0).length / raw.length).toFixed(0)}% / ${f1(q(raw, .5))} / ${f1(q(raw, .95))} / ${f1(q(raw, 1))}`;
      row[`cost${dir} pos%/≥${thresholdBps}/med/p95`] = `${(100 * cost.filter((x) => x > 0).length / cost.length).toFixed(1)}% / ${sig.length} / ${f1(q(cost, .5))} / ${f1(q(cost, .95))}`;
      row[`signal${dir}→realized n/hit%/med/mean`] = sig.length ? `${sig.length} / ${(100 * real.filter((x) => x > 0).length / real.length).toFixed(0)}% / ${f1(q(real, .5))} / ${f1(real.reduce((a, b) => a + b, 0) / real.length)}` : '0';
    }
    return row;
  };
  const bySess = {}; for (const r of rows) (bySess[r.session] ||= []).push(r);
  const table = [summarize(rows, 'ALL'), ...Object.entries(bySess).sort().map(([s, l]) => summarize(l, s))];
  const stat = (dir) => { const sig = rows.filter((r) => r['cost' + dir] >= thresholdBps), real = sig.map((r) => r['delay' + dir]); return { pos: 100 * rows.filter((r) => r['cost' + dir] > 0).length / rows.length, signals: sig.length, hit: sig.length ? 100 * real.filter((x) => x > 0).length / sig.length : null, med: q(real, .5) }; };
  const summary = { symbol, n: rows.length, from: rows[0]?.iso.slice(0, 10), to: rows[rows.length - 1]?.iso.slice(0, 10), pool: pool.dex, A: stat('A'), B: stat('B') };
  if (quiet) return { rows, summary };
  console.log(`\n[bt] ${symbol}  dex=${pool.dex} pool (${step >= 3600 ? 'hour' : 'minute'} candles)  bp=${bpSource}  qty=${qty}  bpSpread=${bpSpreadBps}bps dexSpread=${dexSpreadBps}bps wdFee=${wdFeeSh}sh delay=${delayBuckets}×5m  rows=${rows.length}  ${rows[0]?.iso.slice(0, 10)} → ${rows[rows.length - 1]?.iso.slice(0, 10)}`);
  console.log(`[bt] A = DEX→Backpack, B = Backpack→DEX. bps of cost basis. "signal→realized": trades where cost-adjusted edge at t ≥ ${thresholdBps}bps, PnL with the sell leg ${delayBuckets * 5} min later.`);
  console.table(table);
  console.log(`[bt] csv: ${out}`);
  return { rows, table, summary };
}

/** Sensitivity: signals / hit-rate per symbol × Backpack spread assumption. Withdrawal fee taken from /api/v1/assets. */
export async function sensitivity({ symbols, spreads = [20, 30, 40], thresholdBps = 20, qty = 1 }) {
  const tokens = await bpTokenizedStocks();
  const out = [];
  for (const sym of symbols) {
    const tok = tokens.find((t) => t.symbol === sym); if (!tok) continue;
    if (!fs.existsSync(path.join(H, `${sym}.external5m.json`))) { console.log(`[bt] ${sym}: no hist data (run --fetch)`); continue; }
    for (const sp of spreads) {
      const { summary: r } = runBacktest({ symbol: sym, qty, bpSpreadBps: sp, wdFeeSh: tok.withdrawalFee, thresholdBps, quiet: true });
      out.push({ symbol: sym, 'bp spread': sp, n: r.n, from: r.from, wdFeeSh: tok.withdrawalFee,
        'A cost>0 %': r.A.pos.toFixed(1), [`A sig≥${thresholdBps}`]: r.A.signals, 'A sig %': (100 * r.A.signals / r.n).toFixed(2), 'A hit %': r.A.hit?.toFixed(0) ?? '-', 'A real med': r.A.med?.toFixed(1) ?? '-',
        'B cost>0 %': r.B.pos.toFixed(1), [`B sig≥${thresholdBps}`]: r.B.signals, 'B sig %': (100 * r.B.signals / r.n).toFixed(2), 'B hit %': r.B.hit?.toFixed(0) ?? '-', 'B real med': r.B.med?.toFixed(1) ?? '-' });
    }
  }
  console.log(`[bt] sensitivity  qty=${qty} threshold=${thresholdBps}bps  A = DEX→Backpack, B = Backpack→DEX. "sig" = cost-adjusted edge ≥ threshold at t; "hit" = share of signals still >0 with sell leg 5 min later.`);
  console.table(out);
  const csv = [Object.keys(out[0] || {}).join(','), ...out.map((r) => Object.values(r).join(','))].join('\n');
  fs.writeFileSync(path.join(CFG.DATA_DIR, 'backtest.sensitivity.csv'), csv);
  return out;
}
