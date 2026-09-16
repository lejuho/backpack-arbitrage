import { bpRfqSubmit, bpRfqs, bpRfqCancel } from './private.js';
import { sleep } from '../util/http.js';

// Deliberately no accept dependency: this helper only requests and cancels quotes.
export async function bpSellQuote({ symbol, quantity, waitMs = 3000 }, {
  submit = bpRfqSubmit, query = bpRfqs, cancel = bpRfqCancel, pause = sleep,
} = {}) {
  const result = { symbol, quantity, side: 'Ask', startedAt: Date.now(), price: null, error: null };
  let rfq;
  try {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('invalid RFQ quantity');
    rfq = await submit({ symbol, side: 'Ask', quantity, executionMode: 'AwaitAccept' });
    result.rfqId = rfq.rfqId;
    if (!rfq.rfqId) throw new Error('missing RFQ ID');
    while (Date.now() - result.startedAt < waitMs) {
      await pause(250);
      const rows = await query({ rfqId: rfq.rfqId });
      const mine = rows.find(r => String(r.rfq?.rfqId) === String(rfq.rfqId));
      const expiryTime = Number(mine?.rfq?.expiryTime ?? rfq.expiryTime);
      if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) throw new Error('RFQ expired or expiry unknown');
      const quotes = (mine?.quotes || []).filter(q => q.status === 'New' && Number(q.bidPrice) > 0);
      if (quotes.length) {
        const best = quotes.reduce((a, b) => Number(a.bidPrice) >= Number(b.bidPrice) ? a : b);
        Object.assign(result, { price: Number(best.bidPrice), quoteId: best.quoteId, expiryTime, receivedAt: Date.now(), quote: best });
        break;
      }
    }
    if (!result.price) throw new Error('no sell quote within window');
  } catch (e) { result.error = String(e.message || e).slice(0, 300); }
  finally {
    if (rfq?.rfqId) {
      try { await cancel({ rfqId: rfq.rfqId }); result.cancelled = true; }
      catch (e) { result.cancelled = false; result.cancelError = String(e.message || e).slice(0, 300); }
    }
  }
  return result;
}

export async function attachSellRfq(rows, token, { quoteFn = bpSellQuote, maxAgeMs = 5000 } = {}) {
  // Sequential requests avoid overlapping balance reservations. Identical quantities reuse one observation.
  const cache = new Map();
  for (const row of rows) {
    const quantity = row.dex.buy?.sharesOut;
    if (!quantity) continue;
    if (!cache.has(quantity)) cache.set(quantity, await quoteFn({ symbol: token.rfqSymbol, quantity }));
    row.sellRfq = cache.get(quantity);
  }
  for (const row of rows) {
    const q = row.sellRfq;
    row.sellRfqValid = !!q?.price && !q.error && q.cancelled === true &&
      q.expiryTime > Date.now() && Date.now() - q.startedAt <= maxAgeMs;
  }
}
