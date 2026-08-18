/**
 * TECH-3635 PoC — stage 3: real-browser validation with Playwright.
 *
 * For each game id: open the real game page in the New Client, wait for the
 * Omega iframe, then look INSIDE the (cross-origin) frame — Playwright can read
 * sub-frames — for known error markers vs. signs of life, while recording
 * failed network requests and console errors. Screenshot saved per game.
 *
 * The client keeps its loading spinner behind the iframe forever (there is no
 * "loaded" event in the app), so "loaded" here is a heuristic to calibrate:
 * frame document has substantial content, no error marker, and canvas/engine
 * activity or provider bootstrap requests succeeded.
 *
 * Usage:  npm i && npx playwright install chromium
 *         node src/validate-browser.js 38510 32540
 * Requires SESSION_KEY of a staging test user (real mode always needs login).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { writeReport, summarize } from './report.js';
import { resolveSession } from './session.js';

// Category per marker: GEO_BLOCKED failures depend on the runner's egress IP
// (the provider enforces them at content level — invisible to the HTTP stage),
// so they say "re-run from the right market", not "the game is broken".
const ERROR_PATTERNS = [
  { re: /blocked by regulation/i, category: 'GEO_BLOCKED' },   // Lucky Streak, e.g. "(GRV-006) blocked by regulation"
  { re: /\(GRV-\d+\)/, category: 'GEO_BLOCKED' },
  { re: /not available in your (country|region|jurisdiction)/i, category: 'GEO_BLOCKED' },
  { re: /unexpected error has occurred/i, category: 'GAME_ERROR' },
  { re: /quote error id/i, category: 'GAME_ERROR' },
  { re: /Your access is blocked/i, category: 'GAME_ERROR' },
  { re: /game (was )?not found/i, category: 'GAME_ERROR' },
  { re: /session (expired|invalid)/i, category: 'GAME_ERROR' },
];

const gameIds = process.argv.slice(2).map(Number).filter(Boolean);
if (gameIds.length === 0) {
  console.error('Usage: node src/validate-browser.js <gameId> [gameId…]');
  process.exit(1);
}
await resolveSession();
if (!config.sessionKey) {
  console.error('A session is required for browser validation (real mode needs a login) — ' +
    'set SESSION_KEY or TEST_USER/TEST_PASSWORD.');
  process.exit(1);
}

const shotsDir = join(config.resultsDir, 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Authenticate the way the client does: sessionKey in localStorage + cookie.
const baseDomain = new URL(config.siteUrl).hostname.split('.').slice(-2).join('.');
await context.addCookies([{
  name: 'sessionKey', value: config.sessionKey, domain: `.${baseDomain}`, path: '/',
}]);
// The client wraps localStorage values in a {value, timestamp} envelope
// (ynew-client libs/core/src/lib/utils/storage/localStorage.ts)
await context.addInitScript(key => {
  localStorage.setItem('sessionKey', JSON.stringify({
    value: key,
    timestamp: Date.now() + 24 * 60 * 60 * 1000,
  }));
}, config.sessionKey);

async function validateInBrowser(gameId) {
  const page = await context.newPage();
  const failedRequests = [];
  const consoleErrors = [];
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()));

  const started = Date.now();
  const result = { gameId, category: 'UNKNOWN', detail: null };
  try {
    await page.goto(`${config.siteUrl}/game/${gameId}?playForReal=true`, { waitUntil: 'domcontentloaded' });

    // The client silently redirects to /casino when launch-info fails
    await page.waitForTimeout(3000);
    if (!page.url().includes(`/game/${gameId}`)) {
      result.category = 'REDIRECTED_AWAY';
      result.detail = page.url();
    } else {
      const frameEl = await page.waitForSelector('iframe[src*="GameContainer.action"]', { timeout: 15000 });
      const frame = await frameEl.contentFrame();
      // Give the provider time to bootstrap, then inspect the frame tree
      await page.waitForTimeout(12000);
      const texts = [];
      for (const f of page.frames()) texts.push(await f.evaluate(() => document.body?.innerText ?? '').catch(() => ''));
      const allText = texts.join('\n');
      const marker = ERROR_PATTERNS.find(p => p.re.test(allText));
      if (marker) {
        result.category = marker.category;
        result.detail = allText.match(marker.re)?.[0];
      } else {
        const signs = await frame.evaluate(() => ({
          bytes: document.documentElement.outerHTML.length,
          canvases: document.querySelectorAll('canvas').length,
          nestedFrames: document.querySelectorAll('iframe').length,
        })).catch(() => null);
        const alive = signs && (signs.canvases > 0 || signs.nestedFrames > 0 || signs.bytes > 5000);
        result.category = alive ? 'LOADED' : 'SUSPICIOUS_EMPTY';
        result.detail = JSON.stringify(signs);
      }
    }
  } catch (err) {
    result.category = 'BROWSER_ERROR';
    result.detail = String(err).slice(0, 300);
  }
  result.ms = Date.now() - started;
  result.failedRequests = failedRequests.slice(0, 20);
  result.consoleErrors = consoleErrors.slice(0, 20);
  result.screenshot = join(shotsDir, `game-${gameId}.png`);
  await page.screenshot({ path: result.screenshot, fullPage: false }).catch(() => {});
  await page.close();
  console.log(`  ${gameId} → ${result.category}${result.detail ? ` (${result.detail})` : ''}`);
  return result;
}

console.log(`Stage 3 — browser validation of ${gameIds.length} game(s) on ${config.siteUrl}…`);
const results = [];
for (const id of gameIds) results.push(await validateInBrowser(id));
await browser.close();

const base = writeReport({
  ticket: 'TECH-3635', stage: 'browser', site: config.siteUrl,
  startedAt: new Date().toISOString(), summary: summarize(results), results,
});
console.log('\nSummary:', summarize(results));
console.log(`Report: ${base}.json`);
