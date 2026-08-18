# game-catalog-validator (TECH-3635 PoC)

Validates that the games Casino V2 exposes for a brand+region can actually be
launched. Three stages: catalog discovery (CMS) → HTTP launch validation (whole
catalog, no browser) → Playwright validation (suspects + samples).

- Ticket: [TECH-3635](https://app.clickup.com/t/86cb6qzv1)
- Full rationale, launch-flow documentation, markers and estimates:
  [`docs/technical-proposal.md`](docs/technical-proposal.md)

## Quick start

```bash
cp .env.example .env         # fill in — see comments; credentials come from the
                             # ClickUp "QA Testing accounts" page, never from git
node src/list-targets.js     # lists CMS brand/region ids to put in .env
node src/run.js              # stages 1+2 → results/run-<ts>.{json,csv}
```

Session: set `TEST_USER`/`TEST_PASSWORD` and the tool logs in by itself (and re-logs
in when the session expires mid-run), or pass a ready `SESSION_KEY`.

Browser stage (real mode requires a session):

```bash
npm install && npx playwright install chromium
node src/validate-browser.js 38510 32540   # game ids; screenshots in results/screenshots/
```

## Result categories

| Category | Failing component |
|---|---|
| `LAUNCH_INFO_FAILED` | CMS/config (disabled, discarded, INACTIVE, blacklisted) |
| `OMEGA_ERROR`, `ACCESS_BLOCKED`, `LAUNCHER_4XX/5XX` | Omega / provider integration |
| `NO_SESSION` | the run's session, not the game — re-login and rerun |
| `SUSPICIOUS_EMPTY` | unknown — send to the browser stage |
| `OK_BOOTSTRAP` | none detected (bootstrap served; rendering not proven) |
| Browser: `GAME_ERROR` / `GEO_BLOCKED` / `LOADED` / `REDIRECTED_AWAY` | game content / provider geo-block on the runner's IP (re-run from the right market) / ok / launch-info failed |

Broken games return **HTTP 200 with an error page** — the classifier reads the body
(`src/classify.js`); extend its marker list as new failure modes appear.

## Notes

- All calls mirror the real client (`launch-info` params, `prepareGameIframeLink`
  URL building, localStorage session envelope). If the client changes, mirror it here.
- Always pass `playerCountry`/`ipCountry`. A game absent for a country can be
  compliance working correctly — never work around the filters.
- Keep concurrency modest (5–10): these are real Omega calls with a real session.
- `results/` and `.env` are gitignored on purpose.
