# TECH-3635 — Automated game catalog validation for Casino V2

**Status:** spike result — proposal + working PoC (`tools/game-catalog-validator/`)
**Date:** 2026-08-18

## TL;DR

The full launch flow can be validated **without a browser** for the entire catalog: the
CMS already exposes the exact Casino V2 catalog per brand+region in one paginated
endpoint, each entry carries everything needed to build the Omega launcher URL, and the
launcher's HTTP response is reliably classifiable (verified empirically: broken games
return **HTTP 200 with an identifiable Omega error page**, working games return the
provider bootstrap). A browser (Playwright) layer is only needed to (a) confirm the
"bootstrap ≠ renders" tail and (b) investigate suspects with screenshots.

The PoC ran against Betjordan staging: **125 games validated in ~65 s, 6 broken games
found**, including the known-broken calibration game — with the known-good one passing.
The Playwright stage also calibrates: it reads the Omega error text *inside* the
cross-origin iframe for the broken game (`GAME_ERROR`) and detects the nested provider
frame for the working one (`LOADED`), with screenshots as artifacts.

## 1. The launch flow (documented)

```
New Client                    CMS (Payload)              Omega (PS)
/game/:id?playForReal=true
  └─ requires sessionKey ──►  GET /api/games/:id/launch-info
                              (404 = disabled/discarded/
                               inactive/blacklisted)
  └─ builds iframe URL ─────────────────────────────►  GET /ps/game/GameContainer.action
       platform=<pamProvider> gameId=<pamGameId>          ├─ 302 → provider-specific action
       playForReal=true sessionKey=… brandId=<platform>   └─ 200: provider bootstrap page
  └─ mounts <iframe> — game loads (or fails) inside it, cross-origin
```

Key facts, verified in code:

- The client makes **one** CMS call (`launch-info`); the launch itself is the player's
  browser hitting Omega directly (`prepareGameIframeLink`,
  `ynew-client/apps/yyy-app/src/app/actions/games.ts:146-186`). No backend of ours is in
  the loop.
- **The middleware is NOT in the launch path** (a common misreading of DevTools).
  Captured traffic during a real game load: the iframe makes 3 requests to `ps.*`
  (Omega — it answers with `omega-request-id` and a Java `JSESSIONID`, so it is Omega's
  platform server, not our NestJS middleware) and then ~255 requests straight to the
  provider's own CDN (Evolution: `evo-test.com`, `casinomodule.com`, `egcdn.com`) —
  and **zero** to `back.*`. The `back.*/v3/ps/ips/*` calls visible during a launch
  (`getPlayerInfo`, `getBalanceSimple`, `keepSessionAlive`) are the SPA maintaining its
  session in parallel; they share the "ps" prefix with the launcher host, hence the
  confusion. Consequence: there is no first-party hook to instrument launches — they
  can only be validated from outside, as this tool does.
- On `launch-info` failure the client **silently redirects to `/casino`** — the player
  sees nothing. On in-game failure, Omega renders the error **inside the cross-origin
  iframe**; the client cannot see it (no `postMessage` listener, no load event).
- Demo mode is **out of scope**: disabled in the client and not supported/wanted for
  every game. All validation uses a real staging test-user session (`playForReal=true`).
