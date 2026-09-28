// Game insights: line movement sampled twice a day, ESPN injury and news
// feeds, and a short factual brief per open game. Everything here is
// display only. Nothing in this file writes the sealed slate, the spread
// the league scores against, results, or picks; runInsights' KV writes
// are limited to the keys below and a test holds it to that.

export const linesKey = (week) => `lines:w${week}`;
export const briefKey = (week, gameId) => `brief:w${week}:g${gameId}`;
export const feedCacheKey = (url) => `feedcache:${url}`;
export const INSIGHTS_LOG_KEY = "insights:log";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// --- Odds ---------------------------------------------------------------
// ESPN's scoreboard carries one odds block per competition. `spread` is
// from the home side's point of view (negative means the home team is
// favoured), and `details` is the book's own text such as "PITT -3.5".
export function parseOdds(comp) {
  const o = comp?.odds?.[0];
  if (!o) return null;
  const spread = Number(o.spread);
  const overUnder = Number(o.overUnder);
  const homeFav = o.homeTeamOdds?.favorite === true ? true : o.awayTeamOdds?.favorite === true ? false : Number.isFinite(spread) ? spread < 0 : null;
  return {
    details: typeof o.details === "string" ? o.details : null,
    spread: Number.isFinite(spread) ? Math.abs(spread) : null,
    favoriteSide: homeFav === null ? null : homeFav ? "home" : "away",
    overUnder: Number.isFinite(overUnder) ? overUnder : null,
    provider: o.provider?.name || null,
  };
}

// --- Line log -------------------------------------------------------------
// One sample per game per run, skipped when nothing moved inside six hours
// so a quiet week stays a handful of points rather than a wall of repeats.
export function appendLineSample(log, gameId, sample, now) {
  const next = { ...(log || {}) };
  const list = Array.isArray(next[gameId]) ? next[gameId].slice() : [];
  const last = list[list.length - 1];
  const same = last && last.spread === sample.spread && last.favoriteSide === sample.favoriteSide && last.overUnder === sample.overUnder;
  if (same && now - last.at < 6 * 3600 * 1000) return next;
  list.push({ at: now, spread: sample.spread, favoriteSide: sample.favoriteSide, overUnder: sample.overUnder });
  next[gameId] = list.slice(-40);
  return next;
}

// From the sealed line to the latest sample: how far, and toward whom.
// Spread as a signed number from the sealed favourite's side, so a move
// toward the favourite reads positive and toward the dog negative.
export function lineMovement(game, samples) {
  if (!game || !Array.isArray(samples) || !samples.length) return null;
  const sealedFavSide = game.favorite === game.home ? "home" : "away";
  const signed = (s) => s.spread === null || s.favoriteSide === null ? null : s.favoriteSide === sealedFavSide ? s.spread : -s.spread;
  const latest = samples[samples.length - 1];
  const nowSigned = signed(latest);
  if (nowSigned === null) return null;
  const sealed = Number(game.spread) || 0;
  const delta = Math.round((nowSigned - sealed) * 2) / 2;
  const favShort = game.favorite === game.home ? game.homeShort : game.awayShort;
  const dogShort = game.favorite === game.home ? game.awayShort : game.homeShort;
  const nowFavShort = latest.favoriteSide === sealedFavSide ? favShort : dogShort;
  return {
    sealed, sealedFavorite: favShort,
    now: latest.spread, nowFavorite: nowFavShort, overUnder: latest.overUnder, at: latest.at,
    delta, toward: delta === 0 ? null : delta > 0 ? favShort : dogShort,
    series: samples.map(signed).filter((v) => v !== null),
  };
}

// --- Feeds ----------------------------------------------------------------
async function fetchJsonCached(env, url, ttlSec = 7200) {
  const key = feedCacheKey(url);
  try {
    const hit = await env.LIFTR_KV.get(key, "json");
    if (hit && hit.at && Date.now() - hit.at < ttlSec * 1000) return { data: hit.data, cached: true };
  } catch {}
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  try { await env.LIFTR_KV.put(key, JSON.stringify({ at: Date.now(), data }), { expirationTtl: ttlSec }); } catch {}
  return { data, cached: false };
}

