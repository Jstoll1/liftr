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
// Playoff seeds: with divisions, each division winner (best record, then
// points for) takes a top seed, ordered by record; the best other records
// fill the rest. Without divisions, straight record then points for.
// Ties on record go to head-to-head wins among the tied teams (the
// league's setting), then points for. h2h[a][b] = a's wins over b.
export function h2hTable(weekly) {
  const h = {};
  for (const g of weekly || []) { const o = (weekly || []).find((y) => y.week === g.week && y.owner === g.opponent); if (o && g.points > o.points) { h[g.owner] = h[g.owner] || {}; h[g.owner][g.opponent] = (h[g.owner][g.opponent] || 0) + 1; } }
  return h;
}
export function seedOrder(owners, w, pf, playoffTeams = 6, divisionOf = null, h2h = null) {
  const byRec = (a, b) => w[b] - w[a] || pf[b] - pf[a];
  const by = (a, b) => w[b] - w[a] || (h2h ? 0 : pf[b] - pf[a]) || pf[b] - pf[a];
  const order = (list) => { const s = [...list].sort(byRec); if (!h2h) return s; const out = []; for (let i = 0; i < s.length;) { let j = i; while (j < s.length && w[s[j]] === w[s[i]]) j++; const grp = s.slice(i, j); const hw = (o) => grp.reduce((n, x) => n + (h2h[o]?.[x] || 0), 0); out.push(...grp.sort((a, b) => hw(b) - hw(a) || pf[b] - pf[a])); i = j; } return out; };
  const divs = divisionOf ? [...new Set(owners.map((o) => divisionOf[o]).filter((d) => d != null))] : [];
  if (divs.length < 2) return order(owners).slice(0, playoffTeams);
  const winners = order(divs.map((d) => order(owners.filter((o) => divisionOf[o] === d))[0]).filter(Boolean));
  return [...winners, ...order(owners.filter((o) => !winners.includes(o)))].slice(0, playoffTeams);
}

export function playoffOdds(weekly, standings, remaining, playoffTeams = 6, runs = 4000, seed = 7, divisionOf = null) {
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
  const h2h = h2hTable(weekly);
  const tally = Object.fromEntries(owners.map((o) => [o, { playoffs: 0, bye: 0, title: 0, seedSum: 0 }]));
  const byes = playoffTeams === 6 ? 2 : playoffTeams === 4 ? 0 : Math.max(0, playoffTeams - 4);
  const play = (a, b) => { const pa = model[a].mean + model[a].sd * normal(rand), pb = model[b].mean + model[b].sd * normal(rand); return pa >= pb ? a : b; };
  for (let r = 0; r < runs; r++) {
    const w = {}, pf = {}, hh = Object.fromEntries(Object.entries(h2h).map(([k, v]) => [k, { ...v }]));
    for (const s of standings) { w[s.owner] = s.wins + (s.ties || 0) / 2; pf[s.owner] = s.pointsFor; }
    for (const g of remaining || []) {
      if (!model[g.home] || !model[g.away]) continue;
      const ph = model[g.home].mean + model[g.home].sd * normal(rand), pa = model[g.away].mean + model[g.away].sd * normal(rand);
      pf[g.home] += ph; pf[g.away] += pa;
      const win = ph >= pa ? g.home : g.away, lose = win === g.home ? g.away : g.home;
      w[win] += 1;
      // Games still to play between two teams count toward their head to head.
      hh[win] = hh[win] || {}; hh[win][lose] = (hh[win][lose] || 0) + 1;
    }
    const seeds = seedOrder(owners, w, pf, playoffTeams, divisionOf, hh);
    seeds.forEach((o, i) => { tally[o].playoffs++; tally[o].seedSum += i + 1; if (i < byes) tally[o].bye++; });
    // Fixed bracket, no reseeding (the league's setting): with 6 teams,
    // 3v6 and 4v5, then 1 meets the 4/5 winner and 2 the 3/6 winner.
    let champ;
    if (seeds.length === 6 && byes === 2) { const q1 = play(seeds[3], seeds[4]), q2 = play(seeds[2], seeds[5]); champ = play(play(seeds[0], q1), play(seeds[1], q2)); }
    else { let alive = seeds.slice(byes), waiting = seeds.slice(0, byes); while (alive.length + waiting.length > 1) { const next = []; for (let i = 0, j = alive.length - 1; i < j; i++, j--) next.push(play(alive[i], alive[j])); if (alive.length % 2) next.push(alive[Math.floor(alive.length / 2)]); alive = [...waiting, ...next]; waiting = []; } champ = alive[0]; }
    if (champ) tally[champ].title++;
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

// Team insights from the rosters and schedule: each position's points
// (QB1, RB1-2, WR1-2, TE1, K, D/ST by season points) ranked against the
// league, how much of the roster's points come from its top two players,
// and how hard the remaining schedule is (opponents' points a game).
export function teamInsights(rosters, weekly, remaining, standings) {
  const need = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, "D/ST": 1 };
  const owners = (standings || []).map((s) => s.owner);
  const posPts = {};
  for (const o of owners) {
    const roster = rosters?.[o] || [];
    posPts[o] = Object.fromEntries(Object.entries(need).map(([pos, n]) => [pos, r1(roster.filter((p) => p.pos === pos).slice(0, n).reduce((t, p) => t + (p.season || 0), 0))]));
  }
  const ppg = {};
  for (const o of owners) { const m = (weekly || []).filter((x) => x.owner === o); ppg[o] = m.length ? m.reduce((t, x) => t + x.points, 0) / m.length : 0; }
  const lg = owners.length ? owners.reduce((t, o) => t + ppg[o], 0) / owners.length : 0;
  const sos = {};
  for (const o of owners) {
    const opps = (remaining || []).filter((g) => g.home === o || g.away === o).map((g) => (g.home === o ? g.away : g.home));
    sos[o] = { opponents: opps, avgOpp: opps.length ? r1(opps.reduce((t, x) => t + (ppg[x] || lg), 0) / opps.length) : null };
  }
  const withSos = owners.filter((o) => sos[o].avgOpp != null).sort((a, b) => sos[b].avgOpp - sos[a].avgOpp);
  const out = {};
  for (const o of owners) {
    const posRank = {};
    for (const pos of Object.keys(need)) posRank[pos] = 1 + owners.filter((x) => posPts[x][pos] > posPts[o][pos]).length;
    const roster = rosters?.[o] || [], total = roster.reduce((t, p) => t + (p.season || 0), 0);
    out[o] = { posPts: posPts[o], posRank, topTwo: roster.slice(0, 2).map((p) => p.name), topShare: total ? r3(roster.slice(0, 2).reduce((t, p) => t + p.season, 0) / total) : null,
      ppg: r1(ppg[o]), leagueAvg: r1(lg), sos: { ...sos[o], rank: withSos.indexOf(o) + 1 || null, of: withSos.length } };
  }
  return out;
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
  return { teams: teamInsights(cur.rosters || {}, weekly, cur.remaining || [], standings), allPlay: ap, power: powerRankings(weekly, standings), odds: playoffOdds(weekly, standings, cur.remaining || [], cur.playoffTeams || 6, 4000, 7, cur.divisionOf || null), awards: weekAwards(weekly, last), regret: regretTotals(cur.regret), streak, playoffTeams: cur.playoffTeams || 6 };
}
