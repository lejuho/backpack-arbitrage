import { CFG } from './config.js';
import { buildUniverse } from './universe.js';
import { currentSession } from './session.js';
import { runMonitor } from './monitor.js';
import { preflight, plan, runDexToBackpack, runBackpackToDex } from './executor.js';
import { rayPools } from './dex/raydium.js';
import { rfqProbe, rfqLoop } from './rfqprobe.js';
import { report } from './report.js';
import { fetchAll, runBacktest, sensitivity } from './backtest.js';
import { swapSolToUsdc, sendUsdcToBackpack } from './fund.js';
import * as rt from './roundtrip.js';
import { runComparison } from './compare.js';
import { jupDexLabels } from './dex/jupiter.js';

const [, , cmd, ...rest] = process.argv;
const opt = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = rest.filter((a) => !a.startsWith('--'));

const usage = `usage:
  node src/cli.js universe                      # tokenized stocks with Solana rails × Backpack venues
  node src/cli.js session                       # current US-equities session at Backpack
  node src/cli.js dex-labels                    # exact Jupiter DEX labels
  node src/cli.js compare SPCX.US [--qty=1] [--dexes="Raydium CLMM,Meteora DLMM"] [--taker=PUBLIC_ADDRESS] [--bp-rfq] [--ref-price=150] [--max-age=5000] [--poll=30000]
  node src/cli.js snapshot [--qty=1] [--provider=jupiter|raydium]
  node src/cli.js monitor  [--qty=1] [--provider=jupiter|raydium] [--poll=5000]
  node src/cli.js pools SPCX.US                 # Raydium pools for the token
  node src/cli.js report                        # summarize data/gaps.jsonl per symbol × session
  node src/cli.js backtest SPCX.US --fetch [--from=2026-06-12] [--tf=minute|hour]   # download candles to data/hist
  node src/cli.js backtest SPCX.US [--bp=external|spot] [--qty=1] [--bpSpread=30] [--delay=1] [--threshold=20]
  node src/cli.js backtest --sensitivity [SPCX.US MU.US ...] [--spreads=20,30,40]   # signals per spread assumption
  node src/cli.js preflight SPCX.US             # keys, balances, deposit address, session, rails
  node src/cli.js rfq SPCX.US [--qty=1]         # broker two-sided quote + Jupiter, cancel (needs Backpack USDC)
  node src/cli.js rfq SPCX.US --loop=300        # repeat every 300s during weekday sessions
  node src/cli.js plan SPCX.US [--qty=1]        # both directions, step list + net edge (dry)
  node src/cli.js exec SPCX.US --dir=dexToBp|bpToDex [--qty=1] [--live] [--minEdgeBps=20] [--2fa=123456]`;

