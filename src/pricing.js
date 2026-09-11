import { CFG } from './config.js';
import { bpDepth, vwapFromDepth } from './backpack/public.js';
import { jupQuote } from './dex/jupiter.js';
import { rayQuote } from './dex/raydium.js';

const USDC_DEC = 6;
const toBase = (x, dec) => Math.round(x * 10 ** dec);
const fromBase = (x, dec) => x / 10 ** dec;

/**
 * DEX side: (a) sell post-withdrawal shares -> USDC, (b) buy with USDC notional ≈ qty*ref -> shares.
 * Returns per-share effective prices already net of AMM fees/impact (they are inside outAmount).
 */
export async function dexSide(token, qty, refPrice, { provider = 'jupiter', quoteOptions = {}, quoteFn } = {}) {
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be positive');
  const q = quoteFn || (provider === 'raydium' ? rayQuote : (args) => jupQuote({ ...args, ...quoteOptions }));
  const sellIn = Math.max(0, toBase(qty, token.decimals) - toBase(token.withdrawalFee || 0, token.decimals));
  const buyIn = toBase(qty * refPrice, USDC_DEC);
  const [sell, buy] = await Promise.allSettled([
    sellIn > 0 && qty >= (token.minimumWithdrawal || 0) && token.withdrawEnabled !== false
      ? q({ inputMint: token.mint, outputMint: CFG.USDC_MINT, amount: sellIn }) : Promise.reject(new Error('withdrawal amount below fee/minimum or withdrawals disabled')),
    Number.isSafeInteger(buyIn) && buyIn > 0 ? q({ inputMint: CFG.USDC_MINT, outputMint: token.mint, amount: buyIn }) : Promise.reject(new Error('no valid reference price for buy sizing')),
  ]);
  const s = sell.status === 'fulfilled' ? sell.value : null;
  const b = buy.status === 'fulfilled' ? buy.value : null;
  // Jupiter outAmount already reflects quote fees; never subtract a fixed fee again.
  return {
    provider,
    sell: s && {
      sharesIn: fromBase(s.inAmount, token.decimals), usdcOut: fromBase(s.outAmount, USDC_DEC),
      pxPerShare: fromBase(s.outAmount, USDC_DEC) / fromBase(s.inAmount, token.decimals),
      impactPct: s.priceImpactPct, routes: s.routes, mode: s.mode,
    },
    buy: b && {
      usdcIn: fromBase(b.inAmount, USDC_DEC), sharesOut: fromBase(b.outAmount, token.decimals),
      pxPerShare: fromBase(b.inAmount, USDC_DEC) / fromBase(b.outAmount, token.decimals),
      impactPct: b.priceImpactPct, routes: b.routes, mode: b.mode,
    },
    errors: [sell, buy].filter((r) => r.status === 'rejected').map((r) => String(r.reason).slice(0, 160)),
  };
}

