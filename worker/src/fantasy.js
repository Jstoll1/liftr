// Live fantasy season for the history chat. ESPN's league API needs the
// league's espn_s2 and SWID cookies (Worker secrets ESPN_S2, ESPN_SWID,
// ESPN_LEAGUE_ID). A cron pulls the current season into KV; the archive
// reads it and falls back to the bundled export when it is missing.
export const CURRENT_KEY = "history:current";
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
  const results = [];
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
    const [w, l] = hp >= ap ? [h, a] : [a, h];
    results.push(`W${wk}${wk > reg ? " playoff" : ""}: ${w} ${Math.max(hp, ap)} def. ${l} ${Math.min(hp, ap)}`);
  }
  const standings = Object.values(rec).sort((x, y) => y.wins - x.wins || y.pointsFor - x.pointsFor).map((x, i) => ({ ...x, rank: i + 1 }));
  return { year, exportedAt: new Date(now).toISOString(), regularSeasonWeeks: reg, weeksPlayed, standings, results,
    note: `Live ${year} season as of the pull time; ranked by wins then points for. Not final.` };
}

export async function pullCurrentSeason(env, ownerMap, { force = false, now = Date.now() } = {}) {
  if (!env.ESPN_S2 || !env.ESPN_SWID || !env.ESPN_LEAGUE_ID) return { skipped: "no ESPN fantasy secrets" };
  if (!force) {
    const prev = await env.LIFTR_KV.get(CURRENT_KEY, "json");
    if (prev && now - Date.parse(prev.exportedAt) < MAX_AGE) return { skipped: "fresh" };
  }
  const year = new Date(now).getUTCFullYear();
  const qs = ["mTeam", "mMatchup", "mSettings"].map((v) => `view=${v}`).join("&");
  const res = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${env.ESPN_LEAGUE_ID}?${qs}`, {
    headers: { Cookie: `espn_s2=${env.ESPN_S2}; SWID=${env.ESPN_SWID}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN fantasy ${res.status}`);
  const cur = buildCurrentSeason(await res.json(), ownerMap, year, now);
  await env.LIFTR_KV.put(CURRENT_KEY, JSON.stringify(cur));
  return { weeksPlayed: cur.weeksPlayed };
}
