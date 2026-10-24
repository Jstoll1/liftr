// Ask the week: "If Michigan wins, can I still win?"
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
  const TOOLS = {
    standings() {
      const memo = base(), live = typeof inFlightPoints === "function" ? (n) => inFlightPoints((lastGoodCloudPicks || {})[n]?.picks || {}, latestLive) : () => 0;
      return { ...hiddenNote(), members: MANAGERS.map((n) => { const b = banked(n), d = memo?.detail?.[n]; return { member: n, points: b.pts, livePoints: live(n), bestPossible: b.max, picksLeft: b.picksLeft, chanceToWin: d ? r3(d.pct) : null, eliminated: d ? d.pct === 0 && d.alive === false : null }; }).sort((a, b) => b.points - a.points) };
    },
    chance({ conditions = [] } = {}) {
      const conds = [];
      for (const c of conditions) {
        const g = GAMES.find((x) => String(x.id) === String(c.game).replace(/^G/i, "")); if (!g) return { error: `No game ${c.game} this week.` };
        const t = String(c.team || "").toLowerCase();
        const team = [g.away, g.home].find((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t)) || (g.awayShort.toLowerCase() === t ? g.away : g.homeShort.toLowerCase() === t ? g.home : null);
        if (!team) return { error: `${c.team} isn't in ${gName(g)}.` };
        conds.push({ game: g.id, team: c.not ? (team === g.away ? g.home : g.away) : team, mode: c.mode === "ATS" ? "ATS" : "SU" });
      }
      const memo = base(); if (!memo) return { error: "Odds not loaded yet." };
      const h = hiddenNote(); if (h.picksHidden && /Everyone/.test(h.picksHidden)) return h;
      const odds = conds.length ? condChances(conds) : memo.out;
      if (!odds) return { error: "Odds not loaded yet." };
      if (odds.impossible) return { error: `${odds.impossible} can't happen: that game is already final the other way.` };
      return { ...h, assuming: conds.map(condText), chanceToWin: Object.fromEntries(MANAGERS.map((n) => [n, r3(odds[n] || 0)])), currentChance: Object.fromEntries(MANAGERS.map((n) => [n, r3(memo.out[n] || 0)])), eliminated: MANAGERS.filter((n) => !(odds[n] > 0)), ...(conds.length ? { eliminatedMeans: "won none of 4,000 simulated outcomes with these results: as good as out, not strictly impossible" } : {}) };
    },
    needs({ member } = {}) {
      const who = MANAGERS.find((n) => n.toLowerCase() === String(member || me() || "").toLowerCase()); if (!who) return { error: `No member ${member}.` };
      const memo = base(); const d = memo?.detail?.[who]; if (!d) return { error: "Odds not loaded yet." };
      return { ...hiddenNote(), member: who, chanceToWin: r3(d.pct), eliminated: d.pct === 0 && d.alive === false, swings: (d.games || []).slice(0, 5).map((x) => ({ game: gName(x.game), pick: `${short(x.game, x.pick.team)} ${x.pick.mode === "ATS" ? `${x.pick.team === x.game.favorite ? "−" : "+"}${x.game.spread}` : "to win"}${x.pick.lock ? " (lock)" : ""}`, chanceIfHits: r3(x.ifHit), chanceIfMisses: r3(x.ifMiss), likelyToHit: r3(x.pHit) })) };
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
      <div class="ask-log">${log.length ? log.map((x) => `<p class="ask-q">${esc(x.q)}</p><p class="ask-a${x.a == null ? " wait" : ""}">${x.a == null ? "Working it out…" : esc(x.a)}</p>`).join("") : `<p class="ask-hint">Ask anything about this week's race: odds, "what if" a game goes one way, who's out, who picked what, the tiebreaker. The numbers come from the same runs as the WIN% column.</p>`}</div>
      <div class="ask-chips">${chips().map((c) => `<button type="button" data-ask="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <form class="ask-f"><input type="text" maxlength="200" placeholder="If Michigan wins can I still win?" ${busy ? "disabled" : ""} autocomplete="off"><button type="submit" ${busy ? "disabled" : ""}>Ask</button></form></div>`;
    const lg = m.querySelector(".ask-log"); lg.scrollTop = lg.scrollHeight;
    return m;
  }

  // The whole conversation as the assistant sees it (user, assistant and
  // tool turns); log holds what is shown.
  const convo = [];
  function context() {
    const f = fins();
    return { asker: me(), members: MANAGERS, games: GAMES.map((g) => { const l = latestLive[g.id], fin = f[g.id]; const sc = fin || (l?.state === "in" ? l : null); return { id: g.id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort, favorite: g.favorite, spread: g.spread, status: fin ? "final" : l?.state === "in" ? `live ${l.detail || ""}`.trim() : `not started (${g.kickoffLabel || ""})`, score: sc ? `${g.awayShort} ${sc.awayScore}, ${g.homeShort} ${sc.homeScore}` : "" }; }) };
  }
  async function send(q) {
    q = String(q || "").trim(); if (q.length < 2 || busy) return;
    busy = true; const item = { q, a: null, tools: [] }; log.push(item); sheet();
    convo.push({ role: "user", content: q });
    try {
      for (let round = 0; round < 5; round++) {
        const r = await fetch(`${WORKER_URL}/week-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: convo.slice(-24), context: context() }) });
        const j = await r.json().catch(() => ({}));
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
      if (item.a == null) item.a = "That one took too many steps. Try asking it a simpler way.";
    } catch { item.a = "Couldn't reach the league just now. Try again."; convo.pop(); }
    busy = false; chipSet = null; sheet();
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
  window.__weekAsk = { runTool, condChances };
})();
