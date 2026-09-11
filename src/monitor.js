import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { buildUniverse } from './universe.js';
import { currentSession } from './session.js';
import { dexSide, backpackSide, computeEdges } from './pricing.js';
import { startPublicWs } from './backpack/ws.js';
import { sleep, nowIso } from './util/http.js';

const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? '   -  ' : Number(x).toFixed(d));

export async function snapshotOnce({ universe, session, qty, stockPriceCache, externalCache, provider = 'jupiter' }) {
  const rows = [];
  for (const token of universe) {
    const t0 = Date.now();
    const bp = await backpackSide(token, qty, { session, stockPriceCache, externalCache });
    const ref = bp.buyPx || bp.sellPx || null;
    let dex = { sell: null, buy: null, errors: ['no reference price for buy sizing'] };
    if (ref) dex = await dexSide(token, qty, ref, { provider });
    else dex = await dexSide(token, qty, null, { provider }); // no fabricated buy sizing reference
    const edges = computeEdges(token, qty, bp, dex);
    rows.push({
      ts: nowIso(), session: session.session, symbol: token.symbol, qty,
      bpVenue: bp.venue, bpBid: bp.bid, bpAsk: bp.ask, bpBuyPx: bp.buyPx, bpSellPx: bp.sellPx, bpPartial: bp.partial, bpNote: bp.note,
      dexProvider: provider, dexSellPx: dex.sell?.pxPerShare ?? null, dexBuyPx: dex.buy?.pxPerShare ?? null,
      pricingVersion: 2, dexSellShares: dex.sell?.sharesIn ?? null, dexSellUsdcOut: dex.sell?.usdcOut ?? null,
      dexSellImpact: dex.sell?.impactPct ?? null, dexBuyImpact: dex.buy?.impactPct ?? null,
      dexSellRoutes: dex.sell?.routes?.join('|') ?? null, dexBuyRoutes: dex.buy?.routes?.join('|') ?? null, dexErrors: dex.errors.join('; '),
      bpBasis: bp.basis ?? null, bookBid: bp.bookBid ?? null, bookAsk: bp.bookAsk ?? null, bookBuyPx: bp.bookBuyPx ?? null, bookSellPx: bp.bookSellPx ?? null,
      dexToBpBookBps: edges.dexToBpBook?.bps ?? null, bpToDexBookBps: edges.bpToDexBook?.bps ?? null,
      dexToBpNet: edges.dexToBp?.net ?? null, dexToBpBps: edges.dexToBp?.bps ?? null, dexToBpConsBps: edges.dexToBpCons?.bps ?? null,
      bpToDexNet: edges.bpToDex?.net ?? null, bpToDexBps: edges.bpToDex?.bps ?? null, bpToDexConsBps: edges.bpToDexCons?.bps ?? null,
      withdrawalFeeShares: token.withdrawalFee, latencyMs: Date.now() - t0,
    });
  }
  return rows;
}

export function printRows(rows) {
  console.log(`\n${rows[0]?.ts}  session=${rows[0]?.session}`);
  console.log('SYMBOL    q   BP venue                 BP sell    BP buy   | DEX sell   DEX buy  | A exp/cons bps      B exp/cons bps     note');
  const thr = CFG.EDGE_BPS + CFG.RFQ_SETTLE_VAR_BPS; // expected-basis edge must clear threshold + settlement margin
  for (const r of rows) {
    const fA = r.dexToBpBps != null && (r.bpBasis === 'book' ? r.dexToBpBps >= CFG.EDGE_BPS : r.dexToBpBps >= thr) ? '*' : ' ';
    const fB = r.bpToDexBps != null && (r.bpBasis === 'book' ? r.bpToDexBps >= CFG.EDGE_BPS : r.bpToDexBps >= thr) ? '*' : ' ';
    console.log(`${r.symbol.padEnd(9)} ${String(r.qty).padStart(2)}  ${String(r.bpVenue || '-').padEnd(24)} ${fmt(r.bpSellPx).padStart(9)} ${fmt(r.bpBuyPx).padStart(9)}  | ${fmt(r.dexSellPx).padStart(9)} ${fmt(r.dexBuyPx).padStart(9)} | ${fmt(r.dexToBpBps, 1).padStart(7)}${fA}/${fmt(r.dexToBpConsBps, 1).padStart(7)}   ${fmt(r.bpToDexBps, 1).padStart(7)}${fB}/${fmt(r.bpToDexConsBps, 1).padStart(7)}  ${r.bpNote || r.dexErrors || ''}`);
  }
}

export function appendJsonl(rows, file = path.join(CFG.DATA_DIR, 'gaps.jsonl')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export async function runMonitor({ qty = CFG.QTY, qtys = CFG.QTYS, pollMs = CFG.POLL_MS, provider = 'jupiter', once = false } = {}) {
  const qtyList = qtys?.length ? qtys : [qty];
  const universe = await buildUniverse();
  if (!universe.length) throw new Error('empty universe (check WATCH)');
  const lastLog = new Map();
  const ws = startPublicWs({ tickers: universe.map((t) => t.ticker), symbols: universe.filter((t) => t.spotSymbol).map((t) => t.spotSymbol), external: universe.map((t) => `${t.symbol}_USDC`) }, (j) => {
    const now = Date.now();
    if ((lastLog.get(j.stream) || 0) > now - 5000) return; // throttle: 1 record / stream / 5s
    lastLog.set(j.stream, now);
    const d = j.data;
    const rec = j.stream.startsWith('stockPrice.')
      ? { ts: nowIso(), stream: j.stream, ticker: d.symbol, bid: d.bid, ask: d.ask, mid: d.mid, srcTs: d.timestamp, session: d.session }
      : j.stream.startsWith('externalTicker.')
        ? { ts: nowIso(), stream: j.stream, symbol: d.s, last: d.c, high: d.h, low: d.l, vol: d.v }
        : { ts: nowIso(), stream: j.stream, symbol: d.s, bid: d.b, bidQty: d.B, ask: d.a, askQty: d.A };
    appendJsonl([rec], path.join(CFG.DATA_DIR, 'ticks.jsonl'));
  });
  await sleep(1500);
  console.log(`[monitor] ${universe.length} tokens: ${universe.map((t) => t.symbol).join(', ')}  provider=${provider} qtys=${qtyList.join(',')} poll=${pollMs}ms edge=${CFG.EDGE_BPS}bps(+${CFG.RFQ_SETTLE_VAR_BPS} on RFQ basis)  log=${path.join(CFG.DATA_DIR, 'gaps.jsonl')}`);
  try {
    for (;;) {
      const session = await currentSession();
      const rows = [];
      for (const q of qtyList) rows.push(...await snapshotOnce({ universe, session, qty: q, stockPriceCache: ws.stockPrice, externalCache: ws.externalTicker, provider }));
      printRows(rows);
      appendJsonl(rows);
      if (once) return rows;
      await sleep(pollMs);
    }
  } finally {
    ws.close();
  }
}
