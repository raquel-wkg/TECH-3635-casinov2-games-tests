/**
 * CLI for the browser stage on specific games — see src/browser.js.
 *
 * Usage:  npm install && npx playwright install chromium
 *         node src/validate-browser.js 38510 32540
 * Requires a session (real mode needs a login): TEST_USER/TEST_PASSWORD or SESSION_KEY.
 */
import { config } from './config.js';
import { writeReport, summarize } from './report.js';
import { resolveSession } from './session.js';
import { validateGamesInBrowser } from './browser.js';

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

console.log(`Browser validation of ${gameIds.length} game(s) on ${config.siteUrl}…`);
const results = await validateGamesInBrowser(gameIds);

const base = writeReport({
  ticket: 'TECH-3635', stage: 'browser', site: config.siteUrl,
  startedAt: new Date().toISOString(), summary: summarize(results), results,
});
console.log('\nSummary:', summarize(results));
console.log(`Report: ${base}.json`);
