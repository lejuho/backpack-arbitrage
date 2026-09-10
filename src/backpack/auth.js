import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { CFG } from '../config.js';

let cached = null;
export function bpKeys() {
  if (cached) return cached;
  if (!CFG.BP_API_SECRET) throw new Error('BP_API_SECRET not set (base64 32-byte ED25519 seed)');
  const seed = Buffer.from(CFG.BP_API_SECRET, 'base64');
  if (seed.length !== 32) throw new Error(`BP_API_SECRET must decode to 32 bytes, got ${seed.length}`);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const pub = spki.subarray(spki.length - 32).toString('base64');
  if (CFG.BP_API_KEY && CFG.BP_API_KEY !== pub) console.warn('[auth] BP_API_KEY does not match key derived from BP_API_SECRET; using derived key');
  cached = { priv, pub };
  return cached;
}

/**
 * Backpack signing string: instruction=<i>&<alphabetical k=v of params>&timestamp=<ts>&window=<w>
 * Params exclude undefined/null. Booleans render as true/false. Nested objects are not part of the string.
 */
export function signRequest(instruction, params = {}, { window = 5000 } = {}) {
  const { priv, pub } = bpKeys();
  const ts = Date.now();
  const parts = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && typeof params[k] !== 'object')
    .sort()
    .map((k) => `${k}=${params[k]}`);
  const str = [`instruction=${instruction}`, ...parts, `timestamp=${ts}`, `window=${window}`].join('&');
  const sig = sign(null, Buffer.from(str, 'utf8'), priv).toString('base64');
  return {
    'X-API-Key': pub,
    'X-Signature': sig,
    'X-Timestamp': String(ts),
    'X-Window': String(window),
  };
}
