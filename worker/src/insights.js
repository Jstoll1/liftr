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
    points: samples.map((x) => ({ at: x.at, v: signed(x), live: !!x.live })).filter((x) => x.v !== null),
  };
}

// --- Feeds ----------------------------------------------------------------
async function fetchJsonCached(env, url, ttlSec = 7200) {
  const key = feedCacheKey(url);
  try {
    const hit = await env.LIFTR_KV.get(key, "json");
    if (hit && hit.at && Date.now() - hit.at < ttlSec * 1000) return { data: hit.data, cached: true };
  } catch {}
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" }, cf: { cacheTtl: 0 } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 80).replace(/\s+/g, " ")}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`not JSON: ${text.slice(0, 80).replace(/\s+/g, " ")}`); }
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

// ESPN's per-game summary: records, ATS records, FPI, weather, venue and
// the statistical leaders, all in one call keyed by the event id.
export function parseSummary(data, game) {
  if (!data || typeof data !== "object") return null;
  const comp = data.header?.competitions?.[0] || {};
  const side = (homeAway) => (comp.competitors || []).find((c) => c.homeAway === homeAway) || {};
  const rec = (c) => {
    const list = Array.isArray(c.record) ? c.record : [];
    const overall = list.find((r) => r.type === "total" || r.name === "overall")?.summary || list[0]?.summary || null;
    const split = list.find((r) => r.type === "home" || r.type === "road" || r.name === "Home" || r.name === "Road")?.summary || null;
    return { overall, split };
  };
  const ats = (teamId) => {
    const row = (data.againstTheSpread || []).find((r) => Number(r?.team?.id) === Number(teamId));
    const r = row?.records?.find((x) => /overall/i.test(x?.type || x?.name || "")) || row?.records?.[0];
    return r?.summary || null;
  };
  const fpi = (() => {
    const p = data.predictor;
    if (!p) return null;
    const h = Number(p.homeTeam?.gameProjection), a = Number(p.awayTeam?.gameProjection);
    return Number.isFinite(h) && Number.isFinite(a) ? { home: Math.round(h), away: Math.round(a) } : null;
  })();
  const w = data.weather || comp.weather || null;
  const weather = w ? { text: w.displayValue || w.conditionId || null, temp: Number.isFinite(Number(w.temperature)) ? Number(w.temperature) : null, precip: Number.isFinite(Number(w.precipitation)) ? Number(w.precipitation) : null } : null;
  const venue = data.gameInfo?.venue ? { name: data.gameInfo.venue.fullName || null, city: [data.gameInfo.venue.address?.city, data.gameInfo.venue.address?.state].filter(Boolean).join(", ") || null, indoor: !!data.gameInfo.venue.indoor } : null;
  const leaders = (homeAway) => {
    const block = (data.leaders || []).find((l) => (l?.team?.homeAway || "").toLowerCase() === homeAway || Number(l?.team?.id) === Number(homeAway === "home" ? game?.homeId : game?.awayId));
    return (block?.leaders || []).slice(0, 3).map((cat) => {
      const top = cat?.leaders?.[0];
      return top ? { cat: cat.displayName || cat.name || "", name: top.athlete?.displayName || top.athlete?.shortName || "", line: top.displayValue || "" } : null;
    }).filter((x) => x && x.name);
  };
  const away = side("away"), home = side("home");
  // The summary also lists injuries per team and the book's current line,
  // which cover for the team endpoints when those are missing.
  const injBlock = (teamId) => (data.injuries || []).find((b) => Number(b?.team?.id) === Number(teamId));
  const injuries = { away: parseInjuries({ injuries: injBlock(away.team?.id ?? game?.awayId)?.injuries || [] }), home: parseInjuries({ injuries: injBlock(home.team?.id ?? game?.homeId)?.injuries || [] }) };
  const pc = Array.isArray(data.pickcenter) ? data.pickcenter[0] : null;
  const odds = pc ? parseOdds({ odds: [pc] }) : null;
  return {
    injuries, odds, injuriesListed: Array.isArray(data.injuries),
    records: { away: rec(away), home: rec(home) },
    ats: { away: ats(away.team?.id ?? game?.awayId), home: ats(home.team?.id ?? game?.homeId) },
    fpi, weather, venue,
    leaders: { away: leaders("away"), home: leaders("home") },
  };
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
    "Use only the facts in the JSON you are given: the sealed line, how the line has moved, the at-a-glance numbers (records, against-the-spread records, ESPN FPI win chance, weather), the injury list and the news headlines for both teams.",
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
          const eventId = liveById[g.id]?.eventId || null;
          const [away, home, summary] = await Promise.all([
            fetchTeamFeeds(env, g.awayId), fetchTeamFeeds(env, g.homeId),
            eventId ? feed(env, `${ESPN}/summary?event=${eventId}`, (d) => parseSummary(d, g)) : Promise.resolve({ ok: false, error: "no event id", items: null }),
          ]);
          const glance = summary.ok ? summary.items : null;
          const movement = lineMovement(g, log[g.id]);
          const payload = {
            game: `${g.awayShort} at ${g.homeShort}`, kickoff: g.kickoffLabel || g.kickoff,
            sealedLine: `${g.favorite === g.home ? g.homeShort : g.awayShort} -${g.spread}`,
            lineNow: movement ? `${movement.nowFavorite} -${movement.now}${movement.delta ? ` (moved ${Math.abs(movement.delta)} toward ${movement.toward})` : " (unchanged)"}` : "no line feed",
            total: movement?.overUnder ?? null,
            glance: glance ? { records: glance.records, ats: glance.ats, fpi: glance.fpi, weather: glance.weather } : null,
            injuries: { [g.awayShort]: away.injuries.items, [g.homeShort]: home.injuries.items },
            news: { [g.awayShort]: away.news.items.map((n) => n.headline), [g.homeShort]: home.news.items.map((n) => n.headline) },
          };
          const written = await writeBrief(env, payload);
          const brief = {
            week: w, game: g.id, updatedAt: now, eventId,
            summary: written.lines, summaryError: written.error || null,
            movement, glance,
            injuries: { away: away.injuries.items, home: home.injuries.items },
            news: { away: away.news.items, home: home.news.items },
            feeds: {
              awayInjuries: { ok: away.injuries.ok, error: away.injuries.error || null, cached: !!away.injuries.cached },
              homeInjuries: { ok: home.injuries.ok, error: home.injuries.error || null, cached: !!home.injuries.cached },
              awayNews: { ok: away.news.ok, error: away.news.error || null },
              homeNews: { ok: home.news.ok, error: home.news.error || null },
              summary: { ok: summary.ok, error: summary.error || null },
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

// On demand, for the sheet: both injury reports, the glance numbers and
// the live line for one game, without waiting for the scheduled run and
// without the model. Cached half an hour so ten people opening the same
// game cost one set of feed calls.
export const snapKey = (week, gameId) => `snap:w${week}:g${gameId}`;
export async function gameSnapshot(env, deps, week, gameId) {
  const cached = await env.LIFTR_KV.get(snapKey(week, gameId), "json");
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached;
  const slate = await deps.readSlate(env, week);
  const g = (slate?.games || []).find((x) => Number(x.id) === Number(gameId));
  if (!g) return null;
  let live = null;
  try { live = (await deps.liveGames(env, week)).games.find((x) => x.id === g.id) || null; } catch {}
  const eventId = live?.eventId || cached?.eventId || null;
  const [away, home, summary] = await Promise.all([
    fetchTeamFeeds(env, g.awayId), fetchTeamFeeds(env, g.homeId),
    eventId ? feed(env, `${ESPN}/summary?event=${eventId}`, (d) => parseSummary(d, g)) : Promise.resolve({ ok: false, error: "no event id", items: null }),
  ]);
  const log = (await env.LIFTR_KV.get(linesKey(week), "json")) || {};
  const samples = (log[g.id] || []).slice();
  const glance = summary.ok ? summary.items : null;
  const nowOdds = live?.odds && live.odds.spread !== null ? live.odds : glance?.odds && glance.odds.spread !== null ? glance.odds : null;
  if (nowOdds) samples.push({ at: Date.now(), spread: nowOdds.spread, favoriteSide: nowOdds.favoriteSide, overUnder: nowOdds.overUnder, live: true });
  const pickInj = (side) => side.injuries.ok ? side.injuries.items : glance?.injuriesListed ? glance.injuries[side === away ? "away" : "home"] : null;
  const snap = {
    at: Date.now(), week, game: g.id, eventId,
    injuries: { away: pickInj(away), home: pickInj(home) },
    news: { away: away.news.items, home: home.news.items },
    glance,
    movement: lineMovement(g, samples),
    samples,
    feeds: {
      awayInjuries: away.injuries.ok || !!glance?.injuriesListed, homeInjuries: home.injuries.ok || !!glance?.injuriesListed,
      awayInjuriesError: away.injuries.error || null, homeInjuriesError: home.injuries.error || null,
      summary: summary.ok, summaryError: summary.error || null,
      lineSource: live?.odds && live.odds.spread !== null ? "scoreboard" : glance?.odds ? "summary" : null,
      liveFound: !!live,
    },
  };
  try { await env.LIFTR_KV.put(snapKey(week, g.id), JSON.stringify(snap), { expirationTtl: 7 * 24 * 3600 }); } catch {}
  return snap;
}

// --- Wider news -----------------------------------------------------------
// Google News RSS for the matchup and each team, past week. Anything from
// ESPN (the phone already shows ESPN's feed), video, podcasts and betting
// promos is dropped, and duplicates across the three searches are merged.
// Instagram is allowed; TikTok and YouTube are not.
const SKIP_SOURCES = /espn|youtube|youtu\.be|tiktok|podcast|draftkings|fanduel|betmgm|caesars|bet365|fanatics sportsbook/i;
const SKIP_TITLES = /\b(video|watch|podcast|live stream|how to watch|stream free|highlights|odds, picks|prediction(s)?,? odds|best bets?|promo code|bonus code|wrestling|basketball|hoops|volleyball|soccer|hockey|baseball|softball|lacrosse|golf|tennis|swimming|gymnastics|rowing|field hockey|water polo)\b/i;
function decode(x) {
  return String(x || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
export function parseGoogleNewsRss(xml) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const tag = (t) => decode((block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)) || [])[1]);
    const source = tag("source");
    let title = tag("title");
    // Google appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag("link");
    const published = tag("pubDate");
    if (!title || !link) continue;
    items.push({ headline: title, source: source || null, link, published: published ? new Date(published).toISOString() : null });
  }
  return items;
}
// Bing's feed: the outlet sits in <News:Source>, the link is a Bing
// redirect whose url= parameter is the article itself.
export function parseBingNewsRss(xml) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const tag = (t) => decode((block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, "i")) || [])[1]);
    const title = tag("title");
    let link = tag("link");
    try { const u = new URL(link); const real = u.searchParams.get("url"); if (real) link = real; } catch {}
    const source = tag("News:Source") || (() => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return null; } })();
    const published = tag("pubDate");
    const blurb = tag("description");
    if (!title || !link) continue;
    items.push({ headline: title, source, link, blurb: blurb || null, published: published ? new Date(published).toISOString() : null });
  }
  return items;
}
// GDELT's article list: a free news index with a JSON API that answers
// both servers and browsers. Fifteen minutes behind, but it never 503s a
// Cloudflare address the way Google's RSS does.
export const gdeltUrl = (q) => `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&format=json&maxrecords=25&sort=DateDesc&timespan=7d`;
export function parseGdelt(json) {
  const arts = Array.isArray(json?.articles) ? json.articles : [];
  return arts.filter((a) => a?.url && a?.title).map((a) => {
    const d = String(a.seendate || "");
    const iso = /^\d{8}T\d{6}Z$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z` : null;
    return { headline: decode(a.title), source: a.domain ? String(a.domain).replace(/^www\./, "") : null, link: a.url, blurb: null, published: iso };
  });
}
// One fetch with a single retry after a short pause when the host is
// throttling (Google's RSS answers 503 to busy edges).
// Successful feed bodies are kept in KV for thirty minutes so repeat opens
// of the same game do not hit the same throttled host again.
async function fetchText(url, accept, env = null) {
  const key = feedCacheKey(url);
  if (env?.LIFTR_KV) { try { const hit = await env.LIFTR_KV.get(key, "json"); if (hit && hit.at && Date.now() - hit.at < 30 * 60 * 1000) return { ok: true, text: hit.text, cached: true }; } catch {} }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" } });
    if (res.ok) {
      const text = await res.text();
      // Feed bodies are small; the site's feed file is not, so the cap is generous.
      if (env?.LIFTR_KV) { try { await env.LIFTR_KV.put(key, JSON.stringify({ at: Date.now(), text: text.slice(0, 4000000) }), { expirationTtl: 3600 }); } catch {} }
      return { ok: true, text };
    }
    if (res.status !== 503 && res.status !== 429) return { ok: false, error: `HTTP ${res.status}` };
    if (attempt === 0) await new Promise((r) => setTimeout(r, 900 + Math.random() * 600));
    else return { ok: false, error: `HTTP ${res.status}` };
  }
  return { ok: false, error: "unreachable" };
}
// Yahoo's news search feed: plain RSS, no source tag, so the outlet is the
// link's host.
export const yahooUrl = (q) => `https://news.search.yahoo.com/rss?p=${encodeURIComponent(q)}`;
export function parseYahooRss(xml) {
  return parseGoogleNewsRss(xml).map((n) => ({ ...n, source: n.source || (() => { try { return new URL(n.link).hostname.replace(/^www\./, ""); } catch { return null; } })() }));
}
export function filterNews(items) {
  const seen = new Set();
  return items.filter((n) => {
    if (SKIP_SOURCES.test(n.source || "") || SKIP_SOURCES.test(n.link || "")) return false;
    if (SKIP_TITLES.test(n.headline)) return false;
    const key = n.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// Slate names carry poll ranks ("#4 Miami") and parentheses ("Miami (OH)");
// neither appears in headlines, so strip them before searching.
export const searchName = (n) => String(n || "").replace(/^#\d+\s+/, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim();
export async function gameNews(env, game) {
  const key = `news:v2:g:${game.awayId}:${game.homeId}`;
  const hit = await env.LIFTR_KV.get(key, "json");
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const q = (s) => `https://news.google.com/rss/search?q=${encodeURIComponent(s)}+when:7d&hl=en-US&gl=US&ceid=US:en`;
  const A = searchName(game.away), H = searchName(game.home);
  const queries = [
    { tag: "game", url: q(`"${A}" "${H}" football`) },
    { tag: "game", url: q(`${A} ${H} football`) },
    { tag: "away", url: q(`"${A}" football`) },
    { tag: "home", url: q(`"${H}" football`) },
  ];
  // Bing News as a second source for the same three searches, so one
  // service turning the Worker away still leaves articles.
  const bing = (s) => `https://www.bing.com/news/search?q=${encodeURIComponent(s)}&format=rss&qft=interval%3d%228%22`;
  queries.push(
    { tag: "game", url: bing(`${A} ${H} football`), bing: true },
    { tag: "away", url: bing(`"${A}" football`), bing: true },
    { tag: "home", url: bing(`"${H}" football`), bing: true },
  );
  queries.push(
    { tag: "game", url: gdeltUrl(`"${A}" "${H}" football`), gdelt: true },
    { tag: "away", url: gdeltUrl(`"${A}" football`), gdelt: true },
    { tag: "home", url: gdeltUrl(`"${H}" football`), gdelt: true },
    { tag: "game", url: yahooUrl(`${A} ${H} football`), yahoo: true },
    { tag: "away", url: yahooUrl(`${A} football`), yahoo: true },
    { tag: "home", url: yahooUrl(`${H} football`), yahoo: true },
  );
  const results = await Promise.all(queries.map(async (x) => {
    try {
      const r = await fetchText(x.url, x.gdelt ? "application/json" : "application/rss+xml, application/xml, text/xml", env);
      if (!r.ok) return { tag: x.tag, items: [], error: r.error };
      const items = x.gdelt ? parseGdelt(JSON.parse(r.text)) : x.bing ? parseBingNewsRss(r.text) : x.yahoo ? parseYahooRss(r.text) : parseGoogleNewsRss(r.text);
      return { tag: x.tag, items: items.map((n) => ({ ...n, about: x.tag })) };
    } catch (err) { return { tag: x.tag, items: [], error: String(err?.message || err) }; }
  }));
  const all = filterNews(results.flatMap((r) => r.items))
    .sort((a, b) => (a.about === "game" ? 0 : 1) - (b.about === "game" ? 0 : 1) || String(b.published).localeCompare(String(a.published)));
  const out = { at: Date.now(), items: all.slice(0, 18), errors: results.filter((r) => r.error).map((r) => `${r.tag}: ${r.error}`) };
  // Only cache a result that found something; an empty one retries next open.
  if (out.items.length) { try { await env.LIFTR_KV.put(key, JSON.stringify(out), { expirationTtl: 6 * 3600 }); } catch {} }
  return out;
}

// --- Written preview -------------------------------------------------------
// The phone reaches ESPN and the Worker does not, so the phone sends the
// facts it already pulled and the Worker's model turns them into a short,
// specific preview. One per game, cached six hours.
export const previewKey = (week, gameId) => `preview:v3:w${week}:g${gameId}`;
export function previewPrompt() {
  return [
    "You are a sharp college football beat writer. Write a short pregame preview from the JSON facts only.",
    "The facts include 'hooks': storylines already pulled from the data (bounce-backs, streaks, unbeaten runs, home or road splits, a starter out, matchup edges, rankings, a night kickoff, weather, the last meeting, line moves).",
    "Pick the ONE most interesting hook and build the preview around it; add a second only if it creates tension (e.g. a hot offence against a leaky defence). Prefer contrast, stakes and change over plain stat lines.",
    "Do NOT open with a quarterback's name followed by 'leads', 'heads', 'brings' or 'takes'. Do not open with the stadium. Open with the storyline itself.",
    "Exactly 2 sentences, 45 words at most, plain and easy to read. Use real names from the facts and full team names, never abbreviations.",
    "Also write a punchy headline under 7 words that names the storyline, not the venue.",
    "Never invent a player, coach, stat, score, record or venue that is not in the facts. Never recommend a side, predict a winner, or mention betting picks. No cliches like 'promises to be a thrilling clash' or 'something has to give'.",
    "Return JSON: {\"headline\": \"...\", \"text\": \"...\"}",
  ].join(" ");
}
export async function writePreview(env, facts) {
  if (!env.OPENAI_API_KEY) return { error: "no model key" };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: previewPrompt() }, { role: "user", content: JSON.stringify(facts).slice(0, 6000) }],
      response_format: { type: "json_schema", json_schema: { name: "preview", strict: true, schema: { type: "object", additionalProperties: false, required: ["headline", "text"], properties: { headline: { type: "string" }, text: { type: "string" } } } } },
      temperature: 0.6,
    }),
  });
  if (!res.ok) return { error: `model ${res.status}` };
  try {
    const parsed = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}");
    const headline = String(parsed.headline || "").trim().slice(0, 120);
    const text = String(parsed.text || "").trim().slice(0, 400);
    return text ? { headline, text } : { error: "empty" };
  } catch { return { error: "bad model json" }; }
}
export async function gamePreview(env, week, game, facts) {
  const key = previewKey(week, game.id);
  const hit = await env.LIFTR_KV.get(key, "json");
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit;
  const out = await writePreview(env, { game: `${game.away} at ${game.home}`, kickoff: game.kickoffLabel || game.kickoff, ...facts });
  if (out.error) return { at: Date.now(), error: out.error };
  const saved = { at: Date.now(), ...out };
  try { await env.LIFTR_KV.put(key, JSON.stringify(saved), { expirationTtl: 3 * 24 * 3600 }); } catch {}
  return saved;
}

