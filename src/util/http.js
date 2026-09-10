export async function getJSON(url, { headers = {}, timeoutMs = 15000, retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'bp-rwa-arb/0.1', ...headers }, signal: ctl.signal });
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url} :: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(300 * (i + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export async function sendJSON(method, url, body, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'bp-rwa-arb/0.1', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${method} ${url} :: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString();
