// Fantasy: the top of the Fantasy (was History) tab. The BroChiefs fantasy
// league (NFL, ESPN, public) from the Worker's /fantasy:
//   the Chief's take on last week
//   this week's matchups: live totals, win chance, players left to play,
//     tap for both lineups (points, projections, who is still to play) and
//     the all-time head to head
//   tables, one at a time: standings, power, playoff odds, luck (all-play)
//   last week's awards and bench regret (points left on the bench)
//   tap an owner for their season: weekly scores against the league, best
//     and worst week, streak and odds
// The league archive folds away underneath.
(() => {
  if (typeof WORKER_URL === "undefined" || !WORKER_URL) return;
  const root = document.getElementById("fx");
  if (!root) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pts = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
  const pct = (x) => (x >= 0.995 ? "99%+" : x > 0 && x < 0.01 ? "<1%" : `${Math.round((x || 0) * 100)}%`);
  const me = () => (typeof currentManager !== "undefined" ? currentManager : null);
  const colour = (o) => (typeof A !== "undefined" && A.colors?.[o]) || "#8b8498";
  const nflLogo = (ab) => (ab ? `<img class="fx-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500-dark/${esc(ab.toLowerCase())}.png" alt="" loading="lazy" onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('/500-dark/','/500/')}else this.style.visibility='hidden'">` : "");
  // No ESPN logo: the owner's pick'em avatar (their emoji or initial on
  // their pick'em colour), so a face is the same across both leagues.
  const pk = (o) => ({ c: (typeof accentFor === "function" && accentFor(o)) || colour(o), t: (typeof avatarOverrides !== "undefined" && avatarOverrides?.[o]) || String(o || "?")[0] });
  const ini = (o) => { const a = pk(o); return `<span class="fx-badge ini" style="--oc:${esc(a.c)}">${esc(a.t)}</span>`; };
  const badge = (t) => (t?.logo ? `<img class="fx-badge" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="${esc(ini(t.owner))}">` : ini(t?.owner));
  const INJ = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SUSP", DAY_TO_DAY: "DTD", PUP: "PUP" };
  const status = (p) => {
    const bye = Object.keys(nfl).length > 4 && p.nfl && !nfl[String(p.nfl).toUpperCase()];
    // An injury says more than a bye (an IR player is out either way).
    if (bye && !p.injury) return `<u class="bye">BYE</u>`;
    return p.injury ? `<u class="${p.injury === "QUESTIONABLE" || p.injury === "DAY_TO_DAY" ? "q" : ""}">${esc(INJ[p.injury] || p.injury.slice(0, 4))}</u>` : "";
  };
  const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
  const owner = (o) => `<b class="${o === me() ? "me" : ""}">${esc(o)}</b>`;
  let data = null, at = 0, busy = false, nfl = {}, nflAt = 0;
  const open = new Set();
  let tab = "standings", card = null;

  async function load(force) {
    if (busy || (!force && data && Date.now() - at < 55000)) return data;
    busy = true;
    try { const r = await fetch(`${WORKER_URL}/fantasy?t=${Math.floor(Date.now() / 60000)}`); if (r.ok) { data = await r.json(); at = Date.now(); } } catch {}
    // NFL game states, for who is still to play (the phone can reach ESPN).
    if (Date.now() - nflAt > 55000) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?t=${Math.floor(Date.now() / 60000)}`);
        if (r.ok) { const j = await r.json(); nfl = {}; for (const ev of j.events || []) { const c = ev.competitions?.[0]; const st = c?.status?.type?.state || "pre"; for (const t of c?.competitors || []) nfl[String(t.team?.abbreviation || "").toUpperCase()] = { state: st, done: !!c?.status?.type?.completed, ball: st === "in" && !!c?.situation?.possession && String(c.situation.possession) === String(t.team?.id), rz: !!c?.situation?.isRedZone }; } nflAt = Date.now(); }
      } catch {}
    }
    busy = false;
    return data;
  }

  // Players still to play, and what they are likely to add: their ESPN
  // projection before kickoff, about half of what is left once their game
  // is on, nothing once it is over.
  const gameOf = (p) => nfl[String(p.nfl || "").toUpperCase()] || null;
  const toPlay = (p) => { const g = gameOf(p); return g ? g.state === "pre" : null; };
  const live = (p) => { const g = gameOf(p); return !!g && g.state === "in"; };
  const remaining = (p) => { const g = gameOf(p); const proj = p.proj ?? null; if (!g) return 0; if (g.state === "post" || g.done) return 0; if (g.state === "in") return proj != null ? Math.max(0, proj - p.pts) * 0.5 : 4; return proj != null ? proj : 9; };
  const outlook = (t) => {
    const st = t?.starters || [];
    const left = st.filter((p) => toPlay(p) === true).length, now = st.filter(live).length;
    const add = st.reduce((n, p) => n + remaining(p), 0);
    const open = st.filter((p) => { const g = gameOf(p); return g && g.state !== "post" && !g.done; }).length;
    return { left, now, exp: (t?.points || 0) + add, sd: Math.sqrt(Math.max(1, open)) * 7 };
  };
  const phi = (z) => 1 / (1 + Math.exp(-1.702 * z));

  const sideHtml = (t, other, k, o) => {
    const lead = (t?.points || 0) > (other?.points || 0);
    const tp = o && (o.left || o.now) ? `<span class="fx-tp">${o.now ? `${o.now} live` : ""}${o.now && o.left ? " · " : ""}${o.left ? `${o.left} to play` : ""}</span>` : "";
    return `<span class="fx-side ${k}${lead ? " lead" : ""}${t?.owner === me() ? " me" : ""}"><span class="fx-tlink" data-fxteam="${esc(t?.owner || "")}" role="button" aria-label="Open ${esc(t?.owner || "")}'s team">${badge(t)}</span><span class="fx-nm"><b>${esc(t?.owner || t?.name || "")}</b><small>${t?.record ? `${esc(t.record)} · ` : ""}${esc(t?.name || "")}</small>${tp}</span><em>${pts(t?.points)}${o && !o.final ? `<small>proj ${pts(o.exp)}</small>` : ""}</em></span>`;
  };
  // A starter's state: done, live, or still to play.
  const stOf = (p) => { const g = gameOf(p); return !g ? "" : g.state === "in" ? "live" : g.state === "post" || g.done ? "done" : "pre"; };
  // Each starter with a dot for done/live/to play; the higher score in each
  // slot row is lit; a totals row closes the column.
  const lineup = (t, o, x) => { const os = o?.starters || []; return `<ol class="fx-lu">${(t?.starters || []).map((p, i) => { const tp = toPlay(p), lv = live(p), q = os[i], st = stOf(p); const win = q && !tp && toPlay(q) !== true && (p.pts || 0) > (q.pts || 0); return `<li class="${tp ? "tp" : ""}${lv ? " fx-on" : ""}"><i>${esc(p.slot)}</i>${nflLogo(p.nfl) || "<span></span>"}<span class="fx-pn"><span class="fx-pt">${esc(p.name)}</span>${status(p)}</span><b class="${win ? "win" : ""}">${st ? (st === "live" && gameOf(p)?.ball ? `<s class="fx-ball${gameOf(p).rz ? " rz" : ""}" title="${gameOf(p).rz ? "Has the ball in the red zone" : "Has the ball"}"></s>` : `<s class="fx-sd ${st}" title="${st === "pre" ? "To play" : st === "live" ? "Playing now" : "Done"}"></s>`) : ""}${tp && p.proj != null ? `<small>${pts(p.proj)}</small>` : pts(p.pts)}</b></li>`; }).join("")}<li class="tot"><i>TOTAL</i><span></span><span class="fx-pn"><span class="fx-pt">${x && !x.final ? `proj ${pts(x.exp)}` : ""}</span></span><b>${pts(t?.points)}</b></li></ol>`; };

  const sparkline = (o) => {
    const wk = (data.weekly || []), mine = wk.filter((x) => x.owner === o).sort((a, b) => a.week - b.week);
    if (mine.length < 2) return "";
    const weeks = mine.map((x) => x.week), avg = weeks.map((w) => { const l = wk.filter((x) => x.week === w); return l.reduce((n, x) => n + x.points, 0) / (l.length || 1); });
    const all = [...mine.map((x) => x.points), ...avg], lo = Math.min(...all) - 5, hi = Math.max(...all) + 5, W = 300, H = 70;
    const hiW = mine.reduce((a, x) => (x.points > a.points ? x : a), mine[0]), loW = mine.reduce((a, x) => (x.points < a.points ? x : a), mine[0]);
    const xy = (i, v) => `${(i / (weeks.length - 1)) * (W - 8) + 4},${H - 4 - ((v - lo) / (hi - lo)) * (H - 8)}`;
    return `<svg class="fx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o)}'s weekly scores against the league average"><polyline class="avg" points="${avg.map((v, i) => xy(i, v)).join(" ")}"/><polyline class="mine" points="${mine.map((x, i) => xy(i, x.points)).join(" ")}"/>${mine.map((x, i) => { const op = wk.find((y) => y.week === x.week && y.owner === x.opponent); const r = op ? (x.points > op.points ? "w" : x.points < op.points ? "l" : "") : ""; const [cx, cy] = xy(i, x.points).split(","); return `<circle class="${r}" cx="${cx}" cy="${cy}" r="${x === hiW || x === loW ? 4 : 3}"><title>Week ${x.week}: ${pts(x.points)}${op ? ` vs ${esc(x.opponent)} ${pts(op.points)}` : ""}</title></circle>`; }).join("")}</svg><div class="fx-spk-wk">${mine.map((x, i) => `<span style="left:${((i / (weeks.length - 1)) * (W - 8) + 4) / W * 100}%" class="${x === hiW ? "hi" : x === loW ? "lo" : ""}">${x === hiW ? "BEST" : x === loW ? "LOW" : x.week}</span>`).join("")}</div>`;
  };
  const ownerCard = (o) => {
    const st = data.stats || {}, mine = (data.weekly || []).filter((x) => x.owner === o);
    if (!mine.length) return "";
    const best = [...mine].sort((a, b) => b.points - a.points)[0], worst = [...mine].sort((a, b) => a.points - b.points)[0];
    const od = st.odds?.[o], ap = st.allPlay?.[o], rg = (st.regret || []).find((x) => x.owner === o);
    return `<div class="fx-card">${sparkline(o)}<div class="fx-key"><span><i class="k-me"></i>${esc(o)}</span><span><i class="k-avg"></i>League average</span></div>
      <div class="fx-facts"><span><small>BEST</small><b>${pts(best.points)}</b><em>wk ${best.week}</em></span><span><small>WORST</small><b>${pts(worst.points)}</b><em>wk ${worst.week}</em></span><span><small>STREAK</small><b>${esc(st.streak?.[o] || "–")}</b></span>${od ? `<span><small>PLAYOFFS</small><b>${pct(od.playoffs)}</b></span>` : ""}${ap ? `<span><small>LUCK</small><b class="${ap.luck > 0 ? "up" : ap.luck < 0 ? "dn" : ""}">${ap.luck > 0 ? "+" : ""}${ap.luck}</b></span>` : ""}${rg ? `<span><small>BENCHED</small><b>${pts(rg.season)}</b></span>` : ""}</div></div>`;
  };

  // The team sheet: a full page over the tab for one owner.
  const insights = (o) => {
    const st = data.stats || {}, ti = st.teams?.[o], ap = st.allPlay?.[o], od = st.odds?.[o], rg = (st.regret || []).find((x) => x.owner === o);
    const s0 = (data.standings || []).find((r) => r.owner === o) || {}, out = [];
    const add = (kind, html) => out.push({ kind, html });
    if (ti?.ppg) { const d = Math.round((ti.ppg - ti.leagueAvg) * 10) / 10; add("ppg", `Scoring <b>${pts(ti.ppg)}</b> a game, ${d >= 0 ? `<b class="up">${pts(d)} above</b>` : `<b class="dn">${pts(-d)} below</b>`} the league average.`); }
    if (ti?.posRank) {
      const r = Object.entries(ti.posRank).filter(([, n]) => n), best = r.sort((a, b) => a[1] - b[1])[0], worst = [...r].sort((a, b) => b[1] - a[1])[0];
      if (best && worst && best[0] !== worst[0]) add("pos", `Strongest at <b>${esc(best[0])}</b> (${ord(best[1])} in the league), weakest at <b>${esc(worst[0])}</b> (${ord(worst[1])}).`);
    }
    if (ti?.topShare >= 0.3 && ti.topTwo?.length === 2) add("lean", `Leans on <b>${esc(ti.topTwo[0])}</b> and <b>${esc(ti.topTwo[1])}</b>: ${pct(ti.topShare)} of the roster's points.`);
    if (ap) add("luck", Math.abs(ap.luck) >= 1 ? `${ap.luck > 0 ? "Lucky" : "Unlucky"}: <b>${s0.wins}-${s0.losses}</b> but <b>${ap.apW}-${ap.apL}</b> against the whole league (luck <b class="${ap.luck > 0 ? "up" : "dn"}">${ap.luck > 0 ? "+" : ""}${ap.luck}</b>).` : `Record matches the scoring: <b>${ap.apW}-${ap.apL}</b> against the whole league.`);
    if (od) add("odds", `<b>${pct(od.playoffs)}</b> to make the playoffs, <b>${pct(od.bye)}</b> for a bye, <b class="gold">${pct(od.title)}</b> to win the title.`);
    if (ti?.sos?.rank && ti.sos.of > 1) { const r = ti.sos.rank; if (r <= 3 || r > ti.sos.of - 3) { const n = r <= 3 ? r : ti.sos.of - r + 1; add("sos", `${r <= 3 ? "Tough" : "Soft"} run-in: the ${n === 1 ? "" : `${ord(n)} `}${r <= 3 ? "hardest" : "easiest"} remaining schedule (${ti.sos.opponents.map(esc).join(", ")}).`); } }
    if (rg?.season) add("bench", `Left <b>${pts(rg.season)}</b> points on the bench${rg.worst ? `, most in week ${rg.worst.week} (${pts(rg.worst.left)})` : ""}.`);
    return out;
  };
  // The numbers behind an insight, shown when it is tapped.
  const tbl = (head, rows) => `<table class="fx-why"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr class="${r.me ? "me" : ""}">${r.c.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
  const why = (kind, o) => {
    const st = data.stats || {}, T = st.teams || {}, owners = (data.standings || []).map((r) => r.owner);
    if (kind === "ppg") {
      const rows = owners.map((x) => ({ x, v: T[x]?.ppg || 0 })).sort((a, b) => b.v - a.v);
      const mine = (data.weekly || []).filter((w) => w.owner === o).sort((a, b) => a.week - b.week);
      return tbl(["#", "Owner", "Pts a game"], rows.map((r, i) => ({ me: r.x === o, c: [i + 1, esc(r.x), pts(r.v)] }))) + `<p class="fx-whyn">${esc(o)} by week: ${mine.map((w) => `wk${w.week} <b>${pts(w.points)}</b>`).join(" · ")}. League average ${pts(T[o]?.leagueAvg)}.</p>`;
    }
    if (kind === "pos") {
      const ti = T[o]; if (!ti) return "";
      return tbl(["Pos", "Points", "Rank", "League best"], Object.keys(ti.posPts).map((pos) => { const best = owners.map((x) => [x, T[x]?.posPts?.[pos] || 0]).sort((a, b) => b[1] - a[1])[0]; return { c: [esc(pos), pts(ti.posPts[pos]), ord(ti.posRank[pos]), `${esc(best[0])} ${pts(best[1])}`] }; })) + `<p class="fx-whyn">Season points of the top starters at each spot (QB1, RB1-2, WR1-2, TE1, K, D/ST).</p>`;
    }
    if (kind === "lean") {
      const r = data.rosters?.[o] || [], tot = r.reduce((n, p) => n + (p.season || 0), 0);
      return tbl(["Player", "Pts", "Share"], r.slice(0, 6).map((p) => ({ c: [esc(p.name), pts(p.season), pct(tot ? p.season / tot : 0)] })));
    }
    if (kind === "luck") {
      const rows = Object.values(st.allPlay || {}).sort((a, b) => b.luck - a.luck);
      return tbl(["Owner", "W-L", "All-play", "Exp W", "Luck"], rows.map((x) => { const s0 = (data.standings || []).find((r) => r.owner === x.owner) || {}; return { me: x.owner === o, c: [esc(x.owner), `${s0.wins}-${s0.losses}`, `${x.apW}-${x.apL}`, x.expWins, `${x.luck > 0 ? "+" : ""}${x.luck}`] }; })) + `<p class="fx-whyn">All-play: each week's score against all nine other teams. Expected wins = all-play win rate × games. Luck = real wins minus expected.</p>`;
    }
    if (kind === "odds") {
      const rows = Object.entries(st.odds || {}).sort((a, b) => b[1].title - a[1].title);
      return tbl(["Owner", "Playoffs", "Bye", "Title", "Seed"], rows.map(([x, v]) => ({ me: x === o, c: [esc(x), pct(v.playoffs), pct(v.bye), pct(v.title), v.avgSeed ?? "–"] }))) + `<p class="fx-whyn">The rest of the regular season and the bracket played 4,000 times, each team scoring from its own average and spread (pulled toward the league average early on). Top ${st.playoffTeams || 6} make it.</p>`;
    }
    if (kind === "sos") {
      const ti = T[o]; if (!ti?.sos) return "";
      return tbl(["Week", "Opponent", "Their pts a game"], (data.remaining || []).filter((g) => g.home === o || g.away === o).map((g) => { const op = g.home === o ? g.away : g.home; return { c: [g.week, esc(op), pts(T[op]?.ppg)] }; })) + `<p class="fx-whyn">Average opponent ${pts(ti.sos.avgOpp)} a game: ${ord(ti.sos.rank)} toughest of ${ti.sos.of}.</p>`;
    }
    if (kind === "bench") {
      const reg = data.regret || {};
      return tbl(["Week", "Played", "Best", "Left"], Object.keys(reg).map(Number).sort((a, b) => a - b).filter((w) => reg[w][o]).map((w) => { const x = reg[w][o]; return { c: [w, pts(x.points), pts(x.best), pts(Math.max(0, x.best - x.points))] }; })) + `<p class="fx-whyn">Best = the highest lineup the roster allowed that week. Weeks start from when the app began tracking lineups.</p>`;
    }
    return "";
  };
  let insOpen = null;

  // The best lineup this week: fill each starting slot with the highest
  // average player who can play it, skipping byes and anyone OUT, on IR,
  // doubtful or suspended. Rarest slots first; FLEX takes RB, WR or TE.
  const unavailable = (p) => (Object.keys(nfl).length > 4 && p.nfl && !nfl[String(p.nfl).toUpperCase()]) || ["OUT", "INJURY_RESERVE", "DOUBTFUL", "SUSPENSION", "PUP"].includes(p.injury);
  const optimal = (roster) => {
    const order = ["QB", "K", "D/ST", "TE", "RB", "WR", "FLEX"];
    const slots = roster.filter((p) => p.slot !== "BE" && p.slot !== "IR").map((p) => p.slot);
    const pool = roster.filter((p) => !unavailable(p)).sort((a, b) => b.avg - a.avg), used = new Set(), lineup = [];
    for (const slot of [...slots].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      const pick = pool.find((p) => !used.has(p) && (slot === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === slot));
      if (pick) used.add(pick);
      lineup.push({ slot, p: pick || null });
    }
    return { lineup, used };
  };
  const rosterHtml = (o) => {
    const r = data.rosters?.[o] || [];
    if (!r.length) return `<p class="fx-note">The roster shows after the next ESPN pull.</p>`;
    const order = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"];
    const { lineup, used } = optimal(r);
    const starting = (p) => p.slot !== "BE" && p.slot !== "IR";
    const row = (slot, p) => {
      if (!p) return `<li class="gap"><i>${esc(slot)}</i><span></span><span>No one available</span><b></b><em></em></li>`;
      const tag = used.has(p) && !starting(p) ? `<s class="go">START</s>` : !used.has(p) && starting(p) ? `<s class="sit">SIT</s>` : "";
      return `<li class="${used.has(p) ? "" : "out"}"><i>${esc(slot)}</i>${nflLogo(p.nfl) || "<span></span>"}<span class="fx-pn"><span class="fx-pt">${esc(p.name)}</span>${status(p)}${tag}</span><b>${pts(p.season)}</b><em>${pts(p.avg)}</em></li>`;
    };
    const best = lineup.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    const rest = r.filter((p) => !used.has(p)).sort((a, b) => (unavailable(a) - unavailable(b)) || b.avg - a.avg);
    const swaps = r.filter((p) => used.has(p) && !starting(p)).length;
    return `<p class="fx-note">${swaps ? `Best lineup by average, byes and injuries left out: <b>${swaps} change${swaps === 1 ? "" : "s"}</b> from what is set on ESPN.` : "What is set on ESPN is already the best lineup by average."}</p>
      <div class="fx-rh"><span></span><span>SEASON</span><span>AVG</span></div><ol class="fx-ro">${best.map((x) => row(x.slot, x.p)).join("")}</ol>
      <div class="fx-k2 fx-bench">BENCH</div><ol class="fx-ro bench">${rest.map((p) => row(p.pos, p)).join("")}</ol>`;
  };
  const posBars = (o) => {
    const ti = data.stats?.teams?.[o]; if (!ti?.posRank) return "";
    const n = (data.standings || []).length || 10;
    return `<div class="fx-pos">${Object.entries(ti.posRank).map(([pos, r]) => `<span class="${r <= 3 ? "up" : r > n - 3 ? "dn" : ""}"><small>${esc(pos)}</small><b>${ord(r)}</b></span>`).join("")}</div>`;
  };
  const oddsLine = (o) => {
    const oh = data.oddsHist || {}, wks = Object.keys(oh).map(Number).sort((a, b) => a - b);
    const pace = data.history?.pace?.find((x) => x.owner === o);
    const lines = [...(data.history?.before || []), ...(data.history?.record || [])].filter((x) => x.owner === o).map((x) => x.line || x.text);
    let chart = "";
    if (wks.length >= 2) {
      const v = wks.map((w) => oh[w][o] || 0), W = 300, H = 50, hi = Math.max(0.05, ...v);
      const xy = (i, x) => `${(i / (wks.length - 1)) * (W - 8) + 4},${H - 4 - (x / hi) * (H - 8)}`;
      chart = `<svg class="fx-spark odds" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Title chance by week"><polyline class="mine" points="${v.map((x, i) => xy(i, x)).join(" ")}"/></svg><p class="fx-note">Title chance by week: ${pct(v[0])} in week ${wks[0]}, ${pct(v[v.length - 1])} now.</p>`;
    }
    return `${lines.length || pace ? `<div class="fx-k2">AGAINST HISTORY</div><ul class="fx-ins">${lines.map((t) => `<li>${esc(t)}</li>`).join("")}${pace ? `<li>On pace for <b>${pts(pace.pf)}</b> points (${ord(pace.pfRank)} of ${pace.of} seasons ever) and <b>${pace.wins}</b> wins.</li>` : ""}</ul>` : ""}${chart ? `<div class="fx-k2">TITLE CHANCE</div>${chart}` : ""}`;
  };
  // The owner's league career: titles, finals, all-time record.
  const careerHtml = (o) => {
    const c = data.careers?.[o]; if (!c) return "";
    const tiles = c.years.map((y) => `<span class="${y.result === "champion" ? "gold" : y.finish <= 3 ? "pod" : ""}" title="${y.year}: ${ord(y.finish)} of ${y.of}"><small>'${String(y.year).slice(2)}</small><b>${y.finish}</b></span>`).join("");
    return `<p class="fx-cv">${c.titles ? `<b class="gold">${c.titles}× CHAMP</b>` : `<b>NO TITLES YET</b>`}<i></i><b>${c.finals}</b> final${c.finals === 1 ? "" : "s"}<i></i><b>${c.wins}-${c.losses}</b> all time</p><div class="fx-k2">FINISH BY SEASON</div><div class="fx-fin">${tiles}</div>`;
  };
  // Where the owner stands in the playoff race, in words.
  const pathLine = (o) => {
    const st = [...(data.standings || [])].sort((a, b) => a.rank - b.rank), P = data.playoffTeams || 6;
    const me0 = st.find((x) => x.owner === o); if (!me0 || st.length <= P) return "";
    const rem = (data.remaining || []).filter((g) => g.home === o || g.away === o).length;
    const lastIn = st[P - 1], firstOut = st[P], g = (n) => `${n} game${n === 1 ? "" : "s"}`;
    let t;
    if (me0.rank <= P) {
      const lead = me0.wins - firstOut.wins;
      t = lead > rem ? `<b class="up">Clinched</b> a playoff spot.` : lead > 0 ? `In at <b>${ord(me0.rank)}</b>, ${g(lead)} clear of ${owner(firstOut.owner)} (${ord(P + 1)}) with ${rem} to play.` : `In at <b>${ord(me0.rank)}</b> but level on wins with ${owner(firstOut.owner)} (${ord(P + 1)}); points decide it. ${rem} to play.`;
    } else {
      const back = lastIn.wins - me0.wins;
      t = me0.wins + rem < lastIn.wins ? `<b class="dn">Out of the race:</b> can't catch ${owner(lastIn.owner)} (${ord(P)}) with ${rem} to play.` : back >= rem ? `<b class="dn">Must win out</b> (${rem} left) and needs ${owner(lastIn.owner)} (${ord(P)}) to slip.` : back > 0 ? `${g(back)} behind ${owner(lastIn.owner)} for the last spot (${ord(P)}) with ${rem} to play.` : `Level on wins with ${owner(lastIn.owner)} for the last spot (${ord(P)}); points decide it. ${rem} to play.`;
    }
    return `<div class="fx-k2">PLAYOFF PATH</div><p class="fx-path">${t}</p>`;
  };
  // Season standouts from the roster: the best, the weakest starter, the bench gem.
  const standouts = (o) => {
    const r = data.rosters?.[o] || []; if (!r.length) return "";
    const start = r.filter((p) => !/^(BE|IR)$/.test(p.slot)), bench = r.filter((p) => p.slot === "BE");
    const mvp = [...r].sort((a, b) => (b.season || 0) - (a.season || 0))[0];
    const dead = start.filter((p) => !/^(K|D\/ST)$/.test(p.pos)).sort((a, b) => (a.avg || 0) - (b.avg || 0))[0];
    const gem = bench.sort((a, b) => (b.avg || 0) - (a.avg || 0))[0];
    const one = (k, p, v, cls) => (p ? `<span class="${cls}"><small>${k}</small>${nflLogo(p.nfl)}<b>${esc(p.name)}</b><em>${v}</em></span>` : "");
    return `<div class="fx-k2">STANDOUTS</div><div class="fx-std">${one("MVP", mvp, `${pts(mvp?.season)} pts`, "mvp")}${one("DEAD WEIGHT", dead, `${pts(dead?.avg)} a game`, "dw")}${one("BENCH GEM", gem, `${pts(gem?.avg)} a game`, "gem")}</div>`;
  };
  async function openTeam(o) {
    if (!data) return;
    if (!Object.keys(nfl).length) await load(true);
    document.getElementById("fx-team")?.remove();
    const st = data.stats || {}, s0 = (data.standings || []).find((r) => r.owner === o) || {}, t = { ...(data.teams?.[o] || {}), owner: o };
    const pw = (st.power || []).find((x) => x.owner === o);
    const m = document.createElement("div");
    m.id = "fx-team"; m.className = "fx-team"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", `${o}'s team`);
    m.innerHTML = `<div class="fx-tcard">
      <div class="fx-thead">${badge(t)}<span class="fx-nm"><b>${esc(t.name || o)}</b><small>${esc(o)}</small></span><button type="button" class="fx-x" data-fxx="1" aria-label="Close">✕</button></div>
      <div class="fx-facts top"><span><small>RECORD</small><b>${s0.wins ?? 0}-${s0.losses ?? 0}</b><em>${s0.rank ? ord(s0.rank) : ""}</em></span><span><small>POWER</small><b>${pw ? ord(pw.rank) : "–"}</b><em>${pw?.move ? (pw.move > 0 ? `▲${pw.move}` : `▼${-pw.move}`) : ""}</em></span><span><small>PLAYOFFS</small><b>${st.odds?.[o] ? pct(st.odds[o].playoffs) : "–"}</b><em>${st.streak?.[o] || ""}</em></span></div>
      ${careerHtml(o)}
      <div class="fx-k2">INSIGHTS</div><ul class="fx-ins">${insights(o).map((x) => `<li class="tap${insOpen === x.kind ? " open" : ""}" data-fxins="${x.kind}" role="button" tabindex="0"><span>${x.html}</span>${insOpen === x.kind ? why(x.kind, o) : ""}</li>`).join("")}</ul>
      <div class="fx-k2">BY POSITION · LEAGUE RANK</div>${posBars(o)}
      ${pathLine(o)}
      ${standouts(o)}
      ${oddsLine(o)}
      <div class="fx-k2">WEEK BY WEEK</div>${sparkline(o)}<div class="fx-key"><span><i class="k-me"></i>${esc(o)}</span><span><i class="k-avg"></i>League average</span></div>
      <div class="fx-k2">ROSTER</div>${rosterHtml(o)}
      <button type="button" class="fx-askt" data-fxaskt="1"><img src="assets/images/chief/chief2-96.webp" alt=""><span>Ask the Chief about ${esc(o)}'s season</span><i>▸</i></button>
    </div>`;
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-fxx]")) { insOpen = null; return m.remove(); }
      if (e.target.closest("[data-fxaskt]")) {
        insOpen = null; m.remove();
        const f = document.getElementById("archive-ask"), q = document.getElementById("archive-q");
        if (f && q) { q.value = `How is ${o}'s fantasy season going, and what are their playoff chances?`; q.dispatchEvent(new Event("input", { bubbles: true })); f.scrollIntoView({ behavior: "smooth", block: "center" }); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true })); }
        try { window.noteUse?.("fantasy-ask-team", o); } catch {}
        return;
      }
      const li = e.target.closest("[data-fxins]");
      if (li) { const k = li.dataset.fxins, top = m.querySelector(".fx-tcard").scrollTop; insOpen = insOpen === k ? null : k; try { window.noteUse?.("fantasy-insight", k); } catch {} openTeam(o).then(() => { const c = document.querySelector("#fx-team .fx-tcard"); if (c) c.scrollTop = top; }); }
    });
    document.body.appendChild(m);
    try { window.noteUse?.("fantasy-team", o); } catch {}
  }

  // "Connie 6-11 Jake" -> "Jake leads 11-6"; "Connie 3-0 Jake" -> "Connie 3-0".
  // Every meeting, regular season and playoffs together: "Jake leads 17-8".
  const allTime = (h) => { const w = {}; for (const t of [h?.regularSeason, h?.playoffs]) { const m = String(t || "").match(/^(\S+) (\d+)-(\d+) (\S+)$/); if (m) { w[m[1]] = (w[m[1]] || 0) + +m[2]; w[m[4]] = (w[m[4]] || 0) + +m[3]; } } const [a, b] = Object.keys(w); return a && b ? leadOf(`${a} ${w[a]}-${w[b]} ${b}`) : leadOf(h?.regularSeason); };
  const leadOf = (t) => { const m = String(t || "").match(/^(\S+) (\d+)-(\d+) (\S+)$/); if (!m) return esc(t || ""); const [, a, x, y, b] = m, X = +x, Y = +y; return X === Y ? `tied ${X}-${Y}` : X > Y ? `<b>${esc(a)}</b> leads ${X}-${Y}` : `<b>${esc(b)}</b> leads ${Y}-${X}`; };
  // Each chip opens the games behind it: every regular-season meeting, the
  // playoff ones, a final, or the last few.
  const h2hLine = (h, mid) => {
    const parts = [["reg", leadOf(h.regularSeason)]];
    if (h.playoffs) parts.push(["po", `playoffs: ${leadOf(h.playoffs).replace(" leads", "")}`]);
    for (const c of h.championshipGames || []) parts.push([`final-${c.year}`, `<b>${esc(c.winner)}</b> won the ${esc(c.year)} final`]);
    const lm = String(h.lastMeeting || "").match(/^(\d{4}) week (\d+): (\S+) ([\d.]+)-([\d.]+)/);
    if (lm) parts.push(["last", `last: <b>${esc(lm[3])}</b> won ${pts(lm[4])}–${pts(lm[5])} (${lm[1]}, wk ${lm[2]})`]);
    const g = h.games || [], k = chipOpen?.mid === mid ? chipOpen.k : null;
    const chips = parts.map(([id, x]) => `<span class="fx-chip${g.length ? " tap" : ""}${k === id ? " on" : ""}"${g.length ? ` data-fxchip="${id}" data-mid="${mid}" role="button" tabindex="0"` : ""}>${x}</span>`).join("");
    if (!k) return chips;
    const list = k === "reg" ? g.filter((x) => !x.playoff) : k === "po" ? g.filter((x) => x.playoff) : k === "last" ? g.slice(0, 5) : g.filter((x) => x.playoff && String(x.year) === k.slice(6));
    const table = tbl(["Year", "Wk", "Winner", "Score"], list.map((x) => ({ me: x.winner === me(), c: [x.year, `${x.week}${x.playoff ? " P" : ""}`, esc(x.winner), `${pts(x.w)}–${pts(x.l)}`] })));
    return `${chips}<div class="fx-chipt">${table}${k === "last" && g.length > 5 ? `<p class="fx-whyn">Last five of ${g.length} meetings.</p>` : ""}${list.some((x) => x.playoff) ? `<p class="fx-whyn">P = playoff week.</p>` : ""}</div>`;
  };
  // The players still to play who will decide a matchup: each side's
  // biggest projection not yet in the books.
  const swing = (m) => {
    if (m.final) return "";
    const top = (t) => (t?.starters || []).filter((p) => toPlay(p) === true || live(p)).sort((a, b) => remaining(b) - remaining(a))[0];
    const a = top(m.away), b = top(m.home);
    if (!a && !b) return "";
    const one = (p) => (p ? `${nflLogo(p.nfl)}<b>${esc(p.name)}</b>${p.proj != null ? `<em>proj ${pts(p.proj)}</em>` : ""}` : "<em>all played</em>");
    return `<div class="fx-ctx"><small>BIGGEST LEFT</small><p class="fx-sw"><span>${one(a)}</span><i>vs</i><span>${one(b)}</span></p></div>`;
  };
  // This week's best and worst starters across the league.
  const performers = () => {
    const all = [];
    for (const m of data.live?.matchups || []) for (const t of [m.away, m.home]) for (const p of t?.starters || []) all.push({ ...p, owner: t.owner });
    const played = all.filter((p) => { const g = gameOf(p); return g && (g.state === "post" || g.done || g.state === "in"); });
    if (played.length < 3) return "";
    const top = [...played].sort((a, b) => b.pts - a.pts).slice(0, 5);
    const done = played.filter((p) => { const g = gameOf(p); return g && (g.state === "post" || g.done) && p.proj; });
    const bust = done.sort((a, b) => (a.pts - a.proj) - (b.pts - b.proj))[0];
    return `<div class="fx-sec"><span class="fx-k2">TOP PERFORMERS · WEEK ${esc(data.live.week)}</span><ul class="fx-aw fx-perf">${top.map((p, i) => `<li><small>${i + 1}</small><b>${esc(p.name)}</b><span>${nflLogo(p.nfl)} ${pts(p.pts)} · ${esc(p.owner)}</span></li>`).join("")}${bust && bust.pts < bust.proj - 5 ? `<li class="bust"><small>BUST</small><b>${esc(bust.name)}</b><span>${pts(bust.pts)} of ${pts(bust.proj)} projected · ${esc(bust.owner)}</span></li>` : ""}</ul></div>`;
  };
  // Twelve years of BroChiefs history against this season.
  const historyHtml = () => {
    const h = data.history; if (!h) return "";
    const rows = [...(h.before || []).map((x) => ({ o: x.owner, t: x.line, k: x.kind, why: x.why })), ...(h.record || []).map((x) => ({ o: x.owner, t: x.text, k: "rec", why: x.why }))];
    // One owner's lines together, record-breakers first.
    const firstAt = {}; rows.forEach((r, i) => { if (!(r.o in firstAt)) firstAt[r.o] = r.k === "rec" ? -1 : i; else if (r.k === "rec") firstAt[r.o] = Math.min(firstAt[r.o], -1); });
    rows.sort((a, b) => firstAt[a.o] - firstAt[b.o] || (a.o === b.o ? 0 : a.o.localeCompare(b.o)));
    if (!rows.length) return "";
    return `<div class="fx-sec"><span class="fx-k2">AGAINST HISTORY</span><ul class="fx-hist">${rows.map((r, i) => { const id = `${r.o}|${r.t}`; const on = histOpen === id; return `<li class="${esc(r.k)}${r.why ? " tap" : ""}${on ? " open" : ""}"${r.why ? ` data-fxh="${esc(id)}" role="button" tabindex="0" aria-expanded="${on}"` : ""}><span>${owner(r.o)} ${esc(r.t)}</span>${on && r.why ? tbl(r.why.head.map(esc), r.why.rows.map((x) => ({ me: x.me, c: x.c.map((v) => esc(v)) }))) : ""}</li>`; }).join("")}</ul></div>`;
  };
  // Both leagues: fantasy place next to pick'em place this season.
  let pickem = null;
  const loadPickem = async () => { if (pickem || typeof fetchSeasonLedger !== "function") return; try { const weeks = await fetchSeasonLedger(); if (!weeks) return; const t = {}; for (const w of weeks) for (const r of w.rows || []) t[r.name] = (t[r.name] || 0) + (r.score || 0); const order = Object.entries(t).sort((a, b) => b[1] - a[1]); pickem = Object.fromEntries(order.map(([n, v], i) => [n, { pts: v, rank: i + 1 }])); paint(); } catch {} };

  const tables = () => {
    const st = data.stats || {}, line = st.playoffTeams || data.playoffTeams || 6;
    const row = (o, cells, i) => `<div class="fx-st${o === me() ? " me" : ""}${card === o ? " open" : ""}${i === line - 1 && (tab === "standings" || tab === "odds") ? " cut" : ""}" data-fxo="${esc(o)}" role="button" tabindex="0"><span class="fx-rk">${cells.rank}</span>${badge({ ...(data.teams?.[o] || {}), owner: o })}<span class="fx-nm">${owner(o)}<small>${esc(cells.sub || "")}</small></span>${cells.cols.map((c) => `<span class="fx-c${c.cls ? ` ${c.cls}` : ""}">${c.v}</span>`).join("")}</div>${card === o ? ownerCard(o) : ""}`;
    const sets = {
      standings: { head: ["W-L", "PF", "STRK"], rows: (data.standings || []).map((r, i) => row(r.owner, { rank: r.rank, sub: data.teams?.[r.owner]?.name, cols: [{ v: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` }, { v: pts(r.pointsFor), cls: "dim" }, { v: esc(st.streak?.[r.owner] || "–"), cls: /^W/.test(st.streak?.[r.owner]) ? "up" : /^L/.test(st.streak?.[r.owner]) ? "dn" : "" }] }, i)) },
      // Power: one bar per team (its power score against the best), the move beside it.
      power: { head: ["POWER"], rows: (st.power || []).map((r, i, all) => { const top = Math.max(...all.map((x) => x.power || 0)) || 1, ap = st.allPlay?.[r.owner]; return row(r.owner, { rank: r.rank, sub: `${pts(st.teams?.[r.owner]?.ppg)} a game${ap ? ` · beats ${pct(ap.apPct)} of teams` : ""}`, cols: [{ cls: "viz", v: `<span class="fx-bar"><i style="width:${Math.max(4, (r.power / top) * 100).toFixed(0)}%"></i></span><em class="${r.move > 0 ? "up" : r.move < 0 ? "dn" : "dim"}">${r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : "–"}</em>` }] }, i); }) },
      // Odds: the playoff chance as a bar (IN once it is a lock), the title chance in gold.
      odds: { head: ["PLAYOFFS", "TITLE"], rows: Object.entries(st.odds || {}).sort((a, b) => b[1].playoffs - a[1].playoffs || b[1].title - a[1].title).map(([o, x], i) => { const sd = x.avgSeed ? (Math.floor(x.avgSeed) === Math.ceil(x.avgSeed) ? `usually the ${ord(x.avgSeed)} seed` : `usually seed ${Math.floor(x.avgSeed)}–${Math.ceil(x.avgSeed)}`) : ""; return row(o, { rank: i + 1, sub: [x.bye >= 0.01 ? `${pct(x.bye)} bye` : "", x.playoffs >= 0.05 ? sd : ""].filter(Boolean).join(" · "), cols: [{ cls: "viz", v: x.playoffs >= 0.995 ? `<span class="fx-in">IN</span>` : x.playoffs < 0.005 ? `<span class="fx-out">OUT</span>` : `<span class="fx-bar"><i style="width:${(x.playoffs * 100).toFixed(0)}%"></i></span><em>${pct(x.playoffs)}</em>` }, { v: pct(x.title), cls: x.title >= 0.1 ? "gold" : x.title < 0.01 ? "dim" : "" }] }, i); }) },
      both: { head: ["FANT", "PICK'EM", "PTS"], rows: (data.standings || []).map((r) => ({ r, p: pickem?.[r.owner] })).sort((a, b) => (a.r.rank + (a.p?.rank || 10)) - (b.r.rank + (b.p?.rank || 10))).map(({ r, p }, i) => row(r.owner, { rank: i + 1, sub: `${r.wins}-${r.losses} fantasy`, cols: [{ v: ord(r.rank) }, { v: p ? ord(p.rank) : "–", cls: p && p.rank <= 3 ? "up" : "" }, { v: p ? String(p.pts) : "–", cls: "dim" }] }, i)) },
      // Luck: a bar from a centre line, green right (lucky), pink left (unlucky).
      luck: { head: ["UNLUCKY · LUCKY"], rows: (() => { const all = Object.values(st.allPlay || {}).sort((a, b) => b.luck - a.luck), mx = Math.max(1, ...all.map((x) => Math.abs(x.luck))); return all.map((x, i) => { const s0 = (data.standings || []).find((r) => r.owner === x.owner) || {}, g = (s0.wins || 0) + (s0.losses || 0) + (s0.ties || 0), ew = Math.round(x.expWins); return row(x.owner, { rank: i + 1, sub: `${s0.wins ?? 0}-${s0.losses ?? 0}, scores like a ${ew}-${Math.max(0, g - ew)} team`, cols: [{ cls: "viz", v: `<span class="fx-luck"><i class="${x.luck >= 0 ? "up" : "dn"}" style="width:${((Math.abs(x.luck) / mx) * 50).toFixed(0)}%"></i></span><em class="${x.luck > 0.05 ? "up" : x.luck < -0.05 ? "dn" : "dim"}">${x.luck > 0 ? "+" : x.luck < 0 ? "−" : ""}${Math.abs(x.luck).toFixed(1)}</em>` }] }, i); }); })() },
    };
    const set = sets[tab];
    const why = { standings: `Top ${line} make the playoffs.`, power: "Who's playing best right now: points, record against the whole league each week, and the last three weeks.", odds: `Chances from 4,000 simulated finishes of the season. Top ${line} make the playoffs.`, luck: "Real record against the record your points deserve. Plus means more wins than the scoring earned.", both: "Fantasy place next to pick'em place this season, best combined first." }[tab];
    return `<div class="fx-sechd"><span>LEAGUE TABLE</span></div><div class="fx-tabs" role="tablist">${[["standings", "STANDINGS"], ["power", "POWER"], ["odds", "ODDS"], ["luck", "LUCK"], ["both", "BOTH"]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-fxtab="${k}">${l}</button>`).join("")}</div>
      <p class="fx-why-top">${esc(why)}</p>
      <div class="fx-sth t-${tab}"><span></span>${set.head.map((h) => `<span>${h}</span>`).join("")}</div>
      <div class="fx-sts t-${tab}">${set.rows.join("")}</div><p class="fx-note">Tap an owner for their team.</p>`;
  };

  const awards = () => {
    const a = data.stats?.awards, rg = data.stats?.regret || [];
    if (!a && !rg.length) return "";
    const li = (k, o, v) => (o ? `<li><small>${k}</small>${owner(o)}<span>${v}</span></li>` : "");
    return `<div class="fx-sec"><span class="fx-k2">WEEK ${esc(a?.week ?? "")} AWARDS</span><ul class="fx-aw">
      ${li("TOP SCORE", a?.top?.owner, pts(a?.top?.points))}${li("LOW SCORE", a?.low?.owner, pts(a?.low?.points))}
      ${a?.blowout ? li("BLOWOUT", a.blowout.winner, `by ${pts(a.blowout.margin)} over ${esc(a.blowout.loser)}`) : ""}
      ${a?.closest ? li("NAIL-BITER", a.closest.winner, `by ${pts(a.closest.margin)} over ${esc(a.closest.loser)}`) : ""}
      ${a?.luckiestWin ? li("LUCKIEST WIN", a.luckiestWin.winner, `won with ${pts(a.luckiestWin.w)}`) : ""}
      ${a?.unluckiestLoss ? li("TOUGH LOSS", a.unluckiestLoss.owner, `lost with ${pts(a.unluckiestLoss.points)}`) : ""}
    </ul></div>${rg.length ? `<div class="fx-sec"><span class="fx-k2">BENCH REGRET · SEASON</span><ul class="fx-aw">${rg.slice(0, 5).map((x, i) => `<li><small>${i + 1}</small>${owner(x.owner)}<span>${pts(x.season)} pts left${x.worst ? ` · worst wk ${x.worst.week} (${pts(x.worst.left)})` : ""}</span></li>`).join("")}</ul></div>` : ""}`;
  };

  let fullById = {}, histOpen = null, chipOpen = null;
  // Your team's updates: injuries from ESPN fantasy and each player's
  // latest news, most important first (injured starters, then injured
  // bench, then fresh news). Fetched for the signed-in owner only.
  let teamNews = null, teamNewsAt = 0, newsAll = false;
  const loadTeamNews = async () => {
    const o = me(); if (!o || !data?.rosters?.[o] || Date.now() - teamNewsAt < 10 * 60000) return;
    teamNewsAt = Date.now();
    try { const r = await fetch(`${WORKER_URL}/fantasy-news?owner=${encodeURIComponent(o)}`); if (r.ok) { teamNews = await r.json(); paint(); } } catch {}
  };
  const SEV = { OUT: 5, INJURY_RESERVE: 4, SUSPENSION: 4, DOUBTFUL: 3, QUESTIONABLE: 2, PROBABLE: 1, DAY_TO_DAY: 1 };
  const statusTxt = (x) => ({ OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SUSP", DOUBTFUL: "D", QUESTIONABLE: "Q", PROBABLE: "P", DAY_TO_DAY: "DTD" }[x] || String(x || "").slice(0, 4));
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  function teamNewsHtml() {
    if (!teamNews?.players) { loadTeamNews(); return ""; }
    const fresh = (n) => n && n.at && Date.now() - n.at < 3 * 86400000;
    // ESPN's live injury (status and its own short note) wins over the
    // fantasy roster's tag, which can be hours old.
    const code = (x) => { const t = String(x || "").toLowerCase(); return /reserve|^ir$/.test(t) ? "INJURY_RESERVE" : /^out/.test(t) ? "OUT" : /doubt/.test(t) ? "DOUBTFUL" : /question/.test(t) ? "QUESTIONABLE" : /suspen/.test(t) ? "SUSPENSION" : /day.to.day/.test(t) ? "DAY_TO_DAY" : /probable/.test(t) ? "PROBABLE" : null; };
    const items = teamNews.players.map((p) => { const st = code(p.espnInjury?.status) || p.injury; const starter = !/^(BE|IR)$/.test(p.slot), sev = SEV[st] || 0, n = (p.news || []).find(fresh) || (p.espnInjury?.note ? { headline: p.espnInjury.note, at: p.espnInjury.at, link: null } : null); return { p: { ...p, injury: st }, n, starter, score: (starter ? 10 : 0) + sev * 3 + (n ? 2 : 0) }; })
      .filter((x) => x.p.injury || x.n).sort((a, b) => b.score - a.score || (b.n?.at || 0) - (a.n?.at || 0));
    const shown = newsAll ? items : items.slice(0, 5);
    const row = ({ p, n, starter }) => `<li${n?.link ? ` data-fxnews="${esc(n.link)}" role="link" tabindex="0"` : ""}>${nflLogo(p.nfl)}<span class="fx-tn-m"><span class="fx-tn-h"><b>${esc(p.name)}</b><small>${esc(p.pos || "")}${starter ? "" : " · bench"}</small>${p.injury ? `<u class="sev${SEV[p.injury] >= 3 ? " hi" : ""}">${statusTxt(p.injury)}</u>` : ""}</span>${n ? `<span class="fx-tn-n">${esc(n.headline)}${n.at ? ` <i>${ago(n.at)}</i>` : ""}</span>` : ""}</span></li>`;
    return `<div class="fx-sechd"><span>YOUR TEAM · UPDATES</span></div>${items.length ? `<ul class="fx-tn">${shown.map(row).join("")}</ul>${items.length > 5 ? `<button type="button" class="fx-tn-more" data-fxnewsall="1">${newsAll ? "Show fewer" : `Show all ${items.length}`}</button>` : ""}` : `<p class="fx-note">No injuries or news on your roster in the last three days.</p>`}`;
  }
  const fxSeen = {}; // matchup id -> last painted leader and scores
  const openMu = (id) => {
    document.getElementById("fx-mupop")?.remove();
    const m = document.createElement("div");
    m.id = "fx-mupop"; m.className = "fx-team"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Matchup");
    m.innerHTML = `<div class="fx-tcard fx-mucard" data-id="${id}"><div class="fx-thead"><span class="fx-k2">WEEK ${esc(data.live?.week || "")} MATCHUP</span><button type="button" class="fx-x" data-fxx="1" aria-label="Close">✕</button></div><div class="fx-popbody">${fullById[id] || ""}</div></div>`;
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-fxx]")) { chipOpen = null; return m.remove(); }
      const ch = e.target.closest("[data-fxchip]");
      if (ch) { const k = ch.dataset.fxchip, mid = Number(ch.dataset.mid); chipOpen = chipOpen?.mid === mid && chipOpen.k === k ? null : { mid, k }; try { window.noteUse?.("fantasy-h2h", k); } catch {} return paint(); }
      const side = e.target.closest("[data-fxteam]");
      if (side) { m.remove(); insOpen = null; openTeam(side.dataset.fxteam); }
    });
    document.body.appendChild(m);
  };
  function paint() {
    if (!data) { root.innerHTML = `<div class="fx-head"><span class="fx-k">FANTASY</span></div><p class="fx-note">Loading the league…</p>`; return; }
    const lw = data.live, week = lw?.week || data.weeksPlayed + 1;
    const anyLive = Object.values(nfl).some((g) => g.state === "in");
    // The signed-in owner's matchup first, marked as theirs.
    const mine = (m) => m.home?.owner === me() || m.away?.owner === me();
    const cards = [...(lw?.matchups || [])].sort((a, b) => mine(b) - mine(a)).map((m) => {
      const isOpen = true, oa = outlook(m.away), oh = outlook(m.home);
      const wp = m.final ? null : phi((oa.exp - oh.exp) / Math.sqrt(oa.sd ** 2 + oh.sd ** 2));
      const h = data.h2h?.[`${m.away?.owner}|${m.home?.owner}`];
      // Closed: a small scorebug card, two owners and their scores, the
      // leader bright, a thin win-chance bar. Open: the full matchup.
      {
        // Yours on the left; each row shows the projected final beside the
        // live score; the bar splits in the two owners' colours.
        const flip = m.home?.owner === me(), A = flip ? m.home : m.away, B = flip ? m.away : m.home, pa = flip ? oh : oa, pb = flip ? oa : oh, w = wp == null ? null : flip ? 1 - wp : wp;
        // The card's state sets how loud it is: nothing scored yet stays
        // quiet, a tie stays neutral, a close one gets a little more
        // contrast, a clear leader a little emphasis on their side.
        const sa = Number(A?.points) || 0, sb = Number(B?.points) || 0, tot = sa + sb;
        const state = tot <= 0 ? "zero" : sa === sb ? "tie" : Math.abs(sa - sb) <= Math.max(8, tot * 0.08) ? "close" : "clear";
        const lead = sa > sb ? "a" : sb > sa ? "b" : "";
        // A brief flash when the lead changes hands, and a pop on a score
        // that moved, compared with the last paint.
        const prev = fxSeen[m.id], took = prev && prev.lead && lead && prev.lead !== lead, bump = (k, v) => prev && prev[k] !== v ? " bump" : "";
        fxSeen[m.id] = { lead, a: sa, b: sb };
        const row = (t, o, side, v) => `<span class="fx-cr s-${side}${lead === side ? " lead" : ""}${t?.owner === me() ? " me" : ""}">${badge(t)}<b>${esc(t?.owner || "")}${mine(m) && (t?.name || data.teams?.[t?.owner]?.name) ? `<small class="fx-tmn">${esc(t?.name || data.teams?.[t?.owner]?.name)}</small>` : ""}</b><em class="fx-sc${bump(side, v)}">${pts(t?.points)}</em></span>`;
        // Battle meter: each side's share of the points scored, a crisp
        // divider where they meet; empty and neutral before anyone scores.
        const share = tot > 0 ? Math.min(96, Math.max(4, (sa / tot) * 100)) : 50;
        const meter = `<span class="fx-meter ${state}" title="${tot > 0 ? `${esc(A?.owner)} ${pts(sa)} · ${esc(B?.owner)} ${pts(sb)}` : "No points yet"}${w != null ? ` · win chance ${esc(A?.owner)} ${pct(w)}` : ""}">${tot > 0 ? `<i class="a" style="width:${share.toFixed(1)}%"></i><i class="b" style="width:${(100 - share).toFixed(1)}%"></i><s style="left:${share.toFixed(1)}%"></s>` : ""}</span>`;
        var card = `<div class="fx-card-mu ${state}${mine(m) ? " mine" : ""}${m.final ? " final" : ""}${took ? " took" : ""}" data-fxmu="${m.id}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(A?.owner)} ${pts(sa)} against ${esc(B?.owner)} ${pts(sb)}">
          ${mine(m) ? `<span class="fx-cmk">YOUR MATCHUP</span>` : m.final ? `<span class="fx-cmk dim">FINAL</span>` : ""}${row(A, B, "a", sa)}${mine(m) ? `<span class="fx-vs" aria-hidden="true">VS</span>` : ""}${row(B, A, "b", sb)}
          ${mine(m) && h?.regularSeason ? `<span class="fx-mh"><i>ALL TIME</i><span>${allTime(h)}</span></span>` : ""}${meter}
        </div>`;
      }
      if (!isOpen) return { card, full: "", mine: mine(m) };
      const fl = m.home?.owner === me(), L = fl ? m.home : m.away, Rt = fl ? m.away : m.home, oL = fl ? oh : oa, oR = fl ? oa : oh, wL = wp == null ? null : fl ? 1 - wp : wp;
      if (m.final) { oL.final = oR.final = true; }
      return { id: m.id, card, mine: mine(m), full: `<div class="fx-mu open${m.final ? " final" : ""}${mine(m) ? " mine" : ""}" data-fxmu="${m.id}">
        <div class="fx-row">${sideHtml(L, Rt, "a", oL)}<span class="fx-vs">${m.final ? "FINAL" : "VS"}</span>${sideHtml(Rt, L, "h", oR)}</div>
        ${h ? `<div class="fx-ctx"><small>ALL TIME</small><span class="fx-chips">${h2hLine(h, m.id)}</span></div>` : ""}${swing({ ...m, away: L, home: Rt })}${wL != null ? `<div class="fx-ctx"><small>WIN CHANCE</small><div class="fx-wp" title="From live points and projections for players still to play"><b>${esc(L?.owner)} ${pct(wL)}</b><span><i style="width:${(wL * 100).toFixed(1)}%"></i></span><b>${pct(1 - wL)} ${esc(Rt?.owner)}</b></div></div>` : ""}
        <div class="fx-lus">${lineup(L, Rt, oL)}${lineup(Rt, L, oR)}</div><p class="fx-note fx-sdkey"><span><s class="fx-sd done"></s>done</span><span><s class="fx-sd live"></s>playing</span><span><s class="fx-ball"></s>has the ball</span><span><s class="fx-sd pre"></s>to play (projection)</span></p>
      </div>` };
    });
    // Tap a card: the full breakdown opens in a pop-up.
    const games = cards.map((g) => g.card).join("");
    fullById = Object.fromEntries(cards.map((g) => [g.id, g.full]));
    const pop = document.querySelector("#fx-mupop .fx-tcard");
    if (pop && fullById[pop.dataset.id]) pop.querySelector(".fx-popbody").innerHTML = fullById[pop.dataset.id];
    root.innerHTML = `
      <div class="fx-head"><span class="fx-k">FANTASY · ${esc(data.year)}</span><span class="fx-wk">${anyLive ? `<i class="fx-dot"></i>LIVE · ` : ""}WEEK ${esc(week)}</span></div>
      ${data.take?.text ? `<button type="button" class="fx-take-btn" data-fxtake="1"><img src="assets/images/chief/chief2-96.webp" alt=""><span class="fx-k2">WEEK ${esc(data.take.week)} RECAP</span><em>from the Chief</em><i>▸</i></button>` : ""}
      ${games ? `<div class="fx-mus">${games}</div>` : `<p class="fx-note">This week's matchups show once ESPN posts them.</p>`}
      ${teamNewsHtml()}
      ${tables()}
      ${historyHtml()}
      ${performers()}
      ${awards()}
      <p class="fx-note">From ESPN · updated ${esc(new Date(data.exportedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</p>`;
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-fxtake]")) {
      // The Chief's recap in a pop-up, so it never pushes the matchups down.
      document.getElementById("fx-team")?.remove();
      const m = document.createElement("div");
      m.id = "fx-team"; m.className = "fx-team"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "The Chief's recap");
      m.innerHTML = `<div class="fx-tcard"><div class="fx-thead"><img class="fx-badge" src="assets/images/chief/chief2-96.webp" alt=""><span class="fx-nm"><b>Week ${esc(data.take.week)} recap</b><small>from the Chief</small></span><button type="button" class="fx-x" data-fxx="1" aria-label="Close">✕</button></div><p class="fx-take-p">${esc(data.take.text)}</p></div>`;
      m.addEventListener("click", (ev) => { if (ev.target === m || ev.target.closest("[data-fxx]")) m.remove(); });
      document.body.appendChild(m);
      try { window.noteUse?.("fantasy-recap"); } catch {}
      return;
    }
    const t = e.target.closest("[data-fxtab]");
    if (t) { tab = t.dataset.fxtab; card = null; if (tab === "both") loadPickem(); try { window.noteUse?.("fantasy-tab", tab); } catch {} return paint(); }
    const o = e.target.closest("[data-fxo]");
    if (o) { insOpen = null; return openTeam(o.dataset.fxo); }
    const side = e.target.closest("[data-fxteam]");
    if (side) { e.stopPropagation(); return openTeam(side.dataset.fxteam); }
    const nw = e.target.closest("[data-fxnews]");
    if (nw) { try { window.noteUse?.("fantasy-news"); } catch {} window.open(nw.dataset.fxnews, "_blank", "noopener"); return; }
    if (e.target.closest("[data-fxnewsall]")) { newsAll = !newsAll; return paint(); }
    const hx = e.target.closest("[data-fxh]");
    if (hx && !e.target.closest(".fx-why")) { histOpen = histOpen === hx.dataset.fxh ? null : hx.dataset.fxh; try { window.noteUse?.("fantasy-history", hx.dataset.fxh.split("|")[0]); } catch {} return paint(); }
    const mu = e.target.closest("[data-fxmu]");
    if (mu) { const id = Number(mu.dataset.fxmu); openMu(id); try { const mm = data.live?.matchups?.find((x) => x.id === id); window.noteUse?.("fantasy-matchup", mm ? `${mm.away?.owner} vs ${mm.home?.owner}` : ""); } catch {} paint(); }
  });
  root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-fxmu],[data-fxo],[data-fxh]")) { e.preventDefault(); e.target.click(); } });

  // Swipe a fantasy pop-up down to close it: from the top of its scroll,
  // the card follows the finger and closes past 90px (as its ✕ would).
  let sw = null;
  document.addEventListener("touchstart", (e) => {
    // From the header always; from anywhere else only at the top of the scroll
    // (iOS can leave a fraction of a pixel, so allow a little).
    const card = e.target.closest?.(".fx-team .fx-tcard"), head = e.target.closest?.(".fx-thead");
    if (!card || (!head && card.scrollTop > 4)) { sw = null; return; }
    sw = { card, y: e.touches[0].clientY, dy: 0, top: card.scrollTop, head: !!head };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!sw) return; sw.dy = e.touches[0].clientY - sw.y;
    if (sw.dy > 0 && (sw.head || sw.card.scrollTop <= 4)) { sw.card.style.transition = "none"; sw.card.style.transform = `translateY(${sw.dy}px)`; sw.card.parentElement.style.opacity = String(Math.max(0.35, 1 - sw.dy / 400)); }
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!sw) return; const { card, dy } = sw; sw = null;
    if (dy > 90) { const x = card.querySelector("[data-fxx]"); if (x) x.click(); else card.parentElement.remove(); try { window.noteUse?.("fantasy-swipe-close"); } catch {} return; }
    card.style.transition = "transform .2s ease-out"; card.style.transform = ""; card.parentElement.style.opacity = "";
  });

  const visible = () => !document.getElementById("history-screen")?.classList.contains("hidden") && !document.hidden;
  window.paintFantasy = async (force) => { paint(); await load(force); paint(); };
  if (visible()) window.paintFantasy();
  setInterval(() => { if (visible()) load().then(paint); }, 60000);
  document.addEventListener("visibilitychange", () => { if (visible()) load().then(paint); });
})();
