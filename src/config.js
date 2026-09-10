import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const str = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

export const CFG = {
  BP_BASE: 'https://api.backpack.exchange',
  BP_WS: 'wss://ws.backpack.exchange/',
  BP_API_SECRET: str('BP_API_SECRET', ''),
  BP_API_KEY: str('BP_API_KEY', ''),
  RPC_URL: str('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  SOLANA_SECRET_KEY: str('SOLANA_SECRET_KEY', ''),
  JUPITER_MODE: str('JUPITER_MODE', 'lite'),
  JUPITER_API_KEY: str('JUPITER_API_KEY', ''),
  USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  WATCH: str('WATCH', '').split(',').map((s) => s.trim()).filter(Boolean),
  QTY: num('QTY', 1),
  QTYS: str('QTYS', '1,10').split(',').map(Number).filter((x) => x > 0),
  POLL_MS: num('POLL_MS', 5000),
  EDGE_BPS: num('EDGE_BPS', 10),
  RFQ_QUOTE_SPREAD_BPS: num('RFQ_QUOTE_SPREAD_BPS', 30),   // quoted bid/ask width (measured 30.6)
  RFQ_SETTLE_VAR_BPS: num('RFQ_SETTLE_VAR_BPS', 5),        // settlement deviation from mid (measured ±5)
  BP_SPOT_FEE_BPS: num('BP_SPOT_FEE_BPS', 0),
  SOL_TX_FEE_USD: num('SOL_TX_FEE_USD', 0.05),
  JUP_ULTRA_FEE_BPS: num('JUP_ULTRA_FEE_BPS', 10),
  DATA_DIR: path.resolve(process.cwd(), 'data'),
};
