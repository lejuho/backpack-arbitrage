import { bpMarkets, bpSecurities, bpTokenizedStocks } from './backpack/public.js';
import { CFG } from './config.js';

/** Join: Backpack tokenized-stock tokens (Solana rails) × spot markets × securities (RFQ constraints). */
export async function buildUniverse({ watch = CFG.WATCH } = {}) {
  const [tokens, markets, securities] = await Promise.all([bpTokenizedStocks(), bpMarkets(), bpSecurities()]);
  const spotBySymbol = new Map(markets.filter((m) => m.marketType === 'SPOT' && m.rwaMarketType === 'STOCK').map((m) => [m.baseSymbol, m]));
  const secBySymbol = new Map(securities.map((s) => [s.asset, s]));
  let list = tokens.map((t) => {
    const spot = spotBySymbol.get(t.symbol);
    const sec = secBySymbol.get(t.symbol);
    return {
      ...t,
      spotSymbol: spot?.symbol || null,
      spotState: spot?.orderBookState || null,
      spotMinQty: spot ? Number(spot.filters.quantity.minQuantity) : null,
      spotStep: spot ? Number(spot.filters.quantity.stepSize) : null,
      rfqSymbol: `${t.symbol}_USDC_RFQ`,
      rfqSessions: sec?.sessions || null,
      cusip: sec?.cusip || null,
    };
  });
  if (watch.length) list = list.filter((t) => watch.includes(t.symbol));
  return list.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
