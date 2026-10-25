// Ask the Chief: "If Michigan wins, can I still win?"
// The Worker's model only reads the question into who and which game
// outcomes it assumes. The numbers here come from the app's own win-chance
// runs, replayed with those outcomes held, so nothing is made up.
(() => {
  if (typeof WORKER_URL === "undefined" || !WORKER_URL || window.LEAGUE?.sport === "nfl") return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Small odds keep a decimal, so "0.4%, down from 1.2%" never reads as
  // "under 1%, down from 1%".
  const pct = (p) => (p >= 0.995 ? "over 99%" : p > 0 && p < 0.001 ? "under 0.1%" : p < 0.1 && p > 0 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);
  const short = (g, team) => (team === g.away ? g.awayShort : g.homeShort);
  const condText = (c) => { const g = GAMES.find((x) => String(x.id) === String(c.game)); if (!g) return ""; const fav = c.team === g.favorite; return c.mode === "ATS" ? `${short(g, c.team)} ${fav ? "−" : "+"}${g.spread} covers` : `${short(g, c.team)} wins`; };
  const log = [];
  let busy = false, copied = false;
  // The chat as plain text, with who asked and the build, to paste to Claude.
  function chatText() {
    const v = document.querySelector('meta[name="build"]')?.content || "";
    const head = `Ask the Chief · ${new Date().toLocaleString()} · ${me() || "nobody signed in"}${v ? ` · build ${v}` : ""}`;
    return [head, ...log.map((x) => `Q: ${x.q}\nA: ${x.a ?? "(still working)"}${(x.tools || []).map((t) => `\n   tool ${t.name}(${JSON.stringify(t.args)}) -> ${JSON.stringify(t.out).slice(0, 400)}`).join("")}`)].join("\n\n");
  }
  async function copyChat() {
    const text = chatText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0"; document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length); try { ok = document.execCommand("copy"); } catch {} t.remove(); }
    copied = ok; sheet(); setTimeout(() => { copied = false; if (document.getElementById("ask-sheet")) sheet(); }, 1600);
  }

  // The win-chance runs as they stand (the board keeps them fresh).
  function base() {
    try { weekWinChances(lastGoodCloudPicks || {}, computeLiveResults(latestLive), latestLive); } catch {}
    return winChanceMemo?.ctx ? winChanceMemo : null;
  }

  // The same runs with some games held to an outcome: each held game is
  // drawn until it lands that way (games are independent, so this is the
  // chance given those outcomes). Returns each member's win share.
  function condChances(conds) {
    const memo = base(); if (!memo) return null;
    const { models, picks, guesses, tbGame } = memo.ctx;
    const N = 4000, lr = lockRule(), rnd = seededRandom(JSON.stringify(conds) + memo.key);
    const want = models.map((m) => conds.find((c) => String(c.game) === String(m.g.id)) || null);
    for (let k = 0; k < models.length; k++) {
      const w = want[k], m = models[k];
      if (w && m.fixed) { const o = resultOutcome(m.g, m.fixed); if ((w.mode === "SU" ? o.suWinner : o.atsWinner) !== w.team) return { impossible: condText(w) }; }
    }
    const wins = new Array(MANAGERS.length).fill(0), score = new Array(MANAGERS.length);
    let kept = 0;
    for (let s = 0; s < N; s++) {
      score.fill(0); let tbTotal = null, ok = true;
      for (let k = 0; k < models.length && ok; k++) {
        const m = models[k], w = want[k];
        let res = m.fixed, o = res ? resultOutcome(m.g, res) : null;
        for (let t = 0; !m.fixed && t < 300; t++) {
          let h = m.curH, a = m.curA;
          const n = poissonRand(m.lam, rnd);
          for (let q = 0; q < n; q++) { const pts = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += pts; else a += pts; }
          if (h === a) { const pts = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += pts; else a += pts; }
          res = { awayScore: a, homeScore: h }; o = resultOutcome(m.g, res);
          if (!w || (w.mode === "SU" ? o.suWinner : o.atsWinner) === w.team) break;
          res = null;
        }
        if (!res) { ok = false; break; }
        if (m.g === tbGame) tbTotal = res.awayScore + res.homeScore;
        for (let i = 0; i < MANAGERS.length; i++) {
          const p = picks[i][k]; if (!p) continue;
          const winner = p.mode === "SU" ? o.suWinner : o.atsWinner;
          if (winner && winner === p.team) score[i] += p.pts;
          else if (p.lock && winner && lr?.miss < 0) score[i] += lr.miss;
        }
      }
      if (!ok) continue;
      kept++;
      let best = -Infinity, bestDiff = Infinity, lead = [];
      for (let i = 0; i < MANAGERS.length; i++) {
        const diff = guesses[i] === null || tbTotal === null ? Infinity : Math.abs(guesses[i] - tbTotal);
        if (score[i] > best || (score[i] === best && diff < bestDiff)) { best = score[i]; bestDiff = diff; lead = [i]; } else if (score[i] === best && diff === bestDiff) lead.push(i);
      }
      for (const i of lead) wins[i] += 1 / lead.length;
    }
    if (!kept) return { impossible: conds.map(condText).join(" and ") };
    return Object.fromEntries(MANAGERS.map((n, i) => [n, wins[i] / kept]));
  }

  // Picks still hidden: before the first kickoff nobody else's are known.
  function hiddenOthers(who) {
    const all = lastGoodCloudPicks || {};
    return MANAGERS.filter((n) => n !== who && Object.values(all[n]?.picks || {}).some((p) => p?.hidden));
  }

  // Who is asking: the signed-in player, or the one this device picked.
  const me = () => currentManager || (typeof loadMe === "function" ? loadMe() : null) || null;

  const fins = () => computeLiveResults(latestLive);

  // --- Tools the assistant calls. Each returns plain data from the app's own
  // maths; the assistant only words it. Odds are fractions 0..1.
  const r3 = (p) => Math.round(p * 1000) / 1000;
  const gName = (g) => `G${g.id} ${g.awayShort} at ${g.homeShort}`;
  function banked(who) {
    const st = (lastGoodCloudPicks || {})[who]?.picks || {}, f = fins();
    let pts = 0, open = 0, left = 0;
    for (const g of GAMES) { const p = st[g.id]; if (!p?.team) continue; if (f[g.id]) pts += scorePick(g, p, f[g.id]) || 0; else { open += pickWorth(g, p); left++; } }
    return { pts, max: pts + open, picksLeft: left };
  }
  function hiddenNote() {
    const h = hiddenOthers(me());
    return h.length >= MANAGERS.length - 1 ? { picksHidden: "Everyone else's picks are hidden until kickoff; odds can't be worked out yet." } : h.length ? { picksHidden: `${h.join(", ")} still have hidden picks (not counted).` } : {};
  }
  // One status per member, so "0% but not out" can't be misread:
  //   alive      wins in the simulations
  //   long shot  no wins in 5,000 runs, but an exact check found a path
  //   out        the exact check proved there is no path
  //   likely out no wins and the exact check couldn't finish (too many games)
  function statusOf(d) {
    if (!d) return null;
    if (d.pct > 0) return { status: "alive" };
    if (d.alive === true) return { status: "long shot", onlyPath: (d.path?.need || []).map((x) => `${x.txt} (G${x.g.id})`), pathChance: d.path ? Math.round(d.path.p * 1e5) / 1e5 : null };
    if (d.alive === false) return { status: "out" };
    return { status: "likely out" };
  }
  // Nicknames the league uses, so a tool given "Woods" finds Jordan.
  const ALIASES = { woods: "Jordan", connie: "Conlan", conlin: "Conlan", adam: "Skills", logs: "Logan", tyler: "Dewitt", "tyler dewitt": "Dewitt" };
  const memberOf = (x) => { const t = String(x || "").trim().toLowerCase(); return MANAGERS.find((n) => n.toLowerCase() === t || shown(n).toLowerCase() === t) || (ALIASES[t] && MANAGERS.includes(ALIASES[t]) ? ALIASES[t] : null); };
  // The tools' "conditions" as games held to a side; "not" flips the team.
  function readConds(conditions = []) {
    const conds = [];
    for (const c of conditions) {
      const g = GAMES.find((x) => String(x.id) === String(c.game).replace(/^G/i, "")); if (!g) return { error: `No game ${c.game} this week.` };
      const t = String(c.team || "").toLowerCase();
      const team = [g.away, g.home].find((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t)) || (g.awayShort.toLowerCase() === t ? g.away : g.homeShort.toLowerCase() === t ? g.home : null);
      if (!team) return { error: `${c.team} isn't in ${gName(g)}.` };
      conds.push({ game: g.id, team: c.not ? (team === g.away ? g.home : g.away) : team, mode: c.mode === "ATS" ? "ATS" : "SU" });
    }
    return conds;
  }
  // Every way an open game can land that changes a pick: the underdog wins,
  // the favourite wins but doesn't cover, a push, or it covers. Each band
  // carries one sample score, checked against the real scoring.
  function bands(g) {
    const fav = g.favorite, dog = fav === g.away ? g.home : g.away, sp = Number(g.spread) || 0;
    const res = (fd) => { const f = 20 + Math.max(fd, 0), d = 20 + Math.max(-fd, 0); return fav === g.home ? { homeScore: f, awayScore: d } : { awayScore: f, homeScore: d }; };
    if (!fav || sp <= 0) return [{ txt: `${g.awayShort} wins`, res: { awayScore: 24, homeScore: 20 } }, { txt: `${g.homeShort} wins`, res: { awayScore: 20, homeScore: 24 } }];
    const F = short(g, fav), D = short(g, dog), top = Math.floor(sp), out = [{ txt: `${D} wins`, res: res(-3) }];
    const noCover = Number.isInteger(sp) ? sp - 1 : top;
    if (noCover >= 1) out.push({ txt: `${F} wins by ${noCover === 1 ? "1" : `1 to ${noCover}`} (no cover)`, res: res(1) });
    if (Number.isInteger(sp)) out.push({ txt: `${F} wins by exactly ${sp} (push)`, res: res(sp) });
    out.push({ txt: `${F} wins by ${top + 1}+ (covers)`, res: res(top + 1) });
    return out;
  }
  // Who takes it among members tied on points: the closest tiebreaker guess.
  // If the tiebreaker game is still open, the answer by its final total.
  function breakTie(tied, tbOpen, tbTotal) {
    const all = lastGoodCloudPicks || {};
    const gs = tied.map((n) => [n, Number(all[n]?.tiebreaker)]).filter(([, v]) => Number.isFinite(v));
    if (!gs.length) return `tie: ${tied.map(shown).join(" / ")} (no tiebreaker guesses)`;
    const near = (t) => { const d = Math.min(...gs.map(([, v]) => Math.abs(v - t))); return gs.filter(([, v]) => Math.abs(v - t) === d).map(([n]) => shown(n)).join(" / "); };
    if (!tbOpen) return `${near(tbTotal)} on the tiebreaker (${tbTotal}), tied on points with ${tied.map(shown).join(", ")}`;
    // Walk the totals still possible and note each change of who is closest.
    const from = tbTotal || 0, cuts = [];
    let cur = near(from), start = from;
    for (let t = from + 1; t <= 150; t++) { const w = near(t); if (w !== cur) { cuts.push([start, t - 1, cur]); cur = w; start = t; } }
    cuts.push([start, null, cur]);
    return `tie on points (${tied.map(shown).join(", ")}); tiebreaker total ${cuts.map(([a, b, w]) => `${b == null ? `${a}+` : a === b ? a : `${a} to ${b}`}: ${w}`).join("; ")}`;
  }
  const TOOLS = {
    standings() {
      const memo = base(), live = typeof inFlightPoints === "function" ? (n) => inFlightPoints((lastGoodCloudPicks || {})[n]?.picks || {}, latestLive) : () => 0;
      return { ...hiddenNote(), members: MANAGERS.map((n) => { const b = banked(n), d = memo?.detail?.[n]; const sObj = statusOf(d) || {}; return { member: n, points: b.pts, livePoints: live(n), bestPossible: b.max, picksLeft: b.picksLeft, chanceToWin: d ? r3(d.pct) : null, ...sObj }; }).sort((a, b) => b.points - a.points), statusMeans: "alive = real chance; long shot = 0% in simulations but a path exists (onlyPath lists what must happen); out = proven no path; likely out = no wins found, not proven" };
    },
    chance({ conditions = [] } = {}) {
      const conds = readConds(conditions); if (conds.error) return conds;
      const memo = base(); if (!memo) return { error: "Odds not loaded yet." };
      const h = hiddenNote(); if (h.picksHidden && /Everyone/.test(h.picksHidden)) return h;
      const odds = conds.length ? condChances(conds) : memo.out;
      if (!odds) return { error: "Odds not loaded yet." };
      if (odds.impossible) return { error: `${odds.impossible} can't happen: that game is already final the other way.` };
      return { ...h, assuming: conds.map(condText), chanceToWin: Object.fromEntries(MANAGERS.map((n) => [n, r3(odds[n] || 0)])), currentChance: Object.fromEntries(MANAGERS.map((n) => [n, r3(memo.out[n] || 0)])), noWins: MANAGERS.filter((n) => !(odds[n] > 0)), ...(!conds.length ? { status: Object.fromEntries(MANAGERS.map((n) => [n, statusOf(memo.detail?.[n])?.status || null])) } : {}), ...(conds.length ? { noWinsMeans: "won none of 4,000 simulated outcomes with these results: as good as out, not proven impossible" } : {}) };
    },
    // Late in the night: every way the open games can go and who wins the
    // week in each, exactly (no simulation).
    scenarios({ conditions = [], member } = {}) {
      const conds = readConds(conditions); if (conds.error) return conds;
      const h = hiddenNote(); if (h.picksHidden) return h;
      const all = lastGoodCloudPicks || {}, f = fins();
      const tb = typeof tiebreakerGameOf === "function" ? tiebreakerGameOf() : null;
      const open = GAMES.filter((g) => !f[g.id]);
      const opts = open.map((g) => {
        const c = conds.find((x) => String(x.game) === String(g.id));
        return bands(g).filter((b) => { if (!c) return true; const o = resultOutcome(g, b.res); return (c.mode === "SU" ? o.suWinner : o.atsWinner) === c.team; });
      });
      for (const c of conds) if (f[c.game]) { const g = GAMES.find((x) => x.id === c.game), o = resultOutcome(g, f[c.game]); if ((c.mode === "SU" ? o.suWinner : o.atsWinner) !== c.team) return { error: `${condText(c)} can't happen: that game is already final the other way.` }; }
      const rows = opts.reduce((n, o) => n * o.length, 1);
      if (!open.length) return { allFinal: true };
      if (rows > 27) {
        // Too many to list: give the member's likeliest winning path instead
        // (the same one Path to Win shows), so there's always a concrete answer.
        const who = memberOf(member || me()), memo = base(), d = who && memo?.detail?.[who];
        const sc = who && typeof pathScenario === "function" ? pathScenario(who) : null;
        return { tooManyToList: `${open.length} games still open, so not every outcome is listed.`, member: who, chanceToWin: d ? r3(d.pct) : null, ...(statusOf(d) || {}),
          likeliestPath: sc ? { mustHappen: sc.all.filter((x) => x.need).map((x) => `${x.txt} (G${x.g.id})`), eitherWay: sc.all.length - sc.need.length, chanceOfThisPath: Math.round(sc.p * 1e4) / 1e4,
            // The path is exact: every listed result landing means first place.
            ifAllHappen: sc.tie ? `${shown(who)} ties for first and needs the tiebreaker${sc.guess != null && sc.tbGame ? ` (guessed ${sc.guess} on ${sc.tbGame.awayShort} at ${sc.tbGame.homeShort})` : ""}` : `${shown(who)} wins the week for certain, whatever the other games do` } : null,
          biggestSwings: (d?.games || []).slice(0, 3).map((x) => ({ game: gName(x.game), chanceIfOnlyThisHits: r3(x.ifHit), chanceIfThisMisses: r3(x.ifMiss) })) };
      }
      const banks = Object.fromEntries(MANAGERS.map((n) => [n, banked(n).pts]));
      const l = tb && latestLive[tb.id], tbFinal = tb && f[tb.id];
      const tbNow = tbFinal ? tbFinal.awayScore + tbFinal.homeScore : l?.state === "in" ? (l.awayScore || 0) + (l.homeScore || 0) : 0;
      const out = [];
      const walk = (k, picked) => {
        if (k === open.length) {
          const pts = Object.fromEntries(MANAGERS.map((n) => [n, banks[n] + picked.reduce((t, [g, b]) => t + (scorePick(g, all[n]?.picks?.[g.id], b.res) || 0), 0)]));
          const top = Math.max(...Object.values(pts)), tied = MANAGERS.filter((n) => pts[n] === top);
          const tbOpen = !!tb && !tbFinal;
          out.push({ if: picked.map(([, b]) => b.txt).join(" · "), winner: tied.length === 1 ? shown(tied[0]) : breakTie(tied, tbOpen, tbNow), top: MANAGERS.slice().sort((a, b) => pts[b] - pts[a]).slice(0, 3).map((n) => `${shown(n)} ${pts[n]}`).join(", ") });
          return;
        }
        for (const b of opts[k]) walk(k + 1, [...picked, [open[k], b]]);
      };
      walk(0, []);
      const winners = [...new Set(out.map((r) => r.winner))];
      const res = {
        openGames: open.map((g) => { const lv = latestLive[g.id]; return `${gName(g)}: ${lv?.state === "in" ? `live, ${g.awayShort} ${lv.awayScore}-${lv.homeScore} ${g.homeShort} (not final)` : "not started"}`; }),
        assuming: conds.map(condText),
        ...(winners.length === 1 ? { settled: `Same result every way: ${winners[0]}` } : {}),
        scenarios: out,
        // The model's tool reply is capped, so long tables drop the scores.
      }; if (JSON.stringify(res).length > 5800) res.scenarios.forEach((r) => delete r.top);
      return res;
    },
    needs({ member } = {}) {
      const who = memberOf(member || me()); if (!who) return { error: `No member ${member}. Members: ${MANAGERS.join(", ")}.` };
      const memo = base(); const d = memo?.detail?.[who]; if (!d) return { error: "Odds not loaded yet." };
      return { ...hiddenNote(), member: who, chanceToWin: r3(d.pct), ...statusOf(d), swings: (d.games || []).slice(0, 5).map((x) => ({ game: gName(x.game), pick: `${short(x.game, x.pick.team)} ${x.pick.mode === "ATS" ? `${x.pick.team === x.game.favorite ? "−" : "+"}${x.game.spread}` : "to win"}${x.pick.lock ? " (lock)" : ""}`, chanceIfHits: r3(x.ifHit), chanceIfMisses: r3(x.ifMiss), likelyToHit: r3(x.pHit) })) };
    },
    picks({ game } = {}) {
      const g = GAMES.find((x) => String(x.id) === String(game).replace(/^G/i, "")); if (!g) return { error: `No game ${game}.` };
      const all = lastGoodCloudPicks || {};
      if (!isGameLocked(g) && MANAGERS.some((n) => all[n]?.picks?.[g.id]?.hidden)) return { game: gName(g), picksHidden: "Picks on this game are hidden until it kicks off." };
      const side = (team) => MANAGERS.filter((n) => all[n]?.picks?.[g.id]?.team === team).map((n) => { const p = all[n].picks[g.id]; return { member: n, bet: p.mode === "ATS" ? `${team === g.favorite ? "−" : "+"}${g.spread}` : "to win", lock: !!(p.lock && lockRule()) }; });
      return { game: gName(g), [g.away]: side(g.away), [g.home]: side(g.home), noPick: MANAGERS.filter((n) => !all[n]?.picks?.[g.id]) };
    },
    tiebreaker() {
      const g = typeof tiebreakerGameOf === "function" ? tiebreakerGameOf() : null; if (!g) return { error: "No tiebreaker game this week." };
      const all = lastGoodCloudPicks || {}, f = fins()[g.id], l = latestLive[g.id];
      const total = f ? f.awayScore + f.homeScore : l?.state === "in" ? (l.awayScore || 0) + (l.homeScore || 0) : null;
      const guesses = MANAGERS.map((n) => [n, String(all[n]?.tiebreaker ?? "").trim()]).filter(([, v]) => v !== "");
      if (guesses.some(([, v]) => v === "hidden")) return { game: gName(g), guessesHidden: "Guesses are hidden until the first kickoff." };
      return { game: gName(g), state: f ? "final" : l?.state === "in" ? "live" : "not started", totalPoints: total, guesses: Object.fromEntries(guesses.map(([n, v]) => [n, Number(v)])) };
    },
  };
  function runTool(name, args) { try { return TOOLS[name] ? TOOLS[name](args || {}) : { error: `Unknown tool ${name}` }; } catch (e) { return { error: "Couldn't work that out." }; } }

  // Suggestions: three from a pool written for the chat, filled in with
  // this week's leader, a rival, games still open and the locks; a fresh
  // three after every answer.
  let chipSet = null;
  function chips() {
    if (chipSet) return chipSet;
    const f = fins(), open = GAMES.filter((g) => !f[g.id]), live = open.filter((g) => latestLive[g.id]?.state === "in");
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const memo = base(), mine = me();
    const ranked = memo?.out ? MANAGERS.filter((n) => n !== mine).sort((a, b) => (memo.out[b] || 0) - (memo.out[a] || 0)) : MANAGERS.filter((n) => n !== mine);
    const leader = ranked[0] && shown(ranked[0]), rival = ranked[1] && shown(ranked[1]);
    const g = pick(live.length ? live : open), g2 = pick(open.filter((x) => x !== g)) || null;
    const all = lastGoodCloudPicks || {};
    const lockGame = GAMES.find((x) => isGameLocked(x) && MANAGERS.some((n) => all[n]?.picks?.[x.id]?.lock));
    const pool = [
      "Can I still win this week?", "What's my best path to win?", "Which game matters most for me?", "Who's out right now?",
      "Who's the favourite and why?", "What's my best possible score?", "Who's closest on the tiebreaker?", "Where do I stand vs the leader?",
      leader && `How does ${leader} get stopped?`, leader && `What does ${leader} need tonight?`, rival && `Can ${rival} still catch me?`, rival && leader && `Who's in better shape, ${rival} or ${leader}?`,
      g && `If ${g.homeShort} wins, can I still win?`, g && `Who's out if ${g.awayShort} covers?`, g && `Who picked ${g.homeShort}?`,
      g && g2 && `If ${g.homeShort} and ${g2.awayShort} both cover, what are my odds?`, g && `What happens to me if ${g.favorite === g.home ? g.homeShort : g.awayShort} doesn't cover?`,
      lockGame && `Who locked ${lockGame.awayShort} or ${lockGame.homeShort}?`, "Whose lock is in trouble right now?",
    ].filter(Boolean);
    // One of the three is always trash talk: at whoever is having the worst
    // week (never the asker), the surprise leader, or a lock going down.
    const others = MANAGERS.filter((n) => n !== mine);
    const worstN = others.slice().sort((a, b) => ((memo?.out?.[a] || 0) - (memo?.out?.[b] || 0)) || (banked(a).pts - banked(b).pts))[0];
    const worst = worstN && shown(worstN), worstOut = worstN && !(memo?.out?.[worstN] > 0);
    const losingLock = others.find((n) => { const st = all[n]?.picks || {}; const id = Object.keys(st).find((k) => st[k]?.lock); const lg = id && GAMES.find((x) => String(x.id) === String(id)); return lg && lockState(lg, st[id]) === "dn"; });
    const snark = [
      worst && worstOut && `How did ${worst} get knocked out so fast?`,
      worst && worstOut && `Was ${worst} eliminated before kickoff or after?`,
      worst && !worstOut && `Does ${worst} have any path at all, or is it over?`,
      worst && `Is ${worst} even trying this week?`,
      worst && `${worst}'s picks: bold or just bad?`,
      leader && `How is ${leader} somehow in the lead?`,
      leader && `What has to go wrong for ${leader} to blow it?`,
      losingLock && `How bad is ${shown(losingLock)}'s lock looking?`,
      "Whose week is the biggest disaster so far?",
      "Rank everyone's week from best to worst.",
    ].filter(Boolean);
    for (const arr of [pool, snark]) for (let i = arr.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [arr[i], arr[k]] = [arr[k], arr[i]]; }
    // Always one about beating the favourite, by name (unless that's you).
    const beat = leader && `How do I cleanly beat ${leader}?`;
    // The other two aren't about the leader too.
    const notLeader = (q) => !beat || !q.includes(leader);
    const rest = pool.filter(notLeader), jab = snark.filter(notLeader);
    return (chipSet = [beat, ...rest.slice(0, beat ? 1 : 2), jab[0] || snark[0]].filter(Boolean));
  }



  function sheet() {
    let m = document.getElementById("ask-sheet");
    if (!m) {
      m = document.createElement("div"); m.id = "ask-sheet"; m.className = "ask"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Ask the Chief");
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.closest(".ask-x")) { m.remove(); return; }
        if (e.target.closest("[data-askcopy]")) { copyChat(); return; }
        const c = e.target.closest("[data-ask]"); if (c) send(c.dataset.ask);
      });
      // Swipe down to close, from the header or a log scrolled to its top.
      let y0 = null, dy = 0, card = null;
      m.addEventListener("touchstart", (e) => {
        card = m.querySelector(".ask-card"); const lg = m.querySelector(".ask-log");
        if (!card || e.target.closest("input, .ask-chips") || (!e.target.closest(".ask-h") && lg?.contains(e.target) && lg.scrollTop > 0)) { y0 = null; return; }
        y0 = e.touches[0].clientY; dy = 0; card.style.transition = "none";
      }, { passive: true });
      m.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) card.style.transform = `translateY(${dy}px)`; }, { passive: true });
      m.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; card.style.transition = "transform .2s ease"; if (dy > 90) { card.style.transform = "translateY(110%)"; setTimeout(() => m.remove(), 200); } else card.style.transform = ""; });
      m.addEventListener("submit", (e) => { e.preventDefault(); const i = m.querySelector("input"); send(i.value); });
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="ask-card"><span class="ask-grip" aria-hidden="true"></span><div class="ask-h"><b>🧠 ASK THE CHIEF<small>Ask about odds, what-ifs, who's out, picks and the tiebreaker.</small></b>${log.length ? `<button type="button" class="ask-cp" data-askcopy="1">${copied ? "✓ Copied" : "Copy chat"}</button>` : ""}<button type="button" class="ask-x" aria-label="Close">✕</button></div>
      <div class="ask-log">${log.length ? log.map((x) => `<p class="ask-q">${esc(x.q)}</p><p class="ask-a${x.a == null ? " wait" : ""}">${x.a == null ? "Working it out…" : esc(x.a)}</p>`).join("") : `<p class="ask-hint">Ask anything about this week's race: odds, "what if" a game goes one way, who's out, who picked what, the tiebreaker. The numbers come from the same runs as the WIN% column.</p>`}</div>
      <div class="ask-chips">${chips().map((c) => `<button type="button" data-ask="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <form class="ask-f"><input type="text" maxlength="200" placeholder="If Michigan wins can I still win?" ${busy ? "disabled" : ""} autocomplete="off"><button type="submit" ${busy ? "disabled" : ""}>Ask</button></form></div>`;
    const lg = m.querySelector(".ask-log"); lg.scrollTop = lg.scrollHeight;
    return m;
  }

  // The whole conversation as the assistant sees it (user, assistant and
  // tool turns); log holds what is shown.
  const convo = [];
  // One id per chat on this page load, so Live can group a conversation.
  const SID = Math.random().toString(36).slice(2, 10);
  function context() {
    const f = fins();
    return { asker: me(), members: MANAGERS, games: GAMES.map((g) => { const l = latestLive[g.id], fin = f[g.id]; const sc = fin || (l?.state === "in" ? l : null); return { id: g.id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort, favorite: g.favorite, spread: g.spread, status: fin ? "final" : l?.state === "in" ? `live ${l.detail || ""}`.trim() : `not started (${g.kickoffLabel || ""})`, score: sc ? `${g.awayShort} ${sc.awayScore}, ${g.homeShort} ${sc.homeScore}` : "" }; }) };
  }
  async function send(q) {
    q = String(q || "").trim(); if (q.length < 2 || busy) return;
    busy = true; const item = { q, a: null, tools: [] }; log.push(item); sheet();
    convo.push({ role: "user", content: q });
    let logId = null;
    const giveUp = (reason) => { if (logId) fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "giveup", logId, reason }) }).catch(() => {}); };
    try {
      for (let round = 0; round < 5; round++) {
        const r = await fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: convo.slice(-24), context: context(), sid: SID, logId, build: document.querySelector('meta[name="build"]')?.content || "" }) });
        const j = await r.json().catch(() => ({}));
        if (j.logId) logId = j.logId;
        if (!r.ok || !j.message) { item.a = j.error || "Couldn't reach the league just now. Try again."; convo.pop(); break; }
        convo.push(j.message);
        if (j.message.tool_calls?.length) {
          for (const c of j.message.tool_calls) {
            let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
            const out = runTool(c.function.name, args);
            item.tools.push({ name: c.function.name, args, out });
            convo.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
          }
          continue;
        }
        item.a = j.message.content || "…"; break;
      }
      if (item.a == null) { item.a = "That one took too many steps. Try asking it a simpler way."; giveUp("too many steps"); }
    } catch { item.a = "Couldn't reach the league just now. Try again."; convo.pop(); giveUp("lost connection"); }
    busy = false; chipSet = null; sheet();
    if (typeof noteUse === "function") noteUse("week-ask", q.slice(0, 60));
  }

  function open() { sheet().querySelector("input")?.focus(); if (typeof noteUse === "function") noteUse("week-ask-open"); }

  // The button: a pill fixed bottom left on the Scores page (Lightning has
  // the bottom right), so it is in reach wherever you are on the board.
  function paintBtn() {
    let b = document.getElementById("ask-fab");
    if (!b) {
      b = document.createElement("button"); b.id = "ask-fab"; b.type = "button"; b.className = "ask-fab"; b.setAttribute("aria-label", "Ask the Chief");
      b.innerHTML = `<b aria-hidden="true">🧠</b>Ask`;
      b.addEventListener("click", () => { chipSet = null; open(); });
      document.body.appendChild(b);
    }
    const sb = document.getElementById("scoreboard-screen");
    b.hidden = !sb || sb.classList.contains("hidden") || [...document.querySelectorAll(".modal-overlay, #ask-sheet, #lt-modal")].some((el) => !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0);
  }
  // The one-time "new feature" card, in the Path to Win intro's style:
  // once per device, on the Scores page, never over another pop-up.
  const INTRO_KEY = "brochiefs_ai_intro_v1";
  function introSeen() { try { return !!localStorage.getItem(INTRO_KEY); } catch { return true; } }
  // ?intro=bi on the address shows the card again (for checking it).
  if (/[?&]intro=bi\b/.test(location.search)) { try { localStorage.removeItem(INTRO_KEY); } catch {} }
  function maybeIntro() {
    const fab = document.getElementById("ask-fab");
    // Only a pop-up actually on screen holds it back (some hide by style,
    // not the hidden class, and used to block it for good).
    const shown_ = (el) => !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
    // Any screen, on launch: TRY IT takes them to Scores and opens the chat.
    if (introSeen() || !me() || window.__adminEntry || window.__liveView || (document.getElementById("logo-screen") && !document.getElementById("logo-screen").classList.contains("hidden")) || [...document.querySelectorAll(".pi-screen, .pr-screen, .np-screen, .modal-overlay, .wpx-overlay, #lt-modal, #ask-sheet, #locks-sheet, .lks")].some(shown_)) return;
    try { localStorage.setItem(INTRO_KEY, String(Date.now())); } catch {}
    const ex = chips();
    const m = document.createElement("div");
    m.className = "pi-screen ai-intro"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "New feature: Ask the Chief");
    m.innerHTML = `<div class="pi-card">
      <div class="pi-head"><span class="pi-new">NEW</span><span class="pi-title">🧠 ASK THE CHIEF</span><button type="button" class="pi-x" aria-label="Close">✕</button></div>
      <p class="pi-lede">Ask anything about this week's race and get the answer from the same odds as the WIN% column.</p>
      <div class="pi-step"><b>1</b><span>Tap <span class="ai-pill">🧠 Ask</span> at the bottom left of Scores</span></div>
      <div class="pi-step"><b>2</b><span>Ask in your own words, or tap one of these</span></div>
      <div class="ai-ex">${ex.map((q) => `<button type="button" data-aiex="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div class="ai-btns"><button type="button" class="ai-later">LATER</button><button type="button" class="pi-ok">TRY IT</button></div>
    </div>`;
    document.body.appendChild(m);
    const close = () => { m.classList.add("out"); setTimeout(() => m.remove(), 220); const f = document.getElementById("ask-fab"); f?.classList.add("ping"); setTimeout(() => f?.classList.remove("ping"), 2400); };
    m.addEventListener("click", (e) => {
      const q = e.target.closest("[data-aiex]")?.dataset.aiex;
      const toScores = () => { const sb = document.getElementById("scoreboard-screen"); if (sb?.classList.contains("hidden")) document.getElementById("nav-scoreboard-btn")?.click(); };
      if (q) { close(); toScores(); setTimeout(() => { open(); send(q); }, 330); return; }
      if (e.target.closest(".pi-ok")) { close(); toScores(); setTimeout(open, 330); return; }
      if (e.target === m || e.target.closest(".pi-x, .ai-later")) close();
    });
    if (typeof noteUse === "function") noteUse("ai-intro");
  }
  paintBtn(); setInterval(() => { paintBtn(); if (!introSeen()) maybeIntro(); }, 1500);
  window.openWeekAsk = open;
  window.__weekAsk = { runTool, condChances };
})();
