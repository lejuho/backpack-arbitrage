import { CFG } from '../config.js';

/** Public WS: keeps latest stockPrice.<ticker> (provider bid/ask/mid) and bookTicker.<symbol>. */
export function startPublicWs({ tickers = [], symbols = [], external = [] }, onEvent = () => {}) {
  const stockPrice = new Map();
  const bookTicker = new Map();
  const externalTicker = new Map();
  let ws, closed = false;
  const connect = () => {
    ws = new WebSocket(CFG.BP_WS);
    ws.onopen = () => {
      const params = [...tickers.map((t) => `stockPrice.${t}`), ...symbols.map((s) => `bookTicker.${s}`), ...external.map((s) => `externalTicker.${s}`)];
      if (params.length) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params }));
    };
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (!j.stream) return;
      if (j.stream.startsWith('stockPrice.')) {
        const d = j.data; stockPrice.set(d.symbol, { bid: d.bid != null ? Number(d.bid) : null, ask: d.ask != null ? Number(d.ask) : null, mid: Number(d.mid), session: d.session, ts: d.timestamp, recvAt: Date.now() });
      } else if (j.stream.startsWith('externalTicker.')) {
        const d = j.data; externalTicker.set(d.s, { last: Number(d.c), high: Number(d.h), low: Number(d.l), recvAt: Date.now() });
      } else if (j.stream.startsWith('bookTicker.')) {
        const d = j.data; bookTicker.set(d.s, { bid: Number(d.b), bidQty: Number(d.B), ask: Number(d.a), askQty: Number(d.A), recvAt: Date.now() });
      }
      onEvent(j);
    };
    ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
    ws.onerror = () => {};
  };
  connect();
  return { stockPrice, bookTicker, externalTicker, close: () => { closed = true; try { ws.close(); } catch {} } };
}
