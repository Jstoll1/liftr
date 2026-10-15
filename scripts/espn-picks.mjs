// NFL only. ESPN's analysts pick every NFL game straight up on
// espn.com/nfl/picks. The page refuses plain requests from servers but
// serves a real browser, so this opens it in headless Chrome on the
// GitHub runner, reads the page's own data (picksData: one row per game,
// one cell per analyst, the pick shown as the chosen team's logo) and adds
// each slate game's picks to data/feeds/w<week>.json as games[id].espn.
// Run after fetch-feeds.mjs: SPORT=nfl node scripts/espn-picks.mjs
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// ESPN's NFL team ids (the slate's awayId/homeId) to the abbreviations in
// its logo paths.
const ABBR = { 1: "atl", 2: "buf", 3: "chi", 4: "cin", 5: "cle", 6: "dal", 7: "den", 8: "det", 9: "gb", 10: "ten", 11: "ind", 12: "kc", 13: "lv", 14: "lar", 15: "mia", 16: "min", 17: "ne", 18: "no", 19: "nyg", 20: "nyj", 21: "phi", 22: "ari", 23: "pit", 24: "lac", 25: "sf", 26: "sea", 27: "tb", 28: "wsh", 29: "car", 30: "jax", 33: "bal", 34: "hou" };
const WORKER = process.env.WORKER_URL || "https://liftr-nfl.jhs797.workers.dev";

const weeks = await (await fetch(`${WORKER}/weeks`)).json();
const week = Number(process.env.WEEK || weeks?.weeks?.current);
const file = `data/feeds/w${week}.json`;
let feed;
try { feed = JSON.parse(await readFile(file, "utf8")); } catch { console.log(`no ${file}; run fetch-feeds first`); process.exit(0); }
const slate = (await (await fetch(`${WORKER}/games?week=${week}`)).json())?.games || [];

const browser = await chromium.launch();
let pd = null;
try {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" });
  await page.goto("https://www.espn.com/nfl/picks", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__espnfitt__?.page?.content?.picksData, null, { timeout: 30000 }).catch(() => {});
  pd = await page.evaluate(() => window.__espnfitt__?.page?.content?.picksData || null);
} finally { await browser.close(); }
if (!pd?.rows?.length || !Array.isArray(pd.header)) { console.log("ESPN picks: none on the page"); process.exit(0); }
// The page is ESPN's current week; only use it for the same week.
const pageWeek = Number(String(pd.title || "").match(/Week\s+(\d+)/i)?.[1]);
if (pageWeek && pageWeek !== week) { console.log(`ESPN picks are for week ${pageWeek}, slate is week ${week}; skipped`); process.exit(0); }

const experts = new Map(pd.header.filter((h) => h && h.id).map((h) => [String(h.id), { name: h.headshot?.alt || h.name || "", record: h.overall || "" }]));
const abbrOf = (logo) => (String(logo || "").match(/\/500\/([a-z]+)\.png/) || [])[1] || "";
let matched = 0;
for (const g of slate) {
  const a = ABBR[g.awayId], h = ABBR[g.homeId];
  if (!a || !h) continue;
  const row = pd.rows.find((r) => { const t = String(r?.[0]?.teams || "").toLowerCase().split(/\s+(?:at|vs)\s+/); return t.length === 2 && t.includes(a) && t.includes(h); });
  if (!row) continue;
  const picks = row.slice(1).map((c) => {
    const who = experts.get(String(c?.id)), team = abbrOf(c?.logo);
    if (!who?.name || !team) return null;
    return { name: who.name, record: who.record, side: team === a ? "away" : team === h ? "home" : null };
  }).filter((p) => p && p.side);
  if (!picks.length) continue;
  feed.games[g.id] = { ...(feed.games[g.id] || {}), espn: { at: Date.now(), link: "https://www.espn.com/nfl/picks", picks } };
  matched++;
}
await writeFile(file, JSON.stringify(feed));
console.log(`ESPN picks: ${matched} of ${slate.length} games, ${experts.size} analysts`);