export function parseInjuries(data) {
  // ESPN files injuries either as a flat list or grouped under a team.
  const list = Array.isArray(data?.injuries) ? data.injuries.flatMap((x) => Array.isArray(x?.injuries) ? x.injuries : [x]) : [];
  return list.map((i) => ({
    name: i?.athlete?.displayName || i?.athlete?.fullName || null,
    pos: i?.athlete?.position?.abbreviation || null,
    status: i?.status || i?.type?.description || null,
    detail: i?.shortComment || i?.details?.detail || i?.longComment || null,
    date: i?.date || null,
  })).filter((i) => i.name && i.status).slice(0, 12);
}

export function parseNews(data) {
  const list = Array.isArray(data?.articles) ? data.articles : [];
  return list.map((a) => ({
    headline: a?.headline || null,
    blurb: a?.description || null,
    published: a?.published || null,
    link: a?.links?.web?.href || a?.links?.mobile?.href || null,
  })).filter((a) => a.headline).slice(0, 8);
}

async function feed(env, url, parse) {
  try {
    const { data, cached } = await fetchJsonCached(env, url);
    return { ok: true, cached, items: parse(data) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), items: [] };
  }
}

export async function fetchTeamFeeds(env, teamId) {
  const [injuries, news] = await Promise.all([
    feed(env, `${ESPN}/teams/${teamId}/injuries`, parseInjuries),
    feed(env, `${ESPN}/news?limit=10&team=${teamId}`, parseNews),
  ]);
  return { injuries, news };
}

// --- Brief ----------------------------------------------------------------
// The model writes only the short summary. Injuries, news and the line
// come straight from the feeds so every line on the sheet has a source.
export function briefPrompt() {
  return [
    "You write a short pre-game brief for a college football pick'em league.",
    "Use only the facts in the JSON you are given: the sealed line, how the line has moved, the injury list and the news headlines for both teams.",
    "Write 3 to 5 plain sentences, each under 30 words, that a friend would read in ten seconds: the notable injuries with status, what the line has done, and any headline that matters to this game.",
    "Report; never recommend a side, never say who will win or cover, never use the words pick, bet, lean, lock or value.",
    "If a feed is empty say so in one short clause such as 'No injury report on the feed.' Do not invent players, numbers or news.",
    "Return JSON: { \"lines\": [\"...\"] }",
  ].join(" ");
}

export async function writeBrief(env, payload) {
  if (!env.OPENAI_API_KEY) return { lines: [], error: "no model key" };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: briefPrompt() }, { role: "user", content: JSON.stringify(payload) }],
      response_format: { type: "json_schema", json_schema: { name: "brief", strict: true, schema: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 } } } } },
      temperature: 0.2,
    }),
  });
  if (!res.ok) return { lines: [], error: `model ${res.status}` };
  const data = await res.json();
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const lines = (parsed.lines || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    return { lines };
  } catch (err) {
    return { lines: [], error: "bad model json" };
  }
}

