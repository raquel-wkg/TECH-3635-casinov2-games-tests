# Casino V2 — Game Catalog Validator

**What this tool does:** it checks, automatically, that every game a brand offers in
Casino V2 can actually be launched — the same thing you do by hand when you open a
game page, press Play and wait to see if the game loads or shows an error. Instead of
clicking through thousands of games, the tool does it for you and gives you a
spreadsheet of which games failed and why.

- Ticket: [TECH-3635](https://app.clickup.com/t/86cb6qzv1)
- How it works internally (for developers): [`docs/technical-proposal.md`](docs/technical-proposal.md)

## What exactly is being tested

When a player opens a game, three things have to work in a row:

1. **The CMS knows the game** — the game appears in the brand's catalog and its
   launch data is complete.
2. **Omega accepts the launch** — the same launcher URL the website builds when you
   press Play responds with the game, not with an error page.
3. **The game really shows on screen** — the game content loads inside the page
   without an error message.

The tool checks **1 and 2 for every game** without opening a browser (fast — about
30 minutes for a 3,500-game catalog), and check **3 with a real browser** for the
games that look broken, taking a screenshot of each as proof.

Nothing ever plays the games: no bets, no clicks inside the game. It only verifies
that they open.

## What you need before starting

- **Node.js 20 or newer** installed (ask IT, or download from nodejs.org).
- A **QA test account** for the brand you want to test — the usual ones from the
  "QA Testing accounts" page in ClickUp. The tool logs in by itself with it.
- Five minutes to fill in a small configuration file (next section).

## Step-by-step

### 1. Get the tool

```bash
git clone git@github.com:raquel-wkg/TECH-3635-casinov2-games-tests.git
cd TECH-3635-casinov2-games-tests
```

### 2. Create your configuration file

Copy the example and open it in any text editor:

```bash
cp .env.example .env
```

The `.env` file is a list of `NAME=value` lines. You need to fill in:

| Setting | What it is | Example (Betjordan staging) |
|---|---|---|
| `SITE_URL` | The website of the brand you're testing | `https://betjordan.stage24.net` |
| `CMS_BRAND_ID` | The brand's number **in the CMS** | `9` |
| `PORTAL_BRAND_ID` | The brand's number **in the portal** | `5` |
| `CMS_REGION_ID` | The region's number, or empty for all | *(empty)* |
| `TEST_USER` / `TEST_PASSWORD` | Your QA test account for that brand | from the ClickUp page |

Don't know the brand/region numbers? That's what the first command is for:

### 3. `node src/list-targets.js` — find the brand and region numbers

This command only **prints a list** — it doesn't test anything. It asks the CMS
"which brands and regions exist here?" and shows their numbers, so you can copy the
right ones into your `.env`:

```
Brands (use "id" as CMS_BRAND_ID, "brand_id" as PORTAL_BRAND_ID):
  id=9  portal brand_id=5  BetJordan
  id=5  portal brand_id=1  YYY
  ...
Regions (use "id" as CMS_REGION_ID ...):
  id=8  GCC  [BH, KW, OM, QA, SA, AE]
  ...
```

You do this once per brand/environment and save the numbers in `.env`.

### 4. `node src/run.js` — run the actual test

This is the real check. It will:

1. Download the **full list of games** the brand offers in Casino V2 (from the CMS).
2. Log in with your test account.
3. For **every game**, ask the CMS for its launch data and then request the same
   Omega launcher URL the website would open — and read the answer: game or error?
4. Write the results to a file.

You'll see progress on screen (`25/125`, `50/125`…) and at the end a summary like:

```
Summary by category: { OK_BOOTSTRAP: 119, OMEGA_ERROR: 6 }
Report: results/run-2026-08-18…json / results/run-2026-08-18….csv
```

That `.csv` file opens in Excel/Google Sheets. **That's your deliverable**: one row
per game with its name, provider and result.

### 5. Reading the results

The `category` column tells you which part failed, in plain terms:

| Category | Meaning | What to do |
|---|---|---|
| `OK_BOOTSTRAP` | The launcher served the game. Good. | Nothing. |
| `OMEGA_ERROR` | Omega answered with its error page ("An unexpected error has occurred… error id N"). The game is broken for players. | Report it — the `detail` column has Omega's error id for the ticket. |
| `LAUNCH_INFO_FAILED` | The CMS refused the launch (game disabled, discarded, inactive in Omega…). Configuration issue. | Check the game in Payload. |
| `NO_SESSION` | The test account's session didn't work — a problem of the *run*, not of the game. | Check the credentials and rerun. |
| `ACCESS_BLOCKED` / `LAUNCHER_4XX/5XX` | The platform refused or failed. | Report with the row's detail. |
| `SUSPICIOUS_EMPTY` | The answer was too small to judge. | Verify in the browser (next step). |

**Tip:** failures that share the same provider usually mean the *provider's* product
is misconfigured in that environment — one issue, not one per game.

### 6. (Optional) `node src/validate-browser.js 38510 32540` — see it with your own eyes

For the games that failed (or any game — the numbers are the game ids from the CSV),
this opens each game page in a real automated browser, exactly like a player, and:

- tells you whether the game **loaded**, showed a **game error**, or was
  **geo-blocked** ("blocked by regulation" — depends on the country you run from);
- saves a **screenshot** of each game in `results/screenshots/` — ready to attach
  to a ticket.

First time only, install the browser runner:

```bash
npm install && npx playwright install chromium
```

## Things worth knowing

- **Country settings**: leave `PLAYER_COUNTRY`/`IP_COUNTRY` empty to test the whole
  catalog (recommended). Fill both to see exactly what a player from one market sees.
- **Geo-blocks in the browser step** depend on the country your machine's internet
  connection appears from — a "blocked by regulation" result may just mean "wrong
  country to test this game from", not a broken game. Use the market's VPN when it
  matters.
- **Keep it gentle**: the default settings check ~2 games per second. Don't raise
  `CONCURRENCY` above 10 without checking with the team — these are real requests to
  Omega.
- **Never commit or share your `.env`** — it contains the test account's password.
  The file is git-ignored on purpose.

## For developers

Architecture, launch-flow documentation, error-marker calibration, scale estimates
and the follow-up plan: [`docs/technical-proposal.md`](docs/technical-proposal.md).
All requests mirror the real client (`launch-info` params, `prepareGameIframeLink`
URL building, localStorage session envelope); if the client changes, mirror it here.
The error classifier is a list in `src/classify.js` (HTTP) and
`src/validate-browser.js` (browser) — extend it whenever QA meets a new error text.
