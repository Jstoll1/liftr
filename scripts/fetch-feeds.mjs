// Fetch game news and injury coverage for the current slate from a GitHub
// runner, which Google and Bing do not throttle the way they throttle the
// Worker, and write it to data/feeds/w<week>.json for GitHub Pages to
// serve. The phone reads that file from brochiefs.com and sends the
// injury articles to the Worker's model for extraction.
//
// Read-only against the Worker; writes one JSON file. Run: node scripts/fetch-feeds.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { parseGoogleNewsRss, parseBingNewsRss, filterNews, searchName } from "../worker/src/insights.js";

const WORKER = process.env.WORKER_URL || "https://liftr-ai.jhs797.workers.dev";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rss(url, bing = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml", "Accept-Language": "en-US,en;q=0.9" } });
      if (res.ok) return { items: bing ? parseBingNewsRss(await res.text()) : parseGoogleNewsRss(await res.text()) };
      if (res.status !== 503 && res.status !== 429) return { items: [], error: `HTTP ${res.status}` };
      await sleep(1500 * (attempt + 1));
    } catch (err) { return { items: [], error: String(err?.message || err) }; }
  }
  return { items: [], error: "throttled" };
}
const google = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:7d&hl=en-US&gl=US&ceid=US:en`;
const bing = (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=interval%3d%228%22`;
const INJ = /injur|questionable|doubtful|ruled out|availability|probable|suspend|return|status|limited|practice/i;

const weeks = await (await fetch(`${WORKER}/weeks`)).json();
const week = Number(process.env.WEEK || weeks?.weeks?.current);
if (!week) { console.error("no current week"); process.exit(1); }
const slate = await (await fetch(`${WORKER}/games?week=${week}`)).json();
const games = slate?.games || [];
console.log(`week ${week}: ${games.length} games`);

const out = { at: Date.now(), week, games: {}, errors: [] };
for (const g of games) {
  const A = searchName(g.away), H = searchName(g.home);
  const pulls = {
    game: [rss(google(`"${A}" "${H}" football`)), rss(bing(`${A} ${H} football`), true)],
    away: [rss(google(`"${A}" football`)), rss(bing(`"${A}" football`), true)],
    home: [rss(google(`"${H}" football`)), rss(bing(`"${H}" football`), true)],
    awayInj: [rss(google(`"${A}" football injury report`)), rss(google(`"${A}" football injury OR questionable OR doubtful OR "ruled out"`))],
    homeInj: [rss(google(`"${H}" football injury report`)), rss(google(`"${H}" football injury OR questionable OR doubtful OR "ruled out"`))],
  };
  const got = {};
  for (const [k, ps] of Object.entries(pulls)) {
    const rs = await Promise.all(ps);
    got[k] = filterNews(rs.flatMap((r) => r.items));
    for (const r of rs) if (r.error) out.errors.push(`g${g.id} ${k}: ${r.error}`);
  }
  const tag = (list, about) => list.map((n) => ({ headline: n.headline, source: n.source, link: n.link, blurb: n.blurb || null, published: n.published, about }));
  const injOnly = (list) => list.filter((n) => INJ.test(`${n.headline} ${n.blurb || ""}`));
  out.games[g.id] = {
    news: [...tag(got.game, "game"), ...tag(got.away, "away"), ...tag(got.home, "home")].slice(0, 30),
    injuries: { away: tag(injOnly([...got.awayInj, ...got.away]), "away").slice(0, 10), home: tag(injOnly([...got.homeInj, ...got.home]), "home").slice(0, 10) },
  };
  console.log(`g${g.id} ${A} at ${H}: news ${out.games[g.id].news.length}, injury articles ${out.games[g.id].injuries.away.length}/${out.games[g.id].injuries.home.length}`);
  await sleep(800);
}
await mkdir("data/feeds", { recursive: true });
await writeFile(`data/feeds/w${week}.json`, JSON.stringify(out));
console.log(`wrote data/feeds/w${week}.json; ${out.errors.length} feed errors`);
