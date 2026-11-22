// Live fantasy season for the history chat. The league is public on ESPN,
// so the league API answers with just the league id (Worker secret
// ESPN_LEAGUE_ID); the espn_s2 and SWID cookies (ESPN_S2, ESPN_SWID) are
// optional, used if set and dropped if ESPN turns them away. A cron pulls
// the current season into KV; the archive reads it and falls back to the
// bundled export when it is missing. Each pull's outcome is kept under
// STATUS_KEY so a failing pull is visible.
import { fantasyStats } from "./fantasy-stats.js";
export const CURRENT_KEY = "history:current";
export const STATUS_KEY = "history:current:status";
const MAX_AGE = 6 * 3600 * 1000;
// During NFL games (Eastern: Thursday 8 PM on, Sunday 1 PM on, Monday 8 PM
// on, and the small hours after each) the live week refreshes every two
// minutes; otherwise every three hours.
export function inNflWindow(now = Date.now()) {
  const et = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), h = et.getHours();
  return (d === 4 && h >= 20) || (d === 0 && h >= 13) || (d === 1 && (h < 2 || h >= 20)) || (d === 5 && h < 2) || (d === 2 && h < 2);
}
export const freshFor = (now = Date.now()) => (inNflWindow(now) ? 2 * 60000 : 3 * 3600000);

const r2 = (x) => Math.round(x * 100) / 100;

// Pure: ESPN league JSON (mTeam + mMatchup + mSettings) -> currentSeason block.
export function buildCurrentSeason(league, ownerMap, year, now = Date.now()) {
  const ownerOf = {};
  for (const t of league.teams || []) {
    const hits = new Set((t.owners || []).map((id) => ownerMap[id]).filter(Boolean));
    if (hits.size !== 1) throw new Error(`team ${t.id} has no known owner`);
    ownerOf[t.id] = [...hits][0];
  }
  const rec = {};
  for (const o of Object.values(ownerOf)) rec[o] = { owner: o, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
  const reg = league.settings?.scheduleSettings?.matchupPeriodCount || 13;
  const results = [], scores = [], margins = [], remaining = [];
  let weeksPlayed = 0;
  for (const m of [...(league.schedule || [])].sort((a, b) => a.matchupPeriodId - b.matchupPeriodId)) {
    if (!m.home || !m.away) continue;
    if (m.winner === "UNDECIDED") { if (m.matchupPeriodId <= reg) remaining.push({ week: m.matchupPeriodId, home: ownerOf[m.home.teamId], away: ownerOf[m.away.teamId] }); continue; }
    const h = ownerOf[m.home.teamId], a = ownerOf[m.away.teamId];
    const hp = m.home.totalPoints ?? 0, ap = m.away.totalPoints ?? 0, wk = m.matchupPeriodId;
    weeksPlayed = Math.max(weeksPlayed, wk);
    for (const [o, me, them] of [[h, hp, ap], [a, ap, hp]]) {
      const x = rec[o]; x.pointsFor = r2(x.pointsFor + me); x.pointsAgainst = r2(x.pointsAgainst + them);
      x[me > them ? "wins" : me < them ? "losses" : "ties"] += 1;
    }
    scores.push({ owner: h, points: hp, week: wk, opponent: a }, { owner: a, points: ap, week: wk, opponent: h });
    margins.push({ winner: hp >= ap ? h : a, loser: hp >= ap ? a : h, margin: r2(Math.abs(hp - ap)), week: wk, score: `${Math.max(hp, ap)}-${Math.min(hp, ap)}` });
    const [w, l] = hp >= ap ? [h, a] : [a, h];
    results.push(`W${wk}${wk > reg ? " playoff" : ""}: ${w} ${Math.max(hp, ap)} def. ${l} ${Math.min(hp, ap)}`);
  }
  const standings = Object.values(rec).sort((x, y) => y.wins - x.wins || y.pointsFor - x.pointsFor).map((x, i) => ({ ...x, rank: i + 1 }));
  // Record leaderboards for this season, so "ever" and "all time" questions
  // weigh the season in progress against the archive.
  const line = (x) => `${x.owner} ${x.points} in ${year} week ${x.week} vs ${x.opponent}`;
  const records = {
    highestWeeklyScores: [...scores].sort((a, b) => b.points - a.points).slice(0, 5).map(line),
    lowestWeeklyScores: [...scores].filter((x) => x.points > 0).sort((a, b) => a.points - b.points).slice(0, 5).map(line),
    biggestWins: [...margins].sort((a, b) => b.margin - a.margin).slice(0, 3).map((x) => `${x.winner} over ${x.loser} by ${x.margin} (${x.score}) in ${year} week ${x.week}`),
    closestGames: [...margins].sort((a, b) => a.margin - b.margin).slice(0, 3).map((x) => `${x.winner} over ${x.loser} by ${x.margin} (${x.score}) in ${year} week ${x.week}`),
  };
  return { year, exportedAt: new Date(now).toISOString(), regularSeasonWeeks: reg, weeksPlayed, standings, results, records,
    rosters: buildRosters(league, ownerOf, year),
    weekly: scores.map((x) => ({ week: x.week, owner: x.owner, points: x.points, opponent: x.opponent })),
    remaining,
    playoffTeams: Number(league.settings?.scheduleSettings?.playoffTeamCount) || 6,
    playoffTiebreak: league.settings?.scheduleSettings?.playoffSeedingRule || null,
    // Divisions and each owner's division, to check how playoff spots are seeded.
    divisions: (league.settings?.scheduleSettings?.divisions || []).map((d) => ({ id: d.id, name: d.name, size: d.size })),
    divisionOf: Object.fromEntries((league.teams || []).map((tm) => [ownerOf[tm.id], tm.divisionId]).filter(([o]) => o)),
    seedingSettings: Object.fromEntries(Object.entries(league.settings?.scheduleSettings || {}).filter(([k, v]) => /playoff|seed|tie|division/i.test(k) && (typeof v !== "object" || v === null))),
    currentScoringPeriod: Number(league.scoringPeriodId || league.status?.currentMatchupPeriod || 0) || null,
    teams: Object.fromEntries((league.teams || []).map((t) => [ownerOf[t.id], { name: t.name || [t.location, t.nickname].filter(Boolean).join(" "), abbrev: t.abbrev || null, logo: t.logo || null }])),
    note: `Live ${year} season as of the pull time; ranked by wins then points for. Not final.` };
}

// ESPN's lineup slots and positions, and NFL team ids, for the live week.
const SLOT = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K", 23: "FLEX", 20: "BE", 21: "IR" };
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"];
const NFL = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };

// Every team's roster for the season: each player's season points, average
// a game, ESPN's full-season projection, position, NFL team, injury and
// lineup slot, best first. From mRoster on the season read.
export function buildRosters(league, ownerOf, year) {
  const out = {};
  for (const t of league.teams || []) {
    const o = ownerOf[t.id]; if (!o) continue;
    out[o] = (t.roster?.entries || []).map((e) => {
      const p = e.playerPoolEntry?.player || {};
      const stat = (src) => (p.stats || []).find((x) => x.statSourceId === src && x.statSplitTypeId === 0 && (!x.seasonId || Number(x.seasonId) === Number(year)));
      const season = stat(0), proj = stat(1);
      return { id: p.id || null, name: p.fullName || "Player", pos: POS[p.defaultPositionId] || "", slot: SLOT[e.lineupSlotId] || "BE", nfl: NFL[p.proTeamId] || null,
        injury: p.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : null,
        season: Math.round((season?.appliedTotal || 0) * 10) / 10, avg: Math.round((season?.appliedAverage || 0) * 10) / 10,
        proj: proj?.appliedTotal != null ? Math.round(proj.appliedTotal) : null,
        acquired: e.acquisitionType || null };
    }).sort((a, b) => b.season - a.season);
  }
  return out;
}

// The most a lineup could have scored: fill the starting slots with the
// highest scorers eligible for each, rarest slot first (QB, K, D/ST, TE,
// then RB and WR, FLEX last). Greedy, which is exact for these slots.
export function bestLineup(players, slots) {
  const order = ["QB", "K", "D/ST", "TE", "RB", "WR", "FLEX"];
  const left = [...players].sort((a, b) => b.pts - a.pts), used = new Set();
  let total = 0;
  for (const slot of [...slots].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const fits = (x) => !used.has(x) && ((x.elig || []).length ? x.elig.includes(slot) : (slot === "FLEX" ? ["RB", "WR", "TE"].includes(x.pos) : x.pos === slot));
    const pick = left.find(fits);
    if (pick) { used.add(pick); total += pick.pts; }
  }
  return Math.round(total * 100) / 100;
}

