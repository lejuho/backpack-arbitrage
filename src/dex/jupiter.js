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
export async function jupQuote({ inputMint, outputMint, amount, slippageBps = 50, taker, dexes, mode = CFG.JUPITER_MODE }) {
  if (!['lite', 'ultra', 'v2', 'build'].includes(mode)) throw new Error(`unknown Jupiter mode: ${mode}`);
  if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) throw new Error('quote amount must be a positive safe integer');
  if (['v2', 'build'].includes(mode) && !CFG.JUPITER_API_KEY) throw new Error(`${mode} requires JUPITER_API_KEY (no V1 fallback)`);
  if (mode === 'build' && !taker) throw new Error('build requires a public taker address');
  if (dexes && !['lite', 'build'].includes(mode)) throw new Error('DEX restriction requires lite or build mode');
  const p = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  if (dexes) p.set('dexes', dexes);
  const startedAt = Date.now();
  let raw, feeBps = 0;
  if (mode === 'ultra') {
    if (taker) p.set('taker', taker);
    raw = await getJSON(`${LITE}/ultra/v1/order?${p}`);
    feeBps = Number(raw.feeBps || 0);
  } else if (mode === 'v2' || mode === 'build') {
    if (taker) p.set('taker', taker);
    if (mode === 'build') p.set('slippageBps', String(slippageBps));
    raw = await getJSON(`${PRO}/swap/v2/${mode === 'build' ? 'build' : 'order'}?${p}`, { headers: hdr(), retries: 0 });
    feeBps = Number(raw.feeBps || 0);
  } else {
    p.set('slippageBps', String(slippageBps));
    raw = await getJSON(`${LITE}/swap/v1/quote?${p}`);
  }
  if (raw?.error || !Number.isSafeInteger(Number(raw?.inAmount)) || Number(raw.inAmount) <= 0 || !Number.isSafeInteger(Number(raw?.outAmount)) || Number(raw.outAmount) <= 0) {
    throw new Error(`invalid Jupiter quote: ${raw?.error || 'missing or invalid amounts'}`);
  }
  const routePlan = raw.routePlan || [];
  if (dexes && (!routePlan.length || routePlan.some((r) => !dexes.split(',').includes(r.swapInfo?.label)))) {
    throw new Error('Jupiter returned a route outside the requested DEX restriction');
  }
  return {
    mode, feeBps,
    startedAt, receivedAt: Date.now(), router: raw.router || 'metis',
    errorCode: raw.errorCode ?? null, errorMessage: raw.errorMessage ?? null,
    executable: mode === 'lite' ? null : mode === 'build' ? !!raw.swapInstruction : !!raw.transaction && !raw.errorCode,
    feeMint: raw.feeMint ?? null, routePlan,
    inAmount: Number(raw.inAmount), outAmount: Number(raw.outAmount),
    priceImpactPct: Number(raw.priceImpactPct ?? 0),
    routes: routePlan.map((r) => `${r.swapInfo?.label}${r.bps != null ? `:${r.bps / 100}%` : r.percent != null ? `:${r.percent}%` : ''}`),
    raw,
  };
}

/** Build an unsigned swap transaction (base64) for lite /swap/v1 mode. */
export async function jupBuildSwapTx({ quote, userPublicKey }) {
  if (quote.mode !== 'lite') throw new Error('V1 swap builder only accepts lite quotes');
  const r = await sendJSON('POST', `${LITE}/swap/v1/swap`, {
    quoteResponse: quote.raw, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto',
  });
  return { swapTransaction: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight };
}

/** Ultra: submit signed tx (base64) with requestId; Jupiter lands it. */
export const jupUltraExecute = ({ signedTransaction, requestId }) =>
  sendJSON('POST', `${LITE}/ultra/v1/execute`, { signedTransaction, requestId });

export const jupV2Execute = ({ signedTransaction, requestId }) =>
  sendJSON('POST', `${PRO}/swap/v2/execute`, { signedTransaction, requestId }, { headers: hdr() });

export const jupDexLabels = async () => {
  if (!CFG.JUPITER_API_KEY) throw new Error('DEX label lookup requires JUPITER_API_KEY');
  return [...new Set(Object.values(await getJSON(`${PRO}/swap/v1/program-id-to-label`, { headers: hdr(), retries: 0 })))].sort();
};