// --- Injuries from the news ------------------------------------------------
// ESPN's injury feed is empty for college football, but beat writers file
// availability reports all week. Search both news feeds for each team's
// injury coverage, then have the model pull a structured list from the
// headlines and blurbs. Cached three hours; only names with a stated
// status come through, and every row carries the outlet it came from.
export const injuriesKey = (week, gameId) => `inj:v12:w${week}:g${gameId}`;
export const INJURY_STATUSES = ["OUT", "DOUBTFUL", "QUESTIONABLE", "PROBABLE", "RETURNING", "SUSPENDED"];
export function injuriesPrompt() {
  return [
    "You extract player availability for one college football team from news headlines and blurbs.",
    "Return only players the text explicitly gives a status for: out, doubtful, questionable, probable, returning from injury, or suspended. Map the status to one of: " + INJURY_STATUSES.join(", ") + ".",
    "Never guess, never add players not named with a status, never include the opponent's players, and ignore anyone from another sport (volleyball, basketball, soccer) or from an NFL team. Skip coaches. If nothing qualifies, return an empty list.",
    "The status must be for THIS week's game, which is named in the message. A report about an earlier game or a different opponent ('expected to sit out against Central Michigan' when this week's opponent is Clemson) is old news: skip that player unless the text also gives a status for this game.",
    "For each: name as written, position, status, and a short detail (injury or reason, max 8 words) plus the outlet name.",
    "Every player needs a position abbreviation (QB, RB, WR, TE, OL, DL, DE, DT, EDGE, LB, CB, S, K, P, LS). Take it from the text first, including role words such as 'tight end', 'safety' or 'left tackle', and otherwise from what you know of that player on this team. Leave it empty only when you truly have no idea.",
    "Also copy, as 'quote', the one sentence from the text that states the player's status, verbatim and unedited (max 200 characters). Never paraphrase it; if no single sentence states it, use an empty string.",
    "Also write 'note': one or two plain sentences (max 220 characters) giving what the text actually says about this player beyond the status: the injury or body part, when it happened, whether he has practiced, the expected timeline, and who fills in. Use only facts stated in the text about this player. No speculation and no opinion. Never write a note that only restates the status ('is doubtful, indicating he may not play'); if the text gives nothing beyond the status, use an empty string.",
    "Return JSON: {\"players\": [{\"name\": \"\", \"pos\": \"\", \"status\": \"\", \"detail\": \"\", \"source\": \"\", \"quote\": \"\", \"note\": \"\"}]}",
  ].join(" ");
}
async function injuryNewsFor(teamName, env = null) {
  const T = searchName(teamName);
  const q = (s) => `https://news.google.com/rss/search?q=${encodeURIComponent(s)}+when:7d&hl=en-US&gl=US&ceid=US:en`;
  const bing = (s) => `https://www.bing.com/news/search?q=${encodeURIComponent(s)}&format=rss&qft=interval%3d%228%22`;
  const urls = [
    { url: q(`"${T}" football injury report`) },
    { url: q(`"${T}" football injury OR questionable OR doubtful OR "ruled out"`) },
    { url: bing(`"${T}" football injury report`), bing: true },
  ];
  urls.push({ url: gdeltUrl(`"${T}" football injury`), gdelt: true }, { url: yahooUrl(`${T} football injury report`), yahoo: true }, { url: yahooUrl(`${T} football injury`), yahoo: true });
  const results = await Promise.all(urls.map(async (x) => {
    try {
      const r = await fetchText(x.url, x.gdelt ? "application/json" : "application/rss+xml, application/xml, text/xml", env);
      if (!r.ok) { const e = []; e.error = r.error; return e; }
      return x.gdelt ? parseGdelt(JSON.parse(r.text)) : x.bing ? parseBingNewsRss(r.text) : x.yahoo ? parseYahooRss(r.text) : parseGoogleNewsRss(r.text);
    } catch (err) { const e = []; e.error = String(err?.message || err); return e; }
  }));
  const kept = filterNews(results.flat()).filter((n) => /injur|questionable|doubtful|ruled out|availability|probable|suspend|return/i.test(`${n.headline} ${n.blurb || ""}`)).slice(0, 8);
  kept.raw = results.map((r) => r.error ? r.error : r.length);
  return kept;
}
// Positions as the sheet prints them. Line spots collapse to OL/DL, and
// a role spelled out in prose ("tight end", "left tackle") maps to its
// abbreviation so a report that never uses one still gets a position.
const POS_ALIAS = { OT: "OL", OG: "OL", G: "OL", C: "OL", IOL: "OL", T: "OL", NT: "DT", NG: "DT", DE: "DE", OLB: "LB", ILB: "LB", MLB: "LB", NB: "CB", DB: "CB", FS: "S", SS: "S", PK: "K", ATH: "ATH", HB: "RB", FB: "RB", RUSH: "EDGE" };
const POS_WORDS = [
  [/\bquarterback\b/i, "QB"], [/\b(running|tail|half)[ -]?back\b/i, "RB"], [/\bfullback\b/i, "RB"], [/\b(wide )?receiver\b|\bwideout\b/i, "WR"], [/\btight end\b/i, "TE"],
  [/\b(offensive (line|lineman|tackle|guard)|left tackle|right tackle|left guard|right guard|center)\b/i, "OL"],
  [/\bdefensive end\b/i, "DE"], [/\bdefensive tackle\b|\bnose (tackle|guard)\b/i, "DT"], [/\bedge( rusher)?\b|\bpass rusher\b/i, "EDGE"], [/\bdefensive (line|lineman)\b/i, "DL"],
  [/\blinebacker\b/i, "LB"], [/\bcornerback\b|\bnickel\b/i, "CB"], [/\bsafety\b/i, "S"], [/\bdefensive back\b/i, "CB"],
  [/\bkicker\b/i, "K"], [/\bpunter\b/i, "P"], [/\blong snapper\b/i, "LS"],
];
export function normalisePos(pos) {
  const p = String(pos || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (!p) return "";
  return POS_ALIAS[p] || p.slice(0, 4);
}
export function inferPos(text) {
  for (const [re, pos] of POS_WORDS) if (re.test(text || "")) return pos;
  return "";
}
// ESPN's roster, as a name → position map, so a player a beat writer
// names without a position still gets one. Last names stand in when the
// name is unique on the roster. Cached a day; a failed read is an empty map.
const nameKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
export function parseRoster(data) {
  const groups = Array.isArray(data?.athletes) ? data.athletes : [];
  const list = groups.flatMap((g) => Array.isArray(g?.items) ? g.items : [g]);
  const full = new Map(), last = new Map();
  for (const a of list) {
    const name = a?.fullName || a?.displayName, pos = normalisePos(a?.position?.abbreviation);
    if (!name || !pos) continue;
    full.set(nameKey(name), pos);
    const ln = nameKey(name).split(" ").slice(-1)[0];
    last.set(ln, last.has(ln) && last.get(ln) !== pos ? null : pos);
  }
  return { full, last };
}
export async function rosterPositions(env, teamId) {
  if (!teamId || !env?.LIFTR_KV) return { full: new Map(), last: new Map() };
  try { return parseRoster((await fetchJsonCached(env, `${ESPN}/teams/${teamId}/roster`, 24 * 3600)).data); } catch { return { full: new Map(), last: new Map() }; }
}
// A game preview names players from both teams, so a team's list can pick
// up the opponent's quarterback. Drop anyone on the other team's roster who
// is not on this one. Full names only: a shared surname proves nothing.
export function ownPlayersOnly(players, own, other) {
  return players.filter((p) => {
    const k = nameKey(p.name);
    return !(other?.full?.has(k) && !own?.full?.has(k));
  });
}
export function fillPositions(players, roster) {
  return players.map((p) => {
    if (p.pos) return p;
    const k = nameKey(p.name), parts = k.split(" ");
    const pos = roster.full.get(k) || (parts.length > 1 ? roster.last.get(parts[parts.length - 1]) : null) || inferPos(p.detail) || "";
    return { ...p, pos };
  });
}
// The sentence of the source text that names the player, for a position
// the model left blank ("...tight end Brandon Lagg is doubtful").
function itemsNaming(items, name) {
  const ln = String(name || "").trim().split(/\s+/).slice(-1)[0];
  if (!ln || ln.length < 3) return "";
  const re = new RegExp(`[^.!?\\n]{0,120}\\b${ln.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.!?\\n]{0,160}`, "i");
  for (const n of items) { const m = re.exec(`${n.headline}. ${n.blurb || ""}`); if (m) return m[0]; }
  return "";
}
// A quote reaches the sheet only when it is really in one of the articles.
// Matching ignores case, curly quotes and whitespace. The article it came
// from supplies the row's link and outlet. Without a usable quote from the
// model, the sentence that names the player stands in when it carries a
// status word, since that is lifted from the text by construction.
const squash = (s) => String(s || "").toLowerCase().replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
const STATUS_WORDS = /out|doubtful|questionable|probable|return|suspend|miss|sidelined|practice|injur|limited|available|expected|cleared/i;
// The note is the model's reading of the article, so it is kept short and
// dropped when it only restates the status.
// A note earns its place only with a concrete fact (a body part, a game,
// practice, a timeline, a replacement). "Doubtful, indicating he may not
// play" is the status again in more words, and opinion is not a fact.
const NOTE_FACT = /injur|ankle|knee|hamstring|shoulder|head|concussion|foot|leg|hand|wrist|arm|hip|groin|calf|thigh|surgery|practic|quarter|half|against|since|miss|week|tent|downgrad|upgrad|travel|snaps|start|fill|replac|lineup|return from|season/i;
const NOTE_FILLER = /\b(indicating|suggesting|meaning|signaling)\b|\bsignificant\b|\bimportant\b|\bkey (for|to)\b|\bbig (for|loss)\b|\bavailability is uncertain\b|\bstatus (is|remains) (doubtful|questionable|probable|uncertain)\b/i;
export const tidyNote = (n) => { const t = String(n || "").replace(/\s+/g, " ").trim().slice(0, 240); return t.length >= 20 && NOTE_FACT.test(t) && !NOTE_FILLER.test(t) ? t : null; };
export function verifyQuote(items, quote, name) {
  const tidy = (q) => String(q || "").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim().slice(0, 220);
  let q = tidy(quote), hit = null;
  if (q.length >= 15) hit = items.find((n) => squash(`${n.headline}. ${n.blurb || ""}`).includes(squash(q))) || null;
  if (!hit) {
    // The stand-in sentence may begin mid-list when the body lacks
    // punctuation, so it starts no more than 70 characters before the name,
    // snapped to the next capitalised word.
    let alt = tidy(itemsNaming(items, name));
    const ln = String(name || "").trim().split(/\s+/).slice(-1)[0];
    const at = ln ? alt.toLowerCase().indexOf(ln.toLowerCase()) : -1;
    if (at > 70) { const head = alt.slice(at - 70, at); const cap = head.search(/\b[A-Z]/); alt = cap >= 0 ? "…" + head.slice(cap) + alt.slice(at) : "…" + alt.slice(at); }
    if (alt.length >= 15 && STATUS_WORDS.test(alt)) { q = alt; hit = items.find((n) => squash(`${n.headline}. ${n.blurb || ""}`).includes(squash(alt))) || null; }
  }
  if (!hit) return null;
  return { quote: q, link: hit.link || null, source: String(hit.source || "").slice(0, 40), published: hit.published || null };
}
export async function extractInjuries(env, teamName, items, ctx = null) {
  if (!items.length) return { players: [] };
  if (!env.OPENAI_API_KEY) return { players: [], error: "no model key" };
  // Articles with a body first, since those carry the names.
  const ordered = [...items].sort((a, b) => (b.blurb ? b.blurb.length : 0) - (a.blurb ? a.blurb.length : 0));
  const text = ordered.map((n) => `- [${n.source || "news"}] ${n.headline}${n.blurb ? ` — ${n.blurb}` : ""}`).join("\n").slice(0, 12000);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: injuriesPrompt() }, { role: "user", content: `Team: ${searchName(teamName)}${ctx ? `\nThis week's game: ${ctx.game}${ctx.kickoff ? ` (${ctx.kickoff})` : ""}. Today: ${new Date().toUTCString().slice(0, 16)}.` : ""}\n${text}` }],
      response_format: { type: "json_schema", json_schema: { name: "injuries", strict: true, schema: { type: "object", additionalProperties: false, required: ["players"], properties: { players: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "pos", "status", "detail", "source", "quote", "note"], properties: { name: { type: "string" }, pos: { type: "string" }, status: { type: "string", enum: INJURY_STATUSES }, detail: { type: "string" }, source: { type: "string" }, quote: { type: "string" }, note: { type: "string" } } } } } } } },
      temperature: 0,
    }),
  });
  if (!res.ok) return { players: [], error: `model ${res.status}` };
  try {
    const parsed = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}");
    const seen = new Set();
    const players = (parsed.players || []).filter((p) => p.name && INJURY_STATUSES.includes(p.status)).filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10)
      .map((p) => { const q = verifyQuote(items, p.quote, p.name); return { name: String(p.name).slice(0, 40), pos: normalisePos(p.pos) || inferPos(`${p.detail || ""} ${itemsNaming(items, p.name)}`), status: p.status, detail: String(p.detail || "").slice(0, 60), source: q?.source || String(p.source || "").slice(0, 40), quote: q?.quote || null, link: q?.link || null, published: q?.published || null, note: tidyNote(p.note) }; });
    return { players };
  } catch { return { players: [], error: "bad model json" }; }
}

