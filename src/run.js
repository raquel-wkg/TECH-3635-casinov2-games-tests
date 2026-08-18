/**
 * TECH-3635 PoC — stages 1+2.
 *
 * Stage 1: fetch the full Casino V2 catalog for one brand+region from the CMS.
 * Stage 2: for every game, without a browser:
 *   a) GET /api/games/:id/launch-info  (the one CMS call the client makes)
 *   b) GET the Omega GameContainer.action launcher URL and classify the response
 *
 * Usage:  node src/run.js            (config via .env — see .env.example)
 */
import { config } from './config.js';
import { fetchCatalog, fetchPortalConfig, buildLaunchUrl } from './catalog.js';
import { get, mapLimit } from './http.js';
import { classifyLauncherResponse } from './classify.js';
import { writeReport, summarize } from './report.js';
import { resolveSession, login } from './session.js';
import { resolveTargets } from './targets.js';

async function validateGame(game, portal) {
  const started = Date.now();

  const infoParams = new URLSearchParams({
    brandId: String(config.cmsBrandId),
    locale: config.locale,
  });
  if (config.playerCountry) infoParams.set('playerCountry', config.playerCountry);
  if (config.ipCountry) infoParams.set('ipCountry', config.ipCountry);
  const info = await get(`${config.cmsUrl}/api/games/${game.id}/launch-info?${infoParams}`);

  let launcherStatus = null;
  let classification;
  if (info.status !== 200 || !info.body?.pamGameId) {
    // 404 = disabled/discarded/inactive/blacklisted — the client silently
    // redirects to /casino in this case; here it is a first-class result.
    classification = { category: 'LAUNCH_INFO_FAILED', detail: `HTTP ${info.status}` };
  } else {
    let launch = await get(buildLaunchUrl(info.body, portal), { asJson: false });
    launcherStatus = launch.status;
    classification = classifyLauncherResponse(launch);
    // Session expired mid-run (the client keeps it alive with keepSessionAlive
    // polling; this tool re-logs in instead — needs TEST_USER/TEST_PASSWORD)
    if (classification.category === 'NO_SESSION' && (await relogin())) {
      launch = await get(buildLaunchUrl(info.body, portal), { asJson: false });
      launcherStatus = launch.status;
      classification = classifyLauncherResponse(launch);
    }
  }

  return {
    gameId: game.id,
    title: game.title,
    producer: game.producer?.name,
    pamProvider: game.pamProvider,
    pamGameId: game.pamGameId,
    launchInfoStatus: info.status,
    launcherStatus,
    category: classification.category,
    detail: classification.detail,
    ms: Date.now() - started,
  };
}

// Serialized re-login: one refresh at a time, others wait and reuse it
let reloginPromise = null;
function relogin() {
  reloginPromise ??= login()
    .then(key => {
      if (key) config.sessionKey = key;
      return Boolean(key);
    })
    .catch(err => {
      console.warn(`Re-login failed: ${err.message}`);
      return false;
    })
    .finally(() => setTimeout(() => (reloginPromise = null), 60_000));
  return reloginPromise;
}

const startedAt = new Date().toISOString();
await resolveTargets();
console.log(`Stage 1 — fetching catalog (brand ${config.cmsBrandId}, region ${config.cmsRegionId ?? 'any'})…`);
const [{ games, gameListDataIds }, portal] = await Promise.all([fetchCatalog(), fetchPortalConfig()]);
console.log(`Catalog: ${games.length} games across lists [${gameListDataIds}]`);

await resolveSession();
if (!config.sessionKey) {
  console.warn('⚠ No session — set SESSION_KEY, or TEST_USER/TEST_PASSWORD for auto-login. ' +
    'Launcher checks will classify as NO_SESSION.');
}

const subset = config.maxGames ? games.slice(0, config.maxGames) : games;
console.log(`Stage 2 — validating ${subset.length} games (concurrency ${config.concurrency})…`);
const results = await mapLimit(subset, config.concurrency, g => validateGame(g, portal),
  (done, total) => console.log(`  ${done}/${total}`));

// --browser: automatically re-check the suspects in a real browser and merge
// the verdict + screenshot into the same report. NO_SESSION is excluded (it is
// a problem of the run, not of the games).
const withBrowser = process.argv.includes('--browser');
if (withBrowser) {
  const suspects = results.filter(r => r.category !== 'OK_BOOTSTRAP' && r.category !== 'NO_SESSION');
  const capped = suspects.slice(0, config.maxBrowserGames);
  if (suspects.length > capped.length) {
    console.log(`⚠ ${suspects.length} suspects, browser-checking the first ${capped.length} ` +
      '(raise MAX_BROWSER_GAMES to check more).');
  }
  if (capped.length === 0) {
    console.log('Stage 3 — no suspects to browser-check. 🎉');
  } else if (!config.sessionKey) {
    console.warn('Stage 3 skipped — a session is required for browser validation.');
  } else {
    console.log(`Stage 3 — browser-checking ${capped.length} suspect(s)…`);
    const { validateGamesInBrowser } = await import('./browser.js');
    const browserResults = await validateGamesInBrowser(capped.map(r => r.gameId));
    for (const b of browserResults) {
      const row = results.find(r => r.gameId === b.gameId);
      row.browserCategory = b.category;
      row.browserDetail = b.detail;
      row.screenshot = b.screenshot;
    }
  }
}

const run = {
  ticket: 'TECH-3635',
  startedAt,
  finishedAt: new Date().toISOString(),
  site: config.siteUrl,
  cmsBrandId: config.cmsBrandId,
  cmsRegionId: config.cmsRegionId,
  playerCountry: config.playerCountry,
  ipCountry: config.ipCountry,
  totalGames: games.length,
  validated: subset.length,
  summary: summarize(results),
  results,
};

const base = writeReport(run);
console.log('\nSummary by category:', run.summary);
console.log(`Report: ${base}.json / ${base}.csv`);
