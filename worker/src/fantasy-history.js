// The live fantasy season set against twelve years of BroChiefs history:
// what only this league's own archive can say. Pure, given the archive
// (MATCHUPS.everyGameByYear, MATCHUPS.leagueMatchupRecords, HISTORY.seasons).

const r1 = (x) => Math.round(x * 10) / 10;
const GAME = /^W(\d+)\s+(\S+)\s+([\d.]+)\s+d\.\s+(\S+)\s+([\d.]+)/;

// Every past regular-season game as { year, week, winner, w, loser, l }.
export function pastGames(everyGameByYear, regWeeks = 13) {
  const out = [];
  for (const [year, list] of Object.entries(everyGameByYear || {})) for (const line of list || []) {
    if (/playoff/i.test(line)) continue;
    const m = String(line).match(GAME); if (!m) continue;
    const week = Number(m[1]); if (week > regWeeks) continue;
    out.push({ year: Number(year), week, winner: m[2], w: Number(m[3]), loser: m[4], l: Number(m[5]) });
  }
  return out;
}

// Each owner's record and points after a given week, in every past season.
function seasonsAfter(games, week) {
  const by = {};
  for (const g of games) {
    if (g.week > week) continue;
    for (const [o, won, pts] of [[g.winner, 1, g.w], [g.loser, 0, g.l]]) {
      const k = `${g.year}|${o}`; by[k] = by[k] || { year: g.year, owner: o, wins: 0, losses: 0, pf: 0 };
      by[k][won ? "wins" : "losses"]++; by[k].pf += pts;
    }
  }
  return Object.values(by);
}

