import path from 'node:path';
import { attachSellRfq } from './backpack/quote.js';
import { CFG } from './config.js';
import { jupQuote, jupDexLabels } from './dex/jupiter.js';
import { dexSide, backpackSide, computeEdges } from './pricing.js';
import { buildUniverse } from './universe.js';
import { currentSession } from './session.js';
import { bpTicker, bpDepth, vwapFromDepth } from './backpack/public.js';
import { appendJsonl } from './monitor.js';
import { sleep } from './util/http.js';

// All requests in a round share a sizing reference; errors remain separate observations.
export async function compareQuotes({ token, qty, refPrice, dexes = [], taker, maxAgeMs = 5000, quoteFn = jupQuote }) {
  if (!Number.isFinite(refPrice) || refPrice <= 0) throw new Error('comparison requires a positive reference price');
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('max-age must be positive');
  const specs = [{ id: 'v1-all', mode: 'lite' }, { id: 'v2-all', mode: 'v2' },
    ...dexes.map((dex) => ({ id: `dex:${dex}`, mode: 'build', dexes: dex }))];
  const roundStartedAt = Date.now();
  const rows = await Promise.all(specs.map(async (spec) => {
    const quotes = [];
    const dex = await dexSide(token, qty, refPrice, { quoteFn: async (args) => {
      const q = await quoteFn({ ...args, mode: spec.mode, dexes: spec.dexes, taker });
      const { raw, ...summary } = q;
      quotes.push({ ...summary, direction: args.inputMint === token.mint ? 'sell-after-withdrawal' : 'buy',
        minimumOutAmount: raw?.otherAmountThreshold ?? null,
        contextSlot: raw?.contextSlot ?? null,
        gasless: raw?.gasless ?? null,
        signatureFeeLamports: raw?.signatureFeeLamports ?? null,
        prioritizationFeeLamports: raw?.prioritizationFeeLamports ?? null,
        rentFeeLamports: raw?.rentFeeLamports ?? null });
      return q;
    } });
    return { schemaVersion: 1, roundStartedAt, symbol: token.symbol, mint: token.mint, qty, refPrice,
      comparison: spec.id, dex, quotes };
  }));
  const roundFinishedAt = Date.now();
  for (const row of rows) {
    row.roundFinishedAt = roundFinishedAt;
    row.maxQuoteAgeMs = row.quotes.length ? Math.max(...row.quotes.map((q) => roundFinishedAt - q.startedAt)) : null;
    row.stale = row.maxQuoteAgeMs != null && row.maxQuoteAgeMs > maxAgeMs;
    row.validForComparison = !row.stale && row.quotes.length === 2 && !row.dex.errors.length &&
      row.quotes.every((q) => !q.errorCode);
  }
  return rows;
}