// --- Runner ---------------------------------------------------------------
// deps: { liveGames(env, week) -> { games:[{id, found, state, odds, eventId}] },
//         readSlate(env, week) -> { games:[...] }, currentWeek(env) -> number }
export async function runInsights(env, deps, { week = null, force = false, briefs = true } = {}) {
  const now = Date.now();
  const w = week ?? await deps.currentWeek(env);
  const slate = await deps.readSlate(env, w);
  const games = slate?.games || [];
  const out = { week: w, at: now, sampled: 0, briefs: 0, skipped: 0, errors: [] };
  if (!games.length) { out.errors.push("no slate"); return out; }

  // Under the lock-all rule every game locks at the first kickoff, so an
  // "open" game is one whose week has not started.
  const firstKick = Math.min(...games.map((g) => new Date(g.kickoff).getTime()));
  const openGames = games.filter((g) => now < firstKick && now < new Date(g.kickoff).getTime());
  if (!openGames.length && !force) { out.skipped = games.length; return out; }

  let live = { games: [] };
  try { live = await deps.liveGames(env, w); } catch (err) { out.errors.push(`live: ${err?.message || err}`); }
  const liveById = Object.fromEntries((live.games || []).map((g) => [g.id, g]));

  // 1. Line samples.
  let log = (await env.LIFTR_KV.get(linesKey(w), "json")) || {};
  for (const g of openGames) {
    const odds = liveById[g.id]?.odds;
    if (!odds || odds.spread === null) continue;
    const before = log[g.id]?.length || 0;
    log = appendLineSample(log, g.id, odds, now);
    if ((log[g.id]?.length || 0) > before) out.sampled += 1;
  }
  await env.LIFTR_KV.put(linesKey(w), JSON.stringify(log));

  // 2. Briefs, three games at a time so a run stays inside the CPU budget.
  if (briefs) {
    const queue = openGames.slice();
    while (queue.length) {
      const batch = queue.splice(0, 3);
      await Promise.all(batch.map(async (g) => {
        try {
          const [away, home] = await Promise.all([fetchTeamFeeds(env, g.awayId), fetchTeamFeeds(env, g.homeId)]);
          const movement = lineMovement(g, log[g.id]);
          const payload = {
            game: `${g.awayShort} at ${g.homeShort}`, kickoff: g.kickoffLabel || g.kickoff,
            sealedLine: `${g.favorite === g.home ? g.homeShort : g.awayShort} -${g.spread}`,
            lineNow: movement ? `${movement.nowFavorite} -${movement.now}${movement.delta ? ` (moved ${Math.abs(movement.delta)} toward ${movement.toward})` : " (unchanged)"}` : "no line feed",
            total: movement?.overUnder ?? null,
            injuries: { [g.awayShort]: away.injuries.items, [g.homeShort]: home.injuries.items },
            news: { [g.awayShort]: away.news.items.map((n) => n.headline), [g.homeShort]: home.news.items.map((n) => n.headline) },
          };
          const summary = await writeBrief(env, payload);
          const brief = {
            week: w, game: g.id, updatedAt: now, eventId: liveById[g.id]?.eventId || null,
            summary: summary.lines, summaryError: summary.error || null,
            movement,
            injuries: { away: away.injuries.items, home: home.injuries.items },
            news: { away: away.news.items, home: home.news.items },
            feeds: {
              awayInjuries: { ok: away.injuries.ok, error: away.injuries.error || null, cached: !!away.injuries.cached },
              homeInjuries: { ok: home.injuries.ok, error: home.injuries.error || null, cached: !!home.injuries.cached },
              awayNews: { ok: away.news.ok, error: away.news.error || null },
              homeNews: { ok: home.news.ok, error: home.news.error || null },
            },
          };
          await env.LIFTR_KV.put(briefKey(w, g.id), JSON.stringify(brief), { expirationTtl: 60 * 24 * 3600 });
          out.briefs += 1;
        } catch (err) {
          out.errors.push(`g${g.id}: ${err?.message || err}`);
        }
      }));
    }
  }

  // 3. Run log for the console.
  try {
    const prev = (await env.LIFTR_KV.get(INSIGHTS_LOG_KEY, "json")) || [];
    await env.LIFTR_KV.put(INSIGHTS_LOG_KEY, JSON.stringify([out, ...prev].slice(0, 30)));
  } catch {}
  return out;
}

export async function readInsights(env, week) {
  const lines = (await env.LIFTR_KV.get(linesKey(week), "json")) || {};
  const list = await env.LIFTR_KV.list({ prefix: `brief:w${week}:` });
  const briefs = {};
  await Promise.all(list.keys.map(async (k) => {
    const b = await env.LIFTR_KV.get(k.name, "json");
    if (b) briefs[b.game] = b;
  }));
  const log = (await env.LIFTR_KV.get(INSIGHTS_LOG_KEY, "json")) || [];
  const lastRun = log.find((r) => r.week === week) || null;
  return { week, lines, briefs, lastRun };
}
