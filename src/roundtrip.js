/** Live fractional round trip for a tokenized stock. Each step logs quote-vs-fill and timings to data/exec.jsonl. */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { buildUniverse } from './universe.js';
import { jupQuote, jupBuildSwapTx } from './dex/jupiter.js';
import { loadKeypair, signAndSend, transferToken2022, tokenBalance, usdcBalance } from './solana/wallet.js';
import { bpBalances, bpDepositAddress, bpRfqSubmit, bpRfqs, bpRfqAccept, bpRfqCancel, bpRfqFills, bpWithdraw, bpWithdrawals } from './backpack/private.js';
import { sleep, nowIso } from './util/http.js';

const log = (step, data) => { const rec = { ts: nowIso(), step: `rt.${step}`, ...data }; console.log(`[rt] ${step}`, JSON.stringify(data)); fs.mkdirSync(CFG.DATA_DIR, { recursive: true }); fs.appendFileSync(path.join(CFG.DATA_DIR, 'exec.jsonl'), JSON.stringify(rec) + '\n'); };
const tok = async (symbol) => (await buildUniverse({ watch: [symbol] }))[0];

/** Step 1: buy `shares` on Jupiter (ExactIn sized from quote), record quote vs on-chain fill. */
export async function stepBuyDex(symbol, shares) {
  const t = await tok(symbol); const kp = loadKeypair(); const me = kp.publicKey.toBase58();
  const probe = await jupQuote({ inputMint: CFG.USDC_MINT, outputMint: t.mint, amount: 1_000_000, mode: 'lite' });
  const px = 1 / (probe.outAmount / 10 ** t.decimals);
  const usdcIn = Math.ceil(shares * px * 1.004 * 1e6);
  const q = await jupQuote({ inputMint: CFG.USDC_MINT, outputMint: t.mint, amount: usdcIn, slippageBps: 50, mode: 'lite' });
  const before = { usdc: await usdcBalance(me), tok: await tokenBalance(me, t.mint, t.decimals) };
  const built = await jupBuildSwapTx({ quote: q, userPublicKey: me });
  const t0 = Date.now(); const sig = await signAndSend(built.swapTransaction, kp, built); const ms = Date.now() - t0;
  await sleep(2000);
  const after = { usdc: await usdcBalance(me), tok: await tokenBalance(me, t.mint, t.decimals) };
  const got = after.tok - before.tok, paid = before.usdc - after.usdc;
  log('buyDex', { symbol, sig, confirmMs: ms, quoteUsdcIn: q.inAmount / 1e6, quoteSharesOut: q.outAmount / 10 ** t.decimals, quotePx: q.inAmount / 1e6 / (q.outAmount / 10 ** t.decimals), fillShares: got, fillUsdc: paid, fillPx: paid / got, slipBps: ((paid / got) / (q.inAmount / 1e6 / (q.outAmount / 10 ** t.decimals)) - 1) * 1e4, routes: q.routes });
  return { got, paid };
}

/** Step 2: send whole token balance to Backpack deposit address, wait until credited. */
export async function stepDeposit(symbol) {
  const t = await tok(symbol); const kp = loadKeypair(); const me = kp.publicKey.toBase58();
  const bal = await tokenBalance(me, t.mint, t.decimals); if (bal <= 0) throw new Error('no token balance');
  const dep = await bpDepositAddress('Solana');
  const bpBefore = Number((await bpBalances())[symbol]?.available || 0);
  const t0 = Date.now();
  const sig = await transferToken2022({ kp, mint: t.mint, decimals: t.decimals, toOwner: dep.address, amount: bal });
  const confirmMs = Date.now() - t0;
  log('deposit.sent', { symbol, shares: bal, to: dep.address, sig, confirmMs });
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const b = await bpBalances().catch(() => null); const avail = b ? Number(b[symbol]?.available || 0) : null;
    if (avail != null && avail >= bpBefore + bal - 1e-6) { log('deposit.credited', { symbol, shares: bal, elapsedS: Math.round((Date.now() - t0) / 1e3), bpAvail: avail }); return { shares: bal, elapsedS: (Date.now() - t0) / 1e3 }; }
    if (i % 12 === 11) log('deposit.waiting', { elapsedS: Math.round((Date.now() - t0) / 1e3), bpAvail: avail });
  }
  throw new Error('deposit not credited within 30 min');
}

