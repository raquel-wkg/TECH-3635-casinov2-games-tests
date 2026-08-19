import { config } from './config.js';
import { get } from './http.js';

/**
 * Resolves the business inputs (OMEGA_BRAND_ID, PORTAL_REGION_ID) into the
 * internal ids the endpoints need, so QA configures what Omega/portal show
 * instead of copying CMS-internal numbers. Explicit
 * CMS_BRAND_ID / CMS_REGION_ID env vars always win.
 */
export async function resolveTargets() {
  // The test targets a brand+region by their business ids — the brand id in
  // Omega/portal and the region id in portal (the CMS ids are per-database
  // autoincrements). An empty PORTAL_REGION_ID means the brand's any-region
  // catalog, same convention as a null region in Payload.
  if (!config.portalBrandId) {
    throw new Error('Set OMEGA_BRAND_ID=<brand id in Omega/portal> (or the advanced CMS_BRAND_ID + CMS_REGION_ID override).');
  }
  if (!config.cmsBrandId) {
    const res = await get(`${config.cmsUrl}/api/brands?where[brand_id][equals]=${config.portalBrandId}&limit=5&depth=0`);
    const doc = (res.body?.docs ?? []).find(d => !d.isDeleted);
    if (!doc) {
      const all = await get(`${config.cmsUrl}/api/brands?limit=100&depth=0`);
      const available = (all.body?.docs ?? []).filter(d => !d.isDeleted)
        .map(d => `${d.brand_id} (${d.name.trim()})`).join(', ');
      throw new Error(`Brand id ${config.portalBrandId} not found on ${config.cmsUrl}. ` +
        `Available (portal id → name): ${available}`);
    }
    config.cmsBrandId = doc.id;
    console.log(`Brand ${config.portalBrandId} "${doc.name.trim()}" → CMS brand id ${config.cmsBrandId}`);
  }

  // Region: by portal region id (PORTAL_REGION_ID). The regions mirror
  // carries the portal `regionId`.
  const portalRegionId = process.env.PORTAL_REGION_ID;
  if (config.cmsRegionId == null && portalRegionId) {
    const res = await get(`${config.cmsUrl}/api/regions?limit=100&depth=0`);
    const regions = (res.body?.docs ?? []).filter(r => !r.isDeleted);
    const match = regions.find(r => Number(r.regionId) === Number(portalRegionId));
    if (!match) {
      const available = regions.map(r => `${r.regionId} (${r.name.trim()})`).join(', ');
      throw new Error(`Region id ${portalRegionId} not found on ${config.cmsUrl}. ` +
        `Available (portal id → name): ${available}`);
    }
    config.cmsRegionId = match.id;
    console.log(`Region "${match.name.trim()}" (portal id ${match.regionId}) → CMS id ${config.cmsRegionId} [${match.countries}]`);
  }
}
