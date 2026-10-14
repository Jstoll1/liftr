// Scouting report: why an owner is winning or losing, from their picks.
// Admin console only for now (loaded by console.js on the Scouting tab).
// Plain arithmetic over the season's slates, finals, final picks and the
// pick log; no model writes the reasons. Every insight carries its counts,
// and one needs enough picks behind it to be shown at all.
//
// Two kinds of numbers:
//   - what happened: points scored, hit rates, what the other mode on the
//     same team would have scored
//   - what a pick was worth going in: the spread says how likely the
//     favorite is to win. Final margins scatter around the spread with a
//     standard deviation of about 15 points in college football (Stern's
//     method for the NFL, 1991, with the college spread), so
//       favorite wins outright  P = Phi(spread / 15)
//       either side covers      P = 1/2
//     and a pick is worth points x chance: favorite to win 1 x P, spread
//     2 x 1/2 = 1, underdog to win 3 x (1 - P).
//   Worth minus scored is luck; worth itself is the skill in the choices.
(function (root) {
  const SD = 15;
  const erf = (x) => { // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const favWinP = (g) => phi(Math.abs(Number(g.spread) || 0) / SD);
  const kindOf = (g, p) => p.mode === "ATS" ? "ats" : p.team === g.favorite ? "fav" : "dog";
  const worth = (g, kind) => kind === "ats" ? 1 : kind === "fav" ? favWinP(g) : 3 * (1 - favWinP(g));
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const pts = (x) => `${Math.round(Math.abs(x))} point${Math.round(Math.abs(x)) === 1 ? "" : "s"}`;
  const share = (a, b) => b >= 10 ? `${pct(a, b)}%` : `${a} of ${b}`;

  // Every finished, picked game for every owner, with what it scored, what
  // it was worth, what the other mode on the same team would have scored,
  // and how many of the others were on the same team.
  function rowsOf({ season, names, scorePick }) {
    const rows = [], missed = {};
    for (const [w, wk] of Object.entries(season?.season || {})) {
      if (!Array.isArray(wk.games)) continue;
      for (const g of wk.games) {
        const r = wk.results?.[g.id];
        if (!r || scorePick(g, { team: g.home, mode: "SU" }, r) === null) continue;
        const sides = {};
        for (const n of names) { const p = wk.picks?.[n]?.picks?.[g.id]; if (p?.team && p.mode && !p.hidden) sides[n] = p.team; }
        const pickers = Object.keys(sides).length;
        for (const n of names) {
          const p = wk.picks?.[n]?.picks?.[g.id];
          if (!p?.team || !p.mode || p.hidden) { if (wk.picks?.[n]) missed[n] = (missed[n] || 0) + 1; continue; }
          const kind = kindOf(g, p);
          const scored = scorePick(g, p, r);
          const other = scorePick(g, { team: p.team, mode: p.mode === "ATS" ? "SU" : "ATS" }, r);
          const sideWon = scorePick(g, { team: p.team, mode: "SU" }, r) > 0;
          const withMe = Object.entries(sides).filter(([m, t]) => m !== n && t === p.team).length;
          const others = pickers - 1;
          // How often the picked team should win outright, from the spread.
          const winP = p.team === g.favorite ? favWinP(g) : 1 - favWinP(g);
          rows.push({ n, w: Number(w), g, p, kind, scored, other, sideWon, winP, worth: worth(g, kind), room: others > 0 ? withMe / others : null, spread: Math.abs(Number(g.spread) || 0) });
        }
      }
    }
    return { rows, missed };
  }

  // Changed picks: first saved pick against the final one, on finished games.
  function flipsOf({ log, season, scorePick }) {
    const chain = new Map();
    for (const r of [...(log || [])].sort((a, b) => a.ts - b.ts)) for (const c of r.changes || []) {
      if (!c.game || c.rejected || c.afterKickoff) continue;
      const k = `${r.week}|${r.manager}|${c.game}`;
      const e = chain.get(k) || { w: Number(r.week), m: r.manager, g: Number(c.game), from: c.from ?? c.to, to: c.to };
      e.to = c.to; chain.set(k, e);
    }
    const parse = (s) => { const m = String(s || "").match(/^(.*)\s(SU|ATS)$/); return m ? { team: m[1], mode: m[2] } : null; };
    const out = {};
    for (const e of chain.values()) {
      const a = parse(e.from), b = parse(e.to);
      if (!a || !b || (a.team === b.team && a.mode === b.mode)) continue;
      const wk = season?.season?.[e.w], game = wk?.games?.find((x) => Number(x.id) === e.g), res = wk?.results?.[e.g];
      if (!game || !res || scorePick(game, b, res) === null) continue;
      const d = scorePick(game, b, res) - scorePick(game, a, res);
      const f = out[e.m] || (out[e.m] = { n: 0, net: 0, helped: 0, hurt: 0 });
      f.n++; f.net += d; if (d > 0) f.helped++; else if (d < 0) f.hurt++;
    }
    return out;
  }

  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

  // Plain names for the three picks, as the pick buttons show them.
  const TYPE_SHORT = { fav: "1-pt favorite", ats: "2-pt spread", dog: "3-pt upset" };
  // How surprising a count is: (seen - expected) / spread of chance. Over
  // 1.65 either way is roughly a 1 in 10 fluke, the bar for showing a
  // finding that only describes the past.
  const zOf = (seen, exp, varSum) => varSum > 0 ? (seen - exp) / Math.sqrt(varSum) : 0;
  const CLEAR = 1.65;

  function report(name, ctx) {
    const { rows, missed, flips, names } = ctx;
    const mine = rows.filter((r) => r.n === name), rest = rows.filter((r) => r.n !== name);
    if (!mine.length) return { name, empty: true };
    const scored = sum(mine, (r) => r.scored), expected = sum(mine, (r) => r.worth);
    const weeks = new Set(mine.map((r) => r.w)).size || 1;
    const per = (xs, f) => xs.length ? sum(xs, f) / xs.length : 0;
    const totals = names.map((n) => ({ n, s: sum(rows.filter((r) => r.n === n), (r) => r.scored) })).sort((a, b) => b.s - a.s);
    const rank = totals.findIndex((x) => x.n === name) + 1;
    const out = [];
    // act: something to do differently. fix: the one-line instruction.
    const add = (o) => out.push(o);

    // 1-point favorite picks: the 2-point spread pick on the same team.
    const favs = mine.filter((r) => r.kind === "fav");
    const restFavShare = rest.length ? rest.filter((r) => r.kind === "fav").length / rest.length : 0;
    if (favs.length >= 5) {
      const actual = sum(favs, (r) => r.scored), alt = sum(favs, (r) => r.other);
      // Only when they lean on it at least as much as the league does.
      if (favs.length / mine.length >= restFavShare && (alt - actual >= 2 || favs.length / mine.length >= restFavShare + 0.1)) add({ key: "fav1", act: true, tone: "weak", weight: Math.max(alt - actual, sum(favs, (r) => 1 - r.worth)),
        head: "Too many 1-point picks",
        line: `${share(favs.length, mine.length)} of your picks are the 1-point favorite pick (league: ${pct(restFavShare * 100, 100)}%). The 2-point spread pick on those same teams would have scored ${alt} instead of ${actual}.`,
        fix: "Swap 1-point favorite picks for the 2-point spread pick on the same team. Over time it pays more.",
        evidence: `${favs.length} picks` });
    }

    // Close games: the 3-point upset pick.
    const close = mine.filter((r) => r.spread > 0 && r.spread <= 6);
    if (close.length >= 6) {
      const dogs = close.filter((r) => r.kind === "dog").length;
      const restClose = rest.filter((r) => r.spread > 0 && r.spread <= 6), restDogs = restClose.filter((r) => r.kind === "dog").length;
      const ms = dogs / close.length, rs = restClose.length ? restDogs / restClose.length : 0;
      const gain = sum(close.filter((r) => r.kind !== "dog"), (r) => worth(r.g, "dog") - r.worth);
      if (ms >= Math.max(0.35, rs)) add({ key: "dogs", act: true, tone: "strong", weight: dogs * 0.3,
        head: "Smart on upset picks",
        line: `In close games (spread 6 or less) you take the 3-point upset ${share(dogs, close.length)} of the time (league: ${pct(restDogs, restClose.length)}%). That's the best-paying pick on the card over time.`,
        evidence: `${close.length} close games` });
      else if (gain >= 2) add({ key: "dogs", act: true, tone: "weak", weight: gain,
        head: "Skipping the best bet on the card",
        line: `In close games (spread 6 or less) the 3-point upset pick wins about 4 times in 10, which pays more than any other pick over time. You took it ${dogs} of ${close.length} times (league: ${pct(restDogs, restClose.length)}%).`,
        fix: "In close games (spread 6 or less), take the 3-point upset more often.",
        evidence: `${close.length} close games` });
    }

    // Blanks.
    const miss = missed?.[name] || 0;
    if (miss >= 2) add({ key: "missed", act: true, tone: "weak", weight: miss * per(rest, (r) => r.scored),
      head: "Leaving picks blank",
      line: `${miss} games left empty. That's ${pts(miss * per(rest, (r) => r.scored))} at the league's average.`,
      fix: "Fill in every game. A blank always scores zero.",
      evidence: `${miss} games` });

    // Changed picks.
    const fl = flips?.[name];
    if (fl && fl.n >= 4 && Math.abs(fl.net) >= 3) add({ key: "flips", act: true, tone: fl.net > 0 ? "strong" : "weak", weight: Math.abs(fl.net),
      head: fl.net > 0 ? "Second looks pay off" : "Trust your first pick",
      line: fl.net > 0
        ? `You changed ${fl.n} picks: ${fl.helped} helped, ${fl.hurt} hurt, ${pts(fl.net)} gained.`
        : `You changed ${fl.n} picks: ${fl.hurt} hurt, ${fl.helped} helped, ${pts(fl.net)} lost.`,
      fix: fl.net > 0 ? null : "Stick with your first pick. Changes have cost you more than they've won.",
      evidence: `${fl.n} changes` });

    // Do the teams you pick win more than the spreads say they should?
    if (mine.length >= 20) {
      const won = mine.filter((r) => r.sideWon).length, exp = sum(mine, (r) => r.winP), v = sum(mine, (r) => r.winP * (1 - r.winP));
      const z = zOf(won, exp, v);
      if (Math.abs(z) >= CLEAR) add({ key: "side", act: false, tone: z > 0 ? "strong" : "weak", weight: Math.abs(won - exp) * 1.5,
        head: z > 0 ? "Picks winners better than Vegas" : "Your teams keep losing",
        line: `The teams you picked won ${won} of ${mine.length} games. Going by the spreads, about ${Math.round(exp)} should have.`,
        evidence: `${mine.length} picks` });
    }

    // Spread picks: a coin flip is the bar.
    const ats = mine.filter((r) => r.kind === "ats");
    if (ats.length >= 10) {
      const hit = ats.filter((r) => r.scored > 0).length, z = zOf(hit, ats.length / 2, ats.length / 4);
      if (Math.abs(z) >= CLEAR) add({ key: "ats", act: false, tone: z > 0 ? "strong" : "weak", weight: Math.abs(hit - ats.length / 2) * 2,
        head: z > 0 ? "Beating the spread" : "Spread picks are missing",
        line: `Your 2-point spread picks hit ${hit} of ${ats.length}. A coin flip would hit about ${Math.round(ats.length / 2)}.`,
        evidence: `${ats.length} picks` });
    }

    // Right team, other pick type: more often better or worse than a fair split?
    const diff = mine.filter((r) => r.other !== r.scored);
    if (diff.length >= 12) {
      const better = diff.filter((r) => r.other > r.scored).length, z = zOf(better, diff.length / 2, diff.length / 4);
      const net = sum(mine, (r) => r.other - r.scored);
      if (Math.abs(z) >= CLEAR) add({ key: "type", act: false, tone: z > 0 ? "weak" : "strong", weight: Math.abs(net),
        head: z > 0 ? "Right team, wrong pick" : "Picks the right pick type",
        line: z > 0
          ? `${better} times the other pick on your team would have paid more, only ${diff.length - better} times less. That's ${pts(net)} left behind.`
          : `Only ${better} times would the other pick on your team have paid more, against ${diff.length - better} times less.`,
        evidence: `${diff.length} games where it mattered` });
    }

    // Order: things to do differently first, then the rest by size.
    out.sort((a, b) => (b.act - a.act) || (b.weight - a.weight));
    let pick = out.slice(0, 4);
    for (const t of ["strong", "weak"]) {
      const best = out.find((x) => x.tone === t && x.weight >= 2);
      if (best && !pick.includes(best)) { const drop = [...pick].reverse().find((x) => x.tone !== t && pick.filter((y) => y.tone === x.tone).length > 1); pick = drop ? [...pick.filter((x) => x !== drop), best] : [...pick, best]; }
    }
    pick = pick.filter((x) => x.weight >= 1.5).sort((a, b) => (b.act - a.act) || (b.weight - a.weight)).slice(0, 5);
    const fixFrom = out.filter((x) => x.act && x.tone === "weak" && x.fix).sort((a, b) => b.weight - a.weight)[0];

    // Luck: scored against what the picks were worth.
    const luck = scored - expected;
    const luckBox = Math.abs(luck) < 3
      ? { head: "Right on pace", line: `Your picks were worth about ${Math.round(expected)} points and scored ${scored}. No luck either way: what you see is what you've earned.` }
      : luck < 0
        ? { head: "Bad luck", line: `Your picks were worth about ${Math.round(expected)} points but scored ${scored}. The bounces have cost you about ${pts(luck)}.` }
        : { head: "Running hot", line: `Your picks were worth about ${Math.round(expected)} points but scored ${scored}. About ${pts(luck)} of that is luck, and luck tends to even out.` };

    const kinds = ["fav", "ats", "dog"].map((k) => {
      const a = mine.filter((r) => r.kind === k), b = rest.filter((r) => r.kind === k);
      return { k, label: TYPE_SHORT[k], n: a.length, hit: a.filter((r) => r.scored > 0).length, pts: sum(a, (r) => r.scored), per: per(a, (r) => r.scored), restPer: per(b, (r) => r.scored) };
    });
    return { name, picks: mine.length, scored, expected, luck, luckBox, luckLine: `${luckBox.head}. ${luckBox.line}`, fix: fixFrom ? fixFrom.fix : null, rank, of: totals.length, weeks, insights: pick, all: out, kinds };
  }

  function build({ season, log, names, scorePick }) {
    const { rows, missed } = rowsOf({ season, names, scorePick });
    const flips = flipsOf({ log, season, scorePick });
    const ctx = { rows, missed, flips, names };
    return { ctx, report: (name) => report(name, ctx) };
  }

  root.build = build;
  root._internals = { phi, favWinP, worth };
})(typeof module !== "undefined" && module.exports ? module.exports : (window.Scout = {}));
