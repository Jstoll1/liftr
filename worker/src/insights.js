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
const SKIP_TITLES = /\b(video|watch|podcast|live stream|how to watch|stream free|highlights|odds, picks|prediction(s)?,? odds|best bets?|promo code|bonus code)\b/i;
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
export async function gameNews(env, game) {
  const key = `news:g:${game.awayId}:${game.homeId}`;
  const hit = await env.LIFTR_KV.get(key, "json");
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const q = (s) => `https://news.google.com/rss/search?q=${encodeURIComponent(s)}+when:7d&hl=en-US&gl=US&ceid=US:en`;
  const queries = [
    { tag: "game", url: q(`"${game.away}" "${game.home}" football`) },
    { tag: "away", url: q(`"${game.away}" football`) },
    { tag: "home", url: q(`"${game.home}" football`) },
  ];
  // Bing News as a second source for the same three searches, so one
  // service turning the Worker away still leaves articles.
  const bing = (s) => `https://www.bing.com/news/search?q=${encodeURIComponent(s)}&format=rss&qft=interval%3d%228%22`;
  queries.push(
    { tag: "game", url: bing(`"${game.away}" "${game.home}" football`), bing: true },
    { tag: "away", url: bing(`"${game.away}" football`), bing: true },
    { tag: "home", url: bing(`"${game.home}" football`), bing: true },
  );
  const results = await Promise.all(queries.map(async (x) => {
    try {
      const res = await fetch(x.url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
      if (!res.ok) return { tag: x.tag, items: [], error: `HTTP ${res.status}` };
      const xml = await res.text();
      return { tag: x.tag, items: (x.bing ? parseBingNewsRss(xml) : parseGoogleNewsRss(xml)).map((n) => ({ ...n, about: x.tag })) };
    } catch (err) { return { tag: x.tag, items: [], error: String(err?.message || err) }; }
  }));
  const all = filterNews(results.flatMap((r) => r.items))
    .sort((a, b) => (a.about === "game" ? 0 : 1) - (b.about === "game" ? 0 : 1) || String(b.published).localeCompare(String(a.published)));
  const out = { at: Date.now(), items: all.slice(0, 18), errors: results.filter((r) => r.error).map((r) => `${r.tag}: ${r.error}`) };
  try { await env.LIFTR_KV.put(key, JSON.stringify(out), { expirationTtl: 6 * 3600 }); } catch {}
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