/** Backpack side for `qty` shares: spot order book VWAP if open, else provider stock quote (RFQ reference) from WS cache. */
export async function backpackSide(token, qty, { session, stockPriceCache, externalCache }) {
  const out = { venue: null, bid: null, ask: null, buyPx: null, sellPx: null, partial: false, note: '' };
  // Listed stocks keep a live native order book around the clock (verified 2026-09-09: SPCX book open and
  // trading during US pre-market/regular). Use it whenever it has two-sided depth; RFQ is logged separately.
  // Native book. On weekends/holidays it is the venue (market makers quote it). On weekdays it is resting user
  // orders and can sit far from the market (2026-09-09: SKHY book 189.99/190.00 vs US market 193.7), so on weekdays
  // it is logged as `book*` fields only and the expected basis comes from the RFQ route below.
  let book = null;
  if (token.spotSymbol) {
    const d = await bpDepth(token.spotSymbol).catch(() => null);
    if (d && d.bids?.length && d.asks?.length) {
      const a = vwapFromDepth(d, 'asks', qty), b = vwapFromDepth(d, 'bids', qty);
      book = { bid: b.best, ask: a.best, buyPx: a.avgPrice, sellPx: b.avgPrice, partial: a.partial || b.partial, note: (a.partial || b.partial) ? `book thinner than qty (${a.filled}/${b.filled} filled)` : '' };
    }
  }
  if (book && session.weekendBook) {
    out.venue = `spot:${token.spotSymbol}`; out.basis = 'book';
    out.bid = book.bid; out.ask = book.ask; out.buyPx = book.buyPx; out.sellPx = book.sellPx; out.partial = book.partial;
    out.buyPxCons = out.buyPx; out.sellPxCons = out.sellPx; out.note = book.note;
    return out;
  }
  if (book) { out.bookBid = book.bid; out.bookAsk = book.ask; out.bookBuyPx = book.buyPx; out.bookSellPx = book.sellPx; out.bookPartial = book.partial; }
  const sp = stockPriceCache?.get(token.ticker);
  out.venue = `rfq:${token.rfqSymbol}`;
  if (sp && Date.now() - sp.recvAt < 60e3) {
    out.bid = sp.bid ?? sp.mid; out.ask = sp.ask ?? sp.mid; out.buyPx = out.ask; out.sellPx = out.bid;
    out.note = `provider quote (${sp.session || '?'}), broker RFQ may differ`;
  } else {
    const ex = externalCache?.get(`${token.symbol}_USDC`);
    if (ex && Date.now() - ex.recvAt < 120e3) {
      // RFQ route. Measured 2026-09-09: broker quotes ~30 bps wide but settles within ±5 bps of mid (≈ US market price).
      // expected basis = external last (mid); conservative basis = quoted bid/ask around it.
      const half = CFG.RFQ_QUOTE_SPREAD_BPS / 2e4;
      out.bid = ex.last * (1 - half); out.ask = ex.last * (1 + half);
      out.buyPx = ex.last; out.sellPx = ex.last;               // expected (settlement ≈ mid)
      out.buyPxCons = out.ask; out.sellPxCons = out.bid;       // conservative (quoted)
      out.basis = 'rfq-expected';
      out.note = 'RFQ: expected=US market last, cons=±15bps quote' + (out.bookBid ? '; weekday book logged separately' : '');
    } else {
      out.note = 'no live stockPrice/externalTicker; RFQ requires auth to quote';
    }
  }
  return out;
}

/**
 * Net edge for both directions, per landing.md formula:
 *   net = expected sell proceeds (after transfer) − buy cost − fees not already inside those amounts.
 * Amounts from depth/AMM quotes already contain price impact; withdrawal fee is deducted from shares.
 */
export function computeEdges(token, qty, bp, dex) {
  const bpFee = CFG.BP_SPOT_FEE_BPS / 1e4;
  const res = {};
  const edgeA = (sellPx) => { // A: buy on DEX -> deposit (free, +1 sol tx) -> sell on Backpack
    const cost = dex.buy.usdcIn + CFG.SOL_TX_FEE_USD * 2, shares = dex.buy.sharesOut, proceeds = shares * sellPx * (1 - bpFee);
    return { shares, cost, proceeds, net: proceeds - cost, bps: ((proceeds - cost) / cost) * 1e4 };
  };
  const edgeB = (buyPx) => { // B: buy on Backpack -> withdraw (fee in shares) -> sell on DEX
    const cost = qty * buyPx * (1 + bpFee) + CFG.SOL_TX_FEE_USD, sharesAfter = dex.sell.sharesIn, proceeds = dex.sell.usdcOut;
    return { shares: sharesAfter, cost, proceeds, net: proceeds - cost, bps: ((proceeds - cost) / cost) * 1e4 };
  };
  if (dex.buy && bp.sellPx && !bp.partial && token.depositEnabled !== false && dex.buy.sharesOut >= (token.minimumDeposit || 0)) { res.dexToBp = edgeA(bp.sellPx); res.dexToBpCons = edgeA(bp.sellPxCons ?? bp.sellPx); if (bp.bookSellPx && !bp.bookPartial) res.dexToBpBook = edgeA(bp.bookSellPx); }
  if (dex.sell && bp.buyPx && !bp.partial && token.withdrawEnabled !== false && qty >= (token.minimumWithdrawal || 0)) { res.bpToDex = edgeB(bp.buyPx); res.bpToDexCons = edgeB(bp.buyPxCons ?? bp.buyPx); if (bp.bookBuyPx && !bp.bookPartial) res.bpToDexBook = edgeB(bp.bookBuyPx); }
  return res;
}
