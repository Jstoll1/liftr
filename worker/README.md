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
