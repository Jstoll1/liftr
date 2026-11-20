// Fantasy analytics, pure and testable, computed on each /fantasy read from
// the season the Worker pulls from ESPN. Used by the fantasy page and the
// Chief.
//   weekly:    [{ week, owner, points, opponent }] for every decided game
//   standings: [{ owner, wins, losses, ties, pointsFor, rank }]
//   remaining: [{ week, home, away }] regular-season games still to play

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const byWeek = (weekly) => { const m = new Map(); for (const x of weekly || []) { if (!m.has(x.week)) m.set(x.week, []); m.get(x.week).push(x); } return m; };

// All-play: each week, every score against every other score that week.
// Luck: actual wins minus the wins all-play says a team "should" have.
export function allPlay(weekly, standings) {
  const out = {};
  for (const s of standings || []) out[s.owner] = { owner: s.owner, apW: 0, apL: 0, apT: 0, expWins: 0 };
  for (const [, list] of byWeek(weekly)) {
    for (const a of list) {
      const o = out[a.owner]; if (!o) continue;
      let w = 0, l = 0, t = 0;
      for (const b of list) { if (b === a) continue; if (a.points > b.points) w++; else if (a.points < b.points) l++; else t++; }
      o.apW += w; o.apL += l; o.apT += t;
      const n = w + l + t; if (n) o.expWins += (w + t / 2) / n;
    }
  }
  for (const s of standings || []) { const o = out[s.owner]; if (!o) continue; o.actualWins = s.wins + (s.ties || 0) / 2; o.luck = r1(o.actualWins - o.expWins); o.expWins = r1(o.expWins); o.apPct = r3(o.apW + o.apL + o.apT ? (o.apW + o.apT / 2) / (o.apW + o.apL + o.apT) : 0); }
  return out;
}

// Power: all-play win rate (half), points per game against the league
// (a third), last three weeks against the league (the rest). Movement is
// against the same ranking a week earlier.
export function powerRankings(weekly, standings) {
  const score = (upTo) => {
    const wk = (weekly || []).filter((x) => x.week <= upTo);
    if (!wk.length) return [];
    const ap = allPlay(wk, standings);
    const ppg = {}, recent = {};
    const weeks = [...new Set(wk.map((x) => x.week))].sort((a, b) => a - b), last3 = new Set(weeks.slice(-3));
    for (const s of standings) { const mine = wk.filter((x) => x.owner === s.owner); ppg[s.owner] = mine.length ? mine.reduce((n, x) => n + x.points, 0) / mine.length : 0; const r = mine.filter((x) => last3.has(x.week)); recent[s.owner] = r.length ? r.reduce((n, x) => n + x.points, 0) / r.length : ppg[s.owner]; }
    const avg = (o) => { const v = Object.values(o); return v.reduce((a, b) => a + b, 0) / (v.length || 1); };
    const aP = avg(ppg) || 1, aR = avg(recent) || 1;
    return standings.map((s) => ({ owner: s.owner, power: 0.5 * (ap[s.owner]?.apPct || 0) + 0.3 * (ppg[s.owner] / aP) / 2 + 0.2 * (recent[s.owner] / aR) / 2 }))
      .sort((a, b) => b.power - a.power).map((x, i) => ({ ...x, rank: i + 1, power: r3(x.power) }));
  };
  const maxWeek = Math.max(0, ...(weekly || []).map((x) => x.week));
  const now = score(maxWeek), before = new Map(score(maxWeek - 1).map((x) => [x.owner, x.rank]));
  return now.map((x) => ({ ...x, move: before.has(x.owner) ? before.get(x.owner) - x.rank : 0 }));
}

