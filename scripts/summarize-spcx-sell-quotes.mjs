import fs from 'node:fs';
const id=process.argv[2];if(!id)throw new Error('runId required');
const rows=fs.readFileSync('data/rfq-paired-quotes.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.runId===id);
const stats=values=>{
 const a=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return {n:0};
 return {n:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,median:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2,min:a[0],max:a.at(-1),meanAbsolute:a.reduce((x,y)=>x+Math.abs(y),0)/a.length};
};
const out={runId:id,count:rows.length,first:rows[0]?.ts,last:rows.at(-1)?.ts,cancelled:rows.filter(r=>r.backpack.cancelled===true).length,valid:rows.filter(r=>r.validBp).length,
 expectedModelVsRfqBps:stats(rows.map(r=>r.model?.expectedVsRfqBps)),conservativeModelVsRfqBps:stats(rows.map(r=>r.model?.conservativeVsRfqBps)),
 observationWindowMs:stats(rows.map(r=>r.observationWindowMs)),sources:{}};
for(const source of ['v2-all','Raydium CLMM','Meteora DLMM']){
 const v=rows.flatMap(r=>r.comparisons.filter(c=>c.source===source&&c.valid).map(c=>c.bpVsDexSellBps));
 out.sources[source]={...stats(v),bpHigherCount:v.filter(x=>x>0).length};
}
fs.writeFileSync(`data/${id}-summary.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