// --- Expert picks ----------------------------------------------------------
// The outlets that publish a pick for the game, one tile each. Articles
// come from the site feed (the runner searches "prediction", "picks" and
// "against the spread" per game and fetches the bodies). The model names
// the outlet, the team it took, whether that is against the spread or
// straight up, the line as written and a predicted score if the piece
// gives one. A pick stands only when the team named is one of the two
// in the game. Cached six hours, stale reads refreshed behind the response.
export const picksKey = (week, gameId) => `pk:v4:w${week}:g${gameId}`;
const PICK_TIER = [/cbs ?sports/i, /sports illustrated|\bsi\b/i, /the athletic/i, /\bcovers\b/i, /action network/i, /pickswise/i, /yahoo/i, /bleacher report/i, /fox sports/i, /usa today/i, /sportsline/i, /oddsshark/i, /dimers/i, /\bpff\b/i, /sporting news/i, /new york post|ny post/i, /on3/i, /247sports/i, /athlon/i, /saturday down south|saturday tradition|saturday blitz/i, /college football news/i, /betsided|fansided/i, /the spun/i];
export const outletRank = (name) => { const i = PICK_TIER.findIndex((re) => re.test(String(name || ""))); return i < 0 ? PICK_TIER.length : i; };
export function picksPrompt() {
  return [
    "You extract published game picks for one college football game from article headlines and bodies.",
    "Read each piece to its end. A staff picks piece lists several people, each with their own pick, line and score: return every one of them as a separate entry, never only the first. Return one entry per outlet and per named picker: the outlet name, the picker's name if given (else empty), the team picked exactly as one of the two teams given, whether the pick is against the spread ('ATS'), straight up ('SU') or the piece gives both ('BOTH'), the point spread as written for that team if stated (e.g. '-3.5', '+7') else empty (a moneyline such as -172 is not a spread: put it in 'ml' instead, else empty), a predicted final score as 'AA-HH' (away first) if given else empty, and the reason in at most twelve words.",
    "Only include a pick the text states plainly. Never guess from tone, never include a pick for another game, and never invent a line or score. If nothing qualifies, return an empty list.",
    "Also copy, character for character from the text, the one short passage (at most twenty words) where the piece states the predicted score, or the pick itself if it gives no score, as 'quote'. Copy it exactly as written, never paraphrase; empty if there is no such passage.",
    "Return JSON: {\"picks\": [{\"outlet\": \"\", \"picker\": \"\", \"team\": \"\", \"side\": \"ATS\", \"line\": \"\", \"ml\": \"\", \"score\": \"\", \"reason\": \"\", \"quote\": \"\"}]}",
  ].join(" ");
}
// Which side of the game a team name means. The slate names schools
// without mascots ("Virginia Tech", "Penn State") and the model is told to
// answer with one of the two names given, so the full name and the short
// name are the aliases, whole word, and anything matching both or neither
// is refused.
export function teamAliases(full, short) {
  return [...new Set([searchName(full).toLowerCase(), String(short || "").toLowerCase()].filter((x) => x.length >= 2))];
}
export function sideOf(game, text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const hit = (al) => al.some((x) => new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t));
  const a = hit(teamAliases(game.away, game.awayShort)), h = hit(teamAliases(game.home, game.homeShort));
  return a && !h ? "away" : h && !a ? "home" : null;
}
// Find a model-copied passage in the articles we actually read, and hand
// back the article's own characters for it (curly quotes and all), since a
// text fragment only matches what is on the page.
export function findPassage(items, quote) {
  const q = String(quote || "").replace(/\s+/g, " ").trim();
  if (q.length < 12) return null;
  const fold = (t) => t.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").toLowerCase();
  const fq = fold(q);
  for (const it of items) {
    const body = String(it?.blurb || "").replace(/\s+/g, " ");
    const at = fold(body).indexOf(fq);
    if (at >= 0) return { item: it, text: body.slice(at, at + q.length) };
  }
  return null;
}
// https://example.com/a#:~:text=... ; long passages use start,end so a
// small difference in the middle (an ad, a link) does not break the match.
export function textFragmentLink(url, text) {
  const enc = (t) => encodeURIComponent(t).replace(/-/g, "%2D");
  const words = String(text).split(" ");
  const directive = words.length > 10 ? `${enc(words.slice(0, 4).join(" "))},${enc(words.slice(-4).join(" "))}` : enc(text);
  return `${String(url).split("#")[0]}#:~:text=${directive}`;
}
export async function extractPicks(env, game, items) {
  if (!items.length) return { picks: [] };
  if (!env.OPENAI_API_KEY) return { picks: [], error: "no model key" };
  const ordered = [...items].sort((a, b) => (b.blurb ? b.blurb.length : 0) - (a.blurb ? a.blurb.length : 0));
  const text = ordered.map((n, i) => `- [#${i} ${n.source || "news"}] ${n.headline}${n.blurb ? ` — ${n.blurb.slice(0, 12000)}` : ""}`).join("\n").slice(0, 60000);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: picksPrompt() }, { role: "user", content: `Game: ${searchName(game.away)} (away) at ${searchName(game.home)} (home). Sealed line: ${searchName(game.favorite)} -${game.spread}.\n${text}` }],
      response_format: { type: "json_schema", json_schema: { name: "picks", strict: true, schema: { type: "object", additionalProperties: false, required: ["picks"], properties: { picks: { type: "array", items: { type: "object", additionalProperties: false, required: ["outlet", "picker", "team", "side", "line", "ml", "score", "reason", "quote"], properties: { outlet: { type: "string" }, picker: { type: "string" }, team: { type: "string" }, side: { type: "string", enum: ["ATS", "SU", "BOTH"] }, line: { type: "string" }, ml: { type: "string" }, score: { type: "string" }, reason: { type: "string" }, quote: { type: "string" } } } } } } } },
      temperature: 0,
    }),
  });
  if (!res.ok) return { picks: [], error: `model ${res.status}` };
  try {
    const parsed = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}");
    const seen = new Set();
    const picks = (parsed.picks || []).map((p) => {
      const side = sideOf(game, p.team);
      if (!side || !p.outlet) return null;
      const outlet = String(p.outlet).trim().slice(0, 40);
      const item = ordered.find((n) => String(n.source || "").toLowerCase() === outlet.toLowerCase()) || ordered.find((n) => new RegExp(outlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(n.source || "")) || null;
      const score = /^\d{1,2}-\d{1,2}$/.test(String(p.score || "").trim()) ? String(p.score).trim() : "";
      // A spread is a small number with a half point at most; three digits
      // is a moneyline whatever field the model put it in.
      const num = (v) => { const t = String(v || "").trim().replace(/[^\d.+-]/g, ""); return /^[+-]?\d+(\.\d)?$/.test(t) ? t : ""; };
      let line = num(p.line), ml = num(p.ml);
      if (line && Math.abs(Number(line)) >= 30) { ml = ml || line; line = ""; }
      if (line && !/^[+-]/.test(line)) line = `-${line}`;
      // The link opens on the prediction itself when the quote is really
      // in the piece we read: a text fragment scrolls to it and highlights it.
      const found = findPassage(item ? [item, ...ordered] : ordered, p.quote);
      const base = found?.item.link || item?.link || null;
      return { outlet, picker: String(p.picker || "").trim().slice(0, 40), side, type: p.side, line: line.slice(0, 6), ml: ml.slice(0, 6), score, reason: String(p.reason || "").trim().slice(0, 90), link: found && found.item.link ? textFragmentLink(found.item.link, found.text) : base, quote: found?.text || "" };
    }).filter(Boolean)
      // One tile per outlet and picker.
      .filter((p) => { const k = `${p.outlet}|${p.picker}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => outletRank(a.outlet) - outletRank(b.outlet)).slice(0, 16);
    return { picks };
  } catch { return { picks: [], error: "bad model json" }; }
}
export async function gamePicks(env, week, game, ctx = null) {
  const key = picksKey(week, game.id);
  const hit = await env.LIFTR_KV.get(key, "json");
  const has = !!hit?.picks?.length;
  const fresh = hit && Date.now() - hit.at < (has ? 6 * 3600 * 1000 : 30 * 60 * 1000);
  if (fresh) return hit;
  if (hit && has && ctx && !(hit.refreshing && Date.now() - hit.refreshing < 2 * 60 * 1000)) {
    try { await env.LIFTR_KV.put(key, JSON.stringify({ ...hit, refreshing: Date.now() }), { expirationTtl: 24 * 3600 }); } catch {}
    ctx.waitUntil(refreshPicks(env, week, game, key).catch((err) => console.error("picks refresh", String(err?.message || err))));
    return { ...hit, stale: true };
  }
  return refreshPicks(env, week, game, key);
}
async function refreshPicks(env, week, game, key) {
  let items = [], siteError = null;
  try {
    const r = await fetchText(`${env.FEEDS_URL || "https://raw.githubusercontent.com/Jstoll1/liftr/main/data/feeds"}/w${week}.json`, "application/json", null);
    if (r.ok) items = JSON.parse(r.text)?.games?.[String(game.id)]?.picks || []; else siteError = r.error;
  } catch (err) { siteError = String(err?.message || err).slice(0, 80); }
  items = (Array.isArray(items) ? items : []).filter((n) => n && typeof n.headline === "string").slice(0, 12);
  const r = await extractPicks(env, game, items);
  const out = { at: Date.now(), picks: r.picks, articles: items.length, siteError, error: r.error || null };
  if (!out.error) { try { await env.LIFTR_KV.put(key, JSON.stringify(out), { expirationTtl: 24 * 3600 }); } catch {} }
  // The last read before kickoff is the record the expert tally grades.
  // It never expires; a read after kickoff never touches it.
  if (!out.error && out.picks.length && Date.now() < new Date(game.kickoff).getTime()) {
    try { await env.LIFTR_KV.put(pickArchiveKey(week, game.id), JSON.stringify({ at: out.at, picks: out.picks })); } catch {}
  }
  return out;
}
export const pickArchiveKey = (week, gameId) => `pkarc:w${week}:g${gameId}`;

// `fromPhone` is what the phone could reach that the Worker cannot:
// ESPN's team news and GDELT. It is merged with the Worker's own search.
// A read that found players is good for three hours; an empty one is
// retried after fifteen minutes, since the feeds come and go.
// `ctx` (the Worker's execution context) lets a stale answer go out at
// once while the refresh runs on after the response: the sheet paints
// the last good read in a few hundred milliseconds instead of waiting
// twenty seconds for two searches and two model calls.
export async function gameInjuries(env, week, game, fromPhone = null, ctx = null) {
  const key = injuriesKey(week, game.id);
  const hit = await env.LIFTR_KV.get(key, "json");
  const hasRows = !!(hit?.away?.length || hit?.home?.length);
  const fresh = hit && Date.now() - hit.at < (hasRows ? 3 * 3600 * 1000 : 15 * 60 * 1000);
  if (fresh && hasRows) return hit;
  if (fresh && !fromPhone && hit.site) return hit;
  if (hit && hasRows && ctx && !fromPhone && !(hit.refreshing && Date.now() - hit.refreshing < 2 * 60 * 1000)) {
    // Stale but usable: answer now, refresh behind the response. The
    // marker keeps a burst of opens from each starting a refresh.
    try { await env.LIFTR_KV.put(key, JSON.stringify({ ...hit, refreshing: Date.now() }), { expirationTtl: 24 * 3600 }); } catch {}
    ctx.waitUntil(refreshInjuries(env, week, game, key).catch((err) => console.error("injuries refresh", String(err?.message || err))));
    return { ...hit, stale: true };
  }
  return refreshInjuries(env, week, game, key, fromPhone);
}
async function refreshInjuries(env, week, game, key, fromPhone = null) {
  const clean = (list) => (Array.isArray(list) ? list : []).filter((n) => n && typeof n.headline === "string").slice(0, 12).map((n) => ({ headline: String(n.headline).slice(0, 200), blurb: n.blurb ? String(n.blurb).slice(0, 3000) : null, source: n.source ? String(n.source).slice(0, 60) : null, link: typeof n.link === "string" ? n.link.slice(0, 300) : null, published: n.published || null }));
  // The site's feed file, pulled by the scheduled Action from a network the
  // news hosts do not throttle, carries article bodies. Read it here too so
  // the extraction does not depend on a phone forwarding it.
  // Read from GitHub's raw URL rather than the site itself: a Worker fetch
  // to a domain on its own Cloudflare zone is refused intermittently.
  let siteInj = null, siteError = null;
  try {
    const r = await fetchText(`${env.FEEDS_URL || "https://raw.githubusercontent.com/Jstoll1/liftr/main/data/feeds"}/w${week}.json`, "application/json", null);
    if (r.ok) siteInj = JSON.parse(r.text)?.games?.[String(game.id)]?.injuries || null; else siteError = r.error;
  } catch (err) { siteError = String(err?.message || err).slice(0, 80); }
  // The Worker's own Google and Bing searches are throttled from its
  // address range and mostly return headlines without bodies. When the
  // site feed already carries articles for a team, skip them: that
  // alone saves several seconds of retries on a cold read.
  const own = (team, have) => have.length >= 2 ? Promise.resolve(Object.assign([], { raw: ["skipped: feed has articles"] })) : injuryNewsFor(team, env);
  const [ownAway, ownHome] = await Promise.all([own(game.away, siteInj?.away || []), own(game.home, siteInj?.home || [])]);
  // Copies with a body go first so the dedupe keeps them over a bare
  // headline from the Worker's own search.
  const merge = (own, extra) => { const all = filterNews([...clean(extra), ...own].sort((a, b) => (b.blurb ? b.blurb.length : 0) - (a.blurb ? a.blurb.length : 0))); const kept = all.filter((n) => /injur|questionable|doubtful|ruled out|availability|probable|suspend|return|status|limited|practice/i.test(`${n.headline} ${n.blurb || ""}`)).slice(0, 10); kept.raw = own.raw; kept.sent = clean(extra).length; return kept; };
  const awayNews = merge(ownAway, [...(siteInj?.away || []), ...(fromPhone?.away || [])]), homeNews = merge(ownHome, [...(siteInj?.home || []), ...(fromPhone?.home || [])]);
  // A dated piece older than eight days is about an earlier game; an
  // undated one stays, and the prompt names this week's opponent so the
  // model can tell old news apart in the text itself.
  const recent = (list) => { const cut = Date.now() - 8 * 24 * 3600 * 1000; const kept = list.filter((n) => !n.published || isNaN(Date.parse(n.published)) || Date.parse(n.published) >= cut); kept.raw = list.raw; kept.sent = list.sent; return kept; };
  const ctx = { game: `${searchName(game.away)} at ${searchName(game.home)}`, kickoff: game.kickoffLabel || game.kickoff || "" };
  const [away, home, awayRoster, homeRoster] = await Promise.all([extractInjuries(env, game.away, recent(awayNews), ctx), extractInjuries(env, game.home, recent(homeNews), ctx), rosterPositions(env, game.awayId), rosterPositions(env, game.homeId)]);
  away.players = fillPositions(ownPlayersOnly(away.players, awayRoster, homeRoster), awayRoster); home.players = fillPositions(ownPlayersOnly(home.players, homeRoster, awayRoster), homeRoster);
  const srcs = (items) => items.map((n) => ({ headline: n.headline, link: n.link, source: n.source, published: n.published })).slice(0, 4);
  const out = { at: Date.now(), site: !!siteInj, siteError, away: away.players, home: home.players, sources: { away: srcs(awayNews), home: srcs(homeNews) }, found: { away: awayNews.length, home: homeNews.length, awaySources: awayNews.raw, homeSources: homeNews.raw, fromPhone: { away: awayNews.sent || 0, home: homeNews.sent || 0 } }, error: away.error || home.error || null };
  if (!out.error) { try { await env.LIFTR_KV.put(key, JSON.stringify(out), { expirationTtl: 24 * 3600 }); } catch {} }
  return out;
}
