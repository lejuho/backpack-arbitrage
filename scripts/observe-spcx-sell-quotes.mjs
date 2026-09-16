// Quote-only observation. No order acceptance or wallet signing.
import fs from 'node:fs';
import {bpSellQuote} from '../src/backpack/quote.js';
import {bpBalances} from '../src/backpack/private.js';
import {bpTicker} from '../src/backpack/public.js';
import {currentSession} from '../src/session.js';
import {jupQuote} from '../src/dex/jupiter.js';
import {CFG} from '../src/config.js';
import {sleep} from '../src/util/http.js';
const taker=process.argv[2];
if(!taker)throw new Error('public taker address required for build quotes');
const runId=`spcx-sell-${Date.now()}`,file='data/rfq-paired-quotes.jsonl';
const mint='SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb',quantity=0.01;
const specs=[{name:'v2-all',mode:'v2'}, {name:'Raydium CLMM',mode:'build',dexes:'Raydium CLMM',taker}, {name:'Meteora DLMM',mode:'build',dexes:'Meteora DLMM',taker}];
const start=Date.now();
for(let i=0;i<10;i++){
 const delay=start+i*60000-Date.now();if(delay>0)await sleep(delay);
 const session=await currentSession();
 if(session.session!=='US_EQUITIES_REGULAR')throw new Error('regular session ended');
 let balances;for(let attempt=0;attempt<3;attempt++){try{balances=await bpBalances();break;}catch(e){if(attempt===2)throw e;await sleep(500);}}if(Number(balances['SPCX.US']?.available)<quantity)throw new Error('sell quote inventory missing');
 const startedAt=Date.now();
 const results=await Promise.allSettled([
  bpSellQuote({symbol:'SPCX.US_USDC_RFQ',quantity}),
  (async()=>{const requestedAt=Date.now();const data=await bpTicker('SPCX.US_USDC',true);return {requestedAt,receivedAt:Date.now(),data};})(),
  ...specs.map(async spec=>{const {raw,...q}=await jupQuote({inputMint:mint,outputMint:CFG.USDC_MINT,amount:10000,...spec});return {...q,source:spec.name,usdcOut:q.outAmount/1e6,pxPerShare:q.outAmount/1e6/quantity};}),
 ]);
 const val=r=>r.status==='fulfilled'?r.value:{error:String(r.reason?.message||r.reason)};
 const bp=val(results[0]),reference=val(results[1]),dex=results.slice(2).map(val);
 const finishedAt=Date.now(),last=Number(reference.data?.lastPrice);
 const validBp=!!bp.price&&!bp.error&&bp.cancelled===true&&bp.expiryTime>finishedAt&&finishedAt-startedAt<=5000;
 const row={runId,index:i+1,ts:new Date(startedAt).toISOString(),startedAt,finishedAt,session:session.session,quantity,backpack:bp,reference,dex,
  observationWindowMs:finishedAt-startedAt,validBp,basis:'same-quantity-sell-quotes-not-arbitrage-profit',
  model:last>0?{lastPrice:last,conservativeSellPrice:last*(1-15/10000),expectedVsRfqBps:validBp?(last/bp.price-1)*10000:null,conservativeVsRfqBps:validBp?(last*(1-15/10000)/bp.price-1)*10000:null}:null};
 row.comparisons=dex.map((q,i)=>({source:specs[i].name,valid:validBp&&!q.error&&!q.errorCode&&q.inAmount===10000, dexSellPrice:q.pxPerShare??null,
  bpVsDexSellBps:validBp&&!q.error&&!q.errorCode?(bp.price/q.pxPerShare-1)*10000:null,error:q.error||q.errorMessage||null}));
 fs.appendFileSync(file,JSON.stringify(row)+'\n');
 console.log(JSON.stringify({runId,index:row.index,ts:row.ts,bpSell:bp.price,error:bp.error,cancelled:bp.cancelled,reference:last,...row.model,comparisons:row.comparisons}));
 if(bp.rfqId&&bp.cancelled!==true)throw new Error(`RFQ cleanup unconfirmed: ${bp.rfqId}; stopped`);
}
console.log(JSON.stringify({completed:true,runId,observations:10,file}));
