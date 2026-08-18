import { config } from './config.js';

/**
 * Obtains an Omega sessionKey the same way the client does:
 * POST {mw}/v3/ps/ips/login?brandId=<portal brand id>.
 *
 * Long sweeps note: the real client keeps the session alive by polling
 * keepSessionAlive; this tool instead re-logs in when the session drops
 * (a NO_SESSION wave mid-run). Credentials come from env — the ClickUp
 * "QA Testing accounts" page — never from the repo.
 */
export async function login() {
  const user = process.env.TEST_USER;
  const pass = process.env.TEST_PASSWORD;
  if (!user || !pass) return null;
  const res = await fetch(`${config.mwUrl}/v3/ps/ips/login?brandId=${config.portalBrandId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const json = await res.json().catch(() => null);
  const data = json?.data ?? json;
  if (data?.status !== 'SUCCESS' || !data.sessionKey) {
    throw new Error(`Login failed for ${user}: ${data?.message ?? `HTTP ${res.status}`}`);
  }
  return data.sessionKey;
}

/** Resolves the session: explicit SESSION_KEY wins, else TEST_USER/TEST_PASSWORD login. */
export async function resolveSession() {
  if (config.sessionKey) return config.sessionKey;
  const key = await login();
  if (key) {
    config.sessionKey = key;
    console.log('Logged in via TEST_USER — sessionKey obtained.');
  }
  return config.sessionKey;
}
