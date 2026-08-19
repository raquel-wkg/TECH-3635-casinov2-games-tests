import { config } from './config.js';
import { get } from './http.js';

/**
 * Stage 1 — catalog discovery.
 *
 * Pages through GET /api/games-groups/search/brand/:brandId — the union of every
 * list in every non-fallback games-group of the brand+region, i.e. exactly the
 * catalog Casino V2 exposes. Each game already carries pamGameId/pamProvider,
 * so no per-game CMS call is needed to build the launch URL.
 *
 * hideGamesWithoutImage defaults to true on the endpoint — we force false so
 * games without an image are validated too.
 */
export async function fetchCatalog() {
  const games = [];
  let page = 1;
  let totalPages = 1;
  let gameListDataIds = [];
  do {
    const params = new URLSearchParams({
      page: String(page),
      limit: '100',
      locale: config.locale,
      hideGamesWithoutImage: 'false',
    });
    if (config.playerCountry) params.set('playerCountry', config.playerCountry);
    if (config.ipCountry) params.set('ipCountry', config.ipCountry);
    if (config.cmsRegionId != null) params.set('regionId', String(config.cmsRegionId));
    const url = `${config.cmsUrl}/api/games-groups/search/brand/${config.cmsBrandId}?${params}`;
    const res = await get(url);
    if (res.status !== 200 || !res.body?.docs) {
      throw new Error(`Catalog page ${page} failed: HTTP ${res.status} ${res.error ?? ''} (${url})`);
    }
    games.push(...res.body.docs);
    totalPages = res.body.totalPages;
    gameListDataIds = res.body.gameListDataIds ?? gameListDataIds;
    page++;
  } while (page <= totalPages);
  return { games, gameListDataIds };
}

/** Fetches portal brand-config: platform brandId + currency→platform overrides. */
export async function fetchPortalConfig() {
  const url = `${config.mwUrl}/v3/info/brand-config?brandId=${config.portalBrandId}`;
  const res = await get(url);
  if (res.status !== 200 || !res.body?.config) {
    throw new Error(`brand-config failed: HTTP ${res.status} (${url})`);
  }
  return {
    platformBrandId: res.body.config.platformLinks?.brandId,
    gamesCurrencyProductMap: res.body.config.gamesCurrencyProductMap ?? {},
  };
}

/**
 * Builds the Omega launcher URL exactly like the client's prepareGameIframeLink
 * (ynew-client apps/yyy-app/src/app/actions/games.ts).
 * Currency-based platform mapping applies only when a currency is configured.
 */
export function buildLaunchUrl(game, portal, { currency = null } = {}) {
  const mappedPlatform =
    (currency && portal.gamesCurrencyProductMap?.[currency]?.[game.pamProvider]) ||
    game.pamProvider;
  const params = new URLSearchParams({
    platform: mappedPlatform,
    gameId: game.pamGameId,
    playForReal: 'true',
    sessionKey: config.sessionKey,
    brandId: String(portal.platformBrandId),
    // Launch each build as the device it is served to: the catalog sweep runs
    // without the `device` collapse, so mobile builds are in the list too, and
    // launching one with isMobile=false would test a combination no player on
    // the right device produces. (Empirically the current staging failures
    // fail on BOTH values — but this keeps the check faithful per build.)
    isMobile: String(Boolean(game.isMobile)),
  });
  if (game.limitsGroupId) params.set('LimitsGroupId', game.limitsGroupId);
  if (['EVO_OSS', 'SOFTSWISS'].includes(game.provider?.name)) {
    params.set('lang', config.locale);
  }
  return `${config.psUrl}/ps/game/GameContainer.action?${params}`;
}