/** Step 3: sell `shares` to the broker via RFQ (accept best quote), wait for rfqFilled, record quote vs fill. */
export async function stepSellRfq(symbol, shares) {
  const t = await tok(symbol);
  const jq = await jupQuote({ inputMint: t.mint, outputMint: CFG.USDC_MINT, amount: Math.round(shares * 10 ** t.decimals), mode: 'lite' });
  const t0 = Date.now();
  const rfq = await bpRfqSubmit({ symbol: t.rfqSymbol, side: 'Ask', quantity: shares, executionMode: 'AwaitAccept' });
  let quote = null;
  for (let i = 0; i < 25 && !quote; i++) { await sleep(300); const open = await bpRfqs({ rfqId: rfq.rfqId }).catch(() => []); const mine = (open || []).find((o) => String(o.rfq?.rfqId) === String(rfq.rfqId)); if (mine?.quotes?.length) quote = mine.quotes[0]; }
  if (!quote) { await bpRfqCancel({ rfqId: rfq.rfqId }).catch(() => {}); throw new Error('no RFQ quote'); }
  const quoteMs = Date.now() - t0;
  const acc = await bpRfqAccept({ rfqId: rfq.rfqId, quoteId: quote.quoteId });
  log('sellRfq.accepted', { symbol, shares, rfqId: rfq.rfqId, quoteBid: quote.bidPrice, quoteAsk: quote.askPrice, quoteMs, status: acc.status, dexSellPx: jq.outAmount / 1e6 / shares });
  let fill = null; const t1 = Date.now();
  for (let i = 0; i < 120 && !fill; i++) { await sleep(2000); const fills = await bpRfqFills({ limit: 20 }).catch(() => []); fill = (fills || []).find((f) => String(f.rfqId) === String(rfq.rfqId)); }
  const usdcAfter = Number((await bpBalances()).USDC?.available || 0);
  log('sellRfq.filled', { symbol, fill: fill && { price: fill.price, quantity: fill.quantity, fee: fill.fee, settleMs: Date.now() - t1 }, quoteBid: quote.bidPrice, improveBps: fill ? (Number(fill.price) / Number(quote.bidPrice) - 1) * 1e4 : null, bpUsdc: usdcAfter, raw: fill });
  return { quote, fill };
}

/** Step 4: withdraw `shares` to wallet (2FA-exempt address), wait for on-chain arrival, record fee actually taken. */
export async function stepWithdraw(symbol, shares) {
  const t = await tok(symbol); const kp = loadKeypair(); const me = kp.publicKey.toBase58();
  const before = await tokenBalance(me, t.mint, t.decimals);
  const t0 = Date.now();
  const w = await bpWithdraw({ address: me, symbol, quantity: shares, blockchain: 'Solana', clientId: `rt-${Date.now()}` });
  log('withdraw.requested', { symbol, shares, id: w.id, status: w.status, fee: w.fee });
  for (let i = 0; i < 720; i++) {
    await sleep(5000);
    const bal = await tokenBalance(me, t.mint, t.decimals);
    if (bal > before + 1e-9) {
      const ws = await bpWithdrawals({ limit: 5 }).catch(() => []); const mine = (ws || []).find((x) => String(x.id) === String(w.id));
      log('withdraw.arrived', { symbol, requested: shares, received: bal - before, feeTaken: shares - (bal - before), elapsedS: Math.round((Date.now() - t0) / 1e3), status: mine?.status, tx: mine?.transactionHash });
      return { received: bal - before, elapsedS: (Date.now() - t0) / 1e3 };
    }
    if (i % 12 === 11) log('withdraw.waiting', { elapsedS: Math.round((Date.now() - t0) / 1e3) });
  }
  throw new Error('withdrawal not arrived within 60 min');
}

/** Step 5: sell whole token balance on Jupiter, record quote vs fill. */
export async function stepSellDex(symbol) {
  const t = await tok(symbol); const kp = loadKeypair(); const me = kp.publicKey.toBase58();
  const bal = await tokenBalance(me, t.mint, t.decimals); if (bal <= 0) throw new Error('no token balance');
  const q = await jupQuote({ inputMint: t.mint, outputMint: CFG.USDC_MINT, amount: Math.round(bal * 10 ** t.decimals), slippageBps: 50, mode: 'lite' });
  const before = await usdcBalance(me);
  const built = await jupBuildSwapTx({ quote: q, userPublicKey: me });
  const t0 = Date.now(); const sig = await signAndSend(built.swapTransaction, kp, built); const ms = Date.now() - t0;
  await sleep(2000);
  const got = (await usdcBalance(me)) - before;
  log('sellDex', { symbol, sig, confirmMs: ms, shares: bal, quoteUsdcOut: q.outAmount / 1e6, quotePx: q.outAmount / 1e6 / bal, fillUsdc: got, fillPx: got / bal, slipBps: (got / (q.outAmount / 1e6) - 1) * 1e4, routes: q.routes });
  return { got };
}

