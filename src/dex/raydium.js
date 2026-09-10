import { getJSON } from '../util/http.js';
const R = 'https://transaction-v1.raydium.io';
const API = 'https://api-v3.raydium.io';

/** Raydium router quote (may span multiple Raydium pools). amount in base units of inputMint. */
export async function rayQuote({ inputMint, outputMint, amount, slippageBps = 50 }) {
  const r = await getJSON(`${R}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&txVersion=V0`);
  if (!r.success) throw new Error(`raydium: ${JSON.stringify(r).slice(0, 200)}`);
  const d = r.data;
  return {
    mode: 'raydium', feeBps: 0,
    inAmount: Number(d.inputAmount), outAmount: Number(d.outputAmount),
    priceImpactPct: Number(d.priceImpactPct ?? 0),
    routes: (d.routePlan || []).map((p) => `ray:${p.poolId.slice(0, 6)}`),
    raw: d,
  };
}

/** Pools that include `mint`, sorted by liquidity. */
export async function rayPools(mint, pageSize = 10) {
  const r = await getJSON(`${API}/pools/info/mint?mint1=${mint}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=1`);
  return (r.data?.data || []).map((p) => ({ id: p.id, type: p.type, pair: `${p.mintA.symbol}/${p.mintB.symbol}`, tvl: p.tvl, vol24h: p.day?.volume, feeRate: p.feeRate }));
}
