// Ask Chief: "If Michigan wins, can I still win?"
// The Worker's model only reads the question into who and which game
// outcomes it assumes. The numbers here come from the app's own win-chance
// runs, replayed with those outcomes held, so nothing is made up.
(() => {
  if (typeof WORKER_URL === "undefined" || !WORKER_URL || window.LEAGUE?.sport === "nfl") return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // An answer as a few blocks: lines starting "1." become a numbered list,
  // "-" or "•" a bullet list, the rest short paragraphs. Escaped first, so
  // nothing in the text can become markup; **bold** is the only styling.
  const fmtA = (t) => {
    const out = []; let list = null;
    // This week's teams by every name the answer might use (full, short),
    // longest first so "Ohio State" wins over "Ohio". The first mention of
    // each team in an answer gets its logo in front.
    const teams = []; for (const g of (typeof GAMES !== "undefined" ? GAMES : [])) for (const [id, names] of [[g.awayId, [g.away, g.awayShort]], [g.homeId, [g.home, g.homeShort]]]) for (const n of names) if (n && id) teams.push([String(n).replace(/^#\d+\s+/, ""), id]);
    teams.sort((a, b) => b[0].length - a[0].length);
    const seen = new Set();
    const rx = teams.length ? new RegExp(`(^|[^A-Za-z])(${teams.map(([n]) => esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z])`, "g") : null;
    const logos = (h) => !rx ? h : h.replace(rx, (m, pre, nm) => { const t = teams.find(([n]) => esc(n) === nm); if (!t || seen.has(t[1])) return m; seen.add(t[1]); return `${pre}<img class="ask-tlogo" src="${logoUrl(t[1])}" alt="" loading="lazy" decoding="async" onerror="this.remove()">${nm}`; });
    const inl = (x) => logos(esc(x).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")).replace(/((?:[A-Z][a-z]+\s+)?(?:<img [^>]*>)?<b>(?:(?!<\/b>).)+<\/b>\s+\d+(?:\.\d)?%)/g, '<span class="ask-nw">$1</span>');
    for (const raw of String(t ?? "").split(/\n+/)) {
      const line = raw.trim(); if (!line) continue;
      const m = line.match(/^(\d+)[.)]\s+(.*)$/) || line.match(/^[-•]\s+(.*)$/);
      const kind = /^\d/.test(line) && m ? "ol" : m ? "ul" : null;
      if (kind) { if (!list || list.kind !== kind) { list = { kind, items: [] }; out.push(list); } list.items.push(inl(m[m.length - 1])); }
      else { list = null; out.push(`<span class="ask-p">${inl(line)}</span>`); }
    }
    return out.map((x) => (typeof x === "string" ? x : `<${x.kind}>${x.items.map((i) => `<li>${i}</li>`).join("")}</${x.kind}>`)).join("");
  };
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
    const head = `Ask Chief · ${new Date().toLocaleString()} · ${me() || "nobody signed in"}${v ? ` · build ${v}` : ""}`;
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
  // The insight behind a chance, worked out here so the Chief explains a
  // conclusion instead of reading numbers: where a member differs from each
  // member ahead (the only games they can gain on), the points gap, their
  // solo picks, and one headline reason picked from those.
  function storyOf(who, memo, all, f) {
    const pick = (n, g) => all[n]?.picks?.[g.id];
    const same = (a, b, g) => a && b && !a.hidden && !b.hidden && a.mode === b.mode && (a.team === b.team || (g && short(g, a.team) === short(g, b.team)));
    const term = (g, x) => `${short(g, x.team)} ${x.mode === "ATS" ? `${x.team === g.favorite ? "−" : "+"}${g.spread}` : "to win"}${x.lock ? " (lock)" : ""}`;
    const open = GAMES.filter((g) => !f[g.id] && pick(who, g)?.team);
    const chance = (n) => memo?.detail?.[n]?.pct ?? 0;
    const mine = chance(who), b = banked(who);
    // Each side's odds of hitting on a split game, so 'why is X higher' can say whose side is likelier.
    const hitP = (n, g) => { const x = (memo?.detail?.[n]?.games || []).find((y) => String(y.game?.id) === String(g.id)); return x && Number.isFinite(x.pHit) ? ` (${Math.round(x.pHit * 100)}% to hit)` : ""; };
    const ahead = MANAGERS.filter((n) => n !== who && chance(n) > mine).sort((x, y) => chance(y) - chance(x));
    const vs = ahead.slice(0, 3).map((n) => {
      const diff = open.filter((g) => !same(pick(who, g), pick(n, g), g));
      const bn = banked(n);
      return { member: n, chance: r3(chance(n)), samePicks: open.length - diff.length, of: open.length, canOnlyGainOn: diff.map((g) => `${gName(g)}: you ${term(g, pick(who, g))}${hitP(who, g)}${pick(n, g)?.team ? `, ${n} ${pick(n, g).hidden ? "hidden" : term(g, pick(n, g)) + hitP(n, g)}` : `, ${n} no pick`}`), pointsNow: `${b.pts} to ${bn.pts}`, mostPossible: `${b.max} to ${bn.max}` };
    });
    const solo = open.filter((g) => MANAGERS.every((n) => n === who || !same(pick(who, g), pick(n, g), g))).map((g) => `${gName(g)} ${term(g, pick(who, g))}`);
    const top = vs[0];
    let headline;
    if (!memo?.detail?.[who]) headline = null; // no odds yet: nothing to explain
    else if (!ahead.length) headline = `${who} is the favourite: nobody has a better chance.`;
    else if (top && top.of && top.samePicks / top.of >= 0.7) headline = `${who} matches ${top.member} on ${top.samePicks} of ${top.of} open picks, so ${who} can only gain on ${top.of - top.samePicks} game${top.of - top.samePicks === 1 ? "" : "s"}; ${top.member} also has more banked or more to play for.`;
    else if (top && b.max < banked(top.member).max) headline = `${who} can reach ${b.max} points at most, ${top.member} ${banked(top.member).max}: ${who} needs ${top.member}'s different picks to miss.`;
    else if (top && b.pts < banked(top.member).pts) headline = `${who} trails ${top.member} by ${banked(top.member).pts - b.pts} points already banked, with ${b.picksLeft} picks left to make it up.`;
    else headline = `${who}'s picks split from the leaders on several games; ${who} needs most of those to land.`;
    return { headline, againstTheMembersAhead: vs, soloPicks: solo };
  }
  // Why "out" before many games are played: a member who scores at least as
  // much as this one on every open game, whatever the result, and has at
  // least as much banked, can never be passed.
  function outBecause(who) {
    const all = lastGoodCloudPicks || {}, f = fins(), b0 = banked(who);
    const open = GAMES.filter((g) => !f[g.id]);
    const margins = (g) => { const sp = Number(g.spread) || 0; return [-40, -21, -14, -10, -7, -3, -1, 1, 3, 7, 10, 14, 21, 40, sp - 1, sp + 1, -sp - 1, -sp + 1].map((m) => ({ awayScore: 50, homeScore: 50 + Math.round(m) })).filter((r) => r.homeScore !== r.awayScore); };
    const pts = (n, g, r) => { const p = all[n]?.picks?.[g.id]; return p?.team && !p.hidden ? scorePick(g, p, r) || 0 : 0; };
    for (const n of MANAGERS) {
      if (n === who || banked(n).pts < b0.pts) continue;
      let ok = true, better = [];
      for (const g of open) { let worse = false, any = false; for (const r of margins(g)) { const d = pts(n, g, r) - pts(who, g, r); if (d < 0) { worse = true; break; } if (d > 0) any = true; } if (worse) { ok = false; break; } if (any) better.push(gName(g)); }
      if (ok) return { member: n, why: `${n} scores at least as much as ${who} on every open game whatever happens${better.length ? `, and more on ${better.slice(0, 3).join(", ")}` : ""}, so ${who} can't finish ahead (a tie would go to the tiebreaker).` };
    }
    return null;
  }
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
    // The fantasy league archive, answered by the Worker's archivist.
    archive: async ({ question }) => {
      const q = String(question || "").trim().slice(0, 300).replace(/\bConlan\b/g, "Connie");
      if (q.length < 3) return { error: "Ask the archive a full question." };
      try {
        const r = await fetch(`${WORKER_URL}/history-ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, asker: typeof currentManager !== "undefined" ? currentManager : undefined }) });
        const j = await r.json().catch(() => ({}));
        return j.answer ? { answer: j.answer, receipts: j.receipts || [] } : { error: j.error || "The archive did not answer." };
      } catch { return { error: "Couldn't reach the archive." }; }
    },
    // The season so far, from the sealed weeks (the Worker's record) plus
    // this week's points so far, as The Pot shows it.
    season() {
      if (typeof payoutLedger !== "function") return { error: "Season not available" };
      if (!weekSummariesReady) { try { loadWeekSummaries(); } catch {} return { error: "The season record is still loading; ask again in a moment." }; }
      const L = payoutLedger();
      const list = (L.list || []).map((r) => ({ member: r.name, place: r.seasonPlace, tied: !!r.tied, seasonPoints: r.points, thisWeekSoFar: r.livePoints ?? null, weeksPlayed: r.played, weeksWon: r.weeksWon, winnings: Math.round((r.earned || 0) * 100) / 100 }));
      const sealedN = Object.values(weekSummaries).filter((w) => w?.complete && !w.exhibition).length, total = typeof POT === "object" ? POT.weeks : null;
      // The chalk line, week by week: what a card of every favorite against
      // the spread scored (the dashed line on the board). On it counts as above.
      const chalkWeeks = Object.values(weekSummaries).filter((w) => w?.complete && Array.isArray(w.slate) && w.finals).sort((a, b) => a.week - b.week).map((w) => ({ week: w.week, exhibition: !!w.exhibition, chalk: w.slate.reduce((t, g) => t + (scorePick(g, { team: g.favorite, mode: "ATS" }, w.finals[g.id] || w.finals[String(g.id)]) || 0), 0), rows: w.rows || [] }));
      const chalkLine = { meaning: "Each week's chalk line is what picking every favorite against the spread scored. Below it means a member scored less than that card; on it counts as above. Exhibition weeks are marked; say whether a claim counts them.",
        byWeek: chalkWeeks.map((c) => ({ week: c.week, chalk: c.chalk, ...(c.exhibition ? { exhibition: true } : {}) })),
        members: MANAGERS.map((n) => { const played = chalkWeeks.filter((c) => c.rows.some((r) => r.name === n)); const below = played.filter((c) => c.rows.find((r) => r.name === n).score < c.chalk).map((c) => c.week); const real = below.filter((wk) => !chalkWeeks.find((c) => c.week === wk).exhibition); return { member: n, weeksPlayed: played.length, weeksBelowChalk: below, neverBelowChalk: played.length > 0 && !below.length, neverBelowOutsideExhibition: played.length > 0 && !real.length }; }) };
      // Each member's points and place in every sealed week, so 'my best /
      // worst week' and 'which week did X score most' read straight off it.
      const sealed = Object.values(weekSummaries).filter((w) => w?.complete && Array.isArray(w.rows)).sort((a, b) => a.week - b.week);
      const weekly = MANAGERS.map((n) => { const wks = sealed.map((w) => { const r = w.rows.find((x) => x.name === n); return r ? { week: w.week, points: r.score, place: r.place, ...(w.exhibition ? { exhibition: true } : {}), ...((w.winners || []).includes(n) ? { won: true } : {}) } : null; }).filter(Boolean);
        const pts = wks.map((x) => x.points).filter(Number.isFinite); const lo = Math.min(...pts), hi = Math.max(...pts);
        return { member: n, weeks: wks, lowestWeeks: pts.length ? wks.filter((x) => x.points === lo).map((x) => x.week) : [], lowest: pts.length ? lo : null, highestWeeks: pts.length ? wks.filter((x) => x.points === hi).map((x) => x.week) : [], highest: pts.length ? hi : null }; });
      return { weekByWeek: { meaning: "Every sealed week's points and place for each member (exhibition weeks marked; say whether a claim counts them).", members: weekly }, chalkLine, weeksSealed: Object.values(weekSummaries).filter((w) => w?.complete).length, seasonWeeks: total, weeksLeft: total != null ? Math.max(0, total - sealedN) : null, thisWeekCounts: total != null && !weekSummaries[currentWeek]?.complete, currentWeek, includesThisWeek: list.some((r) => r.thisWeekSoFar != null), members: list };
    },
    // When members were knocked out (could no longer catch the leader on
    // points) in every sealed pick'em week, replayed game by game in kickoff
    // order from the sealed ledgers. A tie on points is still alive (the
    // tiebreaker can win it). Day and time are Eastern, at about when that
    // game ended (kickoff plus 3.5 hours).
    eliminations() {
      if (!weekSummariesReady) { try { loadWeekSummaries(); } catch {} return { error: "The season record is still loading; ask again in a moment." }; }
      const et = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" });
      // A game ending after midnight belongs to the night before ("Friday night").
      const day = (ms) => new Date(ms - 6 * 3600e3).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" });
      const weeks = Object.values(weekSummaries).filter((w) => w?.complete && Array.isArray(w.rows) && Array.isArray(w.slate)).sort((a, b) => a.week - b.week).map((w) => {
        const order = [...w.slate].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id - b.id);
        const led = Object.fromEntries(w.rows.map((r) => [r.name, Object.fromEntries((r.ledger || []).map((x) => [x.g, x]))]));
        const banked = Object.fromEntries(w.rows.map((r) => [r.name, 0]));
        const out = [];
        order.forEach((g, i) => {
          for (const r of w.rows) banked[r.name] += Number(led[r.name][g.id]?.pts) || 0;
          const top = Math.max(...Object.values(banked));
          const left = order.slice(i + 1);
          for (const r of w.rows) {
            if (out.some((o) => o.member === r.name)) continue;
            const max = banked[r.name] + left.reduce((t, h) => t + Math.max(0, Number(led[r.name][h.id]?.worth) || 0), 0);
            if (max < top) { const at = Date.parse(g.kickoff) + 3.5 * 3600e3; const dd = day(at); out.push({ member: r.name, afterGame: `${g.awayShort} at ${g.homeShort}`, gameNumber: i + 1, gamesLeft: left.length, endedAround: et(at), day: dd, night: new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" }) !== dd ? `${dd} night (after midnight)` : undefined, maxLeft: max, leaderHad: top, ...((w.rows.find((x) => x.name === r.name)?.picked ?? 1) === 0 ? { noPicksThatWeek: true } : {}) }); }
          }
        });
        return { week: w.week, ...(w.exhibition ? { exhibition: true } : {}), firstKickoff: et(Date.parse(order[0]?.kickoff)), knockedOut: out, survivedToTheEnd: w.rows.filter((r) => !out.some((o) => o.member === r.name)).map((r) => r.name), winners: w.winners || [] };
      });
      const early = weeks.flatMap((w) => w.knockedOut.filter((o) => !/Saturday|Sunday/.test(o.day)).map((o) => ({ week: w.week, ...o })));
      // This week so far, replayed the same way over the finals in.
      let thisWeek = null;
      try {
        const f = fins(), all = lastGoodCloudPicks || {};
        const order = GAMES.filter((g) => f[g.id]).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id - b.id);
        const open = GAMES.filter((g) => !f[g.id]);
        const names = MANAGERS.filter((n) => all[n]);
        const banked = Object.fromEntries(names.map((n) => [n, 0])), out = [];
        order.forEach((g, i) => {
          for (const n of names) { const p = all[n].picks?.[g.id]; if (p?.team && !p.hidden) banked[n] += scorePick(g, p, f[g.id]) || 0; }
          const top = Math.max(...Object.values(banked));
          const left = [...order.slice(i + 1), ...open];
          for (const n of names) {
            if (out.some((o) => o.member === n)) continue;
            const max = banked[n] + left.reduce((t, h) => { const p = all[n].picks?.[h.id]; return t + (p?.team && !p.hidden ? pickWorth(h, p) : 0); }, 0);
            if (max < top) { const at = Date.parse(g.kickoff) + 3.5 * 3600e3; out.push({ member: n, afterGame: `${g.awayShort} at ${g.homeShort}`, gameNumber: i + 1, gamesLeft: GAMES.length - (i + 1), endedAround: et(at), day: day(at) }); }
          }
        });
        thisWeek = { week: currentWeek, finalsSoFar: order.length, knockedOut: out };
      } catch {}
      // Fastest ever: fewest games played before being knocked out (members
      // who made picks; this week included).
      const all2 = [...weeks.flatMap((w) => w.knockedOut.filter((o) => !o.noPicksThatWeek).map((o) => ({ week: w.week, ...o }))), ...(thisWeek?.knockedOut || []).map((o) => ({ week: thisWeek.week, thisWeek: true, ...o }))];
      const fastest = all2.sort((a, b) => a.gameNumber - b.gameNumber).slice(0, 5);
      return { meaning: "Knocked out = could no longer reach the leader's points with every remaining pick hitting. Days are Eastern time, about when the deciding game ended. fastest ranks every knockout this season (this week included) by how few games had finished.", thisWeek, fastest, beforeSaturday: early, weeks };
    },
    standings() {
      const memo = base(), live = typeof inFlightPoints === "function" ? (n) => inFlightPoints((lastGoodCloudPicks || {})[n]?.picks || {}, latestLive) : () => 0;
      // While everyone else's picks are hidden the odds would only count the
      // asker's own picks (that read 99% to win), so none are given.
      const hn = hiddenNote(), noOdds = !!hn.picksHidden && /Everyone/.test(hn.picksHidden);
      return { ...hn, ...(noOdds ? { oddsAvailable: false } : {}), members: MANAGERS.map((n) => { const b = banked(n), d = memo?.detail?.[n]; const sObj = noOdds ? {} : statusOf(d) || {}; const hd = (() => { const st = (lastGoodCloudPicks || {})[n]?.picks || {}, f = fins(); let h = 0, dd = 0; for (const g of GAMES) { const p = st[g.id]; if (!p?.team || !f[g.id]) continue; dd++; if ((scorePick(g, p, f[g.id]) || 0) > 0) h++; } return { h, dd }; })(); return { member: n, points: b.pts, hits: hd.h, decided: hd.dd, livePoints: live(n), bestPossible: b.max, picksLeft: b.picksLeft, chanceToWin: !noOdds && d ? r3(d.pct) : null, ...sObj }; }).sort((a, b) => b.points - a.points), statusMeans: "alive = real chance; long shot = 0% in simulations but a path exists (onlyPath lists what must happen); out = proven no path; likely out = no wins found, not proven" };
    },
    // "If the scores stay the same": every game still going ends at its
    // current score, and the week is scored and ranked exactly on that.
    endedNow() {
      const hn = hiddenNote(); if (hn.picksHidden && /Everyone/.test(hn.picksHidden)) return { ...hn, oddsAvailable: false };
      const res = { ...(typeof computeLiveResults === "function" ? computeLiveResults(latestLive || {}) : {}) };
      const asNow = [];
      for (const g of GAMES) { const l = latestLive?.[g.id]; if (res[g.id] || !l?.found || l.state !== "in") continue; res[g.id] = { awayScore: l.awayScore || 0, homeScore: l.homeScore || 0 }; asNow.push(`${gName(g)}: ends ${l.awayScore || 0}-${l.homeScore || 0}`); }
      const notStarted = GAMES.filter((g) => !res[g.id]).map(gName);
      const rows = rankManagers(lastGoodCloudPicks || {}, res);
      const tb = tiebreakerGameOf?.(), tbTotal = tb && res[tb.id] ? res[tb.id].awayScore + res[tb.id].homeScore : null;
      const top = rows.filter((r) => r.place === 1).map((r) => r.name);
      return { ...hn, assuming: asNow, notStartedIgnored: notStarted, winner: top.length === 1 ? top[0] : null, tiedForFirst: top.length > 1 ? top : undefined,
        tiebreaker: tb ? (tbTotal == null ? "tiebreaker game not started: ties stay ties" : `tiebreaker total would be ${tbTotal}`) : undefined,
        standings: rows.slice(0, 6).map((r) => ({ member: r.name, points: r.score, place: r.place, tied: !!r.tied })) };
    },
    // How likely a game's outcome is (cover, straight-up win), read from the
    // same simulation as WIN%: each member's pick on that game hit in a
    // known share of the runs. Before kickoff a cover sits near 50% because
    // the spread is set to make it even; live, it moves with the score.
    // Who has something to play for: the CFP rankings (the AP poll before
    // the committee's first one) and this week's games with a ranked team in
    // them, every FBS game not just the slate, with records and conference
    // records. Straight from ESPN, so it covers games the pick'em skipped.
    stakes: async () => {
      const API = window.ESPN_API || "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
      try {
        const [rk, sb] = await Promise.all([fetch(`${API}/rankings`).then((r) => r.json()), fetch(`${API}/scoreboard?groups=80&limit=300`).then((r) => r.json())]);
        const polls = rk?.rankings || [], poll = polls.find((x) => /playoff/i.test(x.name || "")) || polls.find((x) => /^AP/i.test(x.name || "")) || polls[0];
        if (!poll) return { error: "Rankings didn't load." };
        const nm = (t) => t?.location || t?.displayName || t?.name || "?";
        const top25 = (poll.ranks || []).map((x) => ({ rank: x.current, team: nm(x.team), record: x.recordSummary || null }));
        const rankOf = new Map((poll.ranks || []).map((x) => [String(x.team?.id), x.current]));
        const slateIds = new Set(GAMES.flatMap((g) => [String(g.awayId), String(g.homeId)]));
        const rec = (c, type) => (c?.records || []).find((r) => r.type === type || r.name === type)?.summary || null;
        const games = (sb?.events || []).map((ev) => { const c = ev.competitions?.[0], sides = c?.competitors || [];
          const away = sides.find((x) => x.homeAway === "away"), home = sides.find((x) => x.homeAway === "home");
          const side = (x) => ({ team: nm(x?.team), rank: rankOf.get(String(x?.team?.id)) || null, record: rec(x, "total"), confRecord: rec(x, "vsconf"), score: c?.status?.type?.state === "pre" ? null : Number(x?.score) });
          return { matchup: `${nm(away?.team)} at ${nm(home?.team)}`, away: side(away), home: side(home), conferenceGame: !!c?.conferenceCompetition, status: c?.status?.type?.shortDetail || "", inPickem: slateIds.has(String(away?.team?.id)) && slateIds.has(String(home?.team?.id)), note: (c?.notes || [])[0]?.headline || null };
        }).filter((g) => g.away.rank || g.home.rank || /championship/i.test(g.note || ""));
        return { poll: poll.name, top25, rankedGamesThisWeek: games, meaning: "poll is the CFP committee's ranking when it says Playoff, else the AP poll. rankedGamesThisWeek is every FBS game this week with a ranked team (or a conference championship), slate or not; inPickem marks games in this week's pick'em. confRecord is the conference record. These are records, not standings or tiebreakers: say a team leads or controls its conference only from confRecord, and hedge it." };
      } catch { return { error: "Couldn't reach ESPN for the rankings." }; }
    },
    gameOdds(a = {}) {
      const game = a.game ?? a.game_id ?? a.gameId ?? a.id, game_id = undefined;
      const id = Number(String(game ?? "").replace(/\D/g, "")), g = GAMES.find((x) => Number(x.id) === id);
      if (!g) return { error: `No game ${game ?? game_id}.` };
      if (fins()[g.id]) return { game: gName(g), final: true };
      const memo = base(), m = memo?.ctx?.models?.find((x) => Number(x.g?.id) === id);
      if (!m || m.fixed) return { error: "Odds not loaded yet." };
      // The same game model as WIN%, played 4,000 times.
      let cov = { [g.away]: 0, [g.home]: 0 }, win = { [g.away]: 0, [g.home]: 0 }; const N = 4000;
      for (let s = 0; s < N; s++) {
        let h = m.curH + (m.base || 0), a = m.curA + (m.base || 0);
        const n = poissonRand(m.lam); for (let q = 0; q < n; q++) { const p = Math.random() < 0.6 ? 7 : 3; if (Math.random() < m.pHome) h += p; else a += p; }
        if (h === a) { const p = Math.random() < 0.6 ? 7 : 3; if (Math.random() < m.pHome) h += p; else a += p; }
        const o = resultOutcome(g, { awayScore: a, homeScore: h });
        if (o.atsWinner in cov) cov[o.atsWinner]++; if (o.suWinner in win) win[o.suWinner]++;
      }
      const pc = (o) => Object.fromEntries(Object.entries(o).map(([t, v]) => [short(g, t), r3(v / N)]));
      return { game: gName(g), line: g.favorite ? `${short(g, g.favorite)} −${g.spread}` : "pick'em", cover: pc(cov), win: pc(win), means: "chance each side covers the line, and wins straight up, from the game model behind WIN% (spread, total, live score and clock). Before kickoff a cover is near 50% by design." };
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
      // Out: say why in the same call (who mirrors or beats every result
      // left, or the point ceiling), so the answer never stops at "you're out".
      const why = d.alive === false ? (() => { const ob = outBecause(who); if (ob) return { outBecause: ob.why, blockedBy: ob.member }; const me0 = banked(who), lead = MANAGERS.map((n) => ({ n, b: banked(n) })).sort((x, y) => y.b.pts - x.b.pts)[0]; // Jordan's best case: every open pick of his hits. For each rival, the
        // least he can score in that case; anyone at or above Jordan's best
        // is the concrete block.
        const all = lastGoodCloudPicks || {}, f = fins(), open = GAMES.filter((g) => !f[g.id] && all[who]?.picks?.[g.id]?.team);
        const marg = (g) => { const sp = Number(g.spread) || 0; return [-40, -21, -14, -10, -7, -3, -1, 1, 3, 7, 10, 14, 21, 40, sp - 1, sp + 1, -sp - 1, -sp + 1].map((m) => ({ awayScore: 50, homeScore: 50 + Math.round(m) })).filter((r) => r.homeScore >= 0); };
        const pk = (n, g, r) => { const p = all[n]?.picks?.[g.id]; return p?.team && !p.hidden ? scorePick(g, p, r) || 0 : 0; };
        const hitWays = (g) => marg(g).filter((r) => pk(who, g, r) > 0);
        const rivals = MANAGERS.filter((n) => n !== who).map((n) => { let lo = banked(n).pts; const agree = []; for (const g of open) { const ways = hitWays(g); if (!ways.length) continue; const m = Math.min(...ways.map((r) => pk(n, g, r))); lo += m; if (m > 0) agree.push(gName(g)); } return { n, lo, agree }; }).filter((x) => x.lo >= me0.max).sort((x, y) => y.lo - x.lo);
        if (rivals.length) { const r = rivals[0]; return { outBecause: `Even if every open ${who} pick hits, he tops out at ${me0.max} (${me0.pts} now). ${r.n} would still have at least ${r.lo}${r.agree.length ? `, because he has the same side on ${r.agree.slice(0, 3).join(", ")}` : " from points already banked"}.${rivals.length > 1 ? ` ${rivals.slice(1, 3).map((x) => `${x.n} (${x.lo})`).join(" and ")} also stay at or above him.` : ""}`, blockedBy: r.n, bestCase: me0.max }; }
        // No single rival beats every best case, but one always beats this
        // one: every open pick of his hits, each game landing the way that
        // helps his rivals least. Name who is still ahead there, and why.
        const sc = Object.fromEntries(MANAGERS.map((n) => [n, banked(n).pts])), same = Object.fromEntries(MANAGERS.map((n) => [n, []]));
        for (const g of open) { const ways = hitWays(g); if (!ways.length) continue; const r = ways.slice().sort((x, y) => Math.max(...MANAGERS.filter((n) => n !== who).map((n) => pk(n, g, x))) - Math.max(...MANAGERS.filter((n) => n !== who).map((n) => pk(n, g, y))))[0]; for (const n of MANAGERS) { const v = pk(n, g, r); sc[n] += v; if (n !== who && v > 0) same[n].push(gName(g)); } }
        const top = MANAGERS.filter((n) => n !== who && sc[n] >= sc[who]).sort((x, y) => sc[y] - sc[x])[0];
        if (top) return { outBecause: `Even if every open ${who} pick hits (${sc[who]} points), ${top} would still have at least ${sc[top]} in that case${same[top].length ? `, because he has the same side on ${same[top].slice(0, 3).join(", ")}` : ""}. Every other way the games can land, someone else finishes ahead of ${who} too (checked exactly).`, blockedBy: top };
        return { outBecause: `${who} has ${me0.pts} now and ${me0.max} at most. No mix of the open results puts ${who} on top: whenever his picks land, someone else lands with him and stays ahead (checked exactly).` }; })() : {};
      return { ...hiddenNote(), member: who, chanceToWin: r3(d.pct), ...statusOf(d), ...why, swings: (d.games || []).slice(0, 5).map((x) => ({ game: gName(x.game), pick: `${short(x.game, x.pick.team)} ${x.pick.mode === "ATS" ? `${x.pick.team === x.game.favorite ? "−" : "+"}${x.game.spread}` : "to win"}${x.pick.lock ? " (lock)" : ""}`, chanceIfHits: r3(x.ifHit), chanceIfMisses: r3(x.ifMiss), likelyToHit: r3(x.pHit) })) };
    },
    picks(a = {}) {
      let game = a.game ?? a.game_id ?? a.gameId ?? a.id ?? (Array.isArray(a.games) ? a.games[0] : undefined);
      const g = GAMES.find((x) => String(x.id) === String(game).replace(/^G/i, "")); if (!g) return { error: `No game ${game}.` };
      const all = lastGoodCloudPicks || {};
      if (!isGameLocked(g) && MANAGERS.some((n) => all[n]?.picks?.[g.id]?.hidden)) return { game: gName(g), picksHidden: "Picks on this game are hidden until it kicks off." };
      const side = (team) => MANAGERS.filter((n) => all[n]?.picks?.[g.id]?.team === team).map((n) => { const p = all[n].picks[g.id]; const fin = fins()[g.id]; const pts = fin ? scorePick(g, p, fin) : null; return { member: n, bet: p.mode === "ATS" ? `${team === g.favorite ? "−" : "+"}${g.spread}` : "to win", worth: pickWorth(g, p), ...(pts != null ? { scored: pts } : {}), lock: !!(p.lock && lockRule()) }; });
      return { game: gName(g), [g.away]: side(g.away), [g.home]: side(g.home), noPick: MANAGERS.filter((n) => !all[n]?.picks?.[g.id]) };
    },
    // One time slot (the 12 PM games): every way its games can finish, and
    // everyone's points after them. Each game has three outcomes (the
    // favourite covers, wins without covering, or loses; a push too on a
    // whole-number spread), so a slot of up to 4 games is listed in full.
    window({ games, member } = {}) {
      const who = memberOf(member || me()); if (!who) return { error: "Who is asking?" };
      const hn = hiddenNote(); if (hn.picksHidden && /Everyone/.test(hn.picksHidden)) return { ...hn, oddsAvailable: false };
      const f = fins(), all = lastGoodCloudPicks || {};
      let slot = Array.isArray(games) && games.length ? games.map((x) => GAMES.find((g) => String(g.id) === String(x).replace(/^G/i, ""))).filter(Boolean)
        : (() => { const open = GAMES.filter((g) => !f[g.id]).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)); const t = open.length ? Date.parse(open[0].kickoff) : 0; return open.filter((g) => Date.parse(g.kickoff) === t); })();
      slot = slot.filter((g) => !f[g.id]);
      if (!slot.length) return { error: "No open games in that slot." };
      if (slot.length > 4) return { error: `That slot has ${slot.length} games; ask about up to 4 at a time.` };
      const outs = (g) => {
        const favHome = g.favorite === g.home, sp = Number(g.spread) || 0, big = Math.floor(sp) + 3, small = Math.max(1, Math.ceil(sp) - 1);
        const res = (favBy) => favHome ? { awayScore: 20, homeScore: 20 + favBy } : { awayScore: 20 + favBy, homeScore: 20 };
        const fav = favHome ? g.homeShort : g.awayShort, dog = favHome ? g.awayShort : g.homeShort;
        const list = [{ say: `${fav} covers ${"−" + sp}`, r: res(big) }];
        if (sp >= 1.5) list.push({ say: `${fav} wins, ${dog} covers`, r: res(small) });
        if (Number.isInteger(sp) && sp > 0) list.push({ say: `${fav} wins by exactly ${sp} (push)`, r: res(sp) });
        list.push({ say: `${dog} wins`, r: res(-3) });
        return list;
      };
      const base0 = Object.fromEntries(MANAGERS.map((n) => [n, banked(n).pts]));
      let combos = [{ says: [], pts: { ...base0 } }];
      for (const g of slot) {
        const next = [];
        for (const c of combos) for (const o of outs(g)) {
          const pts = { ...c.pts };
          for (const n of MANAGERS) { const pk = all[n]?.picks?.[g.id]; if (pk?.team) pts[n] += scorePick(g, pk, o.r) ?? 0; }
          next.push({ says: [...c.says, o.say], pts });
        }
        combos = next;
      }
      const rows = combos.map((c) => { const others = MANAGERS.filter((n) => n !== who).map((n) => c.pts[n]); const lead = c.pts[who] - Math.max(...others); const place = 1 + others.filter((x) => x > c.pts[who]).length; return { outcome: c.says.join("; "), yourPoints: c.pts[who], leadOverNextBest: lead, place, tiedWith: others.filter((x) => x === c.pts[who]).length, finish: MANAGERS.map((n) => ({ member: n, points: c.pts[n] })).sort((x, y) => y.points - x.points).slice(0, 4).map((x, i) => `${i + 1}. ${x.member} ${x.points}`) }; }).sort((a, b) => b.leadOverNextBest - a.leadOverNextBest);
      return { member: who, slot: slot.map(gName), pointsNow: base0[who], best: rows[0], worst: rows[rows.length - 1], outcomes: rows.slice(0, 12), note: "Leads count banked points only; outcome odds are not given." };
    },
    // Why someone's odds are what they are: where their card differs from the
    // league (sides most of the room did not take, and what those pay), their
    // lock, their ceiling against everyone else's, and their biggest swings.
    edge({ member } = {}) {
      // "favourite" / "leader": whoever has the best chance right now.
      if (/^(favou?rite|leader|the favou?rite|top)$/i.test(String(member || "").trim())) { const m0 = base(); member = MANAGERS.slice().sort((a, b) => (m0?.detail?.[b]?.pct || 0) - (m0?.detail?.[a]?.pct || 0))[0]; }
      const who = memberOf(member || me()); if (!who) return { error: `No member ${member}.` };
      const hn = hiddenNote(); if (hn.picksHidden && /Everyone/.test(hn.picksHidden)) return { ...hn, oddsAvailable: false };
      const memo = base(), d = memo?.detail?.[who], all = lastGoodCloudPicks || {}, f = fins();
      const contrarian = [];
      for (const g of GAMES) {
        if (f[g.id]) continue;
        const mine = all[who]?.picks?.[g.id]; if (!mine?.team) continue;
        const others = MANAGERS.filter((n) => n !== who && all[n]?.picks?.[g.id]?.team);
        if (!others.length || others.some((n) => all[n].picks[g.id].hidden)) continue;
        const same = others.filter((n) => all[n].picks[g.id].team === mine.team).length;
        if (same / others.length <= 0.4) contrarian.push({ game: gName(g), pick: `${short(g, mine.team)} ${mine.mode === "ATS" ? `${mine.team === g.favorite ? "−" : "+"}${g.spread}` : "to win"}${mine.lock ? " (lock)" : ""}`, worth: pickWorth(g, mine), sameSide: same, of: others.length });
      }
      const maxes = MANAGERS.map((n) => [n, banked(n).max]).sort((a, b) => b[1] - a[1]);
      const lockG = GAMES.find((g) => all[who]?.picks?.[g.id]?.lock);
      // The whole room's chances and points, so "why am I lowest" can be
      // answered by comparison, and the ceiling stated for what it is: the
      // most points this member can still reach, ranked against the others'
      // most. It is not a finishing place: anyone with a chance can finish 1st.
      const story = storyOf(who, memo, all, f);
      const field = MANAGERS.map((n) => ({ member: n, chanceToWin: memo?.detail?.[n] ? r3(memo.detail[n].pct) : null, points: banked(n).pts, mostPossible: banked(n).max, picksLeft: banked(n).picksLeft })).sort((a, b) => (b.chanceToWin ?? 0) - (a.chanceToWin ?? 0));
      const pct0 = d ? d.pct : null;
      return { member: who, chanceToWin: pct0 != null ? r3(pct0) : null, canStillFinishFirst: pct0 == null ? null : pct0 > 0, chanceRank: field.findIndex((x) => x.member === who) + 1, of: MANAGERS.length,
        points: banked(who).pts, mostPointsPossible: banked(who).max, mostPointsPossibleRank: maxes.findIndex(([n]) => n === who) + 1,
        story,
        ...(d && d.alive === false ? { outBecause: outBecause(who) || "no result left puts this member first (checked exactly)" } : {}),
        mostPointsPossibleMeans: "the most points this member can still reach if every open pick hits, ranked against every member's own most; NOT their best finishing place",
        field,
        lock: lockG ? { game: gName(lockG), pick: `${short(lockG, all[who].picks[lockG.id].team)}` } : null,
        againstTheRoom: contrarian.slice(0, 4), swings: (d?.games || []).slice(0, 3).map((x) => ({ game: gName(x.game), chanceIfHits: r3(x.ifHit), chanceIfMisses: r3(x.ifMiss) })) };
    },
    // One member against another: the chance to finish ahead (from the same
    // runs as WIN%), and every open game where their picks differ, which is
    // where it is decided (a game they both took the same way cannot split them).
    versus({ member, rival } = {}) {
      const me_ = MANAGERS.find((n) => n.toLowerCase() === String(member || me() || "").toLowerCase()), them = MANAGERS.find((n) => n.toLowerCase() === String(rival || "").toLowerCase());
      if (!me_ || !them) return { error: "Name two members." };
      const hn = hiddenNote(); if (hn.picksHidden && /Everyone/.test(hn.picksHidden)) return { ...hn, oddsAvailable: false };
      const memo = base(), i = MANAGERS.indexOf(me_), j = MANAGERS.indexOf(them);
      const p = memo?.h2h?.[i]?.[j];
      const all = lastGoodCloudPicks || {}, f = fins();
      const term = (g, x) => !x ? "no pick" : x.hidden ? "hidden" : `${x.team === g.home ? g.homeShort : g.awayShort} ${x.mode === "ATS" ? `${x.team === g.favorite ? "−" : "+"}${g.spread}` : "to win"}${x.lock ? " (lock)" : ""}`;
      const differ = GAMES.filter((g) => !f[g.id]).map((g) => { const a = all[me_]?.picks?.[g.id], b = all[them]?.picks?.[g.id]; return { g, a, b }; })
        .filter(({ a, b }) => !(a && b && a.team === b.team && a.mode === b.mode && !!a.lock === !!b.lock))
        .map(({ g, a, b }) => { const wa = a?.team && !a.hidden ? pickWorth(g, a) : 0, wb = b?.team && !b.hidden ? pickWorth(g, b) : 0; // Which way the member should root: score both picks if the member's
          // side (or, with no pick, the rival's) wins big and if it loses big.
          const side = (a?.team && !a.hidden ? a : b)?.team, res = (big) => side === g.home ? { awayScore: 0, homeScore: big ? 60 : 0, ...(big ? {} : { awayScore: 60 }) } : { awayScore: big ? 60 : 0, homeScore: big ? 0 : 60 };
          const sc = (x, r) => x?.team && !x.hidden ? Number(scorePick(g, x, r)) || 0 : 0;
          const hit = res(true), miss = res(false), netHit = sc(a, hit) - sc(b, hit), netMiss = sc(a, miss) - sc(b, miss);
          const tShort = side === g.home ? g.homeShort : g.awayShort, sameSide = a?.team && b?.team && a.team === b.team;
          const rootFor = netHit === netMiss ? "either way" : `${tShort} to ${netHit > netMiss ? "cover" : "miss"}`;
          return { game: gName(g), [me_]: term(g, a), [them]: term(g, b), worth: { [me_]: wa, [them]: wb }, biggestSwing: wa + wb, rootFor, whatHappens: { [`if ${tShort} covers`]: `${me_} ${netHit >= 0 ? "+" : ""}${netHit} vs ${them}`, [`if ${tShort} misses`]: `${me_} ${netMiss >= 0 ? "+" : ""}${netMiss} vs ${them}` }, ...(sameSide && netHit !== netMiss ? { why: `Same pick, but ${!!a.lock !== !!b.lock ? `${a.lock ? me_ : them} has it as a lock` : "worth different points"}, so ${netHit > netMiss ? "a cover" : "a miss"} helps ${me_} more.` } : {}) }; })
        .sort((x, y) => y.biggestSwing - x.biggestSwing);
      const ch = (n) => { const d = memo?.detail?.[n]; return d ? r3(d.pct) : null; };
      return { member: me_, rival: them, chanceToFinishAhead: p == null ? null : r3(p), chanceToWinWeek: { [me_]: ch(me_), [them]: ch(them) }, pointsNow: { [me_]: banked(me_).pts, [them]: banked(them).pts }, ceiling: { [me_]: banked(me_).max, [them]: banked(them).max }, gamesThatSplitThem: differ };
    },
    // The least-picked sides of the week, over every game whose picks are
    // showing: one call instead of one per game.
    rarest() {
      const all = lastGoodCloudPicks || {}, out = [];
      for (const g of GAMES) {
        if (!isGameLocked(g) && MANAGERS.some((n) => all[n]?.picks?.[g.id]?.hidden)) continue;
        const by = new Map();
        for (const n of MANAGERS) { const x = all[n]?.picks?.[g.id]; if (!x?.team) continue; const k = `${x.team}|${x.mode}`; const e = by.get(k) || { g, x, who: [] }; e.who.push(n); by.set(k, e); }
        const tot = [...by.values()].reduce((a, e) => a + e.who.length, 0);
        for (const e of by.values()) out.push({ game: gName(g), pick: `${e.x.team === g.home ? g.homeShort : g.awayShort} ${e.x.mode === "ATS" ? `${e.x.team === g.favorite ? "−" : "+"}${g.spread}` : "to win"}`, members: e.who, of: tot });
      }
      if (!out.length) return { picksHidden: "No picks are showing yet (they show from each game's kickoff)." };
      return { rarest: out.sort((a, b) => a.members.length - b.members.length || a.game.localeCompare(b.game)).slice(0, 6) };
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
  window.__askRun = runTool; // tests and the console

  // Suggestions: three from a pool written for the chat, filled in with
  // this week's leader, a rival, games still open and the locks; a fresh
  // three after every answer.
  let chipSet = null, fromHistory = false;
  function chips() {
    if (chipSet) return chipSet;
    // Opened from League History: questions about the archive first.
    if (fromHistory) { const me0 = me(); return (chipSet = [me0 ? `What's ${shown(me0)}'s best season ever?` : "Who has the most titles?", "Who has the most regular season wins all time?", "Which season had the closest title game?"]); }
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
      "Who's the favourite and why?", "Rank everyone's week from best to worst.", "What's my best possible score?", "Who's closest on the tiebreaker?", "Where do I stand vs the leader?",
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
      worst && `Rate ${worst}'s card out of 10. Be honest.`,
      worst && `Did ${worst} make these picks blindfolded?`,
      worst && `Is ${worst} just donating the buy-in this year?`,
      worst && `Should ${worst} be allowed to pick next week?`,
      leader && `${leader} is due for a collapse, right?`,
      leader && `Is ${leader} good or just lucky?`,
      "Whose picks should be embarrassing them right now?",
      "Who's buying the beer this week?",
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
      m = document.createElement("div"); m.id = "ask-sheet"; m.className = "ask"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Ask Chief");
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.closest(".ask-x")) { m.remove(); return; }
        if (e.target.closest("[data-askcopy]")) { copyChat(); return; }
        const rq = e.target.closest("[data-reask]");
        if (rq) { const i = m.querySelector(".ask-f input"); if (i && !i.disabled) { i.value = rq.dataset.reask; i.focus(); i.setSelectionRange(i.value.length, i.value.length); } if (typeof noteUse === "function") noteUse("ask-reask"); return; }
        const pb = e.target.closest("[data-askpath]"); if (pb) { m.remove(); openPathCard(pb.dataset.askpath); if (typeof track === "function") track("ask-path-open", { event: true }); return; }
        const c = e.target.closest("[data-ask]"); if (c) send(c.dataset.ask);
      });
      // Swipe down to close, from the header or a log scrolled to its top.
      if (typeof pullToClose === "function") pullToClose(m, () => m.querySelector(".ask-card"), () => m.remove());
      m.addEventListener("submit", (e) => { e.preventDefault(); const i = m.querySelector("input"); send(i.value); });
      // Dock above the keyboard: iOS does not shrink a fixed overlay when the
      // keyboard opens, so the overlay is sized to the visible viewport.
      const vv = window.visualViewport;
      if (vv) {
        const fit = () => { if (!document.body.contains(m)) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); return; } m.style.top = `${vv.offsetTop}px`; m.style.height = `${vv.height}px`; m.style.bottom = "auto"; };
        vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); requestAnimationFrame(fit);
      }
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="ask-card"><span class="ask-grip" aria-hidden="true"></span><div class="ask-h"><b><span class="ask-title"><img class="chief-ico" src="assets/images/chief/chief2-96.webp" alt="" aria-hidden="true" decoding="async">ASK CHIEF</span></b>${log.length ? `<button type="button" class="ask-cp" data-askcopy="1">${copied ? "✓ Copied" : "Copy"}</button>` : ""}<button type="button" class="ask-x" aria-label="Close">✕</button></div>
      <div class="ask-log">${log.length ? log.map((x) => `<p class="ask-q" role="button" tabindex="0" data-reask="${esc(x.q)}" title="Tap to ask again or edit">${esc(x.q)}</p><div class="ask-a${x.a == null ? " wait" : ""}">${x.a == null ? "Working it out…" : fmtA(String(x.a).replace("[[WHICH_LEAGUE]]", "").replace(/\[\[PATH:[^\]]*\]\]/g, "").trim())}</div>${(() => { const pm = x.a && String(x.a).match(/\[\[PATH:([^\]]+)\]\]/); const who = pm && (typeof MANAGERS !== "undefined" ? MANAGERS : []).find((n) => n.toLowerCase() === pm[1].trim().toLowerCase()); return who && typeof openPathCard === "function" ? `<div class="ask-which"><button type="button" data-askpath="${esc(who)}">🏁 ${who === (typeof currentManager !== "undefined" && currentManager) ? "YOUR" : esc(shown(who).toUpperCase()) + "'S"} PATH TO WIN</button></div>` : ""; })()}${x.a && (x.a.includes("[[WHICH_LEAGUE]]") || (String(x.a).length < 80 && /fantasy.{0,12}pick.?.?em|pick.?.?em.{0,12}fantasy/i.test(x.a) && /\?\s*$/.test(x.a))) && x === log[log.length - 1] && !busy ? `<div class="ask-which"><button type="button" data-ask="${esc(x.q)} (pick'em)">🏈 PICK'EM</button><button type="button" data-ask="${esc(x.q)} (fantasy league)">🏆 FANTASY</button></div>` : ""}`).join("") : `<p class="ask-hint">This week and every season: odds, what-ifs, picks, records and the archive.</p>`}</div>
      ${log.length ? "" : `<div class="ask-chips">${chips().map((c) => `<button type="button" data-ask="${esc(c)}"><span>${esc(c)}</span><i aria-hidden="true">↗</i></button>`).join("")}</div>`}
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
    // Which tab the question was asked from: on Fantasy a question with no
    // league words is a fantasy question.
    return { screen: document.getElementById("history-screen")?.classList.contains("hidden") === false ? "fantasy" : "pickem", asker: me(), members: MANAGERS, games: GAMES.map((g) => { const l = latestLive[g.id], fin = f[g.id]; const sc = fin || (l?.state === "in" ? l : null); return { id: g.id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort, favorite: g.favorite, spread: g.spread, status: fin ? "final" : l?.state === "in" ? `live ${l.detail || ""} (kicked off ${g.kickoffLabel || ""})`.trim() : `not started (${g.kickoffLabel || ""})`, score: sc ? `${g.awayShort} ${sc.awayScore}, ${g.homeShort} ${sc.homeScore}` : "" }; }) };
  }
  async function send(q) {
    q = String(q || "").trim(); if (q.length < 2 || busy) return;
    busy = true; const item = { q, a: null, tools: [] }; log.push(item); sheet();
    convo.push({ role: "user", content: q });
    // Path questions ('what do I need', 'how do I win', 'which games do I have
    // to get right'): the path to win card already answers them, so skip the
    // round trip and hand over the chance and the button at once.
    const fast = (() => {
      if (typeof openPathCard !== "function" || typeof winChanceMemo === "undefined" || !winChanceMemo.out) return null;
      if (/fantasy|playoff|season|beat|\bvs\b|versus|ahead of|pass\b|stop|if\b/i.test(q)) return null;
      if (!/(path|what (games? )?(do|does) \w+ (need|have to)|need to (win|hit|happen)|have to (get|hit|win)|how (do|does|can) \w+ win|what has to happen)/i.test(q)) return null;
      const named = (typeof MANAGERS !== "undefined" ? MANAGERS : []).filter((n) => new RegExp(`\\b${n}\\b`, "i").test(q.replace(/compootah/ig, "")));
      const who = named.length === 1 ? named[0] : named.length ? null : currentManager;
      const p = who && winChanceMemo.out[who];
      if (!who || p == null) return null;
      const pctTxt = p >= 0.995 ? "over 99%" : p > 0 && p < 0.001 ? "under 0.1%" : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
      return p <= 0 ? null : `${who === currentManager ? "You're" : `${shown(who)} is`} at ${pctTxt} to win the week.\n[[PATH:${who}]]`;
    })();
    if (fast) { item.a = fast; convo.push({ role: "assistant", content: fast }); busy = false; sheet(); if (typeof track === "function") track("ask-path-fast", { event: true }); return; }
    let logId = null;
    const giveUp = (reason) => { if (logId) fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "giveup", logId, reason }) }).catch(() => {}); };
    try {
      for (let round = 0; round < 5; round++) {
        const r = await fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: convo.slice(-24), context: context(), sid: SID, logId, build: document.querySelector('meta[name="build"]')?.content || "" }), signal: AbortSignal.timeout(60000) });
        const j = await r.json().catch(() => ({}));
        if (j.logId) logId = j.logId;
        if (!r.ok || !j.message) { item.a = j.error || "Couldn't reach the league just now. Try again."; convo.pop(); break; }
        convo.push(j.message);
        if (j.message.tool_calls?.length) {
          for (const c of j.message.tool_calls) {
            let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
            const out = await runTool(c.function.name, args);
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
      b = document.createElement("button"); b.id = "ask-fab"; b.type = "button"; b.className = "ask-fab"; b.setAttribute("aria-label", "Ask Chief");
      b.innerHTML = `<b aria-hidden="true"><img class="chief-ico" src="assets/images/chief/chief2-96.webp" alt="" aria-hidden="true" decoding="async"></b>Ask`;
      b.addEventListener("click", () => { chipSet = null; open(); });
      document.body.appendChild(b);
      // Tucks away while the page scrolls (it floats over rows) and comes
      // back once scrolling stops.
      const sc = document.getElementById("app-scroll");
      let tuckT = null;
      const tuck = () => { b.classList.add("tuck"); clearTimeout(tuckT); tuckT = setTimeout(() => b.classList.remove("tuck"), 700); };
      sc?.addEventListener("scroll", tuck, { passive: true }); window.addEventListener("scroll", tuck, { passive: true });
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
    // No introduction pop ups: the Ask pill is enough. ?intro=bi still
    // previews the card (admin).
    if (!/[?&]intro=bi\b/.test(location.search)) return;
    if (introSeen() || !me() || window.__adminEntry || window.__liveView || (document.getElementById("logo-screen") && !document.getElementById("logo-screen").classList.contains("hidden")) || [...document.querySelectorAll(".pi-screen, .pr-screen, .np-screen, .modal-overlay, .wpx-overlay, #lt-modal, #ask-sheet, #locks-sheet, .lks")].some(shown_)) return;
    try { localStorage.setItem(INTRO_KEY, String(Date.now())); } catch {}
    const ex = chips();
    const m = document.createElement("div");
    m.className = "pi-screen ai-intro"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "New feature: Ask Chief");
    m.innerHTML = `<div class="pi-card">
      <div class="pi-head"><span class="pi-new">NEW</span><span class="pi-title"><img class="chief-ico" src="assets/images/chief/chief2-96.webp" alt="" aria-hidden="true" decoding="async"> ASK CHIEF</span><button type="button" class="pi-x" aria-label="Close">✕</button></div>
      <p class="pi-lede">Ask anything about this week's race and get the answer from the same odds as the WIN% column.</p>
      <div class="pi-step"><b>1</b><span>Tap <span class="ai-pill"><img class="chief-ico" src="assets/images/chief/chief2-96.webp" alt="" aria-hidden="true" decoding="async"> Ask</span> at the bottom left of Scores</span></div>
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
  window.__weekAskSend = (q) => { chipSet = null; open(); send(q); };
  // The History page's box opens this same chat rather than a second one.
  window.__weekAskOpen = () => { chipSet = null; fromHistory = true; open(); fromHistory = false; };
  window.__weekAsk = { runTool, condChances };

  // ---- Pressure test (admin): #chieftest on Jake's phone runs a fixed set
  // of hard questions through the real Chief (same worker, same tools, same
  // data), off the chat log, and prints a report to paste back for grading.
  // The question set lives in chief-tests.json (repo, like fixes.json): each
  // Chief fix adds its regression test there and each feature its new test.
  // The worker keeps the running set with streaks; a run adds any test from
  // the file it hasn't seen (and never one removed on Live).
  let SEED_CASES = [];
  const loadSeeds = async () => { try { const r = await fetch(`chief-tests.json?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) SEED_CASES = (await r.json()).tests || []; } catch {} return SEED_CASES; };
  async function testCase(c) {
    const conv = [], out = [];
    const ctx = () => ({ ...context(), screen: c.screen });
    for (const q of c.turns) {
      conv.push({ role: "user", content: q });
      const item = { q, a: null, tools: [] };
      try {
        for (let round = 0; round < 5; round++) {
          const r = await fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conv.slice(-24), context: ctx(), sid: "test", test: true, build: document.querySelector('meta[name="build"]')?.content || "" }), signal: AbortSignal.timeout(60000) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.message) { item.a = `(error: ${j.error || r.status})`; break; }
          conv.push(j.message);
          if (j.message.tool_calls?.length) {
            for (const t of j.message.tool_calls) { let args = {}; try { args = JSON.parse(t.function.arguments || "{}"); } catch {} const o = await runTool(t.function.name, args); item.tools.push({ name: t.function.name, args, out: o }); conv.push({ role: "tool", tool_call_id: t.id, content: JSON.stringify(o) }); }
            continue;
          }
          item.a = j.message.content || "…"; break;
        }
        if (item.a == null) item.a = "(too many steps)";
      } catch (e) { item.a = `(lost connection: ${String(e?.message || e).slice(0, 40)})`; }
      out.push(item);
    }
    return out;
  }
  // Live's remembered-device token on this phone (same site), for the stored set.
  const ctDevice = () => { try { return localStorage.getItem("brochiefs_live_device") || ""; } catch { return ""; } };
  async function ctApi(method, body) {
    const d = ctDevice(), q = ctAuth || (d ? `device=${encodeURIComponent(d)}` : ""); if (!q) return null;
    try { const r = await fetch(`${WORKER_URL}/chief-test?${q}&t=${Date.now()}`, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }); return r.ok ? await r.json() : null; } catch { return null; }
  }
  async function loadSet() {
    await loadSeeds();
    const j = await ctApi("POST", { action: "sync", cases: SEED_CASES }); if (!j) return null;
    return j.cases.length ? j : null;
  }
  // Each case's checks against what the Chief did: the tools it called (any
  // of a|b), text it must and must not say, and no "which league" when the
  // screen decides it.
  function grade(c, turns) {
    const ck = c.checks || {}, tools = turns.flatMap((t) => t.tools.map((x) => x.name)), text = turns.map((t) => t.a || "").join("\n"), why = [];
    for (const t of ck.tools || []) if (!t.split("|").some((n) => (n === "none" ? !tools.length : tools.includes(n)))) why.push(`didn't call ${t}`);
    for (const r of ck.must || []) { try { if (!new RegExp(r, "i").test(text)) why.push(`missing /${r}/`); } catch {} }
    for (const r of ck.mustNot || []) { try { if (new RegExp(r, "i").test(text)) why.push(`said /${r}/`); } catch {} }
    if (ck.noAsk && /WHICH_LEAGUE|fantasy league or the pick/i.test(text)) why.push("asked which league");
    if (turns.some((t) => /^\((error|lost connection|too many steps)/.test(t.a || ""))) why.push("no answer");
    const bad = turns.flatMap((t) => t.tools).filter((x) => /^No game|^No member|^Unknown tool/.test(String(x.out?.error || "")));
    if (bad.length) why.push(`tool error: ${bad[0].name} ${bad[0].out.error}`);
    return { pass: !why.length, why };
  }
  function testReport(results) {
    const f = fins(), build = document.querySelector('meta[name="build"]')?.content || "";
    const head = `Chief pressure test · ${new Date().toLocaleString()} · asker ${me()} · build ${build} · week ${typeof currentWeek !== "undefined" ? currentWeek : "?"} · ${GAMES.filter((g) => f[g.id]).length}/${GAMES.length} games final`;
    return [head, ...results.map(({ c, turns, check }) => [`\n## ${c.id} (${c.screen}) ${check ? (check.pass ? "PASS" : `FAIL: ${check.why.join("; ")}`) : ""}${c.regression ? " [regression]" : ""}`, ...turns.map((t) => [`Q: ${t.q}`, `A: ${t.a}`, ...t.tools.map((x) => `   tool ${x.name}(${JSON.stringify(x.args)}) -> ${JSON.stringify(x.out).slice(0, 700)}`)].join("\n"))].join("\n"))].join("\n");
  }
  // One full run: the stored set (or the repo file), each case through the
  // real Chief, graded, the score saved. progress(i, n, id) after each.
  let ctAuth = "";
  async function runAll(includeRetired, progress = () => {}, only = null) {
    const set = (await loadSet()) || { cases: (SEED_CASES.length ? SEED_CASES : await loadSeeds()).map((c) => ({ source: "seed", ...c })), runs: [], local: true };
    const todo = set.cases.filter((c) => only?.length ? only.includes(c.id) : includeRetired || !c.retired), results = [];
    // A failing-only rerun checks fixes; it is not saved as the score.
    if (only?.length) set.local = true;
    for (let i = 0; i < todo.length; i++) { progress(i, todo.length, todo[i].id); const turns = await testCase(todo[i]); results.push({ c: todo[i], turns, check: grade(todo[i], turns) }); }
    progress(todo.length, todo.length, "");
    const passed = results.filter((r) => r.check.pass).length, failed = results.filter((r) => !r.check.pass).map((r) => r.c.id);
    let saved = "";
    if (!set.local) { const st = `${GAMES.filter((g) => fins()[g.id]).length}/${GAMES.length} final${GAMES.some((g) => latestLive[g.id]?.state === "in") ? ", games live" : ""}`; const r = await ctApi("POST", { action: "save-run", results: Object.fromEntries(results.map((x) => [x.c.id, x.check.pass])), build: document.querySelector('meta[name="build"]')?.content || "", state: st, passed, total: results.length, failed }); saved = r ? "" : " (couldn't save the score)"; set.runs = r?.runs || set.runs; set.turned = r ? { regressed: r.regressed || [], fixed: r.fixed || [] } : null; } else saved = " (not saved: no Live sign-in reached the test)";
    const trend = (set.runs || []).slice(0, 6).map((x) => `${x.passed}/${x.total}`).join(" ← ");
    const tu = set.turned || { regressed: [], fixed: [] };
    const head = `SCORE ${passed}/${results.length}${saved}${trend ? `\nRecent runs: ${trend}` : ""}${tu.regressed.length ? `\nREGRESSED (passed before, failing now): ${tu.regressed.join(", ")}` : ""}${tu.fixed.length ? `\nFixed since last run: ${tu.fixed.join(", ")}` : ""}${failed.length ? `\nFailed checks: ${failed.join(", ")}` : ""}`;
    // The short version to paste: only what failed, regressions first.
    const bad = results.filter((x) => !x.check.pass).sort((a, b) => tu.regressed.includes(b.c.id) - tu.regressed.includes(a.c.id));
    const brief = `Brochiefs Chief test brief: ${head}\n` + (bad.length ? testReport(bad).split("\n").slice(1).join("\n") : "\nEverything passed.");
    const text = `${head}\n\n` + testReport(results);
    // Kept on the worker too, so the results can still be copied on Live
    // after the app or Live was closed.
    if (!set.local) ctApi("POST", { action: "report", passed, total: results.length, text, brief });
    return { passed, total: results.length, failed, regressed: tu.regressed, fixed: tu.fixed, runs: set.runs || [], brief, text };
  }
  // The data a fair run needs: this week's slate, everyone's picks and the
  // WIN% odds worked out from them (a run on a half-loaded page graded stale
  // numbers).
  const ctReady = async (ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (GAMES.length && lastGoodCloudPicks && Object.keys(lastGoodCloudPicks).length && base()?.detail) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
  // Live runs the test in a hidden frame of the app (?ctembed=1) and shows
  // the progress bar and report itself; the frame only does the work.
  if (/[?&]ctembed=1\b/.test(location.search) && window.parent !== window) {
    const post = (m) => { try { window.parent.postMessage(m, location.origin); } catch {} };
    window.addEventListener("message", async (e) => {
      if (e.origin !== location.origin || e.data?.type !== "ct-run") return;
      ctAuth = String(e.data.auth || "");
      if (me() !== "Jake") return post({ type: "ct-error", error: "The app on this device isn't signed in as Jake. Open the app here once and pick Jake." });
      post({ type: "ct-progress", i: 0, n: 0, id: "loading this week's data" });
      if (!(await ctReady())) return post({ type: "ct-error", error: "This week's picks and odds didn't load in 30 seconds. Try again." });
      try { const r = await runAll(!!e.data.all, (i, n, id) => post({ type: "ct-progress", i, n, id }), Array.isArray(e.data.only) ? e.data.only : null); post({ type: "ct-done", ...r }); } catch (err) { post({ type: "ct-error", error: String(err?.message || err).slice(0, 120) }); }
    });
    post({ type: "ct-hello" });
  }
  async function runPressureTest() {
    if (me() !== "Jake") return;
    let m = document.getElementById("chief-test");
    if (!m) { m = document.createElement("div"); m.id = "chief-test"; m.className = "ct-ov"; document.body.appendChild(m); }
    m.innerHTML = `<div class="ct-card"><div class="ct-k">CHIEF PRESSURE TEST</div><p class="ct-p">The question set through the real Chief, off the chat log. About a minute or two.</p><label class="ct-l"><input type="checkbox" id="ct-ret"> Include retired tests (the quarterly check)</label><div class="ct-row"><button type="button" class="ct-b" data-ct="close">Close</button><button type="button" class="ct-b go" data-ct="run">Run</button></div><div class="ct-bar" hidden><i></i></div><pre class="ct-out" hidden></pre></div>`;
    m.onclick = async (e) => {
      const b = e.target.closest("[data-ct]"); if (!b) return;
      if (b.dataset.ct === "close") { m.remove(); history.replaceState(null, "", location.pathname + location.search); return; }
      if (b.dataset.ct === "copy") { const t = m.querySelector(".ct-out").textContent; try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; } catch { const r = document.createRange(); r.selectNodeContents(m.querySelector(".ct-out")); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = "Selected: copy it"; } return; }
      if (b.dataset.ct !== "run") return;
      b.disabled = true; const p = m.querySelector(".ct-p"), pre = m.querySelector(".ct-out"), bar = m.querySelector(".ct-bar");
      p.textContent = "Loading this week's data…"; await ctReady(); bar.hidden = false;
      const r = await runAll(m.querySelector("#ct-ret")?.checked, (i, n, id) => { bar.firstChild.style.width = `${n ? (i / n) * 100 : 0}%`; p.textContent = i < n ? `Running ${i + 1} of ${n}: ${id}…` : "Saving the score…"; });
      pre.textContent = r.text; pre.hidden = false; p.textContent = "Done. Copy the report and paste it to Claude."; b.dataset.ct = "copy"; b.textContent = "Copy report"; b.disabled = false;
    };
  }
  const maybeTest = () => { if (location.hash === "#chieftest") setTimeout(runPressureTest, 1200); };
  maybeTest(); window.addEventListener("hashchange", maybeTest);
})();
