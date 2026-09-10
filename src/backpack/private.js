import { CFG } from '../config.js';
import { getJSON, sendJSON, sleep } from '../util/http.js';
import { signRequest } from './auth.js';

const B = CFG.BP_BASE;
const qs = (p) => {
  const e = Object.entries(p).filter(([, v]) => v !== undefined && v !== null);
  return e.length ? '?' + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
};
const sGet = (instruction, path, params = {}) => getJSON(`${B}${path}${qs(params)}`, { headers: signRequest(instruction, params), retries: 0 });
const sPost = (instruction, path, body = {}, extra = {}) => sendJSON('POST', `${B}${path}`, { ...body, ...extra }, { headers: signRequest(instruction, body) });

// ---- account / capital
export const bpBalances = () => sGet('balanceQuery', '/api/v1/capital');
export const bpDepositAddress = (blockchain = 'Solana') => sGet('depositAddressQuery', '/wapi/v1/capital/deposit/address', { blockchain });
export const bpDeposits = (params = {}) => sGet('depositQueryAll', '/wapi/v1/capital/deposits', params);
export const bpWithdrawals = (params = {}) => sGet('withdrawalQueryAll', '/wapi/v1/capital/withdrawals', params);

/**
 * Withdraw a tokenized stock (e.g. symbol 'SPCX.US') to a Solana address.
 * twoFactorToken is required unless the address is in the address book with 2FA-exempt toggled on.
 */
export function bpWithdraw({ address, symbol, quantity, blockchain = 'Solana', twoFactorToken, clientId, autoLendRedeem }) {
  const body = { address, blockchain, quantity: String(quantity), symbol };
  if (twoFactorToken) body.twoFactorToken = twoFactorToken;
  if (clientId) body.clientId = clientId;
  if (autoLendRedeem !== undefined) body.autoLendRedeem = autoLendRedeem;
  return sPost('withdraw', '/wapi/v1/capital/withdrawals', body);
}

// ---- spot order book (weekend / holiday sessions for listed stocks, and all crypto)
export function bpOrder({ symbol, side, orderType = 'Limit', price, quantity, quoteQuantity, timeInForce = 'IOC', clientId, postOnly }) {
  const body = { symbol, side, orderType };
  if (price !== undefined) body.price = String(price);
  if (quantity !== undefined) body.quantity = String(quantity);
  if (quoteQuantity !== undefined) body.quoteQuantity = String(quoteQuantity);
  if (orderType === 'Limit' && timeInForce) body.timeInForce = timeInForce;
  if (clientId !== undefined) body.clientId = clientId;
  if (postOnly !== undefined) body.postOnly = postOnly;
  return sPost('orderExecute', '/api/v1/order', body);
}
export const bpOpenOrders = (symbol) => sGet('orderQueryAll', '/api/v1/orders', symbol ? { symbol } : {});
export const bpFills = (params = {}) => sGet('fillHistoryQueryAll', '/wapi/v1/history/fills', params);

// ---- RFQ (weekday sessions for stocks): symbol '<TICKER>.US_USDC_RFQ'
export function bpRfqSubmit({ symbol, side, quantity, price, executionMode = 'AwaitAccept', clientId }) {
  const body = { symbol, side, quantity: String(quantity), executionMode };
  if (price !== undefined) body.price = String(price);
  if (clientId !== undefined) body.clientId = clientId;
  return sPost('rfqSubmit', '/api/v1/rfq', body);
}
export const bpRfqs = (params = {}) => sGet('rfqQuery', '/api/v1/rfqs', params);
export const bpRfqAccept = ({ rfqId, quoteId }) => sPost('quoteAccept', '/api/v1/rfq/accept', { rfqId, quoteId });
export const bpRfqCancel = ({ rfqId }) => sPost('rfqCancel', '/api/v1/rfq/cancel', { rfqId });
export const bpRfqHistory = (params = {}) => sGet('rfqHistoryQueryAll', '/wapi/v1/history/rfq', params);
export const bpRfqFills = (params = {}) => sGet('rfqFillHistoryQueryAll', '/wapi/v1/history/rfq/fill', params);

/**
 * Request a quote for `quantity` shares and (optionally) accept the best one.
 * Stock RFQs must use `quantity` (quoteQuantity unsupported). Broker quotes use deferred settlement:
 * acceptance is binding, fill (rfqFilled) follows once the broker executes.
 */
export async function bpRfqTrade({ symbol, side, quantity, limitPrice, accept = false, waitMs = 8000 }) {
  const rfq = await bpRfqSubmit({ symbol, side, quantity, executionMode: 'AwaitAccept' });
  const t0 = Date.now();
  let best = null;
  while (Date.now() - t0 < waitMs) {
    await sleep(500);
    const open = await bpRfqs({ rfqId: rfq.rfqId });
    const mine = (open || []).find((o) => String(o.rfq?.rfqId) === String(rfq.rfqId));
    const quotes = mine?.quotes || [];
    if (quotes.length) {
      best = quotes.reduce((a, b) => (Number(b.price) < Number(a.price)) === (side === 'Bid') ? b : a);
      break;
    }
  }
  if (!best) return { rfq, quote: null, accepted: null, reason: 'no quote within window' };
  const px = Number(best.price);
  const ok = limitPrice === undefined || (side === 'Bid' ? px <= limitPrice : px >= limitPrice);
  if (!accept || !ok) {
    try { await bpRfqCancel({ rfqId: rfq.rfqId }); } catch {}
    return { rfq, quote: best, accepted: null, reason: ok ? 'accept=false' : `quote ${px} worse than limit ${limitPrice}` };
  }
  const accepted = await bpRfqAccept({ rfqId: rfq.rfqId, quoteId: best.quoteId });
  return { rfq, quote: best, accepted, reason: 'accepted (binding, deferred settlement)' };
}
