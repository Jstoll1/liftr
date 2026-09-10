# Liftr AI Worker

Small Cloudflare Worker that holds your OpenAI API key server-side and picks
today's exercises for a Liftr session — never exposes the key to the browser.

The app (`app.js`) already knows how to call this. Until you deploy it and
fill in `AI_ENDPOINT`, the app just uses its built-in local logic — nothing
breaks in the meantime.

## 1. Get an OpenAI API key

1. Go to https://platform.openai.com/api-keys and sign in (or create an account).
2. Create a new secret key and copy it — you won't be able to see it again.
3. Add billing at https://platform.openai.com/settings/organization/billing
   if you haven't already (this uses `gpt-4o-mini`, which is very cheap —
   a session recommendation costs a small fraction of a cent).

## 2. Deploy the Worker

You don't need to install anything globally — `npx` handles it.

```sh
cd worker
npx wrangler login          # opens a browser to authorize Cloudflare
npx wrangler secret put OPENAI_API_KEY   # paste your key when prompted
npx wrangler deploy
```

`wrangler deploy` prints a URL that looks like:

```
https://liftr-ai.<your-subdomain>.workers.dev
```

That's your `AI_ENDPOINT`.

## 3. Wire it into the app

Open `app.js` at the repo root and set:

```js
const AI_ENDPOINT = "https://liftr-ai.<your-subdomain>.workers.dev";
```

Commit and push — the app will now call the Worker for every recommended or
alternative workout pick (custom-built sessions skip it since you've already
hand-picked the exercises). If the call ever fails or times out, it silently
falls back to the local logic, so it's safe either way.

## 4. Double-check CORS

`wrangler.toml` sets `ALLOWED_ORIGIN` to `https://jstoll1.github.io`. If your
site is served from a different origin, update that value before deploying,
or the browser will block the request.

## What it does

The Worker receives the athlete's goal, the chosen workout type, today's
check-in (time/energy/partner), and the *exact* list of exercises it's
allowed to pick from (the base list plus the optional finisher and
partner-bonus move). It asks OpenAI for a JSON-schema-constrained response —
the model can only choose exercise names that exist in that list, so it
can never invent or hallucinate one. It also writes one short sentence
explaining its picks, which shows up in the app as the 🤖 note under the
exercise list.

## Cost

`gpt-4o-mini` is the default model — a single request costs a small
fraction of a cent. Two people logging one session a day costs pennies a
month. You can change the model via the `OPENAI_MODEL` var in
`wrangler.toml` if you want to use something else.

## 5. Cross-device sync (Cloudflare KV)

This same Worker also backs cross-device sync, so if Jake or Jessica use
Liftr on more than one phone, their history/notes/settings (and cheers)
follow them instead of staying stuck on one device. It's optional — the
app still works purely on localStorage if you skip this — but it's free
on Cloudflare's free tier for two people's usage.

```sh
cd worker
npx wrangler kv namespace create LIFTR_KV
```

That prints something like:

```
[[kv_namespaces]]
binding = "LIFTR_KV"
id = "abcd1234..."
```

Copy the `id` value into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in the `[[kv_namespaces]]` block that's
already there. Then redeploy:

```sh
npx wrangler deploy
```

Nothing else to configure — the app already calls `/kv` and `/cheers` on
this same Worker URL. It pulls once when someone taps into their profile
on the welcome screen, and pushes after finishing a workout, saving a
check-in note, updating settings, or sending a cheer. If the Worker or
network is unreachable, it fails silently and the app keeps working off
whatever's already stored locally.

Free tier limits are generous for two people (100k reads/day, 1,000
writes/day) — comfortably enough since syncing only happens at those
checkpoints, not on every tap while working out.

## 6. Brochiefs pick'em sync (same Worker, `/picks` and `/results`)

The pick'em app at the repo root (`index.html`/`app.js`) also uses this
Worker so everyone's picks and a live scoreboard/rankings show up on one
shared page instead of being stuck on each person's own device.

Nothing extra to deploy — `/picks` and `/results` are routed in the same
`worker/src/index.js` and use the same `LIFTR_KV` namespace as above (keyed
`picks:<manager>` and `result:<gameId>`, so nothing collides with the
`liftr:<user>` keys the workout app uses).

Set the pick'em app's Worker URL in `app.js` at the repo root:

```js
const WORKER_URL = "https://liftr-ai.<your-subdomain>.workers.dev";
```

