// Live fantasy season for the history chat. The league is public on ESPN,
// so the league API answers with just the league id (Worker secret
// ESPN_LEAGUE_ID); the espn_s2 and SWID cookies (ESPN_S2, ESPN_SWID) are
// optional, used if set and dropped if ESPN turns them away. A cron pulls
// the current season into KV; the archive reads it and falls back to the
// bundled export when it is missing. Each pull's outcome is kept under
// STATUS_KEY so a failing pull is visible.
export const CURRENT_KEY = "history:current";
export const STATUS_KEY = "history:current:status";
const MAX_AGE = 6 * 3600 * 1000;

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
  const results = [], scores = [], margins = [];
  let weeksPlayed = 0;
  for (const m of [...(league.schedule || [])].sort((a, b) => a.matchupPeriodId - b.matchupPeriodId)) {
    if (!m.home || !m.away || m.winner === "UNDECIDED") continue;
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
    note: `Live ${year} season as of the pull time; ranked by wins then points for. Not final.` };
}

export async function pullCurrentSeason(env, ownerMap, { force = false, now = Date.now() } = {}) {
  if (!env.ESPN_LEAGUE_ID) return { skipped: "no ESPN_LEAGUE_ID" };
  if (!force) {
    const prev = await env.LIFTR_KV.get(CURRENT_KEY, "json");
    if (prev && now - Date.parse(prev.exportedAt) < MAX_AGE) return { skipped: "fresh" };
  }
  const year = new Date(now).getUTCFullYear();
  const qs = ["mTeam", "mMatchup", "mSettings"].map((v) => `view=${v}`).join("&");
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
  await env.LIFTR_KV.put(CURRENT_KEY, JSON.stringify(cur));
  await status({ ok: true, how, weeksPlayed: cur.weeksPlayed });
  return { weeksPlayed: cur.weeksPlayed, how };
}
