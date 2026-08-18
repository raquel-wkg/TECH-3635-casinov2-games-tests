/**
 * Classifies a launcher (GameContainer.action) HTTP response.
 *
 * Markers verified empirically on staging (2026-08-18, Betjordan):
 * - no/invalid session          → 200 with an Omega "<title>Login" page
 * - broken game (e.g. 38510)    → Omega error page: "An unexpected error has
 *   occurred while processing your request ... quote error id N", or a
 *   "403 Your access is blocked" page on the SOFTSWISS redirect path
 * - working game (e.g. 32540)   → provider bootstrap document
 *
 * Extend MARKERS as new failure modes are discovered — that is the point of
 * running the browser stage on suspects.
 */
const MARKERS = [
  { category: 'NO_SESSION', test: b => /<title>\s*Login/i.test(b) },
  { category: 'OMEGA_ERROR', test: b => /unexpected error has occurred/i.test(b) },
  { category: 'OMEGA_ERROR', test: b => /quote error id/i.test(b) },
  { category: 'ACCESS_BLOCKED', test: b => /Your access is blocked/i.test(b) },
  { category: 'GAME_NOT_FOUND', test: b => /game (was )?not found/i.test(b) },
];

export function classifyLauncherResponse({ status, body, error }) {
  if (status === 0) return { category: 'NETWORK_ERROR', detail: error };
  if (status >= 500) return { category: 'LAUNCHER_5XX', detail: `HTTP ${status}` };
  if (status === 403 || status === 401) return { category: 'ACCESS_BLOCKED', detail: `HTTP ${status}` };
  if (status >= 400) return { category: 'LAUNCHER_4XX', detail: `HTTP ${status}` };
  const text = typeof body === 'string' ? body : '';
  for (const m of MARKERS) {
    if (m.test(text)) {
      const errorId = text.match(/error id ([\d,]+)/i)?.[1];
      return { category: m.category, detail: errorId ? `error id ${errorId}` : null };
    }
  }
  if (text.length < 500) return { category: 'SUSPICIOUS_EMPTY', detail: `${text.length} bytes` };
  // 200 + substantial document + no known error marker: assume provider bootstrap.
  // HTTP 200 alone does NOT prove the game renders — the browser stage covers that.
  return { category: 'OK_BOOTSTRAP', detail: null };
}
