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
  const nflLogo = (ab) => (ab ? `<img class="fx-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${esc(ab.toLowerCase())}.png" alt="" loading="lazy" onerror="this.style.display='none'">` : "");
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
        if (r.ok) { const j = await r.json(); nfl = {}; for (const ev of j.events || []) { const c = ev.competitions?.[0]; const st = c?.status?.type?.state || "pre"; for (const t of c?.competitors || []) nfl[String(t.team?.abbreviation || "").toUpperCase()] = { state: st, done: !!c?.status?.type?.completed }; } nflAt = Date.now(); }
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
    return `<span class="fx-side ${k}${lead ? " lead" : ""}${t?.owner === me() ? " me" : ""}"><span class="fx-tlink" data-fxteam="${esc(t?.owner || "")}" role="button" aria-label="Open ${esc(t?.owner || "")}'s team">${badge(t)}</span><span class="fx-nm"><b>${esc(t?.owner || t?.name || "")}</b><small>${t?.record ? `${esc(t.record)} · ` : ""}${esc(t?.name || "")}</small>${tp}</span><em>${pts(t?.points)}</em></span>`;
  };
  const lineup = (t) => `<ol class="fx-lu">${(t?.starters || []).map((p) => { const tp = toPlay(p), lv = live(p); return `<li class="${tp ? "tp" : ""}${lv ? " lv" : ""}"><i>${esc(p.slot)}</i><span>${esc(p.name)}${status(p)}</span>${nflLogo(p.nfl)}<b class="${p.pts > 0 ? "on" : ""}">${tp && p.proj != null ? `<small>${pts(p.proj)}</small>` : pts(p.pts)}</b></li>`; }).join("")}</ol>`;

  const sparkline = (o) => {
    const wk = (data.weekly || []), mine = wk.filter((x) => x.owner === o).sort((a, b) => a.week - b.week);
    if (mine.length < 2) return "";
    const weeks = mine.map((x) => x.week), avg = weeks.map((w) => { const l = wk.filter((x) => x.week === w); return l.reduce((n, x) => n + x.points, 0) / (l.length || 1); });
    const all = [...mine.map((x) => x.points), ...avg], lo = Math.min(...all) - 5, hi = Math.max(...all) + 5, W = 300, H = 70;
    const xy = (i, v) => `${(i / (weeks.length - 1)) * (W - 8) + 4},${H - 4 - ((v - lo) / (hi - lo)) * (H - 8)}`;
    return `<svg class="fx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o)}'s weekly scores against the league average"><polyline class="avg" points="${avg.map((v, i) => xy(i, v)).join(" ")}"/><polyline class="mine" points="${mine.map((x, i) => xy(i, x.points)).join(" ")}"/>${mine.map((x, i) => `<circle cx="${xy(i, x.points).split(",")[0]}" cy="${xy(i, x.points).split(",")[1]}" r="2.5"/>`).join("")}</svg>`;
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
    if (ti?.ppg) { const d = Math.round((ti.ppg - ti.leagueAvg) * 10) / 10; out.push(`Scoring <b>${pts(ti.ppg)}</b> a game, ${d >= 0 ? `<b class="up">${pts(d)} above</b>` : `<b class="dn">${pts(-d)} below</b>`} the league average.`); }
    if (ti?.posRank) {
      const r = Object.entries(ti.posRank).filter(([, n]) => n), best = r.sort((a, b) => a[1] - b[1])[0], worst = [...r].sort((a, b) => b[1] - a[1])[0];
      if (best && worst && best[0] !== worst[0]) out.push(`Strongest at <b>${esc(best[0])}</b> (${ord(best[1])} in the league), weakest at <b>${esc(worst[0])}</b> (${ord(worst[1])}).`);
    }
    if (ti?.topShare >= 0.3 && ti.topTwo?.length === 2) out.push(`Leans on <b>${esc(ti.topTwo[0])}</b> and <b>${esc(ti.topTwo[1])}</b>: ${pct(ti.topShare)} of the roster's points.`);
    if (ap) out.push(Math.abs(ap.luck) >= 1 ? `${ap.luck > 0 ? "Lucky" : "Unlucky"}: <b>${s0.wins}-${s0.losses}</b> but <b>${ap.apW}-${ap.apL}</b> against the whole league (luck <b class="${ap.luck > 0 ? "up" : "dn"}">${ap.luck > 0 ? "+" : ""}${ap.luck}</b>).` : `Record matches the scoring: <b>${ap.apW}-${ap.apL}</b> against the whole league.`);
    if (od) out.push(`<b>${pct(od.playoffs)}</b> to make the playoffs, <b>${pct(od.bye)}</b> for a bye, <b class="gold">${pct(od.title)}</b> to win the title.`);
    if (ti?.sos?.rank && ti.sos.of > 1) { const r = ti.sos.rank; if (r <= 3 || r > ti.sos.of - 3) { const n = r <= 3 ? r : ti.sos.of - r + 1; out.push(`${r <= 3 ? "Tough" : "Soft"} run-in: the ${n === 1 ? "" : `${ord(n)} `}${r <= 3 ? "hardest" : "easiest"} remaining schedule (${ti.sos.opponents.map(esc).join(", ")}).`); } }
    if (rg?.season) out.push(`Left <b>${pts(rg.season)}</b> points on the bench${rg.worst ? `, most in week ${rg.worst.week} (${pts(rg.worst.left)})` : ""}.`);
    return out;
  };
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
      if (!p) return `<li class="gap"><i>${esc(slot)}</i><span>No one available</span><span></span><b></b><em></em></li>`;
      const tag = used.has(p) && !starting(p) ? `<s class="go">START</s>` : !used.has(p) && starting(p) ? `<s class="sit">SIT</s>` : "";
      return `<li class="${used.has(p) ? "" : "out"}"><i>${esc(slot)}</i><span>${esc(p.name)}${status(p)}${tag}</span>${nflLogo(p.nfl)}<b>${pts(p.season)}</b><em>${pts(p.avg)}</em></li>`;
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
      <div class="fx-k2">INSIGHTS</div><ul class="fx-ins">${insights(o).map((x) => `<li>${x}</li>`).join("")}</ul>
      <div class="fx-k2">BY POSITION · LEAGUE RANK</div>${posBars(o)}
      ${oddsLine(o)}
      <div class="fx-k2">WEEK BY WEEK</div>${sparkline(o)}<div class="fx-key"><span><i class="k-me"></i>${esc(o)}</span><span><i class="k-avg"></i>League average</span></div>
      <div class="fx-k2">ROSTER</div>${rosterHtml(o)}
    </div>`;
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-fxx]")) m.remove(); });
    document.body.appendChild(m);
    try { window.noteUse?.("fantasy-team"); } catch {}
  }

  // The players still to play who will decide a matchup: each side's
  // biggest projection not yet in the books.
  const swing = (m) => {
    if (m.final) return "";
    const top = (t) => (t?.starters || []).filter((p) => toPlay(p) === true || live(p)).sort((a, b) => remaining(b) - remaining(a))[0];
    const a = top(m.away), b = top(m.home);
    if (!a && !b) return "";
    const one = (p) => (p ? `${nflLogo(p.nfl)}<b>${esc(p.name)}</b>${p.proj != null ? `<em>${pts(p.proj)}</em>` : ""}` : "<em>none left</em>");
    return `<p class="fx-sw"><small>SWING</small><span>${one(a)}</span><i>vs</i><span>${one(b)}</span></p>`;
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
    const rows = [...(h.before || []).map((x) => ({ o: x.owner, t: x.line, k: x.kind })), ...(h.record || []).map((x) => ({ o: x.owner, t: x.text, k: "rec" }))];
    // One owner's lines together, record-breakers first.
    const firstAt = {}; rows.forEach((r, i) => { if (!(r.o in firstAt)) firstAt[r.o] = r.k === "rec" ? -1 : i; else if (r.k === "rec") firstAt[r.o] = Math.min(firstAt[r.o], -1); });
    rows.sort((a, b) => firstAt[a.o] - firstAt[b.o] || (a.o === b.o ? 0 : a.o.localeCompare(b.o)));
    if (!rows.length) return "";
    return `<div class="fx-sec"><span class="fx-k2">THIS HAS HAPPENED BEFORE</span><ul class="fx-hist">${rows.map((r) => `<li class="${esc(r.k)}">${owner(r.o)} ${esc(r.t)}</li>`).join("")}</ul></div>`;
  };
  // Both leagues: fantasy place next to pick'em place this season.
  let pickem = null;
  const loadPickem = async () => { if (pickem || typeof fetchSeasonLedger !== "function") return; try { const weeks = await fetchSeasonLedger(); if (!weeks) return; const t = {}; for (const w of weeks) for (const r of w.rows || []) t[r.name] = (t[r.name] || 0) + (r.score || 0); const order = Object.entries(t).sort((a, b) => b[1] - a[1]); pickem = Object.fromEntries(order.map(([n, v], i) => [n, { pts: v, rank: i + 1 }])); paint(); } catch {} };

  const tables = () => {
    const st = data.stats || {}, line = st.playoffTeams || data.playoffTeams || 6;
    const row = (o, cells, i) => `<div class="fx-st${o === me() ? " me" : ""}${card === o ? " open" : ""}${i === line - 1 && (tab === "standings" || tab === "odds") ? " cut" : ""}" data-fxo="${esc(o)}" role="button" tabindex="0"><span class="fx-rk">${cells.rank}</span>${badge({ ...(data.teams?.[o] || {}), owner: o })}<span class="fx-nm">${owner(o)}<small>${esc(cells.sub || "")}</small></span>${cells.cols.map((c) => `<span class="fx-c${c.cls ? ` ${c.cls}` : ""}">${c.v}</span>`).join("")}</div>${card === o ? ownerCard(o) : ""}`;
    const sets = {
      standings: { head: ["W-L", "PF", "STRK"], rows: (data.standings || []).map((r, i) => row(r.owner, { rank: r.rank, sub: data.teams?.[r.owner]?.name, cols: [{ v: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` }, { v: pts(r.pointsFor), cls: "dim" }, { v: esc(st.streak?.[r.owner] || "–"), cls: /^W/.test(st.streak?.[r.owner]) ? "up" : /^L/.test(st.streak?.[r.owner]) ? "dn" : "" }] }, i)) },
      power: { head: ["MOVE", "PPG", "ALL-PL"], rows: (st.power || []).map((r, i) => { const s0 = (data.standings || []).find((x) => x.owner === r.owner) || {}; return row(r.owner, { rank: r.rank, sub: `${s0.wins ?? 0}-${s0.losses ?? 0} · ${data.teams?.[r.owner]?.name || ""}`, cols: [{ v: r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : "–", cls: r.move > 0 ? "up" : r.move < 0 ? "dn" : "dim" }, { v: pts(st.teams?.[r.owner]?.ppg), cls: "dim" }, { v: pct(st.allPlay?.[r.owner]?.apPct) }] }, i); }) },
      odds: { head: ["PLAYOFF", "BYE", "TITLE"], rows: Object.entries(st.odds || {}).sort((a, b) => b[1].playoffs - a[1].playoffs || b[1].title - a[1].title).map(([o, x], i) => row(o, { rank: i + 1, sub: x.avgSeed ? `avg seed ${x.avgSeed}` : "", cols: [{ v: pct(x.playoffs), cls: x.playoffs >= 0.5 ? "up" : "" }, { v: pct(x.bye), cls: "dim" }, { v: pct(x.title), cls: x.title >= 0.2 ? "gold" : "" }] }, i)) },
      both: { head: ["FANT", "PICK'EM", "PTS"], rows: (data.standings || []).map((r) => ({ r, p: pickem?.[r.owner] })).sort((a, b) => (a.r.rank + (a.p?.rank || 10)) - (b.r.rank + (b.p?.rank || 10))).map(({ r, p }, i) => row(r.owner, { rank: i + 1, sub: `${r.wins}-${r.losses} fantasy`, cols: [{ v: ord(r.rank) }, { v: p ? ord(p.rank) : "–", cls: p && p.rank <= 3 ? "up" : "" }, { v: p ? String(p.pts) : "–", cls: "dim" }] }, i)) },
      luck: { head: ["W-L", "ALL-PL", "LUCK"], rows: Object.values(st.allPlay || {}).sort((a, b) => b.luck - a.luck).map((x, i) => { const s = (data.standings || []).find((r) => r.owner === x.owner) || {}; return row(x.owner, { rank: i + 1, sub: x.luck > 0.9 ? "lucky" : x.luck < -0.9 ? "unlucky" : "", cols: [{ v: `${s.wins ?? 0}-${s.losses ?? 0}` }, { v: `${x.apW}-${x.apL}`, cls: "dim" }, { v: `${x.luck > 0 ? "+" : ""}${x.luck}`, cls: x.luck > 0 ? "up" : x.luck < 0 ? "dn" : "" }] }, i); }) },
    };
    const set = sets[tab];
    const why = { standings: `Top ${line} make the playoffs.`, power: "All-play record, points per game and the last three weeks.", odds: `The rest of the season simulated 4,000 times. Top ${line} make it.`, luck: "All-play: your score against every team each week. Luck is real wins minus all-play wins.", both: "Fantasy place next to pick'em place this season, best combined first." }[tab];
    return `<div class="fx-tabs" role="tablist">${[["standings", "STANDINGS"], ["power", "POWER"], ["odds", "ODDS"], ["luck", "LUCK"], ["both", "BOTH"]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-fxtab="${k}">${l}</button>`).join("")}</div>
      <div class="fx-sth"><span></span>${set.head.map((h) => `<span>${h}</span>`).join("")}</div>
      <div class="fx-sts">${set.rows.join("")}</div><p class="fx-note">${esc(why)} Tap an owner for their team.</p>`;
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

  function paint() {
    if (!data) { root.innerHTML = `<div class="fx-head"><span class="fx-k">FANTASY</span></div><p class="fx-note">Loading the league…</p>`; return; }
    const lw = data.live, week = lw?.week || data.weeksPlayed + 1;
    const anyLive = Object.values(nfl).some((g) => g.state === "in");
    // The signed-in owner's matchup first, marked as theirs.
    const mine = (m) => m.home?.owner === me() || m.away?.owner === me();
    const games = [...(lw?.matchups || [])].sort((a, b) => mine(b) - mine(a)).map((m) => {
      const isOpen = open.has(m.id), oa = outlook(m.away), oh = outlook(m.home);
      const wp = m.final ? null : phi((oa.exp - oh.exp) / Math.sqrt(oa.sd ** 2 + oh.sd ** 2));
      const h = data.h2h?.[`${m.away?.owner}|${m.home?.owner}`];
      return `${mine(m) ? `<span class="fx-k2 fx-mine-k">YOUR MATCHUP</span>` : ""}<div class="fx-mu${isOpen ? " open" : ""}${m.final ? " final" : ""}${mine(m) ? " mine" : ""}" data-fxmu="${m.id}" role="button" tabindex="0" aria-expanded="${isOpen}">
        <div class="fx-row">${sideHtml(m.away, m.home, "a", oa)}<span class="fx-vs">${m.final ? "FINAL" : "VS"}</span>${sideHtml(m.home, m.away, "h", oh)}</div>
        ${h ? `<p class="fx-h2h">${esc(h.regularSeason || "")}${h.playoffs ? ` · playoffs ${esc(String(h.playoffs).replace(/^(\S+) (\d+-\d+) \S+$/, "$2"))}` : ""}${h.championshipGames?.length ? ` · ${h.championshipGames.map((c) => `${esc(c.winner)} won the ${esc(c.year)} final`).join(", ")}` : ""}${h.lastMeeting ? ` · last: ${esc(String(h.lastMeeting).replace(/\s*\(regular season\)/, ""))}` : ""}</p>` : ""}
        ${swing(m)}
        ${wp != null ? `<div class="fx-wp" title="Win chance from live points and projections"><b>${pct(wp)}</b><span><i style="width:${(wp * 100).toFixed(1)}%"></i></span><b>${pct(1 - wp)}</b></div>` : ""}
        ${isOpen ? `<div class="fx-lus">${lineup(m.away)}${lineup(m.home)}</div><p class="fx-note">Grey number = projection for a player still to play.</p>` : ""}
      </div>`;
    }).join("");
    root.innerHTML = `
      <div class="fx-head"><span class="fx-k">FANTASY · ${esc(data.year)}</span><span class="fx-wk">${anyLive ? `<i class="fx-dot"></i>LIVE · ` : ""}WEEK ${esc(week)}</span></div>
      ${data.take?.text ? `<button type="button" class="fx-take-btn" data-fxtake="1"><img src="assets/images/chief/chief2-96.webp" alt=""><span class="fx-k2">WEEK ${esc(data.take.week)} RECAP</span><em>from the Chief</em><i>▸</i></button>` : ""}
      ${games ? `<div class="fx-mus">${games}</div>` : `<p class="fx-note">This week's matchups show once ESPN posts them.</p>`}
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
    if (o) return openTeam(o.dataset.fxo);
    const side = e.target.closest("[data-fxteam]");
    if (side) { e.stopPropagation(); return openTeam(side.dataset.fxteam); }
    const mu = e.target.closest("[data-fxmu]");
    if (mu) { const id = Number(mu.dataset.fxmu); open.has(id) ? open.delete(id) : open.add(id); try { window.noteUse?.("fantasy-matchup"); } catch {} paint(); }
  });
  root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-fxmu],[data-fxo]")) { e.preventDefault(); e.target.click(); } });

  const visible = () => !document.getElementById("history-screen")?.classList.contains("hidden") && !document.hidden;
  window.paintFantasy = async (force) => { paint(); await load(force); paint(); };
  if (visible()) window.paintFantasy();
  setInterval(() => { if (visible()) load().then(paint); }, 60000);
  document.addEventListener("visibilitychange", () => { if (visible()) load().then(paint); });
})();