// Pure: ESPN league JSON for one scoring period (mTeam + mMatchup +
// mMatchupScore with scoringPeriodId) -> this week's matchups, each side
// with its team name, logo, live total and lineup (starters, then bench).
export function buildLiveWeek(league, ownerMap) {
  const week = Number(league.status?.currentMatchupPeriod || league.scoringPeriodId || 0);
  const team = {};
  for (const t of league.teams || []) {
    const owner = (t.owners || []).map((id) => ownerMap[id]).find(Boolean) || null;
    team[t.id] = { owner, name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") || owner, abbrev: t.abbrev || null, logo: t.logo || null,
      record: t.record?.overall ? `${t.record.overall.wins}-${t.record.overall.losses}${t.record.overall.ties ? `-${t.record.overall.ties}` : ""}` : null };
  }
  // A player's box score in a few words (ESPN stat ids), e.g. "22/31 280 yd 2 TD".
  const statLine = (a, pos) => {
    if (!a) return null; const v = (k) => Math.round(Number(a[k]) || 0), out = [];
    const td = (n, w) => n ? `${n > 1 ? n + " " : ""}${w}` : "";
    if (pos === "K") return v(84) || v(87) ? `FG ${v(83)}/${v(84)} · XP ${v(86)}/${v(87)}` : null;
    if (pos === "D/ST") return [`${v(120)} PA`, v(99) && `${v(99)} sk`, v(95) && `${v(95)} INT`, v(96) && `${v(96)} FR`].filter(Boolean).join(" · ");
    if (v(0)) out.push(`${v(1)}/${v(0)} ${v(3)} yd`, td(v(4), "TD"), td(v(20), "INT"));
    if (v(23)) out.push(`${v(23)} car ${v(24)} yd`, td(v(25), "TD"));
    if (v(53) || v(58)) out.push(`${v(53)} rec ${v(42)} yd`, td(v(43), "TD"));
    if (v(72)) out.push(td(v(72), "FUM"));
    const t = out.filter(Boolean).join(" · "); return t || (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE" ? "No stats" : null);
  };
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const side = (s) => {
    if (!s) return null;
    const t = team[s.teamId] || {};
    const entries = s.rosterForCurrentScoringPeriod?.entries || s.rosterForMatchupPeriod?.entries || [];
    const players = entries.map((e) => {
      const p = e.playerPoolEntry?.player || {};
      const slot = SLOT[e.lineupSlotId] || "BE";
      const sp = Number(league.scoringPeriodId || week);
      const proj = (p.stats || []).find((x) => x.statSourceId === 1 && Number(x.scoringPeriodId) === sp)?.appliedTotal;
      const act = (p.stats || []).find((x) => x.statSourceId === 0 && Number(x.scoringPeriodId) === sp)?.stats;
      return { id: p.id || null, name: p.fullName || "Player", pos: POS[p.defaultPositionId] || slot, slot, pts: r2(e.playerPoolEntry?.appliedStatTotal), line: statLine(act, POS[p.defaultPositionId] || slot),
        proj: Number.isFinite(proj) ? r2(proj) : null, elig: (p.eligibleSlots || []).map((x) => SLOT[x]).filter((x) => x && x !== "BE" && x !== "IR"),
        nfl: NFL[p.proTeamId] || null, injury: p.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : null };
    });
    const starters = players.filter((x) => x.slot !== "BE" && x.slot !== "IR").sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    const bench = players.filter((x) => x.slot === "BE" || x.slot === "IR");
    const live = s.totalPointsLive ?? s.totalPoints;
    const points = r2(live != null ? live : starters.reduce((n, x) => n + x.pts, 0));
    return { ...t, points, starters, bench, best: bestLineup([...starters, ...bench.filter((x) => x.slot !== "IR")], starters.map((x) => x.slot)) };
  };
  const matchups = (league.schedule || []).filter((m) => Number(m.matchupPeriodId) === week && m.home && m.away)
    .map((m) => ({ id: m.id, home: side(m.home), away: side(m.away), final: m.winner && m.winner !== "UNDECIDED" }));
  return { week, matchups };
}

export async function pullCurrentSeason(env, ownerMap, { force = false, now = Date.now() } = {}) {
  if (!env.ESPN_LEAGUE_ID) return { skipped: "no ESPN_LEAGUE_ID" };
  if (!force) {
    const prev = await env.LIFTR_KV.get(CURRENT_KEY, "json");
    if (prev && now - Date.parse(prev.exportedAt) < MAX_AGE) return { skipped: "fresh" };
  }
  const year = new Date(now).getUTCFullYear();
  const qs = ["mTeam", "mMatchup", "mSettings", "mRoster"].map((v) => `view=${v}`).join("&");
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${env.ESPN_LEAGUE_ID}?${qs}`;
  const status = (x) => env.LIFTR_KV.put(STATUS_KEY, JSON.stringify({ at: now, ...x })).catch(() => {});
  const get = (cookies) => fetch(url, { headers: { Accept: "application/json", ...(cookies ? { Cookie: `espn_s2=${env.ESPN_S2}; SWID=${env.ESPN_SWID}` } : {}) } });
  const hasCookies = !!(env.ESPN_S2 && env.ESPN_SWID);
  let res = await get(hasCookies), how = hasCookies ? "cookies" : "public";
  // Stale cookies on a public league: ESPN refuses them, the plain read works.
  if (!res.ok && hasCookies && (res.status === 401 || res.status === 403)) { res = await get(false); how = "public (saved cookies refused)"; }
  if (!res.ok) { await status({ ok: false, error: `ESPN fantasy ${res.status}`, how }); throw new Error(`ESPN fantasy ${res.status}`); }
  let cur;
  try { cur = buildCurrentSeason(await res.json(), ownerMap, year, now); }
  catch (e) { await status({ ok: false, error: String(e.message || e), how }); throw e; }
  // The live week: lineups and points for the current scoring period.
  try {
    const sp = cur.currentScoringPeriod;
    if (sp) {
      const wr = await fetch(`${url.split("?")[0]}?view=mTeam&view=mMatchup&view=mMatchupScore&scoringPeriodId=${sp}`, { headers: { Accept: "application/json" } });
      if (wr.ok) cur.live = buildLiveWeek(await wr.json(), ownerMap);
    }
  } catch (e) { cur.liveError = String(e.message || e).slice(0, 120); }
  // Bench regret by week, kept across pulls: what each owner scored against
  // the best lineup their roster allowed. The current week overwrites itself
  // until it is decided, so the season total is final weeks plus this one.
  try {
    const prev = await env.LIFTR_KV.get(CURRENT_KEY, "json");
    const regret = { ...(prev?.year === cur.year ? prev?.regret || {} : {}) };
    if (cur.live?.matchups?.length) {
      const wk = {};
      for (const m of cur.live.matchups) for (const t of [m.home, m.away]) if (t?.owner && Number.isFinite(t.best)) wk[t.owner] = { points: t.points, best: t.best };
      if (Object.keys(wk).length) regret[cur.live.week] = wk;
    }
    cur.regret = regret;
    if (prev?.take && prev.year === cur.year) cur.take = prev.take;
    const oh = { ...(prev?.year === cur.year ? prev?.oddsHist || {} : {}) };
    try { const od = fantasyStats(cur)?.odds; if (od && cur.weeksPlayed) oh[cur.weeksPlayed] = Object.fromEntries(Object.entries(od).map(([o, x]) => [o, x.title])); } catch {}
    cur.oddsHist = oh;
  } catch {}
  await env.LIFTR_KV.put(CURRENT_KEY, JSON.stringify(cur));
  await status({ ok: true, how, weeksPlayed: cur.weeksPlayed, live: !!cur.live });
  return { weeksPlayed: cur.weeksPlayed, how };
}
