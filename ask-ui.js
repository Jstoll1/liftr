// Ask the week (preview): "If Michigan wins, can I still win?"
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
    const head = `Brochiefs Ask the week · ${new Date().toLocaleString()} · ${me() || "nobody signed in"}${v ? ` · build ${v}` : ""}`;
    return [head, ...log.map((x) => `Q: ${x.q}\nA: ${x.a ?? "(still working)"}${x.raw ? `\n   read as: ${JSON.stringify(x.raw)}` : ""}`)].join("\n\n");
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

  // Everyone at once: who is out and who is alive, with or without held games.
  function fieldAnswer(r) {
    const hidden = hiddenOthers(me());
    if (hidden.length >= MANAGERS.length - 1) return "Picks are hidden until kickoff, so there's no race to work out yet.";
    const memo = base(); if (!memo) return "The odds aren't loaded yet. Give the board a second and ask again.";
    let odds = memo.out, ifs = "";
    if (r.conditions.length) {
      const c = condChances(r.conditions); if (!c) return "The odds aren't loaded yet. Give the board a second and ask again.";
      if (c.impossible) return `${c.impossible} can't happen any more: that game is already final the other way.`;
      odds = c; ifs = r.conditions.map(condText).join(" and ");
    }
    const rows = MANAGERS.map((n) => [n, odds[n] || 0]).sort((a, b) => b[1] - a[1]);
    const out = rows.filter(([, p]) => p <= 0).map(([n]) => shown(n)), alive = rows.filter(([, p]) => p > 0);
    const head = ifs ? `If ${ifs}: ` : "";
    const outTxt = out.length ? `${out.join(", ")} ${out.length === 1 ? "is" : "are"} out.` : "Nobody is out.";
    const aliveTxt = alive.length ? ` Still alive: ${alive.map(([n, p]) => `${shown(n)} ${pct(p)}`).join(", ")}.` : "";
    return `${head}${outTxt}${aliveTxt}${hidden.length ? ` (${hidden.map(shown).join(", ")}'s picks are still hidden.)` : ""}`;
  }

  const fins = () => computeLiveResults(latestLive);
  // Best finish: what is banked plus every pick still to be decided hitting.
  function maxAnswer(who) {
    const st = (lastGoodCloudPicks || {})[who]?.picks || {}, f = fins(), you = who === me();
    let banked = 0, open = 0, n = 0;
    for (const g of GAMES) { const p = st[g.id]; if (!p?.team) continue; if (f[g.id]) banked += scorePick(g, p, f[g.id]) || 0; else { open += pickWorth(g, p); n++; } }
    const S = you ? "You" : shown(who);
    return `${S} ${you ? "have" : "has"} ${banked} banked and ${n} pick${n === 1 ? "" : "s"} still to play, so the best finish is ${banked + open}.`;
  }
  // Who took what on a game, from picks already shown (from kickoff on).
  function picksAnswer(r) {
    const c = r.conditions[0]; if (!c) return "Which game? Try \"who picked Michigan?\"";
    const g = GAMES.find((x) => String(x.id) === String(c.game)); if (!g) return "I couldn't find that game.";
    const all = lastGoodCloudPicks || {};
    const side = (team) => MANAGERS.filter((n) => all[n]?.picks?.[g.id]?.team === team).map((n) => { const p = all[n].picks[g.id]; return `${shown(n)}${p.mode === "ATS" ? ` ${team === g.favorite ? "−" : "+"}${g.spread}` : " (to win)"}${p.lock && lockRule() ? " 🔒" : ""}`; });
    const hidden = MANAGERS.filter((n) => all[n]?.picks?.[g.id]?.hidden).length;
    if (hidden && !isGameLocked(g)) return `Picks on ${g.awayShort} at ${g.homeShort} stay hidden until it kicks off.`;
    const a = side(g.away), h = side(g.home);
    return `${g.awayShort}: ${a.length ? a.join(", ") : "nobody"}. ${g.homeShort}: ${h.length ? h.join(", ") : "nobody"}.`;
  }
  function tbAnswer() {
    const g = typeof tiebreakerGameOf === "function" ? tiebreakerGameOf() : null; if (!g) return "There's no tiebreaker game set this week.";
    const all = lastGoodCloudPicks || {}, f = fins()[g.id], l = latestLive[g.id];
    const total = f ? f.awayScore + f.homeScore : l?.state === "in" ? (l.awayScore || 0) + (l.homeScore || 0) : null;
    const gs = MANAGERS.map((n) => [n, String(all[n]?.tiebreaker ?? "").trim()]).filter(([, v]) => v !== "");
    if (gs.some(([, v]) => v === "hidden")) return `The tiebreaker is total points in ${g.awayShort} at ${g.homeShort}. Guesses stay hidden until the first kickoff.`;
    const list = gs.map(([n, v]) => [n, Number(v)]).filter(([, v]) => Number.isFinite(v)).sort((a, b) => (total == null ? a[1] - b[1] : Math.abs(a[1] - total) - Math.abs(b[1] - total)));
    const now = total == null ? "It hasn't kicked off." : f ? `Final total: ${total}.` : `Total right now: ${total}.`;
    return `Tiebreaker: total points in ${g.awayShort} at ${g.homeShort}. ${now} ${list.length ? `${total == null ? "Guesses" : "Closest first"}: ${list.map(([n, v]) => `${shown(n)} ${v}`).join(", ")}.` : "No guesses in."}`;
  }

  function answer(r) {
    if ((r.intent === "needs" || r.intent === "threats") && r.conditions?.length) r = { ...r, intent: "chance" };
    if (r.intent === "field") return fieldAnswer(r);
    if (r.intent === "picks") return picksAnswer(r);
    if (r.intent === "tiebreaker") return tbAnswer();
    if (r.intent === "max") return maxAnswer(r.who || me() || MANAGERS[0]);
    const who = r.who || me();
    if (r.intent === "unknown") return "I can answer questions about this week's race: odds, \"if X wins\", what you need, who's out, who picked what, best finish and the tiebreaker.";
    if (!who) return "Who's asking? Pick yourself on the app first, or name someone (\"can Curt still win?\").";
    const hidden = hiddenOthers(who);
    if (hidden.length >= MANAGERS.length - 1) return "Everyone else's picks are hidden until kickoff, so there's no race to work out yet. Ask again once games start.";
    const memo = base(); if (!memo?.detail?.[who]) return "The odds aren't loaded yet. Give the board a second and ask again.";
    const d = memo.detail[who], name = shown(who), you = who === me();
    const subj = you ? "you" : name, Subj = you ? "You" : name;
    const note = hidden.length ? ` (${hidden.map(shown).join(", ")}'s picks are still hidden, so they aren't counted.)` : "";
    if (r.intent === "chance") {
      if (!r.conditions.length) return `${Subj} ${you ? "have" : "has"} a ${pct(d.pct)} chance to win the week right now.${d.pct === 0 && d.alive === false ? " No path left." : ""}${note}`;
      const c = condChances(r.conditions);
      if (!c) return "The odds aren't loaded yet. Give the board a second and ask again.";
      const ifs = r.conditions.map(condText).join(" and ");
      if (c.impossible) return `${c.impossible} can't happen any more: that game is already final the other way.`;
      const p = c[who];
      const verdict = p <= 0 ? `No. If ${ifs}, ${subj} can't finish first` : p < 0.01 ? `Barely. If ${ifs}, ${subj} still win${you ? "" : "s"} ${pct(p)} of the time` : `Yes. If ${ifs}, ${subj} win${you ? "" : "s"} the week ${pct(p)} of the time`;
      const move = p > d.pct + 0.005 ? `, up from ${pct(d.pct)} now` : p < d.pct - 0.005 ? `, down from ${pct(d.pct)} now` : `, about the same as now`;
      const lead = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      const fav = lead && lead[0] !== who && lead[1] > 0 ? ` ${shown(lead[0])} would be the favourite at ${pct(lead[1])}.` : "";
      return `${verdict}${p <= 0 ? "." : move + "."}${fav}${note}`;
    }
    if (r.intent === "needs") {
      if (d.pct === 0 && d.alive === false) return `${Subj} can't win this week any more.${note}`;
      const top = (d.games || []).filter((x) => x.ifHit > x.ifMiss).slice(0, 3);
      if (!top.length) return `${Subj} ${you ? "are" : "is"} at ${pct(d.pct)}; no single open game moves it much.${note}`;
      return `${Subj} ${you ? "are" : "is"} at ${pct(d.pct)}. Biggest swings: ${top.map((x) => `${short(x.game, x.pick.team)} ${x.pick.mode === "ATS" ? `${x.pick.team === x.game.favorite ? "−" : "+"}${x.game.spread}` : "to win"} (${pct(x.ifHit)} if it hits, ${pct(x.ifMiss)} if not)`).join("; ")}.${note}`;
    }
    if (r.intent === "threats") {
      const t = (d.threats || []).filter((x) => x.p >= 0.005);
      if (!t.length) return `Nobody is a real threat to ${subj} right now (${pct(d.pct)} to win).${note}`;
      return `When ${subj} ${you ? "don't" : "doesn't"} win, it's usually ${t.map((x) => `${shown(x.name)} (${pct(x.p)})`).join(", ")}.${note}`;
    }
    return "I didn't follow that one. Try \"If Michigan wins can I still win?\"";
  }

  // Suggestions: a few from the usual questions, filled in with games still
  // to be decided, shuffled each time the chat opens.
  let chipSet = null;
  function chips() {
    if (chipSet) return chipSet;
    const f = fins(), open = GAMES.filter((g) => !f[g.id]);
    const g1 = open[0], g2 = open[1] || open[0];
    const pool = [
      "Can I still win this week?", "What do I need to win?", "Who can catch me?", "Who is eliminated?", "Who's the favourite right now?",
      "What's my best possible score?", "Where's the tiebreaker at?",
      g1 && `If ${g1.homeShort} wins can I still win?`, g1 && `If ${g1.awayShort} covers who is out?`, g2 && `Who picked ${g2.homeShort}?`,
      g1 && g2 && g1 !== g2 && `If ${g1.homeShort} and ${g2.awayShort} win, what are my odds?`,
    ].filter(Boolean);
    for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
    return (chipSet = pool.slice(0, 3));
  }


  function sheet() {
    let m = document.getElementById("ask-sheet");
    if (!m) {
      m = document.createElement("div"); m.id = "ask-sheet"; m.className = "ask"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Ask about this week");
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.closest(".ask-x")) { m.remove(); return; }
        if (e.target.closest("[data-askcopy]")) { copyChat(); return; }
        const c = e.target.closest("[data-ask]"); if (c) send(c.dataset.ask);
      });
      m.addEventListener("submit", (e) => { e.preventDefault(); const i = m.querySelector("input"); send(i.value); });
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="ask-card"><div class="ask-h"><b>💬 ASK THE WEEK</b>${log.length ? `<button type="button" class="ask-cp" data-askcopy="1">${copied ? "✓ Copied" : "Copy chat"}</button>` : ""}<button type="button" class="ask-x" aria-label="Close">✕</button></div>
      <div class="ask-log">${log.length ? log.map((x) => `<p class="ask-q">${esc(x.q)}</p><p class="ask-a${x.a == null ? " wait" : ""}">${x.a == null ? "Working it out…" : esc(x.a)}</p>`).join("") : `<p class="ask-hint">Ask about this week's race. The odds come from the same runs as the WIN% column.</p>`}</div>
      <div class="ask-chips">${chips().map((c) => `<button type="button" data-ask="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <form class="ask-f"><input type="text" maxlength="200" placeholder="If Michigan wins can I still win?" ${busy ? "disabled" : ""} autocomplete="off"><button type="submit" ${busy ? "disabled" : ""}>Ask</button></form></div>`;
    const lg = m.querySelector(".ask-log"); lg.scrollTop = lg.scrollHeight;
    return m;
  }

  async function send(q) {
    q = String(q || "").trim(); if (q.length < 3 || busy) return;
    busy = true; const item = { q, a: null }; log.push(item); sheet();
    try {
      const games = GAMES.map((g) => ({ id: g.id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort, favorite: g.favorite, spread: g.spread, status: computeLiveResults(latestLive)[g.id] ? "final" : latestLive[g.id]?.state === "in" ? "live" : "not started" }));
      const r = await fetch(`${WORKER_URL}/week-ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, asker: me(), members: MANAGERS, games, previous: (() => { const p = log[log.length - 2]; return p ? { q: p.q, reading: p.raw || null } : null; })() }) });
      const j = await r.json().catch(() => ({}));
      item.raw = r.ok ? j : null;
      item.a = r.ok ? answer(j) : j.error || "Couldn't reach the league just now. Try again.";
    } catch { item.a = "Couldn't reach the league just now. Try again."; }
    busy = false; sheet();
    if (typeof noteUse === "function") noteUse("week-ask", q.slice(0, 60));
  }

  function open() { sheet().querySelector("input")?.focus(); if (typeof noteUse === "function") noteUse("week-ask-open"); }

  // The button: a pill fixed bottom left on the Scores page (Lightning has
  // the bottom right), so it is in reach wherever you are on the board.
  function paintBtn() {
    let b = document.getElementById("ask-fab");
    if (!b) {
      b = document.createElement("button"); b.id = "ask-fab"; b.type = "button"; b.className = "ask-fab"; b.setAttribute("aria-label", "Ask about this week");
      b.innerHTML = `<b aria-hidden="true">💬</b>Ask`;
      b.addEventListener("click", () => { chipSet = null; open(); });
      document.body.appendChild(b);
    }
    const sb = document.getElementById("scoreboard-screen");
    b.hidden = !sb || sb.classList.contains("hidden") || !!document.querySelector(".modal-overlay:not(.hidden), #ask-sheet, #lt-modal");
  }
  paintBtn(); setInterval(paintBtn, 800);
  window.openWeekAsk = open;
  window.__weekAsk = { answer, condChances };
})();
