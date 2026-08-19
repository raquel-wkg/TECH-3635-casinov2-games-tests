import { config } from './config.js';
import { get } from './http.js';

/**
 * Resolves the portal-facing inputs (BRAND_CONFIG_ID, REGION_ID) into the
 * internal ids the endpoints need, so QA configures what the portal shows
 * instead of copying CMS-internal numbers. Explicit
 * CMS_BRAND_ID / PORTAL_BRAND_ID / CMS_REGION_ID env vars always win.
 */
export async function resolveTargets() {
  const brandConfigId = process.env.BRAND_CONFIG_ID;

  // The portal brand-configuration id — the test's unit is a brand
  // configuration (brand+region). It resolves the portal brand id; the region
  // comes from REGION_ID (the CMS mirror stores no region link), and leaving
  // REGION_ID empty means the brand's any-region catalog — same convention as
  // a null region in Payload.
  if (brandConfigId && (!config.cmsBrandId || !config.portalBrandId)) {
    const res = await get(
      `${config.cmsUrl}/api/brands-configuration?where[brandConfigId][equals]=${encodeURIComponent(brandConfigId)}&limit=5&depth=0`,
    );
    const doc = (res.body?.docs ?? []).find(d => !d.isDeleted);
    if (!doc) {
      const all = await get(`${config.cmsUrl}/api/brands-configuration?limit=100&depth=0`);
      const available = (all.body?.docs ?? []).filter(d => !d.isDeleted)
        .map(d => `${d.brandConfigId} (${d.name})`).join(', ');
      throw new Error(`Brand configuration ${brandConfigId} not found on ${config.cmsUrl}. Available: ${available}`);
    }
    config.portalBrandId ||= Number(doc.brandId);
    console.log(`Brand config ${brandConfigId} "${doc.name}" → portal brand id ${config.portalBrandId}`);
  }

  if (config.portalBrandId && !config.cmsBrandId) {
    const res = await get(`${config.cmsUrl}/api/brands?where[brand_id][equals]=${config.portalBrandId}&limit=5&depth=0`);
    const doc = (res.body?.docs ?? []).find(d => !d.isDeleted);
    if (!doc) throw new Error(`No CMS brand mirrors portal brand id ${config.portalBrandId} on ${config.cmsUrl}.`);
    config.cmsBrandId = doc.id;
    console.log(`Portal brand ${config.portalBrandId} "${doc.name.trim()}" → CMS brand id ${config.cmsBrandId}`);
  }

  if (!config.cmsBrandId || !config.portalBrandId) {
    throw new Error('Set BRAND_CONFIG_ID=<portal config id> ' +
      '(or the advanced CMS_BRAND_ID + PORTAL_BRAND_ID override).');
  }

  // Region: by portal region id (REGION_ID, consistent with BRAND_CONFIG_ID).
  // The regions mirror carries the portal `regionId`.
  const portalRegionId = process.env.REGION_ID;
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
