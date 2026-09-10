/**
 * Request a broker quote on <SYM>.US_USDC_RFQ, record the two-sided quote (askPrice/bidPrice) together with
 * a simultaneous Jupiter quote, then cancel without accepting. Needs Backpack USDC >= qty × price (funds are
 * checked on submit even though nothing is accepted).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { bpRfqSubmit, bpRfqs, bpRfqCancel } from './backpack/private.js';
import { jupQuote } from './dex/jupiter.js';
import { buildUniverse } from './universe.js';
import { sleep, nowIso } from './util/http.js';
import { currentSession } from './session.js';

export async function rfqProbe({ symbol, qty = 1, side = 'Bid', waitMs = 8000, token }) {
  const session = await currentSession();
  if (!token) [token] = await buildUniverse({ watch: [symbol] });
  const rfqSymbol = `${symbol}_USDC_RFQ`;
  const t0 = Date.now();
  let rfq, quote = null, error = null, status = null, quoteMs = null;
  const jupP = Promise.allSettled([
    jupQuote({ inputMint: CFG.USDC_MINT, outputMint: token.mint, amount: Math.round(qty * 150 * 1e6) }), // sized later by ref
    jupQuote({ inputMint: token.mint, outputMint: CFG.USDC_MINT, amount: Math.round(qty * 10 ** token.decimals) }),
  ]);
  try {
    rfq = await bpRfqSubmit({ symbol: rfqSymbol, side, quantity: qty, executionMode: 'AwaitAccept' });
    status = rfq.status;
    while (Date.now() - t0 < waitMs) {
      await sleep(300);
      const open = await bpRfqs({ rfqId: rfq.rfqId }).catch(() => []);
      const mine = (open || []).find((o) => String(o.rfq?.rfqId) === String(rfq.rfqId));
      if (!mine) { status = 'gone'; break; }
      status = mine.rfq?.status;
      if (mine.quotes?.length) { quote = mine.quotes[0]; quoteMs = Date.now() - t0; break; }
    }
  } catch (e) { error = String(e.message || e).slice(0, 300); }
  if (rfq?.rfqId) { try { await bpRfqCancel({ rfqId: rfq.rfqId }); } catch {} }
  const [jb, js] = await jupP;
  const bpAsk = quote ? Number(quote.askPrice) : null, bpBid = quote ? Number(quote.bidPrice) : null;
  const dexBuy = jb.status === 'fulfilled' ? jb.value.inAmount / 1e6 / (jb.value.outAmount / 10 ** token.decimals) : null;
  const dexSell = js.status === 'fulfilled' ? js.value.outAmount / 1e6 / qty : null;
  const fee = CFG.SOL_TX_FEE_USD;
  const rec = {
    ts: nowIso(), session: session.session, et: session.et, symbol, rfqSymbol, side, qty,
    rfqId: rfq?.rfqId ?? null, status, quoteMs, quoteId: quote?.quoteId ?? null,
    bpBid, bpAsk, bpSpreadBps: bpBid && bpAsk ? ((bpAsk - bpBid) / bpAsk) * 1e4 : null,
    dexBuy, dexSell, dexSpreadBps: dexBuy && dexSell ? ((dexBuy - dexSell) / dexBuy) * 1e4 : null,
    dexRoutes: jb.status === 'fulfilled' ? jb.value.routes.join('|') : null,
    // A: buy on DEX, deposit (free), sell to broker at bpBid.  B: buy from broker at bpAsk, withdraw (fee in shares), sell on DEX.
    dexToBpBps: dexBuy && bpBid ? ((bpBid * qty - dexBuy * qty - 2 * fee) / (dexBuy * qty)) * 1e4 : null,
    bpToDexBps: dexSell && bpAsk ? ((dexSell * (qty - token.withdrawalFee) - bpAsk * qty - fee) / (bpAsk * qty)) * 1e4 : null,
    error,
  };
  fs.mkdirSync(CFG.DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(CFG.DATA_DIR, 'rfq.jsonl'), JSON.stringify(rec) + '\n');
  return rec;
}

/** Repeat probes every `everyS` seconds while a weekday session is open (skips weekend/holiday book). */
export async function rfqLoop({ symbols, qty = 1, everyS = 300 }) {
  const universe = await buildUniverse({ watch: symbols });
  for (;;) {
    const session = await currentSession();
    const fractionalOk = session.session === 'US_EQUITIES_REGULAR';
    if (session.weekendBook || (qty < 1 && !fractionalOk)) { console.log(`[rfq] ${nowIso()} ${session.session}: ${session.weekendBook ? 'RFQ closed' : 'fractional needs regular hours'}, sleeping`); await sleep(everyS * 1e3); continue; }
    for (const token of universe) {
      const r = await rfqProbe({ symbol: token.symbol, qty, token });
      console.log(`[rfq] ${r.ts} ${r.symbol} bp ${r.bpBid}/${r.bpAsk} (${r.bpSpreadBps?.toFixed(1)}bps) dex ${r.dexSell?.toFixed(2)}/${r.dexBuy?.toFixed(2)} | A ${r.dexToBpBps?.toFixed(1)} B ${r.bpToDexBps?.toFixed(1)} ${r.error || ''}`);
      await sleep(2000);
    }
    await sleep(everyS * 1e3);
  }
}
