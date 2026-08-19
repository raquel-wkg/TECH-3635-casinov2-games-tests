import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

// One stamp per process, shared by the report files and the screenshots
// folder, so everything a run produced carries the same date.
export const runStamp = new Date().toISOString().replace(/[:.]/g, '-');

const CSV_COLUMNS = [
  'gameId', 'title', 'producer', 'pamProvider', 'pamGameId',
  'launchInfoStatus', 'launcherStatus', 'category', 'detail',
  'browserCategory', 'browserDetail', 'screenshot', 'ms',
];

export function writeReport(run) {
  mkdirSync(config.resultsDir, { recursive: true });
  const base = join(config.resultsDir, `run-${runStamp}`);

  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2));

  const escape = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = run.results.map(r => CSV_COLUMNS.map(c => escape(r[c])).join(','));
  writeFileSync(`${base}.csv`, [CSV_COLUMNS.join(','), ...rows].join('\n'));

  return base;
}

export function summarize(results) {
  const byCategory = {};
  for (const r of results) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  return byCategory;
}
