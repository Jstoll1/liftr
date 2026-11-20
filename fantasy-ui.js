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
  const ini = (o) => `<span class="fx-badge ini" style="--oc:${esc(colour(o))}">${esc(String(o || "?")[0])}</span>`;
  const badge = (t) => (t?.logo ? `<img class="fx-badge" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fx-badge ini',textContent:'${esc(String(t.owner || "?")[0])}'}))">` : ini(t?.owner));
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
    return `<span class="fx-side ${k}${lead ? " lead" : ""}${t?.owner === me() ? " me" : ""}">${badge(t)}<span class="fx-nm"><b>${esc(t?.owner || t?.name || "")}</b><small>${t?.record ? `${esc(t.record)} · ` : ""}${esc(t?.name || "")}</small>${tp}</span><em>${pts(t?.points)}</em></span>`;
  };
  const lineup = (t) => `<ol class="fx-lu">${(t?.starters || []).map((p) => { const tp = toPlay(p), lv = live(p); return `<li class="${tp ? "tp" : ""}${lv ? " lv" : ""}"><i>${esc(p.slot)}</i><span>${esc(p.name)}${p.injury ? `<u>${esc(p.injury === "QUESTIONABLE" ? "Q" : p.injury === "OUT" ? "O" : p.injury === "DOUBTFUL" ? "D" : p.injury[0])}</u>` : ""}</span>${nflLogo(p.nfl)}<b class="${p.pts > 0 ? "on" : ""}">${tp && p.proj != null ? `<small>${pts(p.proj)}</small>` : pts(p.pts)}</b></li>`; }).join("")}</ol>`;

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

  const tables = () => {
    const st = data.stats || {}, line = st.playoffTeams || data.playoffTeams || 6;
    const row = (o, cells, i) => `<div class="fx-st${o === me() ? " me" : ""}${card === o ? " open" : ""}${i === line - 1 && (tab === "standings" || tab === "odds") ? " cut" : ""}" data-fxo="${esc(o)}" role="button" tabindex="0"><span class="fx-rk">${cells.rank}</span>${badge({ ...(data.teams?.[o] || {}), owner: o })}<span class="fx-nm">${owner(o)}<small>${esc(cells.sub || "")}</small></span>${cells.cols.map((c) => `<span class="fx-c${c.cls ? ` ${c.cls}` : ""}">${c.v}</span>`).join("")}</div>${card === o ? ownerCard(o) : ""}`;
    const sets = {
      standings: { head: ["W-L", "PF", "STRK"], rows: (data.standings || []).map((r, i) => row(r.owner, { rank: r.rank, sub: data.teams?.[r.owner]?.name, cols: [{ v: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` }, { v: pts(r.pointsFor), cls: "dim" }, { v: esc(st.streak?.[r.owner] || "–"), cls: /^W/.test(st.streak?.[r.owner]) ? "up" : /^L/.test(st.streak?.[r.owner]) ? "dn" : "" }] }, i)) },
      power: { head: ["MOVE", "", ""], rows: (st.power || []).map((r, i) => row(r.owner, { rank: r.rank, sub: data.teams?.[r.owner]?.name, cols: [{ v: r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : "–", cls: r.move > 0 ? "up" : r.move < 0 ? "dn" : "dim" }, { v: "" }, { v: "" }] }, i)) },
      odds: { head: ["PLAYOFF", "BYE", "TITLE"], rows: Object.entries(st.odds || {}).sort((a, b) => b[1].playoffs - a[1].playoffs || b[1].title - a[1].title).map(([o, x], i) => row(o, { rank: i + 1, sub: x.avgSeed ? `avg seed ${x.avgSeed}` : "", cols: [{ v: pct(x.playoffs), cls: x.playoffs >= 0.5 ? "up" : "" }, { v: pct(x.bye), cls: "dim" }, { v: pct(x.title), cls: x.title >= 0.2 ? "gold" : "" }] }, i)) },
      luck: { head: ["W-L", "ALL-PL", "LUCK"], rows: Object.values(st.allPlay || {}).sort((a, b) => b.luck - a.luck).map((x, i) => { const s = (data.standings || []).find((r) => r.owner === x.owner) || {}; return row(x.owner, { rank: i + 1, sub: x.luck > 0.9 ? "lucky" : x.luck < -0.9 ? "unlucky" : "", cols: [{ v: `${s.wins ?? 0}-${s.losses ?? 0}` }, { v: `${x.apW}-${x.apL}`, cls: "dim" }, { v: `${x.luck > 0 ? "+" : ""}${x.luck}`, cls: x.luck > 0 ? "up" : x.luck < 0 ? "dn" : "" }] }, i); }) },
    };
    const set = sets[tab];
    const why = { standings: `Top ${line} make the playoffs.`, power: "All-play record, points per game and the last three weeks.", odds: `The rest of the season simulated 4,000 times. Top ${line} make it.`, luck: "All-play: your score against every team each week. Luck is real wins minus all-play wins." }[tab];
    return `<div class="fx-tabs" role="tablist">${[["standings", "STANDINGS"], ["power", "POWER"], ["odds", "ODDS"], ["luck", "LUCK"]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-fxtab="${k}">${l}</button>`).join("")}</div>
      <div class="fx-sth"><span></span>${set.head.map((h) => `<span>${h}</span>`).join("")}</div>
      <div class="fx-sts">${set.rows.join("")}</div><p class="fx-note">${esc(why)} Tap an owner for their season.</p>`;
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
    const games = (lw?.matchups || []).map((m) => {
      const isOpen = open.has(m.id), oa = outlook(m.away), oh = outlook(m.home);
      const wp = m.final ? null : phi((oa.exp - oh.exp) / Math.sqrt(oa.sd ** 2 + oh.sd ** 2));
      const h = data.h2h?.[`${m.away?.owner}|${m.home?.owner}`];
      return `<div class="fx-mu${isOpen ? " open" : ""}${m.final ? " final" : ""}" data-fxmu="${m.id}" role="button" tabindex="0" aria-expanded="${isOpen}">
        <div class="fx-row">${sideHtml(m.away, m.home, "a", oa)}<span class="fx-vs">${m.final ? "FINAL" : "VS"}</span>${sideHtml(m.home, m.away, "h", oh)}</div>
        ${wp != null ? `<div class="fx-wp" title="Win chance from live points and projections"><b>${pct(wp)}</b><span><i style="width:${(wp * 100).toFixed(1)}%"></i></span><b>${pct(1 - wp)}</b></div>` : ""}
        ${isOpen ? `${h ? `<p class="fx-h2h">All time: ${esc(h.regularSeason || "")}${h.playoffs ? ` · playoffs ${esc(h.playoffs)}` : ""}</p>` : ""}<div class="fx-lus">${lineup(m.away)}${lineup(m.home)}</div><p class="fx-note">Grey number = projection for a player still to play.</p>` : ""}
      </div>`;
    }).join("");
    root.innerHTML = `
      <div class="fx-head"><span class="fx-k">FANTASY · ${esc(data.year)}</span><span class="fx-wk">${anyLive ? `<i class="fx-dot"></i>LIVE · ` : ""}WEEK ${esc(week)}</span></div>
      ${data.take?.text ? `<div class="fx-take"><span class="fx-k2">THE CHIEF · WEEK ${esc(data.take.week)}</span><p>${esc(data.take.text)}</p></div>` : ""}
      ${games ? `<div class="fx-mus">${games}</div>` : `<p class="fx-note">This week's matchups show once ESPN posts them.</p>`}
      ${tables()}
      ${awards()}
      <p class="fx-note">From ESPN · updated ${esc(new Date(data.exportedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</p>`;
  }

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-fxtab]");
    if (t) { tab = t.dataset.fxtab; card = null; try { window.noteUse?.("fantasy-tab", tab); } catch {} return paint(); }
    const o = e.target.closest("[data-fxo]");
    if (o) { card = card === o.dataset.fxo ? null : o.dataset.fxo; try { window.noteUse?.("fantasy-owner"); } catch {} return paint(); }
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
