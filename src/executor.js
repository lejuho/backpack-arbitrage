/**
 * Execution pipeline for the two arbitrage directions. Default is DRY-RUN (plan + preflight only).
 * Pass { live: true } to actually trade / move funds. Every step is logged to data/exec.jsonl.
 *
 *  A) DEX -> Backpack : Jupiter buy shares -> transfer Token-2022 to Backpack Solana deposit address
 *                       -> wait for deposit credit -> sell on Backpack (spot order if weekend book, else RFQ)
 *  B) Backpack -> DEX : buy on Backpack (RFQ / spot) -> withdraw <SYMBOL>.US to wallet (fee in shares, 2FA rules)
 *                       -> wait for on-chain arrival -> Jupiter sell
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { buildUniverse } from './universe.js';
import { currentSession } from './session.js';
import { dexSide, backpackSide, computeEdges } from './pricing.js';
import { jupQuote, jupBuildSwapTx, jupUltraExecute, jupV2Execute } from './dex/jupiter.js';
import { bpBalances, bpDepositAddress, bpDeposits, bpWithdraw, bpWithdrawals, bpOrder, bpRfqTrade } from './backpack/private.js';
import { loadKeypair, signAndSend, transferToken2022, tokenBalance, usdcBalance, solBalance } from './solana/wallet.js';
import { sleep, nowIso } from './util/http.js';

const log = (step, data) => {
  const rec = { ts: nowIso(), step, ...data };
  console.log(`[exec] ${step}`, JSON.stringify(data));
  fs.mkdirSync(CFG.DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(CFG.DATA_DIR, 'exec.jsonl'), JSON.stringify(rec) + '\n');
};

export async function preflight(symbol, { needWallet = true, needBackpack = true } = {}) {
  const checks = [];
  const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });
  ok('Jupiter execution mode', ['lite', 'ultra', 'v2'].includes(CFG.JUPITER_MODE), 'build mode is comparison-only');
  if (CFG.JUPITER_MODE === 'v2') ok('Jupiter V2 API key', !!CFG.JUPITER_API_KEY, 'V2 does not fall back to V1');
  const [token] = await buildUniverse({ watch: [symbol] });
  ok('token listed with Solana rails', !!token, token ? `${token.mint} dep=${token.depositEnabled} wd=${token.withdrawEnabled} fee=${token.withdrawalFee}sh` : 'not in Backpack assets with Solana deposit/withdraw');
  if (!token) return { token: null, checks };
  const session = await currentSession();
  ok('session', true, `${session.session} (ET ${session.et}) -> Backpack venue: ${session.weekendBook ? (token.spotSymbol ? 'spot order book' : 'NO VENUE (no spot market for this symbol on weekends)') : 'RFQ ' + token.rfqSymbol}`);
  ok('backpack venue available now', session.weekendBook ? !!token.spotSymbol && token.spotState === 'Open' : true, session.weekendBook ? `spotState=${token.spotState}` : 'RFQ (broker quotes, deferred settlement)');
  if (needBackpack) {
    if (!CFG.BP_API_SECRET) ok('backpack API key', false, 'BP_API_SECRET missing');
    else {
      try { const b = await bpBalances(); ok('backpack API key', true, `USDC avail=${b.USDC?.available ?? 0} ${symbol} avail=${b[symbol]?.available ?? 0}`); } catch (e) { ok('backpack API key', false, String(e).slice(0, 200)); }
      try { const a = await bpDepositAddress('Solana'); ok('backpack Solana deposit address', !!a?.address, a?.address || ''); } catch (e) { ok('backpack Solana deposit address', false, String(e).slice(0, 200)); }
    }
  }
  if (needWallet) {
    if (!CFG.SOLANA_SECRET_KEY) ok('solana wallet', false, 'SOLANA_SECRET_KEY missing');
    else {
      try {
        const kp = loadKeypair(); const pk = kp.publicKey.toBase58();
        const [sol, usdc, tok] = await Promise.all([solBalance(pk), usdcBalance(pk), tokenBalance(pk, token.mint, token.decimals)]);
        ok('solana wallet', true, `${pk} SOL=${sol.toFixed(4)} USDC=${usdc.toFixed(2)} ${token.ticker}=${tok}`);
        ok('sol for fees', sol >= 0.01, `${sol.toFixed(4)} SOL`);
      } catch (e) { ok('solana wallet', false, String(e).slice(0, 200)); }
    }
  }
  ok('withdrawal 2FA', true, 'withdrawals to a non-2FA-exempt address need twoFactorToken; add the wallet to Backpack address book with 2FA-exempt for unattended runs (cannot be verified via API)');
  return { token, session, checks };
}

export async function plan(symbol, qty = CFG.QTY) {
  const pf = await preflight(symbol, { needWallet: false, needBackpack: false });
  const { token, session } = pf;
  if (!token) return pf;
  const bp = await backpackSide(token, qty, { session, stockPriceCache: null });
  const dex = await dexSide(token, qty, bp.buyPx || bp.sellPx || 100);
  const edges = computeEdges(token, qty, bp, dex);
  const steps = {
    dexToBp: [
      `1. Jupiter swap ${dex.buy?.usdcIn?.toFixed(2)} USDC -> ~${dex.buy?.sharesOut?.toFixed(4)} ${token.ticker} (${dex.buy?.routes?.join(',')})`,
      `2. Transfer Token-2022 ${token.ticker} to Backpack Solana deposit address (ATA idempotent + transferChecked)`,
      `3. Poll /wapi/v1/capital/deposits until confirmed; balance ${symbol} available`,
      `4. Sell ${symbol}: ${session.weekendBook ? `spot ${token.spotSymbol} limit IOC @ ~${bp.sellPx?.toFixed(2)}` : `RFQ ${token.rfqSymbol} Ask qty (min per session from /securities)`}`,
    ],
    bpToDex: [
      `1. Buy ${qty} ${symbol}: ${session.weekendBook ? `spot ${token.spotSymbol} limit IOC @ ~${bp.buyPx?.toFixed(2)}` : `RFQ ${token.rfqSymbol} Bid qty=${qty} (whole shares outside regular hours)`}`,
      `2. Withdraw ${qty} ${symbol} -> wallet via /wapi/v1/capital/withdrawals (fee ${token.withdrawalFee} sh ≈ $${(token.withdrawalFee * (bp.buyPx || 0)).toFixed(2)}; 2FA unless exempt address)`,
      `3. Poll on-chain ATA balance until +${(qty - token.withdrawalFee).toFixed(4)}`,
      `4. Jupiter swap ${token.ticker} -> USDC (~${dex.sell?.pxPerShare?.toFixed(2)}/sh, ${dex.sell?.routes?.join(',')})`,
    ],
  };
  return { ...pf, bp, dex, edges, steps };
}

// ---------------- live steps ----------------
async function dexBuy({ token, usdcIn, kp, live }) {
  const q = await jupQuote({ inputMint: CFG.USDC_MINT, outputMint: token.mint, amount: Math.round(usdcIn * 1e6), taker: kp?.publicKey.toBase58() });
  log('dex.buy.quote', { usdcIn, sharesOut: q.outAmount / 10 ** token.decimals, routes: q.routes, mode: q.mode });
  if (!live) return { sig: null, shares: q.outAmount / 10 ** token.decimals };
  let sig;
  if (q.mode === 'ultra' || q.mode === 'v2') {
    if (!q.executable || !q.raw.requestId) throw new Error('Jupiter returned a non-executable quote');
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(Buffer.from(q.raw.transaction, 'base64')); tx.sign([kp]);
    const r = await (q.mode === 'v2' ? jupV2Execute : jupUltraExecute)({ signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: q.raw.requestId });
    if (r.status !== 'Success') throw new Error(`Jupiter execute: ${JSON.stringify(r).slice(0, 300)}`);
    sig = r.signature;
  } else {
    const built = await jupBuildSwapTx({ quote: q, userPublicKey: kp.publicKey.toBase58() });
    sig = await signAndSend(built.swapTransaction, kp, built);
  }
  log('dex.buy.sent', { sig });
  return { sig, shares: q.outAmount / 10 ** token.decimals };
}
async function dexSell({ token, shares, kp, live }) {
  const q = await jupQuote({ inputMint: token.mint, outputMint: CFG.USDC_MINT, amount: Math.round(shares * 10 ** token.decimals), taker: kp?.publicKey.toBase58() });
  log('dex.sell.quote', { shares, usdcOut: q.outAmount / 1e6, routes: q.routes, mode: q.mode });
  if (!live) return { sig: null, usdc: q.outAmount / 1e6 };
  let sig;
  if (q.mode === 'ultra' || q.mode === 'v2') {
    if (!q.executable || !q.raw.requestId) throw new Error('Jupiter returned a non-executable quote');
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(Buffer.from(q.raw.transaction, 'base64')); tx.sign([kp]);
    const r = await (q.mode === 'v2' ? jupV2Execute : jupUltraExecute)({ signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: q.raw.requestId });
    if (r.status !== 'Success') throw new Error(`Jupiter execute: ${JSON.stringify(r).slice(0, 300)}`);
    sig = r.signature;
  } else {
    const built = await jupBuildSwapTx({ quote: q, userPublicKey: kp.publicKey.toBase58() });
    sig = await signAndSend(built.swapTransaction, kp, built);
  }
  log('dex.sell.sent', { sig });
  return { sig, usdc: q.outAmount / 1e6 };
}
async function bpSell({ token, session, qty, limitPrice, live }) {
  if (session.weekendBook && token.spotSymbol) {
    if (!live) return { dry: true, venue: token.spotSymbol };
    const r = await bpOrder({ symbol: token.spotSymbol, side: 'Ask', orderType: 'Limit', price: limitPrice.toFixed(2), quantity: qty.toFixed(2), timeInForce: 'IOC' });
    log('bp.sell.spot', r); return r;
  }
  if (!live) return { dry: true, venue: token.rfqSymbol };
  const r = await bpRfqTrade({ symbol: token.rfqSymbol, side: 'Ask', quantity: qty, limitPrice, accept: true });
  log('bp.sell.rfq', { quote: r.quote, reason: r.reason }); return r;
}
async function bpBuy({ token, session, qty, limitPrice, live }) {
  if (session.weekendBook && token.spotSymbol) {
    if (!live) return { dry: true, venue: token.spotSymbol };
    const r = await bpOrder({ symbol: token.spotSymbol, side: 'Bid', orderType: 'Limit', price: limitPrice.toFixed(2), quantity: qty.toFixed(2), timeInForce: 'IOC' });
    log('bp.buy.spot', r); return r;
  }
  if (!live) return { dry: true, venue: token.rfqSymbol };
  const r = await bpRfqTrade({ symbol: token.rfqSymbol, side: 'Bid', quantity: qty, limitPrice, accept: true });
  log('bp.buy.rfq', { quote: r.quote, reason: r.reason }); return r;
}
async function waitBackpackDeposit({ symbol, minQty, timeoutMs = 30 * 60e3 }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const b = await bpBalances();
    const avail = Number(b[symbol]?.available || 0);
    if (avail >= minQty) return avail;
    const deps = await bpDeposits({ from: t0 - 60e3 }).catch(() => []);
    const mine = (deps || []).filter((d) => d.symbol === symbol);
    if (mine.length) log('bp.deposit.status', { status: mine[0].status, qty: mine[0].quantity });
    await sleep(10e3);
  }
  throw new Error('deposit not credited within timeout');
}
async function waitOnchainArrival({ owner, token, minQty, timeoutMs = 60 * 60e3 }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const bal = await tokenBalance(owner, token.mint, token.decimals);
    if (bal >= minQty) return bal;
    await sleep(10e3);
  }
  throw new Error('withdrawal not arrived on-chain within timeout');
}

/** Direction A: DEX -> Backpack. */
export async function runDexToBackpack({ symbol, qty = CFG.QTY, live = false, minEdgeBps = CFG.EDGE_BPS }) {
  const p = await plan(symbol, qty);
  if (!p.token) throw new Error('unknown token');
  const e = p.edges.dexToBp;
  log('plan.dexToBp', { symbol, qty, edge: e, session: p.session.session, live });
  if (!e || e.bps < minEdgeBps) { log('abort', { reason: `edge ${e?.bps?.toFixed(1)}bps < ${minEdgeBps}` }); return p; }
  const kp = live ? loadKeypair() : (CFG.SOLANA_SECRET_KEY ? loadKeypair() : null);
  const pf = await preflight(symbol); if (live && pf.checks.some((c) => !c.pass)) throw new Error('preflight failed: ' + JSON.stringify(pf.checks.filter((c) => !c.pass)));
  const bought = await dexBuy({ token: p.token, usdcIn: p.dex.buy.usdcIn, kp, live });
  const dep = live ? await bpDepositAddress('Solana') : { address: '<backpack-deposit-address>' };
  const shares = Math.floor(bought.shares * 100) / 100; // Backpack stock step 0.01
  log('transfer.plan', { to: dep.address, shares });
  if (live) { const sig = await transferToken2022({ kp, mint: p.token.mint, decimals: p.token.decimals, toOwner: dep.address, amount: shares }); log('transfer.sent', { sig }); await waitBackpackDeposit({ symbol, minQty: shares }); }
  const sold = await bpSell({ token: p.token, session: p.session, qty: shares, limitPrice: p.bp.sellPx * 0.995, live });
  log('done.dexToBp', { sold });
  return { plan: p, bought, sold };
}