- **No stage ever plays the game.** The HTTP sweep only fetches the launcher bootstrap
  (the provider session doesn't even start); the browser stage only observes whether
  the frame renders or shows an error. Clicking "play" per game is neither needed nor
  feasible — every game's UI is different.
- **Scope comes free**: the serving pipeline already filters `isEnabled`, `isDiscarded`
  and `pamStatus='ACTIVE'` (game and producer) in SQL, so the swept catalog is exactly
  "enabled + ACTIVE in Omega, in use by the brand" with no extra filtering.

## 2. What "the game works" means

Three verifiable levels, each strictly stronger:

| Level | Check | Catches | Cost |
|---|---|---|---|
| L1 — servable | game appears in the brand+region catalog union and `launch-info` returns 200 with coherent `pamGameId`/`pamProvider` | CMS/config problems (disabled, discarded, INACTIVE, blacklisted, no producer) | ~1 req/game |
| L2 — launchable | `GET GameContainer.action` (real session) classified as provider bootstrap, not an error page | Omega/provider integration failures — **this is where the real breakage shows up** | ~1 req/game |
| L3 — renders | Playwright: game page → iframe → frame content shows life (canvas/nested frames/bootstrap size) and no error marker | provider content failures that still serve a bootstrap | ~15-20 s/game |

### Where failures actually live (measured)

Two-brand comparison on staging (Betjordan 125 games, YYY 124 games, 124 in common):

- **Every broken game had perfect Payload data** (`launch-info` 200, coherent
  `pamGameId`/`pamProvider`) — consistent with those fields being synced nightly from
  Omega and read-only in Payload. The failures live in Omega/provider game config.
- **Failures cluster by provider only partially**: EVO_CAS failed 3 of 3 (clustering
  real), but SOFTSWISS failed 2 of 4 — a per-provider sample can pick the working ones
  and miss the per-game tail. Full per-game HTTP sweep + per-provider browser sample is
  the combination that covers both.
- **The 124 common games behaved identically on both brands**; the brand difference on
  staging was in the *catalog* (38510 only served — and broken — on Betjordan). Per-brand
  sweeps remain necessary (Omega config is per brand, e.g. a game's `includedBrands`),
  but no brand-divergent launch result has been observed yet.

Empirical classification markers (staging, 2026-08-18):

| Launcher response | Meaning |
|---|---|
| 200, provider bootstrap document | OK (L2 pass) |
| 200, "An unexpected error has occurred … quote error id N" | broken game (Omega error, id extractable) |
| 200, `<title>Login` page | session missing/expired — infra problem of the run, not the game |
| 403 / "Your access is blocked" | blocked at the platform (only reproducible without session on the SOFTSWISS path) |
| tiny/empty body | suspicious — send to L3 |

**HTTP 200 alone proves nothing** — every broken game found returned 200. Classification
must read the body. Conversely `OK_BOOTSTRAP` at L2 is a *very strong* signal but not
proof of rendering; that residual risk is what L3 sampling is for.

**Evaluated and discarded: `openGameSession` as a validation signal.** Omega's docs
describe `POST /ps/ips/openGameSession` (productCode + gameId → launchToken) as the
pre-launch step. Tested via the middleware (`back.*/v3/ps/ips/openGameSession`,
multipart): it returns `SUCCESS` + a launchToken **for broken games too** — it
validates the player session, not the game's provider config. The GameContainer body
classification remains the necessary check.

**Finding: the staging EVO_CAS failures are an environment/aggregator mismatch, not a
flow gap.** Omega's docs mention a dedicated live-dealer flow (`getLiveDealerTables` →
`gameContainerLink`), and the client has none — every game launches through the generic
GameContainer URL. Initially that looked like the reason the three staging EVO_CAS live
games fail (a real-browser check confirms a player sees the error on the Casino V2 game
page). But pre-prod disproves it: live games work through the generic flow there (e.g.
game 30, Blackjack Prestige, LUCKY_STREAK), and **all 135 Evolution games in the
BetJordan pre-prod catalog are served as `pamProvider=LUCKY_STREAK`** — Evolution live
is aggregated through Lucky Streak in pre-prod/production, while staging serves those
titles as direct `EVO_CAS`, which fails there. Lesson for the sweep, twice over:
staging results don't transfer (different Omega products per environment — pre-release
validation must run against the pre-prod/production pair), and failures that cluster by
`pamProvider` should be read as *platform/product provisioning* issues before being
filed as per-game bugs.

## 3. Proposed architecture

Four stages, exactly as the ticket sketched — all four exist in the PoC:

1. **Catalog discovery** — `GET /api/games-groups/search/brand/:brandId?regionId=…`
   (union of every list in every non-fallback group = the Casino V2 catalog; filters are
   optional, pass `hideGamesWithoutImage=false`; page `limit` ≤ 100). Every entry already
   includes `pamGameId`, `pamProvider`, `limitsGroupId` — no per-game CMS call needed for
   URL building.
2. **HTTP validation (whole catalog)** — per game: `launch-info` + launcher GET +
   body classification. Concurrency-capped worker pool; one retry on 429/5xx/network.
3. **Browser validation (suspects + sample)** — Playwright over: everything not
   `OK_BOOTSTRAP`, plus a rotating random sample of passes. Screenshot, failed network
   requests, console errors captured per game.
4. **Result collection** — JSON + CSV per run: game id/title/producer/provider,
   both statuses, category, error id, timing. Categories map 1:1 to the failing
   component: `LAUNCH_INFO_FAILED` → CMS/config · `OMEGA_ERROR`/`ACCESS_BLOCKED` →
   Omega/provider · `GAME_ERROR`/`SUSPICIOUS_EMPTY` (browser) → game content.