const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export function historyContext(cur, archive) {
  const standings = cur?.standings || [], wk = cur?.weeksPlayed || 0, reg = cur?.regularSeasonWeeks || 13;
  if (!standings.length || !wk) return null;
  const games = pastGames(archive.everyGameByYear, reg);
  const seasons = archive.seasons || {};
  const finish = (year, owner) => { const s = seasons[year]; if (!s) return null; return s.champion === owner ? "won the title" : s.runnerUp === owner ? "lost the final" : s.third === owner ? "finished third" : (() => { const f = (s.standings || []).find((x) => x.owner === owner)?.finish; return f ? `finished ${ord(f)}` : null; })(); };

  // "This has happened before": the same or better record after this many
  // weeks, and how those seasons ended.
  const then = seasonsAfter(games, wk);
  const before = [];
  for (const s of standings) {
    const like = then.filter((x) => x.wins === s.wins && x.losses === s.losses);
    if (s.wins >= wk - 2 || s.losses >= wk - 2) {
      // A hot or cold start: the best (or worst) comparable starts.
      const hot = s.wins >= wk - 2;
      const same = then.filter((x) => (hot ? x.wins >= s.wins : x.losses >= s.losses));
      if (same.length) {
        const ended = same.map((x) => ({ ...x, end: finish(x.year, x.owner) }));
        const titles = ended.filter((x) => x.end === "won the title").length;
        const ex = ended.sort((a, b) => b.year - a.year)[0];
        const why = { head: ["Year", "Owner", `After ${wk}`, "Finish"], rows: [{ me: true, c: ["Now", s.owner, `${s.wins}-${s.losses}`, "?"] }, ...[...ended].sort((a, b) => b.year - a.year).map((x) => ({ c: [x.year, x.owner, `${x.wins}-${x.losses}`, x.end || "–"] }))] };
        before.push({ why, owner: s.owner, kind: hot ? "hot" : "cold", record: `${s.wins}-${s.losses}`, times: same.length, titles,
          line: `${s.wins}-${s.losses} after ${wk}: ${same.length === 1 ? "done once before" : `done ${same.length} times before`}${hot ? `, ${titles ? `${titles} won the title` : "none won the title"}` : ""}. Last: ${ex.owner} in ${ex.year}${ex.end ? `, who ${ex.end}` : ""}.` });
      } else before.push({ owner: s.owner, kind: hot ? "hot" : "cold", record: `${s.wins}-${s.losses}`, times: 0, line: `${s.wins}-${s.losses} after ${wk}: never happened in BroChiefs history.` });
    } else if (like.length && like.length <= 3) {
      before.push({ why: { head: ["Year", "Owner", `After ${wk}`, "Finish"], rows: like.map((x) => ({ c: [x.year, x.owner, `${x.wins}-${x.losses}`, finish(x.year, x.owner) || "–"] })) }, owner: s.owner, kind: "rare", record: `${s.wins}-${s.losses}`, times: like.length, line: `${s.wins}-${s.losses} after ${wk}: only ${like.length} other${like.length === 1 ? "" : "s"} ever.` });
    }
  }

  // Pace: points for and wins over the full regular season, against every
  // past full season.
  const full = seasonsAfter(games, reg).filter((x) => x.wins + x.losses >= reg - 1);
  const pfRank = (pf) => 1 + full.filter((x) => x.pf > pf).length;
  const winRank = (w) => 1 + full.filter((x) => x.wins > w).length;
  const pace = standings.map((s) => {
    const pf = r1((s.pointsFor / wk) * reg), w = Math.round((s.wins / wk) * reg);
    return { owner: s.owner, pf, wins: w, pfRank: pfRank(pf), winRank: winRank(w), of: full.length + 1 };
  });
  const most = [...full].sort((a, b) => b.pf - a.pf)[0], least = [...full].sort((a, b) => a.pf - b.pf)[0];
  const record = [];
  // The all-time list a pace sits in: the top five past seasons with this
  // season's pace placed among them.
  const board = (key, label, p) => { const list = [...full].sort((a, b) => b[key] - a[key]).slice(0, 5).map((x) => ({ v: x[key], c: [x.owner, x.year] })); list.push({ v: key === "pf" ? p.pf : p.wins, me: true, c: [p.owner, "pace"] }); list.sort((a, b) => b.v - a.v); return { head: ["#", "Owner", "Year", label], rows: list.map((x, i) => ({ me: x.me, c: [i + 1, ...x.c, key === "pf" ? r1(x.v) : x.v] })) }; };
  const lowBoard = (p) => { const list = [...full].sort((a, b) => a.pf - b.pf).slice(0, 5).map((x) => ({ v: x.pf, c: [x.owner, x.year] })); list.push({ v: p.pf, me: true, c: [p.owner, "pace"] }); list.sort((a, b) => a.v - b.v); return { head: ["#", "Owner", "Year", "Points"], rows: list.map((x, i) => ({ me: x.me, c: [i + 1, ...x.c, r1(x.v)] })) }; };
  for (const p of pace) {
    if (p.pfRank <= 3) record.push({ why: board("pf", "Points", p), owner: p.owner, text: p.pfRank === 1 ? `on pace for ${p.pf} points, past the record${most ? ` (${most.owner}, ${r1(most.pf)} in ${most.year})` : ""}` : `on pace for ${p.pf} points, the ${ord(p.pfRank)} most ever${most ? ` (record: ${most.owner}, ${r1(most.pf)} in ${most.year})` : ""}` });
    if (p.pfRank >= p.of - 1) record.push({ why: lowBoard(p), owner: p.owner, text: `on pace for ${p.pf} points, the ${p.pfRank === p.of ? "fewest" : "2nd fewest"} ever${least ? ` (low: ${least.owner}, ${r1(least.pf)} in ${least.year})` : ""}` });
    if (p.winRank === 1) { const best = Math.max(0, ...full.map((x) => x.wins)), who = full.filter((x) => x.wins === best).sort((a, b) => b.year - a.year)[0]; record.push({ why: board("wins", "Wins", p), owner: p.owner, text: p.wins > best ? `on pace for ${p.wins} wins, past the record of ${best} (${who.owner}, ${who.year})` : `on pace for ${p.wins} wins, tying the record (${who.owner}, ${who.year})` }); }
  }
  // This season's top weeks against the all-time top ten.
  const allTop = (archive.records?.highestWeeklyScores || []).map((t) => Number((String(t).match(/\s([\d.]+)\sin\s/) || [])[1])).filter(Number.isFinite);
  const cutoff = allTop.length ? Math.min(...allTop) : Infinity;
  const tops = archive.records?.highestWeeklyScores || [], top1 = allTop.length ? Math.max(...allTop) : Infinity;
  for (const g of cur.weekly || []) if (g.points >= cutoff) {
    const rank = 1 + allTop.filter((x) => x > g.points).length;
    const wl = tops.map((t, i) => ({ v: allTop[i], c: [String(t).replace(/ \(\w\)$/, "")] })).concat([{ v: g.points, me: true, c: [`${g.owner} ${g.points} in ${cur.year || "this season"} week ${g.week}`] }]).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v).slice(0, 11);
    record.push({ why: { head: ["#", "Week"], rows: wl.map((x, i) => ({ me: x.me, c: [i + 1, x.c[0]] })) }, owner: g.owner, text: g.points > top1 ? `${g.points} in week ${g.week} is the best week ever, past ${String(tops[0] || "").replace(/ \(\w\)$/, "")}` : `${g.points} in week ${g.week} is the ${ord(rank)} best week ever` });
  }

  return { week: wk, before, pace, record };
}

// Each owner's league career from the archive: titles, finals, all-time
// regular-season record and where they finished each year.
export function careers(seasons) {
  const out = {};
  for (const [year, s] of Object.entries(seasons || {})) for (const x of s.standings || []) {
    const c = out[x.owner] ||= { titles: 0, finals: 0, wins: 0, losses: 0, years: [] };
    c.wins += x.wins || 0; c.losses += x.losses || 0;
    if (x.result === "champion") c.titles++;
    if (x.result === "champion" || x.result === "runner-up") c.finals++;
    c.years.push({ year: Number(year), finish: x.finish, of: s.teams || (s.standings || []).length, result: x.result });
  }
  for (const c of Object.values(out)) c.years.sort((a, b) => a.year - b.year);
  return out;
}

// Every game two owners have played, newest first, playoff weeks marked.
export function meetings(everyGameByYear, a, b) {
  const out = [];
  for (const [year, list] of Object.entries(everyGameByYear || {})) for (const line of list || []) {
    const m = String(line).match(GAME); if (!m) continue;
    if (!((m[2] === a && m[4] === b) || (m[2] === b && m[4] === a))) continue;
    out.push({ year: Number(year), week: Number(m[1]), winner: m[2], w: Number(m[3]), loser: m[4], l: Number(m[5]), playoff: /playoff/i.test(line) || Number(m[1]) >= 14 });
  }
  return out.sort((x, y) => y.year - x.year || y.week - x.week);
}