/** Direction B: Backpack -> DEX. */
export async function runBackpackToDex({ symbol, qty = CFG.QTY, live = false, minEdgeBps = CFG.EDGE_BPS, twoFactorToken }) {
  const p = await plan(symbol, qty);
  if (!p.token) throw new Error('unknown token');
  const e = p.edges.bpToDex;
  log('plan.bpToDex', { symbol, qty, edge: e, session: p.session.session, live });
  if (!e || e.bps < minEdgeBps) { log('abort', { reason: `edge ${e?.bps?.toFixed(1)}bps < ${minEdgeBps}` }); return p; }
  const kp = live ? loadKeypair() : (CFG.SOLANA_SECRET_KEY ? loadKeypair() : null);
  const pf = await preflight(symbol); if (live && pf.checks.some((c) => !c.pass)) throw new Error('preflight failed: ' + JSON.stringify(pf.checks.filter((c) => !c.pass)));
  const bought = await bpBuy({ token: p.token, session: p.session, qty, limitPrice: p.bp.buyPx * 1.005, live });
  const owner = kp?.publicKey.toBase58() || '<wallet>';
  log('withdraw.plan', { symbol, qty, to: owner, feeShares: p.token.withdrawalFee });
  let arrived = qty - p.token.withdrawalFee;
  if (live) {
    const w = await bpWithdraw({ address: owner, symbol, quantity: qty, twoFactorToken });
    log('withdraw.sent', w);
    const before = await tokenBalance(owner, p.token.mint, p.token.decimals);
    arrived = (await waitOnchainArrival({ owner, token: p.token, minQty: before + qty - p.token.withdrawalFee - 1e-6 })) - before;
    const ws = await bpWithdrawals({ from: Date.now() - 3600e3 }).catch(() => []); log('withdraw.status', { last: (ws || [])[0] });
  }
  const sold = await dexSell({ token: p.token, shares: arrived, kp, live });
  log('done.bpToDex', { bought, sold });
  return { plan: p, bought, sold };
}