export async function runComparison({ symbol = 'SPCX.US', qty = 1, dexes = [], taker, refPrice, pollMs = 0, maxAgeMs = 5000, bpRfq = false }) {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pollMs) || pollMs < 0) throw new Error('invalid quantity or poll interval');
  if (bpRfq && (!CFG.BP_API_KEY || !CFG.BP_API_SECRET)) throw new Error('--bp-rfq requires Backpack API credentials');
  if (!CFG.JUPITER_API_KEY) throw new Error('compare requires JUPITER_API_KEY for V2 (no fallback)');
  if (dexes.length && !taker) throw new Error('DEX comparison requires --taker=<public wallet address>');
  if (taker) {
    const { PublicKey } = await import('@solana/web3.js');
    new PublicKey(taker); // No private key is loaded by this read-only command.
  }
  if (dexes.length) {
    const labels = await jupDexLabels();
    for (const dex of dexes) if (!labels.includes(dex)) throw new Error(`unknown DEX label: ${dex}; run dex-labels`);
  }
  const file = path.join(CFG.DATA_DIR, 'quotes.compare.jsonl');
  do {
    // Refresh fee and rail metadata each round rather than assuming fixed withdrawal costs.
    const [token] = await buildUniverse({ watch: [symbol] });
    if (!token) throw new Error(`unknown token: ${symbol}`);
    const session = await currentSession();
    const referenceStartedAt = Date.now();
    const external = await bpTicker(`${token.symbol}_USDC`, true).catch(() => null);
    const last = Number(external?.lastPrice);
    const externalCache = new Map();
    if (last > 0) externalCache.set(`${token.symbol}_USDC`, { last, recvAt: Date.now() });
    const bp = await backpackSide(token, qty, { session, externalCache });
    const sizing = refPrice == null ? (bp.buyPx || last) : Number(refPrice);
    const rows = await compareQuotes({ token, qty, refPrice: sizing, dexes, taker, maxAgeMs });
    if (bpRfq && !session.weekendBook) await attachSellRfq(rows, token, { maxAgeMs });
    // A buys a variable number of shares. Reprice book proceeds at that exact quantity.
    const depth = session.weekendBook && token.spotSymbol ? await bpDepth(token.spotSymbol).catch(() => null) : null;
    for (const row of rows) {
      const adjusted = { ...bp };
      if (session.weekendBook) {
        const buy = depth ? vwapFromDepth(depth, 'asks', qty) : null;
        const sell = depth && row.dex.buy ? vwapFromDepth(depth, 'bids', row.dex.buy.sharesOut) : null;
        adjusted.buyPx = adjusted.buyPxCons = buy && !buy.partial ? buy.avgPrice : null;
        adjusted.sellPx = adjusted.sellPxCons = sell && !sell.partial ? sell.avgPrice : null;
        adjusted.partial = !buy || buy.partial || !sell || sell.partial;
      }
      if (bpRfq && !session.weekendBook) {
        adjusted.buyPx = adjusted.buyPxCons = null; // No authenticated buy RFQ requested.
        adjusted.sellPx = adjusted.sellPxCons = row.sellRfqValid ? row.sellRfq.price : null;
        adjusted.bookBuyPx = adjusted.bookSellPx = null;
        adjusted.partial = false;
        adjusted.basis = 'authenticated-sell-rfq-cancelled';
      }
      const now = Date.now();
      row.ts = new Date(now).toISOString();
      row.session = session.session;
      row.backpack = adjusted;
      row.withdrawalFeeShares = token.withdrawalFee;
      row.costAssumptions = { solTxFeeUsd: CFG.SOL_TX_FEE_USD, bpSpotFeeBps: CFG.BP_SPOT_FEE_BPS };
      row.observationWindowMs = now - referenceStartedAt;
      row.stale ||= row.observationWindowMs > maxAgeMs;
      row.validForComparison &&= !row.stale;
      const buyQuote = row.quotes.find(q => q.direction === 'buy');
      row.validDexToBp = !row.stale && !!row.dex.buy && !!buyQuote && !buyQuote.errorCode &&
        (!bpRfq || session.weekendBook || row.sellRfqValid);
      row.edges = row.validForComparison ? computeEdges(token, qty, adjusted, row.dex) : {};
      if (row.validDexToBp) {
        const edgesA = computeEdges(token, qty, adjusted, { ...row.dex, sell: null });
        Object.assign(row.edges, edgesA);
      }
      if (!row.validDexToBp) for (const key of Object.keys(row.edges)) if (key.startsWith('dexToBp')) delete row.edges[key];
      if (token.depositEnabled === false || (row.dex.buy && row.dex.buy.sharesOut < (token.minimumDeposit || 0))) {
        for (const key of Object.keys(row.edges)) if (key.startsWith('dexToBp')) delete row.edges[key];
      }
      row.edgeBasis = session.weekendBook ? 'public-orderbook-estimate' : bpRfq ? (row.sellRfqValid ? 'authenticated-sell-rfq-cancelled' : 'authenticated-sell-rfq-unavailable') : 'reference-price-only-not-executable-RFQ';
    }
    appendJsonl(rows, file);
    console.table(rows.map((r) => ({ source: r.comparison, qty, buy: r.dex.buy?.pxPerShare,
      sellAfterWithdrawal: r.dex.sell?.pxPerShare, valid: r.validForComparison, validA: r.validDexToBp, bpSell: r.backpack.sellPx,
      basis: r.edgeBasis, A_bps: r.edges.dexToBp?.bps, B_bps: r.edges.bpToDex?.bps,
      errors: [...r.dex.errors, r.sellRfq?.error, r.sellRfq?.cancelError].filter(Boolean).join('; ') })));
    console.log(`Saved ${rows.length} rows to ${file}; estimates only, no orders submitted.`);
    if (pollMs) await sleep(pollMs);
  } while (pollMs);
}