try {
  if (cmd === 'dex-labels') {
    console.log((await jupDexLabels()).join('\n'));
  } else if (cmd === 'compare') {
    if (opt.live) throw new Error('compare is read-only; --live is not supported');
    await runComparison({ symbol: pos[0] || 'SPCX.US', qty: Number(opt.qty || 1),
      dexes: opt.dexes ? [...new Set(String(opt.dexes).split(',').map((x) => x.trim()).filter(Boolean))] : [],
      bpRfq: !!opt['bp-rfq'], taker: opt.taker, refPrice: opt['ref-price'], maxAgeMs: Number(opt['max-age'] || 5000), pollMs: Number(opt.poll || 0) });
  } else if (cmd === 'universe') {
    const u = await buildUniverse({ watch: [] });
    console.table(u.map((t) => ({ symbol: t.symbol, mint: t.mint, dep: t.depositEnabled, wd: t.withdrawEnabled, wdFeeSh: t.withdrawalFee, spot: t.spotSymbol || '-', spotState: t.spotState || '-', rfq: t.rfqSessions ? 'yes' : 'no' })));
  } else if (cmd === 'session') {
    console.log(await currentSession());
  } else if (cmd === 'snapshot') {
    await runMonitor({ qty: Number(opt.qty || CFG.QTY), qtys: opt.qtys ? String(opt.qtys).split(',').map(Number) : (opt.qty ? [Number(opt.qty)] : CFG.QTYS), provider: opt.provider || 'jupiter', once: true });
  } else if (cmd === 'monitor') {
    await runMonitor({ qty: Number(opt.qty || CFG.QTY), qtys: opt.qtys ? String(opt.qtys).split(',').map(Number) : (opt.qty ? [Number(opt.qty)] : CFG.QTYS), provider: opt.provider || 'jupiter', pollMs: Number(opt.poll || CFG.POLL_MS) });
  } else if (cmd === 'rt') {
    const sym = pos[1] || 'SPCX.US', n = Number(opt.shares || 0.01);
    if (pos[0] === 'buy') await rt.stepBuyDex(sym, n);
    else if (pos[0] === 'deposit') await rt.stepDeposit(sym);
    else if (pos[0] === 'sellrfq') await rt.stepSellRfq(sym, n);
    else if (pos[0] === 'withdraw') await rt.stepWithdraw(sym, n);
    else if (pos[0] === 'selldex') await rt.stepSellDex(sym);
    else if (pos[0] === 'pairs') await rt.rfqPairs(sym, { n: Number(opt.n || 4), shares: n, gapS: Number(opt.gap || 45) });
    else throw new Error('rt buy|deposit|sellrfq|withdraw|selldex <SYMBOL> [--shares=]');
  } else if (cmd === 'swap') {
    await swapSolToUsdc(Number(pos[0]));
  } else if (cmd === 'deposit') {
    await sendUsdcToBackpack(Number(pos[0]));
  } else if (cmd === 'backtest') {
    if (opt.fetch) await fetchAll({ symbol: pos[0] || 'SPCX.US', from: opt.from || '2026-06-12', tf: opt.tf || 'minute' });
    else if (opt.sensitivity) await sensitivity({ symbols: pos.length ? pos : ['SPCX.US', 'MU.US', 'SNDK.US', 'SKHY.US'], spreads: String(opt.spreads || '20,30,40').split(',').map(Number), thresholdBps: Number(opt.threshold || CFG.EDGE_BPS), qty: Number(opt.qty || 1) });
    else {
      const [tok] = await buildUniverse({ watch: [pos[0] || 'SPCX.US'] });
      runBacktest({ symbol: pos[0] || 'SPCX.US', qty: Number(opt.qty || 1), bpSpreadBps: Number(opt.bpSpread || 30), dexSpreadBps: Number(opt.dexSpread || 2), wdFeeSh: Number(opt.wdFee || tok?.withdrawalFee || 0.004), delayBuckets: Number(opt.delay || 1), thresholdBps: Number(opt.threshold || CFG.EDGE_BPS), bpSource: opt.bp || 'external' });
    }
  } else if (cmd === 'report') {
    report();
  } else if (cmd === 'pools') {
    const [t] = await buildUniverse({ watch: [pos[0]] }); if (!t) throw new Error('unknown symbol');
    console.table(await rayPools(t.mint));
  } else if (cmd === 'rfq') {
    if (opt.loop) await rfqLoop({ symbols: pos, qty: Number(opt.qty || 1), everyS: Number(opt.loop) });
    else { const r = await rfqProbe({ symbol: pos[0], qty: Number(opt.qty || 1), side: opt.side || 'Bid' }); console.log(JSON.stringify(r, null, 1)); }
  } else if (cmd === 'preflight') {
    const r = await preflight(pos[0]); console.table(r.checks);
  } else if (cmd === 'plan') {
    const p = await plan(pos[0], Number(opt.qty || CFG.QTY));
    console.table(p.checks);
    console.log('backpack:', p.bp); console.log('dex buy:', p.dex?.buy); console.log('dex sell:', p.dex?.sell);
    console.log('edges:', JSON.stringify(p.edges, null, 1));
    for (const [k, v] of Object.entries(p.steps || {})) { console.log(`\n${k}:`); v.forEach((s) => console.log('  ' + s)); }
  } else if (cmd === 'exec') {
    const args = { symbol: pos[0], qty: Number(opt.qty || CFG.QTY), live: !!opt.live, minEdgeBps: Number(opt.minEdgeBps || CFG.EDGE_BPS), twoFactorToken: opt['2fa'] };
    if (opt.dir === 'dexToBp') await runDexToBackpack(args); else if (opt.dir === 'bpToDex') await runBackpackToDex(args); else throw new Error('--dir required');
  } else { console.log(usage); }
} catch (e) { console.error('ERROR:', e.message || e); process.exit(1); }
