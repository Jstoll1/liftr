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
  const KIND = { fav: "favorite to win (1 pt)", ats: "against the spread (2 pts)", dog: "underdog to win (3 pts)" };
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
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
          rows.push({ n, w: Number(w), g, p, kind, scored, other, sideWon, worth: worth(g, kind), room: others > 0 ? withMe / others : null, spread: Math.abs(Number(g.spread) || 0) });
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

  function report(name, ctx) {
    const { rows, missed, flips, names } = ctx;
    const mine = rows.filter((r) => r.n === name), rest = rows.filter((r) => r.n !== name);
    if (!mine.length) return { name, empty: true };
    const scored = sum(mine, (r) => r.scored), expected = sum(mine, (r) => r.worth);
    const per = (xs, f) => xs.length ? sum(xs, f) / xs.length : 0;
    // League totals, for the standings line.
    const totals = names.map((n) => ({ n, s: sum(rows.filter((r) => r.n === n), (r) => r.scored) })).sort((a, b) => b.s - a.s);
    const rank = totals.findIndex((x) => x.n === name) + 1;
    const out = [];
    const add = (o) => out.push(o);

    // 1. The choices themselves: worth per pick against the league.
    const evMe = per(mine, (r) => r.worth), evRest = per(rest, (r) => r.worth);
    if (mine.length >= 15) {
      const edge = (evMe - evRest) * mine.length;
      add({ key: "value", tone: edge >= 0 ? "strong" : "weak", weight: Math.abs(edge),
        text: edge >= 0
          ? `Your picks are good value: worth ${f1(evMe)} points each going in, against ${f1(evRest)} for everyone else. That's about ${pts(edge)} over the season before a ball is snapped.`
          : `Your picks are worth less going in: ${f1(evMe)} points each, against ${f1(evRest)} for everyone else. That costs about ${pts(edge)} over the season, whatever happens on the field.`,
        evidence: `${mine.length} picks` });
    }

    // 2. Favorites to win for 1 point: the spread on the same team is worth more.
    const favs = mine.filter((r) => r.kind === "fav");
    if (favs.length >= 5) {
      const gap = sum(favs, (r) => 1 - r.worth);
      const actual = sum(favs, (r) => r.scored), alt = sum(favs, (r) => r.other);
      const restShare = rest.length ? rest.filter((r) => r.kind === "fav").length / rest.length : 0;
      add({ key: "fav1", tone: "weak", weight: gap + Math.max(0, alt - actual) / 2,
        text: `${share(favs.length, mine.length)} of your picks are favorites to win for 1 point (the league: ${pct(restShare * 100, 100)}%). The spread on the same team is worth more on average: a full point a pick against ${f1(per(favs, (r) => r.worth))}. On these picks you scored ${actual}; the spread would have scored ${alt}.`,
        evidence: `${favs.length} favorite picks` });
    }

    // 3. Close games: the underdog to win is the best value on the board.
    const close = mine.filter((r) => r.spread > 0 && r.spread <= 6);
    if (close.length >= 6) {
      const dogs = close.filter((r) => r.kind === "dog").length;
      const restClose = rest.filter((r) => r.spread > 0 && r.spread <= 6), restDogs = restClose.filter((r) => r.kind === "dog").length;
      const mineShare = dogs / close.length, restShare = restClose.length ? restDogs / restClose.length : 0;
      const gain = sum(close.filter((r) => r.kind !== "dog"), (r) => worth(r.g, "dog") - r.worth);
      add({ key: "dogs", tone: mineShare >= Math.max(0.35, restShare) ? "strong" : "weak", weight: mineShare >= Math.max(0.35, restShare) ? dogs * 0.3 : gain,
        text: mineShare >= Math.max(0.35, restShare)
          ? `You take the underdog outright in close games (spread 6 or less) ${share(dogs, close.length)} of the time. At 3 points and roughly a 40% chance, that's the best value on the board.`
          : `In close games (spread 6 or less) the underdog to win pays 3 and wins about 40% of the time, worth about 1.2 a pick, more than anything else on the card. You took it ${dogs} of ${close.length} times${restClose.length ? ` (the league: ${pct(restDogs, restClose.length)}%)` : ""}.`,
        evidence: `${close.length} close games` });
    }

    // 4. Right team, wrong mode: what the other mode on the same team would have scored.
    if (mine.length >= 15) {
      const net = sum(mine, (r) => r.other - r.scored), netRest = per(rest, (r) => r.other - r.scored) * mine.length;
      const better = mine.filter((r) => r.other > r.scored).length, worse = mine.filter((r) => r.other < r.scored).length;
      const d = net - netRest;
      if (Math.abs(d) >= 2) add({ key: "mode", tone: d > 0 ? "weak" : "strong", weight: Math.abs(d),
        text: d > 0
          ? `Right team, wrong mode: the other mode on the same team would have scored more ${better} times and less ${worse} times, ${pts(net)} net. A typical owner loses about ${pts(netRest)} this way.`
          : `Your mode calls are sharp: switching mode on the same team would have scored more only ${better} times and less ${worse} times. You've banked about ${pts(-d)} more from the choice than a typical owner.`,
        evidence: `${mine.length} picks` });
    }

    // 5. Picking winners: did the team you picked win the game?
    if (mine.length >= 20) {
      const won = mine.filter((r) => r.sideWon).length, restWon = rest.filter((r) => r.sideWon).length;
      const d = won / mine.length - (rest.length ? restWon / rest.length : 0);
      if (Math.abs(d) >= 0.05) add({ key: "side", tone: d > 0 ? "strong" : "weak", weight: Math.abs(d) * mine.length * 1.5,
        text: `The team you picked won the game ${share(won, mine.length)} of the time; everyone else's won ${pct(restWon, rest.length)}%. ${d > 0 ? "You're reading games well." : "The picks themselves, not just the modes, are where the points go."}`,
        evidence: `${mine.length} picks` });
    }

    // 6. Hit rate by mode, against the league's on the same mode.
    for (const k of ["ats", "dog", "fav"]) {
      const a = mine.filter((r) => r.kind === k), b = rest.filter((r) => r.kind === k);
      if (a.length < 8 || b.length < 10) continue;
      const ha = a.filter((r) => r.scored > 0).length, hb = b.filter((r) => r.scored > 0).length;
      const d = ha / a.length - hb / b.length, val = k === "ats" ? 2 : k === "dog" ? 3 : 1;
      if (Math.abs(d) >= 0.1) add({ key: `hit-${k}`, tone: d > 0 ? "strong" : "weak", weight: Math.abs(d) * a.length * val,
        text: `${k === "ats" ? "Spread picks" : k === "dog" ? "Underdogs to win" : "Favorites to win"}: ${share(ha, a.length)} hit, against ${pct(hb, b.length)}% for everyone else.`,
        evidence: `${a.length} picks` });
    }

    // 7. Against the room: picks where few others were on the same team.
    const alone = mine.filter((r) => r.room !== null && r.room <= 0.25), crowd = mine.filter((r) => r.room !== null && r.room > 0.25);
    if (alone.length >= 6 && crowd.length >= 6) {
      const pa = per(alone, (r) => r.scored), pc = per(crowd, (r) => r.scored);
      const d = (pa - pc) * alone.length;
      if (Math.abs(d) >= 2) add({ key: "room", tone: d > 0 ? "strong" : "weak", weight: Math.abs(d),
        text: d > 0
          ? `Going against the room pays for you: ${f1(pa)} points a pick when few others are on your team, ${f1(pc)} when you're with the crowd.`
          : `Going against the room hasn't paid: ${f1(pa)} points a pick when few others are on your team, ${f1(pc)} when you're with the crowd.`,
        evidence: `${alone.length} lone picks` });
    }

    // 8. Big spreads: covering double digits.
    const big = mine.filter((r) => r.kind === "ats" && r.spread >= 10);
    if (big.length >= 6) {
      const hit = big.filter((r) => r.scored > 0).length;
      const d = (hit / big.length - 0.5) * big.length * 2;
      if (Math.abs(d) >= 2) add({ key: "big", tone: d > 0 ? "strong" : "weak", weight: Math.abs(d),
        text: `Double-digit spreads: your spread picks there hit ${share(hit, big.length)}${d < 0 ? ". A coin flip would have done better; big numbers are where your card leaks." : ", well above a coin flip."}`,
        evidence: `${big.length} picks` });
    }

    // 9. Second-guessing.
    const fl = flips?.[name];
    if (fl && fl.n >= 3 && Math.abs(fl.net) >= 2) add({ key: "flips", tone: fl.net > 0 ? "strong" : "weak", weight: Math.abs(fl.net),
      text: fl.net > 0
        ? `Changing your mind pays: ${fl.n} changed picks gained ${pts(fl.net)} (${fl.helped} helped, ${fl.hurt} hurt).`
        : `Second-guessing costs you: ${fl.n} changed picks lost ${pts(fl.net)} (${fl.helped} helped, ${fl.hurt} hurt). The first pick was usually right.`,
      evidence: `${fl.n} changes` });

    // 10. Blanks.
    const miss = missed?.[name] || 0;
    if (miss >= 2) add({ key: "missed", tone: "weak", weight: miss * per(rest, (r) => r.scored),
      text: `${miss} games left blank, worth about ${pts(miss * per(rest, (r) => r.scored))} at the league's average.`,
      evidence: `${miss} games` });

    // Strongest first; at least one strength when there is one worth saying.
    out.sort((a, b) => b.weight - a.weight);
    let pick = out.slice(0, 4);
    const strength = out.find((x) => x.tone === "strong" && x.weight >= 2);
    if (strength && !pick.includes(strength)) pick = [...pick.slice(0, 3), strength];
    pick = pick.filter((x) => x.weight >= 1.5).slice(0, 5);

    // Luck: scored against what the picks were worth.
    const luck = scored - expected;
    const luckLine = Math.abs(luck) < 3
      ? `Right on what your picks were worth: ${scored} points scored, about ${Math.round(expected)} expected.`
      : luck < 0
        ? `Unlucky: your picks were worth about ${Math.round(expected)} points; they scored ${scored}. About ${pts(luck)} of the gap is the ball bouncing the wrong way, not the picks.`
        : `Running hot: your picks were worth about ${Math.round(expected)} points and scored ${scored}. About ${pts(luck)} of that is good fortune that may not last.`;

    const kinds = ["fav", "ats", "dog"].map((k) => {
      const a = mine.filter((r) => r.kind === k), b = rest.filter((r) => r.kind === k);
      return { k, label: KIND[k], n: a.length, hit: a.filter((r) => r.scored > 0).length, pts: sum(a, (r) => r.scored), per: per(a, (r) => r.scored), restPer: per(b, (r) => r.scored), restShare: rest.length ? b.length / rest.length : 0 };
    });
    return { name, picks: mine.length, scored, expected, luck, luckLine, rank, of: totals.length, weeks: new Set(mine.map((r) => r.w)).size, insights: pick, all: out, kinds };
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
