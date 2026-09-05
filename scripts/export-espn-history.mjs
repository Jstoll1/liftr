#!/usr/bin/env node
// Export BroChiefs matchup history from ESPN's fantasy API.
//
// Run on your own machine (the cookies never leave it):
//   ESPN_LEAGUE_ID=123456 ESPN_S2='...' SWID='{...}' node scripts/export-espn-history.mjs
//
// Writes data/espn-history.json with, per season: members, teams, every
// matchup (week, sides, scores, playoff flag) and each team's bench points
// per week. Nothing secret is written to the file.

import { writeFileSync, mkdirSync } from "node:fs";

const LEAGUE = process.env.ESPN_LEAGUE_ID;
const S2 = process.env.ESPN_S2;
const SWID = process.env.SWID;
const FIRST = Number(process.env.FIRST_SEASON || 2014);
const LAST = Number(process.env.LAST_SEASON || 2025);
if (!LEAGUE || !S2 || !SWID) {
  console.error("Set ESPN_LEAGUE_ID, ESPN_S2 and SWID in the environment.");
  process.exit(1);
}

const headers = { Cookie: `espn_s2=${S2}; SWID=${SWID}`, Accept: "application/json" };
const BENCH_SLOTS = new Set([20, 21]); // 20 = bench, 21 = IR

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// ESPN serves 2018+ from the current endpoint and older seasons from
// leagueHistory, which wraps the league object in an array.
async function fetchSeason(year, params) {
  const qs = params.map((p) => `view=${p}`).join("&");
  if (year >= 2018) {
    return getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${LEAGUE}?${qs}`);
  }
  const arr = await getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE}?seasonId=${year}&${qs}`);
  return Array.isArray(arr) ? arr[0] : arr;
}

async function fetchWeek(year, week) {
  const qs = `view=mMatchupScore&view=mRoster&scoringPeriodId=${week}`;
  if (year >= 2018) {
    return getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${LEAGUE}?${qs}`);
  }
  const arr = await getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE}?seasonId=${year}&${qs}`);
  return Array.isArray(arr) ? arr[0] : arr;
}

function benchPoints(team) {
  const entries = team?.roster?.entries || [];
  let bench = 0;
  for (const e of entries) {
    if (!BENCH_SLOTS.has(e.lineupSlotId)) continue;
    bench += Number(e.playerPoolEntry?.appliedStatTotal ?? 0);
  }
  return Math.round(bench * 100) / 100;
}

const out = { exportedAt: new Date().toISOString(), leagueId: String(LEAGUE), seasons: {} };

for (let year = FIRST; year <= LAST; year++) {
  process.stdout.write(`${year}: `);
  let league;
  try {
    league = await fetchSeason(year, ["mTeam", "mMatchup", "mSettings", "mStandings"]);
  } catch (err) {
    console.log(`skipped (${err.message})`);
    continue;
  }
  const members = (league.members || []).map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, displayName: m.displayName }));
  const teams = (league.teams || []).map((t) => ({
    id: t.id,
    name: `${t.location || ""} ${t.nickname || ""}`.trim() || t.name || `Team ${t.id}`,
    abbrev: t.abbrev,
    ownerIds: t.owners || [],
    wins: t.record?.overall?.wins, losses: t.record?.overall?.losses, ties: t.record?.overall?.ties,
    pointsFor: t.record?.overall?.pointsFor, pointsAgainst: t.record?.overall?.pointsAgainst,
    finalStanding: t.rankCalculatedFinal || t.playoffSeed,
  }));
  const regWeeks = league.settings?.scheduleSettings?.matchupPeriodCount || 13;
  const matchups = (league.schedule || []).map((m) => ({
    week: m.matchupPeriodId,
    playoff: m.playoffTierType ? m.playoffTierType !== "NONE" : m.matchupPeriodId > regWeeks,
    tier: m.playoffTierType || null,
    home: m.home ? { teamId: m.home.teamId, points: m.home.totalPoints } : null,
    away: m.away ? { teamId: m.away.teamId, points: m.away.totalPoints } : null,
    winner: m.winner,
  }));

  // Bench points per team per week
  const weeks = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b);
  const bench = {};
  for (const w of weeks) {
    try {
      const wk = await fetchWeek(year, w);
      for (const t of wk.teams || []) {
        (bench[t.id] ||= {})[w] = benchPoints(t);
      }
      process.stdout.write(".");
    } catch (err) {
      process.stdout.write("x");
    }
  }
  out.seasons[year] = { regularSeasonWeeks: regWeeks, members, teams, matchups, benchPointsByTeamWeek: bench };
  console.log(` ${teams.length} teams, ${matchups.length} matchups`);
}

mkdirSync("data", { recursive: true });
writeFileSync("data/espn-history.json", JSON.stringify(out, null, 1));
console.log("Wrote data/espn-history.json");
