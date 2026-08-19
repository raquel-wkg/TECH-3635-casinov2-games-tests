import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader — no dependency needed for a PoC
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

const siteUrl = new URL(required('SITE_URL'));
// Same rule as the client's domainWithoutPrefix(): last two hostname labels
const baseDomain = siteUrl.hostname.split('.').slice(-2).join('.');
const derive = prefix => `https://${prefix}.${baseDomain}`;

export const config = {
  root,
  siteUrl: siteUrl.origin,
  cmsUrl: process.env.CMS_URL || derive('yweave'),
  psUrl: process.env.PS_URL || derive('ps'),
  mwUrl: process.env.MW_URL || derive('back'),
  // Brand/region: QA sets BRAND_CONFIG_ID + REGION_ID (portal ids) — or
  // BRAND=<name> — and the internal ids are resolved automatically
  // (src/targets.js). Explicit CMS ids still win.
  cmsBrandId: process.env.CMS_BRAND_ID ? Number(process.env.CMS_BRAND_ID) : null,
  cmsRegionId: process.env.CMS_REGION_ID ? Number(process.env.CMS_REGION_ID) : null,
  portalBrandId: process.env.PORTAL_BRAND_ID ? Number(process.env.PORTAL_BRAND_ID) : null,
  // Optional ON PURPOSE: with neither country set, the CMS omits the game and
  // producer blacklist filters (verified: helpers.ts applies them only when
  // countries.length > 0), so the sweep covers the FULL curated catalog of the
  // brand+region — the superset any player could see. Set them to reproduce
  // one market's exact view instead.
  playerCountry: process.env.PLAYER_COUNTRY || null,
  ipCountry: process.env.IP_COUNTRY || null,
  locale: process.env.LOCALE || 'en',
  sessionKey: process.env.SESSION_KEY || '',
  concurrency: Number(process.env.CONCURRENCY || 5),
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  maxGames: process.env.MAX_GAMES ? Number(process.env.MAX_GAMES) : null,
  // Cap for the automatic browser pass over suspects (--browser): at ~20 s per
  // game it keeps the worst case bounded; raise it deliberately when needed.
  maxBrowserGames: Number(process.env.MAX_BROWSER_GAMES || 25),
  resultsDir: join(root, 'results'),
};