Left blank, the pick'em app still works fully on localStorage — it just
can't show anyone else's picks. `/results` has no auth (same small trusted
group as the rest of this app); anyone can record which team covered once
a game ends, and the scoreboard uses that to compute live rankings.

## 7. `/history-ask` — League history Q&A

`POST /history-ask` with `{ "question": "..." }` returns `{ "answer": "..." }`.
The model only sees the archive dataset in `src/history-data.js` (a mirror of
the data in the root `history.js`; regenerate it when that file changes) and
is instructed to refuse anything outside BroChiefs league history. Uses the
existing `OPENAI_API_KEY` secret and `OPENAI_MODEL_ARCHIVE`, falling back to
`OPENAI_MODEL_PLAN` (`gpt-4o`).
Rate limited to 40 questions per IP per hour via `LIFTR_KV`. The model does
not see the whole archive: `selectContext()` in `src/index.js` reads the
question for owner names and nicknames, team names, seasons and topic words,
then sends only the matching tables (2k to 12k tokens instead of 40k+). Requests must
carry an Origin on the `ALLOWED_ORIGIN` list, and obvious prompt-injection
phrasing is refused without a model call.

Every question and answer is kept in KV for seven days. To review them, set a
secret once:

    npx wrangler secret put ARCHIVE_LOG_KEY

then open `https://liftr-ai.jhs797.workers.dev/history-log?key=<that value>`
on any device. Without the secret the endpoint returns 404.

Every pick change is logged for 30 days. `/picks-log?key=<ARCHIVE_LOG_KEY>` lists them newest first, marks any change made after that game kicked off, and flags any current pick stamped after kickoff. An admin repair replaces a manager's stored picks outright: `POST /picks?key=<ARCHIVE_LOG_KEY>` with `{"manager","state"}`.

### Weekly performance log

The board is computed live from ESPN, so a week that has finished leaves no
record of itself — once ESPN's scoreboard moves on it cannot be rebuilt. Each
week is therefore **sealed** into `week-summary:w<N>`: every owner's points,
hits, misses, picks made, tiebreaker guess and distance, their place, and who
won. `POST /season` seals on every call, so a week is partial while it runs
and final once its last game is in; the app posts the finals from whichever
phone is on the scoreboard when that happens, and remembers it did so.

- `GET /weeks` → `{weeks, summaries, trophies}`, public. `trophies` is the
  count of weeks won per owner, which is what the leaderboard draws beside
  each name
- `POST /weeks?key=<ARCHIVE_LOG_KEY>` re-seals every week, or one with
  `&week=N`. Safe to repeat: a sealed week keeps its original date and a
  trophy is never counted twice

A week is only won once every game is final, and a week nobody scored in has
no winner. Ties that the tiebreaker does not split share the win, and each of
those owners gets a trophy. The scoring here mirrors `app.js` exactly — ATS
pays 2, favourite straight up 1, underdog straight up 3, a push pays nobody —
so the sealed standings match what the board showed.

### Owner logins

Each owner claims their own name once with a code they choose, and every pick
they post afterwards carries a token — `base64url({m, exp})` signed with
`AUTH_SECRET` — so the Worker can tell a real submission from someone typing
another owner's name. Reading the board, the archive and trivia needs nothing.

    npx wrangler secret put AUTH_SECRET     # any long random string

`AUTH_MODE` in `wrangler.toml` decides how live it is, and it ships **off**:

| mode | `POST /picks` |
| --- | --- |
| `off` | tokens ignored; picks save exactly as they always have |
| `soft` | saves without a token still go through, and the picks log marks them "not signed in" |
| `on` | a token matching the body's owner is required; the admin key still overrides |

- `GET /auth` → `{mode, claimed:[names]}`, no secrets
- `POST /auth {action:"claim", manager, code}` → sets the first code for an
  unclaimed name (6 characters or more) and returns a token; 409 if taken
- `POST /auth {action:"login", manager, code}` → token, or 401. Eight wrong
  tries per owner in ten minutes and it answers 429 until the window passes
- `POST /auth?key=<ARCHIVE_LOG_KEY> {action:"reset", manager}` → frees a name
  to be claimed again. Codes are never recoverable, only reset

Codes are stored as `SHA-256(salt + code)` under `auth:<owner>`; the attempt
limit, not the hash, is what makes a short owner-chosen code impractical to
guess. The slate editor lists who has claimed what and has the reset button.

