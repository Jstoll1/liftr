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
  // Names a headline can use for a team: the slate's short name, the
  // school's first word, and the mascot. "Pitt", "Pittsburgh", "Panthers".
  // "Panthers" is also an NFL team and "Virginia" is also the Cavaliers, so
  // the school name minus its mascot is the anchor, the short name joins
  // it, and a mascot counts only when no other team uses it.
  const SHARED = /^(panthers|tigers|eagles|bulldogs|wildcats|cardinals|cowboys|giants|lions|bears|rams|jets|ravens|falcons|saints|broncos|chiefs|colts|texans|titans|jaguars|dolphins|bills|patriots|steelers|bengals|browns|packers|vikings|commanders|buccaneers|chargers|seahawks|cavaliers|spartans|trojans|knights|warriors|bears|huskies|aggies|cougars|rebels|owls|hawks|rams|pirates|bobcats|mustangs|bruins)$/;
  const aliases = (full, short) => { const w = searchName(full).toLowerCase().split(/\s+/); const school = w.length > 1 ? w.slice(0, -1).join(" ") : w[0]; const mascot = w.length > 1 ? w[w.length - 1] : ""; return [school, String(short || "").toLowerCase(), SHARED.test(mascot) ? "" : mascot].filter((x) => x.length >= 4); };
  const wholeWord = (h, x) => new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(h);
  const aA = aliases(g.away, g.awayShort), aH = aliases(g.home, g.homeShort);
  const names = (list, al) => list.filter((n) => { const h = String(n.headline).toLowerCase(); return al.some((x) => wholeWord(h, x)); });
  const injOnly = (list, al) => names(list, al).filter((n) => INJ.test(`${n.headline} ${n.blurb || ""}`));
  out.games[g.id] = {
    news: [...tag(names(got.game, [...aA, ...aH]), "game"), ...tag(names(got.away, aA), "away"), ...tag(names(got.home, aH), "home")].slice(0, 30),
    injuries: { away: tag(injOnly([...got.awayInj, ...got.away], aA), "away").slice(0, 10), home: tag(injOnly([...got.homeInj, ...got.home], aH), "home").slice(0, 10) },
  };
  console.log(`g${g.id} ${A} at ${H}: news ${out.games[g.id].news.length}, injury articles ${out.games[g.id].injuries.away.length}/${out.games[g.id].injuries.home.length}`);
  await sleep(800);
}
await mkdir("data/feeds", { recursive: true });
await writeFile(`data/feeds/w${week}.json`, JSON.stringify(out));
console.log(`wrote data/feeds/w${week}.json; ${out.errors.length} feed errors`);
