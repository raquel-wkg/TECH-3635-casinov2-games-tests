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
  // One retry with a pause: Omega staging occasionally rejects logins on
  // transient server-side errors (seen: its DB disk filling up), and a second
  // attempt moments later succeeds.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${config.mwUrl}/v3/ps/ips/login?brandId=${config.portalBrandId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(config.timeoutMs),
    }).catch(err => ({ status: 0, json: async () => null, error: String(err) }));
    const json = await res.json().catch(() => null);
    const data = json?.data ?? json;
    if (data?.status === 'SUCCESS' && data.sessionKey) return data.sessionKey;
    const reason = data?.message ?? res.error ?? `HTTP ${res.status}`;
    if (attempt === 1) {
      console.warn(`Login attempt failed (${String(reason).slice(0, 120)}…) — retrying in 5 s.`);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`Login failed for ${user}: ${reason}\n` +
      '(If the message mentions a server/database problem, it is the environment, not your credentials — try again in a few minutes.)');
  }
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