### Measured throughput and estimates

125 games, concurrency 5, staging: **~65 s** (~1.9 games/s, 2 sequential HTTP calls per
game). Real target size: the BetJordan **pre-prod** catalog is **3,641 games** → ~32 min
at concurrency 5. Linear projection, HTTP layer:

| Catalog | conc. 5 | conc. 10 | conc. 20 |
|---|---|---|---|
| 10k | ~1.5 h | ~45 min | ~25 min |
| 20k | ~3 h | ~1.5 h | ~45 min |
| 40k | ~6 h | ~3 h | ~1.5 h |

Browser layer at ~18 s/game with 6 workers: ~200 games/h — viable for suspects and
samples (hundreds), never for the full catalog. That is the point of the funnel: the
HTTP layer decides *which* games earn a browser.

Concurrency caution: these are real Omega calls with a real session. Start at 5–10;
Omega's documented AMS limit is 60 req/min for the sync API — the PS launcher limit is
unknown, and provider back-ends sit behind it. Confirm with the account manager before a
full production-scale run.

## 4. Pre-production QA validation (use case 1)

Run the PoC per **brand configuration** from a laptop or CI job against **staging**:

1. Configure with portal ids: `BRAND_CONFIG_ID=<portal config id>` +
   `REGION_ID=<portal region id>` (empty = any-region, like a null region in
   Payload) — the tool resolves the internal ids itself; a wrong value answers
   with the available list.
