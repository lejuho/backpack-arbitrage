/** Funding helpers: swap SOL->USDC on Jupiter, send USDC to Backpack deposit address, time the credit. */
import fs from 'node:fs';
import path from 'node:path';
import { PublicKey, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from '@solana/spl-token';
import { CFG } from './config.js';
import { jupQuote, jupBuildSwapTx } from './dex/jupiter.js';
import { loadKeypair, signAndSend, connection, usdcBalance, solBalance } from './solana/wallet.js';
import { bpBalances, bpDepositAddress, bpDeposits } from './backpack/private.js';
import { sleep, nowIso } from './util/http.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const log = (step, data) => { const rec = { ts: nowIso(), step, ...data }; console.log(`[fund] ${step}`, JSON.stringify(data)); fs.mkdirSync(CFG.DATA_DIR, { recursive: true }); fs.appendFileSync(path.join(CFG.DATA_DIR, 'exec.jsonl'), JSON.stringify(rec) + '\n'); };

export async function swapSolToUsdc(sol) {
  const kp = loadKeypair();
  const q = await jupQuote({ inputMint: SOL_MINT, outputMint: CFG.USDC_MINT, amount: Math.round(sol * 1e9), slippageBps: 50, mode: 'lite' });
  log('swap.quote', { solIn: sol, usdcOut: q.outAmount / 1e6, pxPerSol: q.outAmount / 1e6 / sol, impact: q.priceImpactPct, routes: q.routes });
  const built = await jupBuildSwapTx({ quote: q, userPublicKey: kp.publicKey.toBase58() });
  const t0 = Date.now();
  const sig = await signAndSend(built.swapTransaction, kp, built);
  const [solB, usdcB] = await Promise.all([solBalance(kp.publicKey.toBase58()), usdcBalance(kp.publicKey.toBase58())]);
  log('swap.confirmed', { sig, confirmMs: Date.now() - t0, solAfter: solB, usdcAfter: usdcB });
  return { sig, usdcAfter: usdcB };
}

export async function sendUsdcToBackpack(usdc) {
  const kp = loadKeypair();
  const dep = await bpDepositAddress('Solana');
  const to = new PublicKey(dep.address); const mint = new PublicKey(CFG.USDC_MINT);
  const fromAta = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, to, true, TOKEN_PROGRAM_ID);
  const before = await bpBalances();
  const beforeUsdc = Number(before.USDC?.available || 0);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mint, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, BigInt(Math.round(usdc * 1e6)), 6, [], TOKEN_PROGRAM_ID),
  );
  const t0 = Date.now();
  const sig = await connection().sendTransaction(tx, [kp]);
  await connection().confirmTransaction(sig, 'confirmed');
  log('deposit.sent', { to: dep.address, usdc, sig, confirmMs: Date.now() - t0, bpUsdcBefore: beforeUsdc });
  // poll until Backpack credits
  let status = null;
  for (let i = 0; i < 180; i++) {
    await sleep(10e3);
    const b = await bpBalances().catch(() => null);
    const avail = b ? Number(b.USDC?.available || 0) : null;
    const deps = await bpDeposits({ from: t0 - 60e3 }).catch(() => []);
    const mine = (deps || []).find((d) => d.transactionHash === sig || Number(d.quantity) === usdc);
    const st = mine?.status || null;
    if (st !== status) { status = st; log('deposit.status', { status, elapsedS: Math.round((Date.now() - t0) / 1e3), bpUsdc: avail }); }
    if (avail != null && avail >= beforeUsdc + usdc - 1e-6) { log('deposit.credited', { elapsedS: Math.round((Date.now() - t0) / 1e3), bpUsdc: avail, status }); return { sig, elapsedS: (Date.now() - t0) / 1e3 }; }
  }
  throw new Error('deposit not credited within 30 min');
}