/** Generic RFQ trade (Bid = buy, Ask = sell) with accept; records quote vs settlement and Jupiter price at the same moment. */
export async function stepRfqTrade(symbol, side, shares) {
  const t = await tok(symbol);
  const jq = side === 'Ask'
    ? await jupQuote({ inputMint: t.mint, outputMint: CFG.USDC_MINT, amount: Math.round(shares * 10 ** t.decimals), mode: 'lite' })
    : await jupQuote({ inputMint: CFG.USDC_MINT, outputMint: t.mint, amount: Math.round(shares * 155 * 1e6), mode: 'lite' });
  const dexPx = side === 'Ask' ? jq.outAmount / 1e6 / shares : jq.inAmount / 1e6 / (jq.outAmount / 10 ** t.decimals);
  const t0 = Date.now();
  const rfq = await bpRfqSubmit({ symbol: t.rfqSymbol, side, quantity: shares, executionMode: 'AwaitAccept' });
  let quote = null;
  for (let i = 0; i < 25 && !quote; i++) { await sleep(300); const open = await bpRfqs({ rfqId: rfq.rfqId }).catch(() => []); const mine = (open || []).find((o) => String(o.rfq?.rfqId) === String(rfq.rfqId)); if (mine?.quotes?.length) quote = mine.quotes[0]; }
  if (!quote) { await bpRfqCancel({ rfqId: rfq.rfqId }).catch(() => {}); throw new Error('no RFQ quote'); }
  const quoteMs = Date.now() - t0; const qpx = Number(side === 'Ask' ? quote.bidPrice : quote.askPrice);
  await bpRfqAccept({ rfqId: rfq.rfqId, quoteId: quote.quoteId });
  let fill = null; const t1 = Date.now();
  for (let i = 0; i < 120 && !fill; i++) { await sleep(1500); const fills = await bpRfqFills({ limit: 20 }).catch(() => []); fill = (fills || []).find((f) => String(f.rfqId) === String(rfq.rfqId)); }
  const fpx = fill ? Number(fill.fillPrice ?? fill.price) : null;
  const improveBps = fpx ? (side === 'Ask' ? fpx / qpx - 1 : 1 - fpx / qpx) * 1e4 : null; // positive = better than quote
  const rec = { symbol, side, shares, rfqId: rfq.rfqId, quoteBid: Number(quote.bidPrice), quoteAsk: Number(quote.askPrice), quoteSpreadBps: (Number(quote.askPrice) - Number(quote.bidPrice)) / Number(quote.askPrice) * 1e4, quoteMs, acceptedPx: qpx, fillPx: fpx, improveBps, settleMs: fill ? Date.now() - t1 : null, dexPx, fillVsDexBps: fpx ? (side === 'Ask' ? fpx / dexPx - 1 : 1 - fpx / dexPx) * 1e4 : null };
  log('rfqTrade', rec);
  fs.appendFileSync(path.join(CFG.DATA_DIR, 'rfq.fills.jsonl'), JSON.stringify({ ts: nowIso(), ...rec }) + '\n');
  return rec;
}

/** n × (buy then sell) pairs inside Backpack; no withdrawal so the only cost is the effective spread. */
export async function rfqPairs(symbol, { n = 4, shares = 0.01, gapS = 45 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await stepRfqTrade(symbol, 'Bid', shares)); await sleep(gapS * 1e3);
    out.push(await stepRfqTrade(symbol, 'Ask', shares)); if (i < n - 1) await sleep(gapS * 1e3);
  }
  const buys = out.filter((r) => r.side === 'Bid'), sells = out.filter((r) => r.side === 'Ask');
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`[rt] pairs=${n} quoteSpread avg ${avg(out.map((r) => r.quoteSpreadBps)).toFixed(1)} bps | improve buy avg ${avg(buys.map((r) => r.improveBps)).toFixed(1)} sell avg ${avg(sells.map((r) => r.improveBps)).toFixed(1)} | effective round-trip cost avg ${avg(buys.map((b, i) => (b.fillPx / sells[i].fillPx - 1) * 1e4)).toFixed(1)} bps`);
  return out;
}