2. `node src/run.js` with the brand/region config → CSV of failures by category. The
   tool logs in by itself (`TEST_USER`/`TEST_PASSWORD` from the ClickUp "QA Testing
   accounts" page) and re-logs in if the session expires mid-run.
3. `node src/validate-browser.js <suspect ids>` → screenshots + diagnostics for tickets.

QA reviews the failure CSV instead of clicking through games; each row already says
which component failed.

### The geography matrix — sweep per brand configuration, not per country

Testing every brand × country combination is neither feasible nor needed. A brand
serves through **configurations**, each tied to a region (a group of countries) — and
the CMS catalog is already resolved per brand+region. The tool has two modes:

- **Full-catalog mode (default for validation)** — omit `playerCountry`/`ipCountry`.
  Verified in the CMS code (`gameListData/endpoints/helpers.ts:154`): the game and
  producer blacklists apply only when at least one country is passed, so with neither,
  the sweep covers the **entire curated catalog** of the brand+region — the superset
  any player could see. Every curated game gets its launch validated exactly once.
- **Market mode** — pass both countries to reproduce exactly what one market sees
  (fidelity checks, counts against the real lobby).
- **Country differences are then data, not launches**: which games each country loses
  to a blacklist is stored in Payload and verifiable as a data check; provider-side
  geo-blocks are the browser stage's `GEO_BLOCKED` category.
- A game legitimately absent for a country is compliance working, not breakage — never
  ask for public unfiltered variants beyond what the endpoint already does.

> Resolved 2026-08-18: the endpoint deliberately stays **fail-open on missing
> countries** (trusted-caller design — player-facing callers must always send both;
> the no-countries form is for internal tooling like this validator).
> `docs/domain/brands-markets.md` now documents this explicitly (updated in this
> branch by the doc's author).

**Provider geo-blocking: confirmed content-level, browser-only** (pre-prod, game 47950
"Grand", Lucky Streak): the launcher HTTP response is a clean bootstrap — the block
appears when the provider's content loads in the iframe, as "Ooops!! (GRV-006) blocked
by regulation", enforced against the **runner's egress IP**. Consequences:

- The HTTP sweep **cannot see** provider geo-blocks — they are exclusively a browser-
  stage category, now classified as `GEO_BLOCKED` (distinct from `GAME_ERROR`: it means
  "re-run from the right market", not "the game is broken").
- Browser samples must run with market-matched egress (VPN, as QA already does for
  y-win) or geo-blocks will pollute results as false failures.
- This also caught a classifier lesson: an unknown error text scores as `LOADED`
  (frame has content). The marker list grows by calibration — screenshots exist
  precisely to audit `LOADED` verdicts — so feed every new provider error QA sees back
  into `ERROR_PATTERNS`.

Remaining question for Omega/providers: the full inventory of provider error codes
(like Lucky Streak's `GRV-*`) per aggregator, to classify without guessing.

## 5. Recurring health validation (use case 2)

Same pipeline, scheduled. Recommended shape (follow-up tickets, not built in the spike):

- **Where:** a Payload job in `yyy-payload-cms` for the HTTP layer — the jobs/queue
  infra, Omega rate-limit pattern and scheduling all exist (`src/jobs/tasks/syncGames/`
  is the model; use a **new queue**, `syncGamesQueue`'s workflow runs with
  `supersedes: true` and would kill concurrent runs). Results in a new collection
  (`game-validation-results`) → visible in the admin UI, queryable, diffable.
- **Browser layer:** scheduled CI (GitHub Actions) running the Playwright script over
  suspects from the last HTTP run + a rotating sample.
- **Strategy:** prioritise newly synced/changed games nightly; full catalog weekly;
  re-test failures with backoff before alerting (transient provider errors exist).
  Alert = a game that passed run N-1 and fails run N (category change, not raw failure).
- **Session:** a dedicated Omega service/test account per environment; the job logs in
  at start (session expires in ~1 day). Needs agreement on which account — and whether
  running against **production** is acceptable at all (real logins, real launcher hits,
  provider traffic, production metrics). Recommendation: staging always; production only
  the HTTP layer, low concurrency, off-peak, after account-manager sign-off.

## 6. Risks and limitations

- **`OK_BOOTSTRAP` is not "renders"** — the browser sample quantifies the gap; markers
  grow as new failure modes are found (the classifier is a list, `src/classify.js`).
- **Provider rate limits are unknown** — external dependency; confirm before scaling.
- **Real-money sessions**: launching `playForReal=true` opens real game sessions for the
  test user. No bets are placed (nothing interacts with the game), but providers see
  launches; regulatory/financial side effects should be confirmed per provider.
- **Session expiry** mid-run: the real client keeps the Omega session alive with
  `keepSessionAlive` polling, which the sweep doesn't do. The tool re-logs in
  automatically when it sees `NO_SESSION` (needs `TEST_USER`/`TEST_PASSWORD`).
- **Staging ≠ production catalog** (125 vs tens of thousands; different Omega instances,
  ~4.6k prod games have no producer and are excluded from serving). Pre-prod validation
  of the real catalog must run against the pre-prod/production CMS+Omega pair.
- **Currency→platform mapping** (`gamesCurrencyProductMap`) is applied like the client
  does, but the run uses one currency; a game broken only under a specific currency
  mapping needs a per-currency run.

## 7. Acceptance criteria → where answered

| AC | Answer |
|---|---|
| Launch flow documented | §1 |
| Definition of "works" | §2 (L1/L2/L3) |
| Backend-only options | §2-3, PoC stages 1-2 (working) |
| Browser/E2E options | §2-3, PoC stage 3 (Playwright script, working) |
| Playwright PoC | `tools/game-catalog-validator/src/validate-browser.js` |
| Large-catalog strategy | §3 funnel + concurrency table |
| Concurrency/batching/retries/timeouts | §3, `src/http.js` (timeout, retry, pool) |
| Failure collection/reporting | §3 stage 4, JSON+CSV per run |
| Recurring feasibility | §5 — yes; Payload job + scheduled CI |
| Provider/environment/production risks | §6 |
| Recommended approach + follow-ups | §8 |

## 8. Recommendation and follow-up tickets

Adopt the funnel (HTTP for everything, browser for suspects+sample). Follow-ups:

1. **Productise the QA runner** — config per brand/region/env, auto-login, HTML report
   (small; the PoC is 90% of it).
2. **Recurring HTTP validation as a Payload job** + `game-validation-results`
   collection + admin visibility. Includes the new-queue and scheduling decisions.
3. **Browser layer in the existing `@games` Playwright suite** (separate repo, outside
   this workspace — it already handles popups, game-load detection and launcher error
   dialogs): port this PoC's session injection (localStorage envelope + cookie) and
   marker list there instead of maintaining a second browser harness, and schedule the
   suspects+per-provider sample run in CI, publishing artifacts.
4. **Alerting** on pass→fail transitions (channel TBD).
5. **Ops/clearances**: dedicated validation account per env; account-manager
   confirmation of provider rate limits, production-run policy, and how providers
   report country-denied access (the geo question from §4).
6. **Decide catalog scope**: served-per-brand only (this proposal's default — launch
   context is per brand anyway), or additionally an *editorial pre-validation* over all
   `game-list-data` lists regardless of groups, to catch broken games before they are
   attached to a page. The latter needs no new CMS endpoint (lists are enumerable via
   REST and deduped in the tool) — but keep it away from public unfiltered endpoints
   (compliance).