**Login log.** Every claim, sign-in, failure, lockout and reset is kept for a
year under `auth-log:`, readable at `/auth-log?key=<ARCHIVE_LOG_KEY>` (404
without it) and linked from the editor. Each event records:

| field | source |
| --- | --- |
| `ipShort` | `CF-Connecting-IP` truncated to /24 (v4) or /48 (v6) |
| `ipHash` | salted hash of the full address — exact match without storing it |
| `country` `city` `region` `asn` `asOrg` `colo` `tz` | `request.cf` |
| `browser` `os` `device` | parsed from `User-Agent`, coarsely |
| `lang` | `Accept-Language` |
| `deviceId` | random id the app keeps in `localStorage` — no cookie, nothing personal |
| `clientTz` `screen` | sent by the app, to tell two similar devices apart |

No single field means much on its own, so each owner keeps a short list of the
devices that have signed in as them (`auth-devices:<owner>`, last 12) and the
log flags what is new. The page leads with what deserves a look: one device
that has signed in as two different owners, three or more failed codes for an
owner, sign-ins from a device that owner has not used, and every claim. A
failed attempt never adds a device to the known list.

Note that `request.cf` is a fixed stub under `wrangler dev`, so city and ASN
only mean something in production.

To try it while the mode is `off`, open the app with `?auth=1`.

Matchup data (head-to-head, weekly scores, playoff games, bench points) comes
from `src/matchup-data.js`, built from `data/espn-history.json`, which is
exported from ESPN with `scripts/export-espn-history.mjs` (see the header of
that script for the cookies it needs). The export also pulls every draft
(first overall pick by year, each owner's round-one slot, auto-drafted picks),
so the archive can answer draft questions once you re-export:

```
cd ~/liftr
ESPN_LEAGUE_ID=878153 LAST_SEASON=2026 ESPN_S2='...' SWID='{...}' node scripts/export-espn-history.mjs
python3 scripts/build-matchup-data.py
git add data/espn-history.json worker/src/matchup-data.js && git commit -m "Refresh ESPN export" && git push
cd worker && npx wrangler deploy
```



## Weeks and the slate editor

The pick'em is season-long. Each week's ten games live in KV as `games:w<N>`,
and `weeks` holds `{current, list}`. Picks are stored per week. Week 1 was
played before the app understood weeks, so its picks stay at `picks:<manager>`
and every later week is namespaced `picks:w<N>:<manager>`; the change is
additive so a scored week cannot be disturbed.

Routes:

- `GET /games` current week's slate, `?week=N` for one week, `?all=1` for every stored week
- `POST /games?key=<ARCHIVE_LOG_KEY>` save a week. Validates every field, requires exactly one tiebreaker game, and refuses a week that has already kicked off unless `&force=1`
- `GET /picks?week=N`, and `POST /picks` with `week` in the body
- `GET /season` every week's slate, picks and stored finals, for season standings
- `POST /season` a week's final scores, ignored for games that have not started

### Two administrators

Three taps on the BroChiefs wordmark asks for a key, `GET /admin-check?key=…`
says which administrator it belongs to, and only that surface opens. There is
no admin page and no link anywhere, and neither script is fetched until a key
checks out, so nothing about either ships to the league.

| key | role | opens | can also |
| --- | --- | --- | --- |
| `SLATE_KEY` | picks the games | the slate editor | nothing else — no logs, no owner codes, no pick repairs |
| `ARCHIVE_LOG_KEY` | the app owner | the app console | the logs, owner resets, the login mode, pick repairs, and the editor |

The console is tabbed: **Pick changes** (the 30-day log, marking anything
changed after kickoff or saved without a login), **Logins** (the login log
with its alerts), **Owners** (who has claimed a name, and reset), **This
device** (what the app on this phone sees, and the local cache tools),
**Login mode** (off / soft / on, stored in KV so it needs no deploy) and
**Slate** (opens the editor).

Both logs also answer `&format=json` so the console can render them in a tab
instead of opening a page.

The slate editor: `GET /games?check=1&key=…` accepts either key, and The key is kept in `sessionStorage` for
that tab, so the prompt returns on the next visit. Any tab in the bottom nav
closes the editor. It asks
the browser (not the Worker, which ESPN blocks) for a week's college slate,
lists the games, and takes a spread and favorite for each. ESPN's closing line
prefills the spread where it has one.
