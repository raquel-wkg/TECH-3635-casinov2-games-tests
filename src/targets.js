import { config } from './config.js';
import { get } from './http.js';

/**
 * Resolves BRAND / REGION names into the internal ids the endpoints need, so
 * QA configures human-readable names instead of copying numbers. Explicit
 * CMS_BRAND_ID / PORTAL_BRAND_ID / CMS_REGION_ID env vars always win.
 */
export async function resolveTargets() {
  const brandName = process.env.BRAND;
  const regionName = process.env.REGION;
  const brandConfigId = process.env.BRAND_CONFIG_ID;

  // Preferred: the portal brand-configuration id — the test's real unit is a
  // brand configuration (brand+region). It resolves the portal brand id; the
  // region still comes from REGION (the CMS mirror stores no region link).
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
    if (!brandName) {
      throw new Error('Set BRAND_CONFIG_ID=<portal config id>, or BRAND=<brand name> (e.g. BRAND=BetJordan), ' +
        'or CMS_BRAND_ID + PORTAL_BRAND_ID.');
    }
    const res = await get(`${config.cmsUrl}/api/brands?limit=100&depth=0`);
    const brands = (res.body?.docs ?? []).filter(b => !b.isDeleted);
    const match = brands.find(b => b.name.trim().toLowerCase() === brandName.trim().toLowerCase());
    if (!match) {
      throw new Error(`Brand "${brandName}" not found on ${config.cmsUrl}. ` +
        `Available: ${brands.map(b => b.name.trim()).join(', ')}`);
    }
    config.cmsBrandId ||= match.id;
    config.portalBrandId ||= match.brand_id;
    console.log(`Brand "${match.name.trim()}" → CMS id ${config.cmsBrandId}, portal id ${config.portalBrandId}`);
  }

  // Region: by portal region id (REGION_ID, consistent with BRAND_CONFIG_ID)
  // or by name (REGION). The regions mirror carries the portal `regionId`.
  const portalRegionId = process.env.REGION_ID;
  if (config.cmsRegionId == null && (portalRegionId || regionName)) {
    const res = await get(`${config.cmsUrl}/api/regions?limit=100&depth=0`);
    const regions = (res.body?.docs ?? []).filter(r => !r.isDeleted);
    const match = portalRegionId
      ? regions.find(r => Number(r.regionId) === Number(portalRegionId))
      : regions.find(r => r.name.trim().toLowerCase() === regionName.trim().toLowerCase());
    if (!match) {
      const available = regions.map(r => `${r.regionId} (${r.name.trim()})`).join(', ');
      throw new Error(`Region ${portalRegionId ? `id ${portalRegionId}` : `"${regionName}"`} not found on ` +
        `${config.cmsUrl}. Available (portal id → name): ${available}`);
    }
    config.cmsRegionId = match.id;
    console.log(`Region "${match.name.trim()}" (portal id ${match.regionId}) → CMS id ${config.cmsRegionId} [${match.countries}]`);
  }
}
