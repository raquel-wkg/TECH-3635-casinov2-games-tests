import { config } from './config.js';

/** GET with timeout; one retry on network error or 429/5xx. Never throws on HTTP errors. */
export async function get(url, { asJson = true, redirect = 'follow' } = {}) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        redirect,
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { 'User-Agent': 'game-catalog-validator/0.1 (TECH-3635 QA PoC)' },
      });
      if ((res.status === 429 || res.status >= 500) && attempt === 1) {
        await sleep(2000);
        continue;
      }
      const body = asJson ? await res.json().catch(() => null) : await res.text();
      return { status: res.status, body, finalUrl: res.url, ms: Date.now() - started };
    } catch (err) {
      if (attempt === 1) {
        await sleep(1000);
        continue;
      }
      return { status: 0, body: null, error: String(err), ms: Date.now() - started };
    }
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run tasks over items with a fixed concurrency cap. */
export async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
