import { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { CFG } from '../config.js';

export const connection = () => new Connection(CFG.RPC_URL, 'confirmed');

export function loadKeypair() {
  const s = CFG.SOLANA_SECRET_KEY;
  if (!s) throw new Error('SOLANA_SECRET_KEY not set');
  const bytes = s.trim().startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s.trim());
  return Keypair.fromSecretKey(bytes);
}

export async function tokenBalance(owner, mint, decimals) {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID);
  try { const a = await getAccount(connection(), ata, 'confirmed', TOKEN_2022_PROGRAM_ID); return Number(a.amount) / 10 ** decimals; } catch { return 0; }
}
export async function usdcBalance(owner) {
  const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
  const ata = getAssociatedTokenAddressSync(new PublicKey(CFG.USDC_MINT), new PublicKey(owner), false, TOKEN_PROGRAM_ID);
  try { const a = await getAccount(connection(), ata, 'confirmed', TOKEN_PROGRAM_ID); return Number(a.amount) / 1e6; } catch { return 0; }
}
export async function solBalance(owner) { return (await connection().getBalance(new PublicKey(owner))) / 1e9; }

/** Sign + send a base64 VersionedTransaction (Jupiter swap). */
export async function signAndSend(base64Tx, kp, { lastValidBlockHeight } = {}) {
  const c = connection();
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
  tx.sign([kp]);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const bh = await c.getLatestBlockhash();
  await c.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: lastValidBlockHeight || bh.lastValidBlockHeight }, 'confirmed');
  return sig;
}

/** Transfer Token-2022 tokenized stock to a destination owner (e.g. Backpack deposit address). Creates dest ATA if needed. */
export async function transferToken2022({ kp, mint, decimals, toOwner, amount }) {
  const c = connection();
  const mintPk = new PublicKey(mint), to = new PublicKey(toOwner);
  const fromAta = getAssociatedTokenAddressSync(mintPk, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mintPk, to, true, TOKEN_2022_PROGRAM_ID);
  const raw = BigInt(Math.round(amount * 10 ** decimals));
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mintPk, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(fromAta, mintPk, toAta, kp.publicKey, raw, decimals, [], TOKEN_2022_PROGRAM_ID),
  );
  const sig = await c.sendTransaction(tx, [kp]);
  await c.confirmTransaction(sig, 'confirmed');
  return sig;
}