// A small seeded random, so the odds are stable between reads.
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }
function normal(rand) { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Playoff odds: play the rest of the regular season thousands of times,
// each team scoring from its own mean and spread (shrunk toward the league
// so a hot start does not run away). Seeds by wins, then points for.
// Playoffs: the top half of the field gets byes when the field is six
// (two byes) or four (none); the title goes through single games.
export function playoffOdds(weekly, standings, remaining, playoffTeams = 6, runs = 4000, seed = 7) {
  const rand = rng(seed + (weekly || []).length);
  const all = (weekly || []).map((x) => x.points), lgMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 100;
  const lgSd = all.length > 1 ? Math.sqrt(all.reduce((n, x) => n + (x - lgMean) ** 2, 0) / (all.length - 1)) : 20;
  const model = {};
  for (const s of standings || []) {
    const mine = (weekly || []).filter((x) => x.owner === s.owner).map((x) => x.points), n = mine.length;
    const m = n ? mine.reduce((a, b) => a + b, 0) / n : lgMean;
    const k = n / (n + 4); // shrink toward the league average
    model[s.owner] = { mean: k * m + (1 - k) * lgMean, sd: lgSd };
  }
  const owners = (standings || []).map((s) => s.owner);
  const tally = Object.fromEntries(owners.map((o) => [o, { playoffs: 0, bye: 0, title: 0, seedSum: 0 }]));
  const byes = playoffTeams === 6 ? 2 : playoffTeams === 4 ? 0 : Math.max(0, playoffTeams - 4);
  const play = (a, b) => { const pa = model[a].mean + model[a].sd * normal(rand), pb = model[b].mean + model[b].sd * normal(rand); return pa >= pb ? a : b; };
  for (let r = 0; r < runs; r++) {
    const w = {}, pf = {};
    for (const s of standings) { w[s.owner] = s.wins + (s.ties || 0) / 2; pf[s.owner] = s.pointsFor; }
    for (const g of remaining || []) {
      if (!model[g.home] || !model[g.away]) continue;
      const ph = model[g.home].mean + model[g.home].sd * normal(rand), pa = model[g.away].mean + model[g.away].sd * normal(rand);
      pf[g.home] += ph; pf[g.away] += pa;
      w[ph >= pa ? g.home : g.away] += 1;
    }
    const seeds = [...owners].sort((a, b) => w[b] - w[a] || pf[b] - pf[a]).slice(0, playoffTeams);
    seeds.forEach((o, i) => { tally[o].playoffs++; tally[o].seedSum += i + 1; if (i < byes) tally[o].bye++; });
    // Bracket: byes wait; the rest pair high against low, winners reseed.
    let alive = seeds.slice(byes), waiting = seeds.slice(0, byes);
    while (alive.length + waiting.length > 1) {
      const next = [];
      for (let i = 0, j = alive.length - 1; i < j; i++, j--) next.push(play(alive[i], alive[j]));
      if (alive.length % 2) next.push(alive[Math.floor(alive.length / 2)]);
      alive = [...waiting, ...next].sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b)); waiting = [];
    }
    if (alive[0]) tally[alive[0]].title++;
  }
  return Object.fromEntries(owners.map((o) => [o, { playoffs: r3(tally[o].playoffs / runs), bye: r3(tally[o].bye / runs), title: r3(tally[o].title / runs), avgSeed: tally[o].playoffs ? r1(tally[o].seedSum / tally[o].playoffs) : null }]));
}

// Awards for one week: top and low score, biggest blowout, closest game,
// luckiest win (won with a below-median score), unluckiest loss (lost with
// an above-median score).
export function weekAwards(weekly, week) {
  const list = (weekly || []).filter((x) => x.week === week);
  if (!list.length) return null;
  const pts = list.map((x) => x.points).sort((a, b) => a - b), med = pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
  const opp = (x) => list.find((y) => y.owner === x.opponent);
  const games = list.filter((x) => opp(x) && x.points >= opp(x).points).map((x) => ({ winner: x.owner, loser: x.opponent, w: x.points, l: opp(x).points, margin: r1(x.points - opp(x).points) }));
  const top = [...list].sort((a, b) => b.points - a.points)[0], low = [...list].sort((a, b) => a.points - b.points)[0];
  const blow = [...games].sort((a, b) => b.margin - a.margin)[0], close = [...games].sort((a, b) => a.margin - b.margin)[0];
  const lucky = games.filter((g) => g.w < med).sort((a, b) => a.w - b.w)[0];
  const unlucky = games.filter((g) => g.l > med).sort((a, b) => b.l - a.l)[0];
  return { week, top: top && { owner: top.owner, points: top.points }, low: low && { owner: low.owner, points: low.points }, blowout: blow || null, closest: close || null, luckiestWin: lucky || null, unluckiestLoss: unlucky ? { owner: unlucky.loser, points: unlucky.l, to: unlucky.winner } : null };
}

// Bench regret: per week, best possible minus what was played; season totals.
export function regretTotals(regret) {
  const tot = {};
  for (const [week, wk] of Object.entries(regret || {})) for (const [o, x] of Object.entries(wk)) {
    const left = Math.max(0, r1((x.best || 0) - (x.points || 0)));
    tot[o] = tot[o] || { owner: o, season: 0, weeks: 0, worst: null };
    tot[o].season = r1(tot[o].season + left); tot[o].weeks++;
    if (!tot[o].worst || left > tot[o].worst.left) tot[o].worst = { week: Number(week), left };
  }
  return Object.values(tot).sort((a, b) => b.season - a.season);
}

// Everything for the page, in one call.
export function fantasyStats(cur) {
  const standings = cur?.standings || [], weekly = cur?.weekly || [];
  if (!standings.length) return null;
  const last = Math.max(0, ...weekly.map((x) => x.week));
  const ap = allPlay(weekly, standings);
  // Streak: the current run of wins or losses.
  const streak = {};
  for (const s of standings) { const mine = weekly.filter((x) => x.owner === s.owner).sort((a, b) => b.week - a.week); let n = 0, kind = null; for (const g of mine) { const o = weekly.find((y) => y.week === g.week && y.owner === g.opponent); const r = !o ? null : g.points > o.points ? "W" : g.points < o.points ? "L" : "T"; if (!kind) kind = r; if (r !== kind) break; n++; } streak[s.owner] = kind ? `${kind}${n}` : ""; }
  return { allPlay: ap, power: powerRankings(weekly, standings), odds: playoffOdds(weekly, standings, cur.remaining || [], cur.playoffTeams || 6), awards: weekAwards(weekly, last), regret: regretTotals(cur.regret), streak, playoffTeams: cur.playoffTeams || 6 };
}
