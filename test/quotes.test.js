import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../src/config.js';
import { jupQuote, jupBuildSwapTx, jupV2Execute } from '../src/dex/jupiter.js';
import { dexSide, computeEdges } from '../src/pricing.js';
import { compareQuotes } from '../src/compare.js';

const token = { symbol: 'TEST.US', mint: 'TEST', decimals: 6, withdrawalFee: 0.004 };
const response = (body) => new Response(JSON.stringify(body), { status: 200 });
const rawQuote = { inAmount: '1000000', outAmount: '990000', routePlan: [{ swapInfo: { label: 'Meteora DLMM', ammKey: 'pool' }, bps: 10000 }] };

test('V2 preserves default router competition and authenticates; no silent V1 fallback', async (t) => {
  const old = CFG.JUPITER_API_KEY;
  t.after(() => { CFG.JUPITER_API_KEY = old; });
  CFG.JUPITER_API_KEY = '';
  await assert.rejects(jupQuote({ inputMint: 'A', outputMint: 'B', amount: 1, mode: 'v2' }), /no V1 fallback/);
  CFG.JUPITER_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    assert.equal(u.pathname, '/swap/v2/order');
    assert.equal(u.searchParams.has('slippageBps'), false);
    assert.equal(options.headers['x-api-key'], 'test-key');
    return response({ ...rawQuote, router: 'jupiterz', transaction: null, feeBps: 10 });
  });
  const q = await jupQuote({ inputMint: 'A', outputMint: 'B', amount: 1000000, mode: 'v2' });
  assert.equal(q.mode, 'v2');
  assert.equal(q.router, 'jupiterz');
  assert.equal(q.executable, false);
  assert.equal(q.routes[0], 'Meteora DLMM:100%');
  await assert.rejects(jupBuildSwapTx({ quote: q, userPublicKey: 'A' }), /only accepts lite/);
});

test('per-DEX build encodes label and rejects routes leaking into other venues', async (t) => {
  const old = CFG.JUPITER_API_KEY;
  CFG.JUPITER_API_KEY = 'test';
  t.after(() => { CFG.JUPITER_API_KEY = old; });
  let wrong = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, '/swap/v2/build');
    assert.equal(u.searchParams.get('dexes'), 'Meteora DLMM');
    assert.equal(u.searchParams.get('taker'), 'PUBLIC');
    return response(wrong ? { ...rawQuote, routePlan: [{ swapInfo: { label: 'Other' } }] } : rawQuote);
  });
  const args = { inputMint: 'A', outputMint: 'B', amount: 1000000, mode: 'build', dexes: 'Meteora DLMM', taker: 'PUBLIC' };
  assert.equal((await jupQuote(args)).routePlan[0].swapInfo.ammKey, 'pool');
  wrong = true;
  await assert.rejects(jupQuote(args), /outside/);
  await assert.rejects(jupQuote({ ...args, taker: undefined }), /public taker/);
});

test('post-withdrawal amount is quoted directly; included fees are not deducted twice', async () => {
  const calls = [];
  const dex = await dexSide(token, 1, 150, { quoteFn: async (args) => {
    calls.push(args);
    return { mode: 'ultra', feeBps: 10, inAmount: args.amount,
      outAmount: args.inputMint === token.mint ? 149000000 : 1001000, routes: [] };
  } });
  assert.equal(calls.find((c) => c.inputMint === token.mint).amount, 996000);
  assert.equal(dex.sell.sharesIn, 0.996);
  assert.equal(dex.sell.usdcOut, 149);
  assert.equal(dex.buy.sharesOut, 1.001);
  const edges = computeEdges(token, 1, { buyPx: 148, sellPx: 150 }, dex);
  assert.equal(edges.bpToDex.proceeds, 149);
  assert.equal(edges.bpToDex.shares, 0.996);
});

test('fee-sized dust and missing references never fabricate opportunities', async () => {
  let calls = 0;
  const dex = await dexSide(token, 0.000088, null, { quoteFn: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(dex.sell, null);
  assert.equal(dex.buy, null);
  assert.deepEqual(computeEdges(token, 0.000088, { buyPx: 150, sellPx: 150 }, dex), {});
});

test('comparison isolates errors and stale quotes without dropping successful sources', async () => {
  const rows = await compareQuotes({ token, qty: 1, refPrice: 150, dexes: ['Meteora DLMM'], taker: 'PUBLIC', maxAgeMs: 1000,
    quoteFn: async (args) => {
      if (args.mode === 'build') throw new Error('No routes found');
      return { inAmount: args.amount, outAmount: args.inputMint === token.mint ? 149000000 : 1000000,
        mode: args.mode, startedAt: Date.now() - (args.mode === 'lite' ? 2000 : 0), receivedAt: Date.now(), routes: [], raw: {} };
    } });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].stale, true);
  assert.equal(rows[0].validForComparison, false);
  assert.equal(rows[1].validForComparison, true);
  assert.equal(rows[2].validForComparison, false);
  assert.equal(rows[2].dex.errors.length, 2);
});

test('V2 managed execution uses V2 endpoint and authentication', async (t) => {
  const old = CFG.JUPITER_API_KEY;
  CFG.JUPITER_API_KEY = 'test';
  t.after(() => { CFG.JUPITER_API_KEY = old; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.jup.ag/swap/v2/execute');
    assert.equal(options.headers['x-api-key'], 'test');
    assert.deepEqual(JSON.parse(options.body), { signedTransaction: 'mock-only', requestId: 'id' });
    return response({ status: 'Success', signature: 'mock' });
  });
  assert.equal((await jupV2Execute({ signedTransaction: 'mock-only', requestId: 'id' })).status, 'Success');
});
