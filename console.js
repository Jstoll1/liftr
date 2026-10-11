// The app owner's console. Everything about running the app in one place,
// a tab at a time: what picks changed, who signed in, who has claimed a
// name, what this device thinks is going on, whether owner login is live,
// and the slate editor.
//
// Reached only by the wordmark gesture with the app owner's key
// (ARCHIVE_LOG_KEY). The slate key opens the editor and never this — see
// keyRole() in the Worker. Fetched on first unlock, so none of it ships
// with the app the league loads.
(() => {
  const WORKER_URL = "https://liftr-ai.jhs797.workers.dev";
  const root = document.getElementById("console-overlay");
  if (!root) return;

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const body = el("console-body");
  const OWNERS = [
    "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
    "Nissan", "Skills", "Jake", "Curt", "Andrew",
  ];

  // The console is opened with a verified key; app.js hands it over rather
  // than asking again.
  const key = () => (typeof window.appConsoleKey === "function" ? window.appConsoleKey() : "");
  const say = (msg, kind = "") => { const s = el("console-status"); if (s) { s.textContent = msg || ""; s.className = "admin-status " + kind; } };
  const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function get(path) {
    const res = await fetch(`${WORKER_URL}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key())}&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  // Opens on who has been in the app, most recent first.
  let tab = "logins";

  // --- Pick changes ---------------------------------------------------
  async function renderPicks() {
    const { changes } = await get("/picks-log?format=json");
    if (!changes.length) { body.innerHTML = `<div class="admin-empty">No pick changes in the last 30 days.</div>`; return; }
    const isLate = (r) => (r.changes || []).some((x) => x.afterKickoff);
    const late = changes.filter(isLate);
    const unauth = changes.filter((c) => c.unauth);

    // One flat list of every edit anyone made is unreadable at ten managers
    // a week. Group by manager, so a question about one person is one card
    // rather than a scroll, and anything flagged sorts to the top.
    const byManager = new Map();
    for (const r of changes) {
      const g = byManager.get(r.manager) || { manager: r.manager, rows: [], late: 0, unauth: 0, edits: 0, last: 0 };
      g.rows.push(r);
      g.edits += (r.changes || []).length;
      if (isLate(r)) g.late += 1;
      if (r.unauth) g.unauth += 1;
      g.last = Math.max(g.last, r.ts || 0);
      byManager.set(r.manager, g);
    }
    const groups = [...byManager.values()].sort((a, b) =>
      (b.late - a.late) || (b.unauth - a.unauth) || (b.last - a.last));

    body.innerHTML = `<div class="con-summary">
        <span>${changes.length} change${changes.length === 1 ? "" : "s"} · ${groups.length} manager${groups.length === 1 ? "" : "s"}</span>
        <span class="${late.length ? "bad" : ""}">${late.length} after kickoff</span>
        <span class="${unauth.length ? "warn" : ""}">${unauth.length} not signed in</span>
      </div>` + groups.map((g) => `<details class="con-group${g.late ? " bad" : ""}" ${g.late ? "open" : ""}>
        <summary class="con-group-head">
          <span class="cg-name">${esc(g.manager)}</span>
          <span class="cg-counts">${g.edits} edit${g.edits === 1 ? "" : "s"}${g.late ? ` · <b class="bad">${g.late} after kickoff</b>` : ""}${g.unauth ? ` · <b class="warn">${g.unauth} no login</b>` : ""}</span>
          <span class="cg-last">${when(g.last)}</span>
        </summary>
        ${g.rows.map((r) => `<div class="con-row${isLate(r) ? " bad" : ""}">
          <div class="con-row-head"><span>${when(r.ts)}${r.week ? ` · wk ${r.week}` : ""}</span>
            ${r.admin ? `<span class="con-tag adm">repair</span>` : ""}${r.unauth ? `<span class="con-tag warn">no login</span>` : ""}</div>
          ${(r.changes || []).map((c) => `<div class="con-line">${c.game ? `G${c.game}` : "Tiebreaker"}: ${esc(c.from ?? "none")} → ${esc(c.to ?? "none")}${c.afterKickoff ? ` <span class="con-tag bad">after kickoff</span>` : ""}</div>`).join("")}
        </div>`).join("")}
      </details>`).join("");
  }

  // --- Season ---------------------------------------------------------
  // Week by week, from the sealed summaries. This is the record the board
  // cannot rebuild once ESPN moves on, so it is also where a week that
  // never got sealed shows up as unsealed.
  async function renderSeason() {
    const data = await get("/weeks");
    const summaries = data.summaries || {};
    const trophies = data.trophies || {};
    const list = (data.weeks?.list || []).slice().sort((a, b) => b - a);
    const board = Object.entries(trophies).sort((a, b) => b[1] - a[1]);
    const sealed = list.filter((n) => summaries[n]?.complete);

    body.innerHTML = `<div class="con-summary">
        <span>${sealed.length} of ${list.length} week${list.length === 1 ? "" : "s"} sealed</span>
        <span>${board.length} owner${board.length === 1 ? "" : "s"} with a week</span>
      </div>
      ${board.length ? `<div class="con-row"><div class="con-row-head"><b>Weeks won</b></div>
        <div class="con-line">${board.map(([who, n]) => `${esc(who)} ${"🏆".repeat(Math.min(n, 4))}${n > 4 ? `×${n}` : ""}`).join(" · ")}</div></div>` : ""}
      ${list.map((n) => {
        const s = summaries[n];
        if (!s) return `<div class="con-row warn"><div class="con-row-head"><b>Week ${n}</b><span>never sealed</span></div>
          <div class="con-line dim">No summary stored. If the week was played, Re-seal below will build one from the slate, picks and finals the Worker has.</div></div>`;
        const top = (s.rows || []).filter((r) => r.picked > 0);
        return `<div class="con-row${s.complete ? "" : " warn"}">
          <div class="con-row-head"><b>${esc(s.label)}</b>
            <span>${s.complete ? `winner ${esc((s.winners || []).join(" & ")) || "nobody scored"} · ${s.highScore} pts` : `in progress · ${s.played}/${s.games} final`}</span></div>
          ${s.tiebreaker ? `<div class="con-line dim">TB ${esc(s.tiebreaker.matchup)}${s.tiebreaker.actual !== null ? ` · total ${s.tiebreaker.actual}` : ""}</div>` : ""}
          ${top.length ? `<div class="con-line dim">${top.map((r) => `${r.won ? "🏆 " : ""}${esc(r.name)} ${r.score}${r.tbDiff !== null ? ` (off ${r.tbDiff})` : ""}`).join(" · ")}</div>` : `<div class="con-line dim">Nobody picked this week.</div>`}
        </div>`;
      }).join("")}
      <div class="con-actions"><button id="con-reseal" class="admin-btn" type="button">Re-seal every week</button></div>
      <div class="con-actions"><button id="con-reseal-force" class="admin-btn ghost" type="button">Reopen and re-seal, including frozen weeks</button></div>
      <p class="admin-intro">Re-sealing recomputes each week from the slate, picks and finals in KV, then freezes a week whose last game is final so the Ledger tab keeps the picks as they were graded. A frozen week is skipped by the plain re-seal; reopening one rebuilds it against whatever the slate says now, so only use it after a correction you meant to make.</p>`;

    const reseal = async (force) => {
      if (force && !confirm("Reopen frozen weeks? Their picks get graded again against the slate as it stands now. Only do this after a correction you meant to make.")) return;
      say("Re-sealing…");
      try {
        const res = await fetch(`${WORKER_URL}/weeks?key=${encodeURIComponent(key())}${force ? "&force=1" : ""}`, { method: "POST" });
        const out = await res.json();
        if (!res.ok) { say(out.error || "Could not re-seal.", "bad"); return; }
        const froze = (out.sealed || []).filter((w) => w.frozen).length;
        say(`Sealed ${out.sealed.length} week${out.sealed.length === 1 ? "" : "s"}${froze ? `, ${froze} frozen` : ""}.`, "ok");
        window.appRefreshWeeks?.();
        renderTab();
      } catch {
        say("Could not reach the Worker.", "bad");
      }
    };
    el("con-reseal").addEventListener("click", () => reseal(false));
    el("con-reseal-force").addEventListener("click", () => reseal(true));
  }

  // --- Logins ---------------------------------------------------------
  // The login dashboard, top to bottom: what stands out in plain words;
  // four tiles; the last 48 hours as one strip per owner with the game
  // windows shaded (who watches live); the last 7 days as a grid; a
  // day-by-hour punchcard of every recorded open; then a profile per owner
  // (streak, usual time, home-screen app or browser, picks in). Local time
  // on this phone. One cyan ramp in four steps (1, 2-3, 4-7, 8+), checked
  // for even steps and contrast on the console's dark surface. Tap any mark
  // for the exact numbers; the list below stays as the table view.
  function loginViz(visits, rows, ago, picks) {
    const DAY = 86400000, HR = 3600000, now = Date.now();
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const today0 = t0.getTime();
    const days = Array.from({ length: 7 }, (_, i) => today0 - (6 - i) * DAY);
    const since7 = days[0];
    const step = (n) => n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4;
    const dayLab = (t) => new Date(t).toLocaleDateString([], { weekday: "short" }).slice(0, 2).toUpperCase();
    const dayLong = (t) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const hourLab = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
    const timeLab = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const tip = (str) => `data-tip="${esc(str)}"`;
    const names = (list) => list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    const N = OWNERS.length;
    // This week's game windows: kickoff to about three and a half hours on.
    const games = (typeof GAMES !== "undefined" ? GAMES : []).map((g) => Date.parse(g.kickoff)).filter(Number.isFinite).sort((a, b) => a - b);
    const windows = [];
    for (const k of games) { const w = [k, k + 3.5 * HR]; const last = windows[windows.length - 1]; if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]); else windows.push(w); }
    const inGame = (t) => windows.some(([a, b]) => t >= a && t < b);
    const lockAt = typeof weekLockTime === "function" ? (weekLockTime() ?? games[0] ?? null) : games[0] ?? null;
    const all = Object.values(visits).flat().map((v) => v.at).filter(Number.isFinite);
    const firstSeen = all.length ? Math.min(...all) : now;

    const owners = rows.map((r) => {
      const list = (visits[r.n] || []).filter((v) => Number.isFinite(v.at)).sort((a, b) => b.at - a.at);
      const per = days.map((d) => list.filter((v) => v.at >= d && v.at < d + DAY));
      const wk = list.filter((v) => v.at >= since7);
      let streak = 0;
      for (let i = 6; i >= 0; i--) { if (per[i].length) streak++; else if (i === 6) continue; else break; }
      const blocks = new Array(8).fill(0); for (const v of list) blocks[Math.floor(new Date(v.at).getHours() / 3)]++;
      const bi = blocks.indexOf(Math.max(...blocks));
      const usual = list.length ? ["late night", "early morning", "morning", "midday", "afternoon", "evening", "night", "late evening"][bi] + ` (${hourLab(bi * 3)}-${hourLab((bi * 3 + 3) % 24)})` : "-";
      const home = list.filter((v) => v.app === "home").length;
      const appKind = !list.length ? "-" : home === list.length ? "home-screen app" : home === 0 ? "browser only" : "app and browser";
      const pk = picks?.[r.n]?.picks || null;
      const pIn = pk ? (typeof GAMES !== "undefined" ? GAMES.filter((g) => pk[g.id]).length : Object.keys(pk).length) : null;
      const pLast = pk ? Math.max(0, ...Object.values(pk).map((x) => Number(x?.savedAt) || 0)) : 0;
      return { ...r, list, per, wk, streak, usual, appKind, device: list[0]?.device || "", gameOpens: wk.filter((v) => inGame(v.at)).length, pIn, pLast };
    });
    const total7 = owners.reduce((a, o) => a + o.wk.length, 0);
    const game7 = owners.reduce((a, o) => a + o.gameOpens, 0);
    const winMs7 = windows.reduce((a, [x, y]) => a + Math.max(0, Math.min(y, now) - Math.max(x, since7)), 0);
    const inToday = owners.filter((o) => o.per[6].length).length;
    const active7 = owners.filter((o) => o.wk.length).length;

    // Punchcard: every recorded open by weekday and hour.
    const punch = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const t of all) { const d = new Date(t); punch[(d.getDay() + 6) % 7][d.getHours()]++; }
    const pmax = Math.max(1, ...punch.flat());
    const pstep = (n) => n <= 0 ? 0 : Math.min(4, 1 + Math.floor((n / pmax) * 3.999));
    let best = { n: -1 };
    punch.forEach((row, d) => row.forEach((n, h) => { const w = n + (row[(h + 1) % 24] || 0) + (row[(h + 2) % 24] || 0); if (w > best.n) best = { n: w, d, h }; }));
    const wdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // What stands out, in words.
    const said = [];
    const top = [...owners].sort((a, b) => b.wk.length - a.wk.length)[0];
    if (top?.wk.length) said.push(`<b>${esc(top.n)}</b> is in the most: ${top.wk.length} opens in 7 days${top.streak >= 7 ? ", every day" : top.streak >= 2 ? `, ${top.streak} days running` : ""}.`);
    const quiet = owners.filter((o) => !o.last || now - o.last > 3 * DAY);
    if (quiet.length) said.push(`${names(quiet.map((o) => `<b>${esc(o.n)}</b>`))} ${quiet.length === 1 ? "hasn't" : "haven't"} opened the app in 3+ days.`);
    if (lockAt && lockAt > now && typeof GAMES !== "undefined") {
      const short = owners.filter((o) => o.pIn != null && o.pIn < GAMES.length);
      if (short.length) said.push(`Picks not done before lock: ${short.map((o) => `<b>${esc(o.n)}</b> ${o.pIn}/${GAMES.length}${o.last && now - o.last > DAY ? ` (last in ${esc(ago(o.last))})` : ""}`).join(", ")}.`);
    }
    if (total7 && winMs7 > 0) { const share = game7 / total7, timeShare = winMs7 / (7 * DAY); said.push(`${Math.round(share * 100)}% of this week's opens came during games, which take up ${Math.round(timeShare * 100)}% of the week${share > timeShare * 2 ? ": game time is when the app gets used" : ""}.`); }
    const browser = owners.filter((o) => o.appKind === "browser only");
    if (browser.length) said.push(`${names(browser.map((o) => `<b>${esc(o.n)}</b>`))} only ${browser.length === 1 ? "uses" : "use"} the browser, not the home-screen app.`);
    if (best.n > 0) said.push(`Busiest stretch on record: ${wdays[best.d]} ${hourLab(best.h)}-${hourLab((best.h + 3) % 24)}.`);

    // Last 48 hours, one strip per owner, games shaded, now at the right.
    const tlA = now - 48 * HR, span = now - tlA;
    const xp = (t) => ((t - tlA) / span * 100).toFixed(2);
    const bands = windows.filter(([a, b]) => b > tlA && a < now).map(([a, b]) => `<i class="lvz-band" style="left:${xp(Math.max(a, tlA))}%;width:${(Math.min(b, now) - Math.max(a, tlA)) / span * 100}%"></i>`).join("");
    const mids = [];
    for (let t = Math.ceil(tlA / DAY) * DAY; t < now; t += DAY) { const d = new Date(t); d.setHours(0, 0, 0, 0); if (d.getTime() > tlA) mids.push(d.getTime()); }
    const midLines = [...new Set(mids)].map((t) => `<i class="lvz-mid" style="left:${xp(t)}%"></i>`).join("");
    const strips = owners.map((o) => `<span class="lvz-nm">${esc(o.n)}</span><div class="lvz-strip">${bands}${midLines}${o.list.filter((v) => v.at >= tlA).map((v) => `<i class="lvz-dot${inGame(v.at) ? " live" : ""}" style="left:${xp(v.at)}%" ${tip(`${o.n} · ${dayLong(v.at)} ${timeLab(v.at)}${inGame(v.at) ? " · during a game" : ""} · ${v.app === "home" ? "home-screen app" : "browser"}`)}></i>`).join("")}</div>`).join("");
    const tlAxis = [0, 12, 24, 36, 48].map((h) => { const t = tlA + h * HR; return `<span>${h === 48 ? "NOW" : `${dayLab(t)} ${hourLab(new Date(t).getHours())}`}</span>`; }).join("");

    // Last 7 days grid.
    const head = `<span></span>${days.map((d, i) => `<span class="lvz-dh${i === 6 ? " today" : ""}">${i === 6 ? "TODAY" : dayLab(d)}</span>`).join("")}<span class="lvz-dh">LAST</span>`;
    const gridRows = owners.map((o) => `<span class="lvz-nm">${esc(o.n)}</span>${o.per.map((list, i) => {
      const n = list.length;
      return `<i class="lvz-c s${step(n)}" ${tip(`${o.n} · ${dayLong(days[i])} · ${n ? `${n} open${n === 1 ? "" : "s"}, last ${timeLab(Math.max(...list.map((v) => v.at)))}` : "not in"}`)}></i>`;
    }).join("")}<span class="lvz-ago${o.last && now - o.last < DAY ? " fresh" : ""}">${o.last ? esc(ago(o.last).replace(" ago", "")) : "never"}</span>`).join("");

    // Punchcard.
    const punchRows = punch.map((row, d) => `<span class="lvz-pd">${wdays[d].slice(0, 2).toUpperCase()}</span>${row.map((n, h) => `<i class="lvz-p s${pstep(n)}" ${tip(`${wdays[d]} ${hourLab(h)}-${hourLab((h + 1) % 24)} · ${n} open${n === 1 ? "" : "s"} on record`)}></i>`).join("")}`).join("");

    // Profiles.
    const prof = [...owners].sort((a, b) => b.wk.length - a.wk.length || (b.last || 0) - (a.last || 0)).map((o) => {
      const spark = o.per.map((l) => `<i style="height:${l.length ? Math.max(15, Math.min(100, l.length / 8 * 100)) : 6}%" class="${l.length ? "" : "z"}"></i>`).join("");
      const pk = o.pIn == null || typeof GAMES === "undefined" ? "" : `<em class="${o.pIn === GAMES.length ? "ok" : "short"}">${o.pIn}/${GAMES.length} picks${o.pLast ? ` · last change ${esc(dayLong(o.pLast))}` : ""}</em>`;
      return `<div class="lvz-pr" ${tip(`${o.n} · ${o.wk.length} opens in 7 days · ${o.gameOpens} during games · last ${o.last ? `${dayLong(o.last)} ${timeLab(o.last)}` : "never"}${o.device ? ` · ${o.device}` : ""}`)}>
        <div class="lvz-pr1"><b>${esc(o.n)}</b><span class="lvz-spark">${spark}</span><strong>${o.wk.length}</strong></div>
        <div class="lvz-pr2"><span>${o.streak ? `${o.streak}-day streak` : "no streak"}</span><span>${esc(o.usual)}</span><span>${esc(o.appKind)}</span>${pk}</div>
      </div>`;
    }).join("");

    return `<div class="lvz">
      ${said.length ? `<div class="lvz-h">WHAT STANDS OUT</div><ul class="lvz-said">${said.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
      <div class="lvz-tiles four">
        <div><b>${inToday}<small>/${N}</small></b><span>in today</span></div>
        <div><b>${active7}<small>/${N}</small></b><span>in this week</span></div>
        <div><b>${total7}</b><span>opens, 7 days</span></div>
        <div><b>${total7 && winMs7 ? `${Math.round(game7 / total7 * 100)}%` : "-"}</b><span>during games</span></div>
      </div>
      <div class="lvz-h">LAST 48 HOURS · <i class="lvz-key-band"></i> GAMES ON</div>
      <div class="lvz-tl">${strips}<span></span><div class="lvz-tlax">${tlAxis}</div></div>
      <div class="lvz-h">WHO'S BEEN IN · LAST 7 DAYS</div>
      <div class="lvz-grid">${head}${gridRows}</div>
      <div class="lvz-key"><span>OPENS A DAY</span><i class="lvz-c s0"></i>0<i class="lvz-c s1"></i>1<i class="lvz-c s2"></i>2-3<i class="lvz-c s3"></i>4-7<i class="lvz-c s4"></i>8+</div>
      <div class="lvz-h">WHEN THE LEAGUE OPENS IT · DAY BY HOUR, SINCE ${esc(dayLong(firstSeen).toUpperCase())}</div>
      <div class="lvz-punch">${punchRows}<span></span><div class="lvz-pax"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div></div>
      <div class="lvz-h">EVERY OWNER · MOST ACTIVE FIRST · OPENS LAST 7 DAYS</div>
      <div class="lvz-prof">${prof}</div>
      <div class="lvz-tip" aria-live="polite">Tap any square, dot or row for the details.</div>
    </div>`;
  }
  // One readout under the charts follows the finger or the pointer.
  function wireLoginViz(root) {
    const out = root.querySelector(".lvz-tip");
    if (!out) return;
    let on = null;
    const show = (t) => { if (!t || t === on) return; on?.classList.remove("on"); on = t; t.classList.add("on"); out.textContent = t.dataset.tip; };
    root.querySelectorAll(".lvz [data-tip]").forEach((t) => { t.addEventListener("pointerenter", () => show(t)); t.addEventListener("click", () => show(t)); });
  }
  async function renderLogins() {
    // App opens first: who has been in, and when.
    let opens = "";
    try {
      const [{ visits }, pk] = await Promise.all([get("/visit"), get(`/picks?week=${currentWeek}`).catch(() => null)]);
      const all = Object.entries(visits || {}).flatMap(([m, list]) => list.map((v) => ({ m, ...v })));
      const fmt = (t) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
      const day = Date.now() - 86400000;
      const rows = OWNERS.map((n) => { const l = visits?.[n] || []; return { n, last: l[0]?.at || 0, today: l.filter((v) => v.at > day).length }; }).sort((a, b) => b.last - a.last);
      opens = loginViz(visits || {}, rows, ago, pk?.picks || null) + `<div class="con-summary"><span>LAST IN THE APP · MOST RECENT FIRST</span><span>${rows.filter((r) => r.today).length} of ${OWNERS.length} in the last 24h</span></div>`
        + rows.map((r) => `<div class="con-row${r.last ? "" : " warn"}"><div class="con-row-head"><span><b>${esc(r.n)}</b></span><span>${r.last ? `${fmt(r.last)} · ${ago(r.last)}` : "never"}</span></div>${r.today ? `<div class="con-line">${r.today} open${r.today === 1 ? "" : "s"} in the last 24h</div>` : ""}</div>`).join("")
        + `<details class="con-more"><summary>Every open (${all.length})</summary>${all.sort((a, b) => b.at - a.at).slice(0, 200).map((v) => `<div class="con-line">${fmt(v.at)} · <b>${esc(v.m)}</b> · ${v.app === "home" ? "home-screen app" : "browser"}${v.screen ? ` · ${esc(v.screen)}` : ""}</div>`).join("")}</details>`;
    } catch {}
    const { events } = await get("/auth-log?format=json");
    if (!events.length) { body.innerHTML = opens + `<div class="admin-empty">No sign-ins yet. Nobody has claimed a name with a code.</div>`; wireLoginViz(body); return; }
    // One browser signing in as two owners is the signal worth chasing.
    const byDevice = new Map();
    for (const e of events) {
      if (!e.deviceId || !e.ok) continue;
      if (!byDevice.has(e.deviceId)) byDevice.set(e.deviceId, new Set());
      byDevice.get(e.deviceId).add(e.manager);
    }
    const shared = [...byDevice.entries()].filter(([, who]) => who.size > 1);
    const failed = events.filter((e) => !e.ok);
    const where = (e) => [e.city, e.region, e.country].filter(Boolean).join(", ") || "unknown";
    const what = (e) => [e.os, e.browser].filter(Boolean).join(" ") || "unknown";
    const alerts = [
      ...shared.map(([id, who]) => `One device (${esc(id.slice(0, 8))}…) signed in as ${esc([...who].join(" and "))}`),
      ...Object.entries(failed.reduce((acc, e) => ({ ...acc, [e.manager]: (acc[e.manager] || 0) + 1 }), {}))
        .filter(([, n]) => n >= 3).map(([m, n]) => `${esc(m)}: ${n} failed codes`),
    ];
    body.innerHTML = opens + `<div class="con-summary"><span>${events.length} event${events.length === 1 ? "" : "s"}</span><span class="${failed.length ? "warn" : ""}">${failed.length} failed</span></div>`
      + (alerts.length ? alerts.map((a) => `<div class="con-row bad"><div class="con-line">⚠ ${a}</div></div>`).join("") : `<div class="con-ok">Nothing unusual.</div>`)
      + events.map((e) => `<div class="con-row${e.ok ? "" : " warn"}">
          <div class="con-row-head"><b>${esc(e.manager)}</b><span>${when(e.ts)} · ${esc(e.kind)}</span>
            ${e.ok ? "" : `<span class="con-tag bad">failed</span>`}${e.newDevice ? `<span class="con-tag warn">new device</span>` : ""}${e.newNetwork ? `<span class="con-tag warn">new network</span>` : ""}</div>
          <div class="con-line dim">${esc(where(e))}${e.asOrg ? ` · ${esc(e.asOrg)}` : ""} · ${esc(e.ipShort || "—")}</div>
          <div class="con-line dim">${esc(what(e))}${e.device ? ` ${esc(e.device)}` : ""}${e.screen ? ` · ${esc(e.screen)}` : ""}${e.deviceId ? ` · ${esc(e.deviceId.slice(0, 8))}…` : ""}</div>
        </div>`).join("");
    wireLoginViz(body);
  }

  // --- Owners ---------------------------------------------------------
  async function renderOwners() {
    const auth = await get("/auth");
    const claimed = new Set(auth.claimed || []);
    body.innerHTML = `<p class="admin-intro">Each owner claims their own name with a code they choose. Reset frees a name so it can be claimed again — for a forgotten code, or when the wrong person got there first.</p>
      <div class="admin-owners-list">${OWNERS.map((name) => `<div class="admin-owner${claimed.has(name) ? " on" : ""}">
        <span class="ao-name">${esc(name === "Conlan" ? "Connie" : name)}</span>
        <span class="ao-state">${claimed.has(name) ? "claimed" : "not claimed"}</span>
        ${claimed.has(name) ? `<button class="admin-btn ao-reset" type="button" data-name="${esc(name)}">Reset</button>` : ""}
      </div>`).join("")}</div>`;
    body.querySelectorAll(".ao-reset").forEach((btn) => btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      if (!confirm(`Clear ${name}'s code? The next person to tap ${name} sets a new one.`)) return;
      btn.disabled = true;
      try {
        const res = await fetch(`${WORKER_URL}/auth?key=${encodeURIComponent(key())}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset", manager: name }),
        });
        if (!res.ok) { say(`Could not reset ${name}.`, "bad"); btn.disabled = false; return; }
        say(`${name} can be claimed again.`, "ok");
        renderTab();
      } catch {
        say("Could not reach the Worker.", "bad");
        btn.disabled = false;
      }
    }));
  }

  // --- This device ----------------------------------------------------
  // Straight from the running app, so it describes the phone in your hand
  // rather than the Worker.
  function renderDevice() {
    const d = typeof window.appDiagnostics === "function" ? window.appDiagnostics() : {};
    body.innerHTML = `<div class="con-diag">${Object.entries(d).map(([k, v]) => `<b>${esc(k)}</b><span>${esc(v)}</span>`).join("")}</div>
      <div class="con-actions">
        <button id="con-resync" class="admin-btn" type="button">Re-pull slate &amp; scores</button>
        <button id="con-forget" class="admin-btn" type="button">Forget this device's owner</button>
        <button id="con-wipe" class="admin-btn" type="button">Clear cached picks</button>
      </div>
      <p class="admin-intro">Clearing is local only — the cloud keeps every pick, and a refresh pulls them back.</p>`;
    el("con-resync").addEventListener("click", async () => {
      say("Refreshing…");
      if (typeof window.appResync === "function") await window.appResync();
      say("Refreshed.", "ok");
      renderTab();
    });
    el("con-forget").addEventListener("click", () => {
      if (!confirm("Forget who this device is? Picks stay in the cloud.")) return;
      window.appForgetDevice?.();
      say("Forgotten. The roster will ask again.", "ok");
      renderTab();
    });
    el("con-wipe").addEventListener("click", () => {
      if (!confirm("Clear this device's cached picks? The cloud keeps every pick.")) return;
      window.appClearPicks?.();
      say("Cleared. Refresh to pull the cloud copy back.", "ok");
      renderTab();
    });
  }

  // --- Login mode -----------------------------------------------------
  async function renderMode() {
    const auth = await get("/auth");
    const mode = auth.mode || "off";
    const claimedCount = (auth.claimed || []).length;
    const opts = [
      ["off", "Off", "Nothing changes. Picks save the way they always have and no owner is ever asked for a code."],
      ["soft", "Soft", "Owners can claim a code and sign in, but a pick with no login still saves — it just gets flagged in Pick changes. Safe mid-week."],
      ["on", "On", "A pick needs a signed-in owner. Anyone who has not claimed their name cannot save until they do."],
    ];
    body.innerHTML = `<p class="admin-intro">${claimedCount} of ${OWNERS.length} owners have claimed a code. Turning this on before everyone has claimed will stop the rest from saving picks, so move to Soft first and watch Pick changes.</p>
      <div class="con-modes">${opts.map(([v, label, note]) => `<button class="con-mode${v === mode ? " on" : ""}" type="button" data-mode="${v}">
          <span class="con-mode-label">${label}${v === mode ? " · current" : ""}</span><span class="con-mode-note">${note}</span>
        </button>`).join("")}</div>`;
    body.querySelectorAll(".con-mode").forEach((btn) => btn.addEventListener("click", async () => {
      const next = btn.dataset.mode;
      if (next === mode) return;
      if (next === "on" && claimedCount < OWNERS.length && !confirm(`Only ${claimedCount} of ${OWNERS.length} owners have claimed a code. The other ${OWNERS.length - claimedCount} will not be able to save picks. Turn it on anyway?`)) return;
      try {
        const res = await fetch(`${WORKER_URL}/auth?key=${encodeURIComponent(key())}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mode", mode: next }),
        });
        if (!res.ok) { say("Could not change the mode.", "bad"); return; }
        say(`Login mode is now ${next}.`, "ok");
        window.appRefreshAuth?.();
        renderTab();
      } catch {
        say("Could not reach the Worker.", "bad");
      }
    }));
  }

  // --- Slate ----------------------------------------------------------
  function renderSlate() {
    body.innerHTML = `<p class="admin-intro">Picking the week's games is delegated: whoever holds the slate key opens the editor with the same three taps on the wordmark. This opens it from here with your key.</p>
      <div class="con-actions"><button id="con-slate-open" class="admin-btn primary" type="button">Open the slate editor</button></div>`;
    el("con-slate-open").addEventListener("click", () => {
      // Hide without locking: openSlateEditor needs the role this console
      // was unlocked with.
      root.classList.add("hidden");
      window.openSlateEditor?.();
    });
  }

  // --- Season ledger --------------------------------------------------
  // Every pick of every manager, every week, right or wrong, with the line
  // it was taken at. Read from the frozen week summaries rather than from
  // live picks, so a re-saved slate cannot move a spread under a pick
  // already graded. Downloadable, because the season record should not
  // live only in a Worker.
  async function renderLedger() {
    const data = await get("/weeks?detail=1");
    const summaries = data.summaries || {};
    const weeks = (data.weeks?.list || []).slice().sort((a, b) => b - a).filter((n) => summaries[n]);
    if (!weeks.length) { body.innerHTML = `<div class="admin-empty">No week has been sealed yet, so there is nothing to show. Seal one from the Season tab.</div>`; return; }

    const flat = [];
    for (const n of weeks) {
      const s = summaries[n];
      for (const r of s.rows || []) for (const e of r.ledger || []) flat.push({ week: n, label: s.label, frozen: !!s.frozen, who: r.name, ...e });
    }
    const graded = flat.filter((e) => e.result !== "pending");
    const counts = { hit: 0, miss: 0, push: 0, nopick: 0 };
    for (const e of graded) counts[e.result] = (counts[e.result] || 0) + 1;

    const mark = { hit: "✓", miss: "✗", push: "P", nopick: "—", pending: "·" };
    body.innerHTML = `<div class="con-summary">
        <span>${flat.length} pick slot${flat.length === 1 ? "" : "s"} across ${weeks.length} week${weeks.length === 1 ? "" : "s"}</span>
        <span>${counts.hit} right · ${counts.miss} wrong · ${counts.push} push · ${counts.nopick} no pick</span>
      </div>
      ${weeks.map((n) => {
        const s = summaries[n];
        // Every manager, including anyone who picked nothing: a blank week
        // is part of the record and decides who was owed what.
        const rows = s.rows || [];
        const withPicks = rows.filter((r) => r.picked > 0).length;
        return `<details class="con-group"><summary class="con-group-head">
            <b>${esc(s.label)}</b><span>${s.frozen ? "frozen" : s.complete ? "complete" : `${s.played}/${s.games} final`} · ${withPicks}/${rows.length} picked</span>
          </summary>
          ${rows.length ? rows.map((r) => `<div class="con-row${r.picked ? "" : " warn"}">
            <div class="con-row-head"><b>${r.won ? "🏆 " : ""}${esc(r.name)}</b><span>${r.score} pts · ${r.hits}/${r.picked}</span></div>
            ${(r.ledger || []).map((e) => `<div class="con-line led ${esc(e.result)}">
                <span class="led-mark">${mark[e.result] || "·"}</span>
                <span class="led-game">G${e.g} ${esc(e.matchup)}</span>
                <span class="led-pick">${e.team ? `${esc(e.team)} ${esc(e.line)}` : "no pick"}</span>
                <span class="led-pts">${e.pts === null ? "" : e.pts}</span>
              </div>${e.late ? `<div class="con-line dim">saved after kickoff · ${when(e.savedAt)}</div>` : ""}`).join("")}
          </div>`).join("") : `<div class="con-line dim">Nobody picked this week.</div>`}
        </details>`;
      }).join("")}
      <div class="con-actions"><button id="con-ledger-csv" class="admin-btn" type="button">Download the season as CSV</button></div>
      <p class="admin-intro">One row per manager per game. A week shown as frozen is the record: re-sealing it will not change it unless the Season tab reopens it deliberately.</p>`;

    el("con-ledger-csv").addEventListener("click", () => {
      const head = ["week", "label", "frozen", "manager", "game", "matchup", "favorite", "spread", "picked_team", "mode", "line", "worth", "result", "points", "final_score", "saved_at_utc", "after_kickoff"];
      const cell = (v) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const lines = [head.join(",")];
      for (const e of flat) lines.push([e.week, e.label, e.frozen, e.who, e.g, e.matchup, e.favorite, e.spread,
        e.team, e.mode, e.line, e.worth, e.result, e.pts, e.score, e.savedAt ? new Date(e.savedAt).toISOString() : "", e.late].map(cell).join(","));
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = `brochiefs-picks-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(`${flat.length} rows downloaded.`, "ok");
    });
  }

  // --- Feeds: the twice-daily insights run --------------------------------
  async function renderFeeds() {
    const data = await get("/insights");
    const briefs = Object.values(data.briefs || {}).sort((a, b) => a.game - b.game);
    const runs = data.lastRun ? [data.lastRun] : [];
    const fmtRun = (r) => `${when(r.at)} · W${r.week} · ${r.sampled} line samples · ${r.briefs} briefs${r.skipped ? ` · ${r.skipped} skipped` : ""}${r.errors?.length ? ` · <span class="con-bad">${r.errors.length} error${r.errors.length === 1 ? "" : "s"}</span>` : ""}`;
    const feedState = (f) => f?.ok ? `<span class="con-ok">ok${f.cached ? " (cached)" : ""}</span>` : `<span class="con-bad">${esc(f?.error || "failed")}</span>`;
    body.innerHTML = `<p class="admin-intro">Line samples and game briefs for week ${data.week}. Runs at 7 AM and 7 PM ET while the week is open. Everything here is display only and never touches the sealed line.</p>
      <div class="admin-row"><button class="admin-btn primary" id="feeds-run" type="button">Run now</button><span id="feeds-note" class="admin-note">${runs.length ? fmtRun(runs[0]) : "No run recorded for this week yet."}</span></div>
      ${runs[0]?.errors?.length ? `<div class="admin-empty con-bad">${runs[0].errors.map(esc).join("<br>")}</div>` : ""}
      ${briefs.length ? briefs.map((b) => `<details class="con-brief"><summary>G${b.game} · ${b.movement ? `${esc(b.movement.nowFavorite)} -${b.movement.now}${b.movement.delta ? ` (${b.movement.delta > 0 ? "+" : ""}${b.movement.delta})` : ""}` : "no line"} · ${b.summary?.length || 0} lines · ${when(b.updatedAt)}${b.summaryError ? ` · <span class="con-bad">${esc(b.summaryError)}</span>` : ""}</summary>
          <div class="con-brief-body">
            <div class="con-kv">away injuries ${feedState(b.feeds?.awayInjuries)} · home injuries ${feedState(b.feeds?.homeInjuries)} · away news ${feedState(b.feeds?.awayNews)} · home news ${feedState(b.feeds?.homeNews)}</div>
            ${(b.summary || []).map((l) => `<div class="con-line">${esc(l)}</div>`).join("") || `<div class="admin-empty">No summary.</div>`}
            <pre class="con-raw">${esc(JSON.stringify({ movement: b.movement, injuries: b.injuries, news: b.news }, null, 1))}</pre>
          </div></details>`).join("") : `<div class="admin-empty">No briefs stored for this week.</div>`}`;
    body.querySelector("#feeds-run").addEventListener("click", async (e) => {
      e.target.disabled = true; say("Running… this takes about half a minute.");
      try {
        const res = await fetch(`${WORKER_URL}/insights/run?key=${encodeURIComponent(key())}&force=1`, { method: "POST" });
        if (!res.ok) { say(`Run failed (${res.status}).`, "bad"); e.target.disabled = false; return; }
        say("Done."); renderTab();
      } catch (err) { say("Run failed.", "bad"); e.target.disabled = false; }
    });
  }

  // Grid sheet: a plain-text Speed Racer checklist of who is in, for
  // pasting into the group chat mid-week. Read-only, copy or share.
  async function renderGrid() {
    const data = await get(`/picks?week=${currentWeek}`);
    const picks = data?.picks || {};
    const total = GAMES.length;
    const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
    const ms = Math.max(0, lockAt - Date.now());
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const left = ms <= 0 ? "LOCKED" : d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
    const rows = MANAGERS.map((name) => {
      const st = picks[name] || { picks: {} };
      const n = GAMES.filter((g) => st.picks?.[g.id]).length;
      const tb = String(st.tiebreaker ?? "").trim() !== "";
      const full = n === total && tb;
      const none = n === 0 && !tb;
      return { name, n, tb, full, none };
    }).sort((a, b) => (b.n + (b.tb ? 1 : 0)) - (a.n + (a.tb ? 1 : 0)) || a.name.localeCompare(b.name));
    const ready = rows.filter((r) => r.full), partial = rows.filter((r) => !r.full && !r.none), out = rows.filter((r) => r.none);
    const line = (r) => `${r.full ? "🟢" : r.none ? "🔴" : "🟡"} ${shown(r.name)} · ${r.n}/${total}${r.tb ? " · TB ✓" : " · TB ✗"}`;
    const text = [
      `🏁 GRID CHECK · ${WEEK_LABEL.toUpperCase()}`,
      `Lights out in ${left}`,
      ``,
      ...(ready.length ? [`READY TO RACE (${ready.length})`, ...ready.map(line), ``] : []),
      ...(partial.length ? [`⚠️ INCOMPLETE (${partial.length})`, ...partial.map(line), ``] : []),
      ...(out.length ? [`🚨 NOTHING IN (${out.length})`, ...out.map(line), ``] : []),
      `${ready.length}/${rows.length} on the grid · brochiefs.com`,
    ].join("\n");
    body.innerHTML = `<p class="admin-intro">Who is in for week ${currentWeek}, as a message you can paste into the chat. Green is a full card with a tiebreaker, yellow is partial, red is nothing in.</p>
      <div class="admin-row"><button class="admin-btn primary" id="grid-copy" type="button">Copy</button>${navigator.share ? `<button class="admin-btn" id="grid-share" type="button">Share…</button>` : ""}<span class="admin-note">${ready.length} ready · ${partial.length} partial · ${out.length} out</span></div>
      <pre class="con-raw con-grid" id="grid-text">${esc(text)}</pre>`;
    body.querySelector("#grid-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); say("Copied."); }
      catch { const r = document.createRange(); r.selectNodeContents(body.querySelector("#grid-text")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); say("Select all and copy.", "bad"); }
    });
    body.querySelector("#grid-share")?.addEventListener("click", async () => { try { await navigator.share({ text }); } catch {} });
  }

  // --- Question of the week ---------------------------------------------
  async function renderQotw() {
    const q = window.QOTW || { id: "gooey-belly", q: "" };
    const d = await get(`/qotw?id=${encodeURIComponent(q.id)}&all=1`);
    const a = d.answers || {};
    const label = (n) => (typeof window.shown === "function" ? window.shown(n) : n);
    const txt = (n) => !a[n] ? null : a[n].copout ? "Cop out: no clue" : a[n].answer;
    body.innerHTML = `<div class="con-summary"><span>${esc(q.q)}</span><span>${d.answered ?? Object.keys(a).length} of ${OWNERS.length} in</span></div>` +
      OWNERS.map((n) => `<div class="con-row${a[n] ? "" : " warn"}"><div class="con-row-head"><span><b>${esc(label(n))}</b></span><span>${a[n] ? when(a[n].at) : "waiting"}</span></div><div class="con-line" style="white-space:pre-wrap">${a[n] ? esc(txt(n)) : "<i>no answer yet</i>"}</div></div>`).join("") +
      (() => {
        const v = d.votes || {};
        const tally = {};
        for (const [, x] of Object.entries(v)) tally[x.for] = (tally[x.for] || 0) + 1;
        const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        const voted = Object.keys(v).length;
        return `<div class="con-summary"><span>FAVORITE ANSWER VOTES</span><span>${voted} of ${OWNERS.length} voted</span></div>` +
          (rows.length ? rows.map(([n, c]) => `<div class="con-row"><div class="con-row-head"><span><b>${esc(label(n))}</b></span><span>${c} vote${c === 1 ? "" : "s"}</span></div><div class="con-line">from ${Object.entries(v).filter(([, x]) => x.for === n).map(([m]) => esc(label(m))).join(", ")}</div></div>`).join("") : `<div class="admin-empty">No votes yet.</div>`);
      })() +
      `<button type="button" class="admin-btn link" id="qotw-copy">Copy all</button>`;
    el("qotw-copy").addEventListener("click", () => {
      const text = `${q.q}\n\n` + OWNERS.map((n) => `${label(n)}: ${txt(n) ?? "(no answer yet)"}`).join("\n");
      navigator.clipboard?.writeText(text).then(() => say("Answers copied.", "good"), () => say("Copy failed.", "bad"));
    });
  }

  // --- Expert picks graded ---------------------------------------------
  async function renderExperts() {
    const d = await get(`/expert-record`);
    const rec = (t) => t ? `${t.W}-${t.L}${t.P ? `-${t.P}` : ""}` : "0-0";
    const pc = (v) => v == null ? "—" : `${Math.round(v * 1000) / 10}%`;
    const t = d.total || {};
    const outlets = d.outlets || [];
    const backfill = `<button type="button" class="admin-btn link" id="xp-backfill">Backfill week 5 from the pre kickoff feed</button>`;
    const wire = () => el("xp-backfill")?.addEventListener("click", async () => {
      say("Backfilling… this reads every game, give it a minute.");
      try {
        const res = await fetch(`${WORKER_URL}/expert-record?week=5&sha=830a979&key=${encodeURIComponent(key())}`, { method: "POST" });
        const r = await res.json();
        if (!res.ok) { say(r.error || `Failed (${res.status})`, "bad"); return; }
        say(`Week 5: ${r.done.filter((x) => x.picks != null).length} games archived.`, "good");
        renderTab();
      } catch (err) { say(`Failed: ${err.message}`, "bad"); }
    });
    if (!outlets.length) { body.innerHTML = `<div class="admin-empty">No archived expert picks yet. Picks are archived the last time they are read before each kickoff.</div>` + backfill; wire(); return; }
    const pending = (d.graded || []).filter((g) => !g.final).length;
    body.innerHTML = `<div class="con-summary"><span>All outlets ${rec(t)}</span><span>${pc(t.pct)}${pending ? ` · ${pending} pending` : ""}</span></div>
      <p class="admin-intro">Picks as they stood at kickoff. ATS uses the outlet's own line when it wrote one, else the sealed line. Pushes are left out of the percentage.</p>` +
      outlets.map((o) => `<div class="con-row"><div class="con-row-head"><span><b>${esc(o.outlet)}</b></span><span>${pc(o.pct)}</span></div><div class="con-line">ALL ${rec(o.ALL)} · ATS ${rec(o.ATS)} · SU ${rec(o.SU)} · ${o.picks} pick${o.picks === 1 ? "" : "s"}</div></div>`).join("") +
      `<details class="ins-more-news"><summary>Every pick (${(d.graded || []).length})</summary>` +
      (d.graded || []).map((g) => `<div class="con-line">W${g.week} ${esc(g.matchup)} · ${esc(g.outlet)}${g.picker ? ` (${esc(g.picker)})` : ""}: ${esc(g.team)} ${esc(g.type)} → ${g.final ? g.grades.map((x) => `${x.kind}${x.kind === "ATS" ? ` ${x.team ? `${esc(x.team)} ` : ""}${x.line > 0 ? "+" : ""}${x.line}` : ""} ${x.result}`).join(", ") + ` (${esc(g.final)})` : "pending"}</div>`).join("") +
      `</details>` + backfill;
    wire();
  }

  const TABS = { qotw: renderQotw, experts: renderExperts, grid: renderGrid, picks: renderPicks, season: renderSeason, ledger: renderLedger, logins: renderLogins, owners: renderOwners, device: renderDevice, mode: renderMode, slate: renderSlate, feeds: renderFeeds };

  async function renderTab() {
    body.innerHTML = `<div class="admin-empty">Loading…</div>`;
    try {
      await TABS[tab]();
    } catch (err) {
      body.innerHTML = `<div class="admin-empty">Could not load that (${esc(err.message)}).</div>`;
    }
  }

  el("console-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".console-tab");
    if (!btn) return;
    tab = btn.dataset.tab;
    el("console-tabs").querySelectorAll(".console-tab").forEach((b) => b.classList.toggle("active", b === btn));
    say("");
    renderTab();
  });
  el("console-refresh").addEventListener("click", renderTab);

  const close = () => {
    root.classList.add("hidden");
    document.body.classList.remove("admin-open");
    // Exit locks: the next three taps ask for a key again, so the other
    // key lands on its own surface.
    window.lockAdminSurfaces?.();
  };
  el("console-exit").addEventListener("click", close);

  // app.js calls this each time the gesture opens the console.
  window.showAppConsole = () => {
    // Every entry lands on Logins, whatever tab was open last time.
    tab = "logins";
    el("console-tabs").querySelectorAll(".console-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === "logins"));
    root.classList.remove("hidden");
    document.body.classList.add("admin-open");
    root.scrollTop = 0;
    renderTab();
  };
  window.showAppConsole();
})();
