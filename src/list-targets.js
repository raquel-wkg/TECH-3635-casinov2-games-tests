/**
 * Helper: lists the brands and regions of the target CMS so QA can pick
 * CMS_BRAND_ID / CMS_REGION_ID without guessing ids.
 *
 * Usage:  SITE_URL=https://betjordan.stage24.net node src/list-targets.js
 * (only SITE_URL is really needed; other required vars can be dummies)
 */
import { config } from './config.js';
import { get } from './http.js';

const [brands, regions] = await Promise.all([
  get(`${config.cmsUrl}/api/brands?limit=100&depth=0`),
  get(`${config.cmsUrl}/api/regions?limit=100&depth=0`),
]);

console.log(`CMS: ${config.cmsUrl}\n`);
console.log('Brands (use "id" as CMS_BRAND_ID, "brand_id" as PORTAL_BRAND_ID):');
for (const b of brands.body?.docs ?? []) {
  if (b.isDeleted) continue;
  console.log(`  id=${b.id}  portal brand_id=${b.brand_id}  ${b.name}`);
}
console.log('\nRegions (use "id" as CMS_REGION_ID — the doc id, NOT the regionId field):');
for (const r of regions.body?.docs ?? []) {
  if (r.isDeleted) continue;
  console.log(`  id=${r.id}  ${r.name}  [${r.countries}]`);
}
