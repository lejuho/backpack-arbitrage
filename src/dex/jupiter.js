import { CFG } from '../config.js';
import { getJSON, sendJSON } from '../util/http.js';

const LITE = 'https://lite-api.jup.ag';
const PRO = 'https://api.jup.ag';
const hdr = () => (CFG.JUPITER_API_KEY ? { 'x-api-key': CFG.JUPITER_API_KEY } : {});

/** Price v3 (USD price + liquidity per mint). */
export async function jupPrices(mints) {
  const r = await getJSON(`${LITE}/price/v3?ids=${mints.join(',')}`);
  return r;
}

/**
 * Quote via the chosen mode. amount is in base units of inputMint.
 * Returns a normalized {inAmount, outAmount, priceImpactPct, routes[], raw, mode, feeBps}.
 */
export async function jupQuote({ inputMint, outputMint, amount, slippageBps = 50, taker, mode = CFG.JUPITER_MODE }) {
  const p = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  let raw, feeBps = 0;
  if (mode === 'ultra') {
    if (taker) p.set('taker', taker);
    raw = await getJSON(`${LITE}/ultra/v1/order?${p}`);
    feeBps = Number(raw.feeBps || 0);
  } else if (mode === 'v2' && CFG.JUPITER_API_KEY) {
    if (taker) p.set('taker', taker);
    raw = await getJSON(`${PRO}/swap/v2/order?${p}`, { headers: hdr() });
    feeBps = Number(raw.feeBps || 0);
  } else {
    p.set('slippageBps', String(slippageBps));
    raw = await getJSON(`${LITE}/swap/v1/quote?${p}`);
  }
  return {
    mode, feeBps,
    inAmount: Number(raw.inAmount), outAmount: Number(raw.outAmount),
    priceImpactPct: Number(raw.priceImpactPct ?? 0),
    routes: (raw.routePlan || []).map((r) => `${r.swapInfo?.label}${r.percent ? `:${r.percent}%` : ''}`),
    raw,
  };
}

/** Build an unsigned swap transaction (base64) for lite /swap/v1 mode. */
export async function jupBuildSwapTx({ quote, userPublicKey }) {
  const r = await sendJSON('POST', `${LITE}/swap/v1/swap`, {
    quoteResponse: quote.raw, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto',
  });
  return { swapTransaction: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight };
}

/** Ultra: submit signed tx (base64) with requestId; Jupiter lands it. */
export const jupUltraExecute = ({ signedTransaction, requestId }) =>
  sendJSON('POST', `${LITE}/ultra/v1/execute`, { signedTransaction, requestId });
