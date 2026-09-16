import test from 'node:test';
import assert from 'node:assert/strict';
import { bpSellQuote, attachSellRfq } from '../src/backpack/quote.js';

test('sell quote uses bidPrice, exact quantity, AwaitAccept and always cancels', async () => {
  let cancelled = 0;
  const result = await bpSellQuote({ symbol: 'SPCX.US_USDC_RFQ', quantity: 1.000926 }, {
    submit: async args => { assert.equal(args.side, 'Ask'); assert.equal(args.quantity, 1.000926); assert.equal(args.executionMode, 'AwaitAccept'); return {rfqId:'1'}; },
    query: async () => [{rfq:{rfqId:'1',expiryTime:Date.now()+60000},quotes:[{status:'New',bidPrice:'149',askPrice:'151',quoteId:'2'}]}],
    cancel: async () => { cancelled++; }, pause: async () => {},
  });
  assert.equal(result.price,149); assert.equal(cancelled,1); assert.equal(result.cancelled,true);
});

test('query error cancels RFQ; submit rejection never supplies fallback price', async () => {
  let cancelled = false;
  const result = await bpSellQuote({ symbol:'X',quantity:1 }, {
    submit:async()=>({rfqId:'1'}), query:async()=>{throw new Error('query failed');},
    cancel:async()=>{cancelled=true;}, pause:async()=>{},
  });
  assert.equal(cancelled,true); assert.equal(result.price,null); assert.match(result.error,/query failed/);
  const rejected = await bpSellQuote({symbol:'X',quantity:1},{submit:async()=>{throw new Error('Insufficient funds');}});
  assert.equal(rejected.price,null); assert.match(rejected.error,/Insufficient funds/);
});

test('expired quotes are rejected and cancelled', async () => {
  const result = await bpSellQuote({symbol:'X',quantity:1},{submit:async()=>({rfqId:'1',expiryTime:1}),query:async()=>[],cancel:async()=>{},pause:async()=>{}});
  assert.equal(result.price,null); assert.equal(result.cancelled,true);
});

test('attach exact bought quantities, reuse duplicates and isolate failure', async () => {
  const rows = [1.000926,0.99998,1.000926].map(sharesOut=>({dex:{buy:{sharesOut}}}));
  const requests=[];
  await attachSellRfq(rows,{rfqSymbol:'X'},{quoteFn:async({quantity})=>{
    requests.push(quantity);
    return quantity===0.99998 ? {error:'fractional rejected'} : {price:149,startedAt:Date.now(),expiryTime:Date.now()+60000,cancelled:true};
  }});
  assert.deepEqual(requests,[1.000926,0.99998]);
  assert.deepEqual(rows.map(r=>r.sellRfqValid),[true,false,true]);
});
