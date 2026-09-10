import { CFG } from '../config.js';
import { getJSON } from '../util/http.js';

const B = CFG.BP_BASE;

export const bpMarkets = () => getJSON(`${B}/api/v1/markets`);
export const bpAssets = () => getJSON(`${B}/api/v1/assets`);
export const bpSecurities = () => getJSON(`${B}/api/v1/securities`);
export const bpMarketSessions = () => getJSON(`${B}/api/v1/market-sessions`);
export const bpMarketHolidays = () => getJSON(`${B}/api/v1/market-holidays`);
export const bpDepth = (symbol) => getJSON(`${B}/api/v1/depth?symbol=${encodeURIComponent(symbol)}`);
export const bpTicker = (symbol, external = false) =>
  getJSON(`${B}/api/v1/ticker?symbol=${encodeURIComponent(symbol)}${external ? '&source=External' : ''}`);
export const bpTickers = () => getJSON(`${B}/api/v1/tickers`);
export const bpStatus = () => getJSON(`${B}/api/v1/status`);

/** Solana token descriptors for Backpack-issued tokenized stocks (symbol ends with .US) with on-chain rails enabled. */
export async function bpTokenizedStocks() {
  const assets = await bpAssets();
  const out = [];
  for (const a of assets) {
    if (!a.symbol.endsWith('.US')) continue;
    for (const t of a.tokens || []) {
      if (t.blockchain !== 'Solana') continue;
      if (!(t.depositEnabled || t.withdrawEnabled)) continue;
      out.push({
        symbol: a.symbol,
        ticker: a.symbol.replace(/\.US$/, ''),
        mint: t.contractAddress,
        decimals: t.nativeDecimals,
        depositEnabled: t.depositEnabled,
        withdrawEnabled: t.withdrawEnabled,
        withdrawalFee: Number(t.withdrawalFee || 0), // in shares
        minimumWithdrawal: Number(t.minimumWithdrawal || 0),
        minimumDeposit: Number(t.minimumDeposit || 0),
      });
    }
  }
  return out;
}

/** Walk a depth side and compute VWAP cost for `qty` units. side: 'asks' (buy) or 'bids' (sell). */
export function vwapFromDepth(depth, side, qty) {
  let levels = depth[side].map(([p, q]) => [Number(p), Number(q)]);
  if (side === 'asks') levels.sort((a, b) => a[0] - b[0]);
  else levels.sort((a, b) => b[0] - a[0]);
  let remaining = qty, notional = 0, filled = 0, worst = null;
  for (const [p, q] of levels) {
    if (remaining <= 0) break;
    const take = Math.min(q, remaining);
    notional += take * p; filled += take; remaining -= take; worst = p;
  }
  const best = levels.length ? levels[0][0] : null;
  return { filled, notional, avgPrice: filled ? notional / filled : null, best, worst, partial: remaining > 1e-12 };
}
