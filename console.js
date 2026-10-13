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
  // Jake runs the league and the app; his own opens and sign-ins say
  // nothing about how the league uses it, so login data leaves him out.
  const NOT_TRACKED = new Set(["Jake"]);
  const OWNERS = [
    "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
    "Nissan", "Skills", "Jake", "Curt", "Andrew",
  ];
  const TRACKED = OWNERS.filter((n) => !NOT_TRACKED.has(n));

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
  let tab = "whosin";

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

  // --- Logins: the league dashboard -----------------------------------
  // Five views, each answering one question:
  //   PULSE     how is the league using the app this week, and what changed
  //   PEOPLE    who is in, who is slipping, and each owner up close
  //   GAME DAY  what a Saturday looks like: who was in, when, watching what
  //   FEATURES  what gets used, what doesn't, and where visits start
  //   PICKS     when picks get made, how often they change, and whether
  //             changing them paid off
  // Everything is computed here from the admin-only data (opens, sessions,
  // the pick log) plus the season's slates and results. Local time. One
  // cyan ramp in four steps for magnitude, checked for even steps and
  // contrast on the dark surface; gold marks games; green and pink only on
  // up/down chips, always with an arrow. Tap any mark for exact numbers.
  const LD_FEATURES = {
    picks: "Picks screen", scoreboard: "Scores screen", history: "History", trivia: "Trivia", home: "Home",
    gamecast: "Live game cast", "game-info": "Game info", "game-final": "Final recap",
    h2h: "Head to head", "wp-player": "Win % breakdown", "wp-explain": "How win % works", sim: "Game sim",
    "grid-card": "Grid card", "pot-open": "The pot", "all-picks-open": "Everyone's picks",
    "ranking-expand": "Leaderboard row", "pick-saved": "Saved a pick", "pick-updated": "Changed a pick",
  };
  const ldFeat = (k) => LD_FEATURES[String(k).replace(/-g\d+$/, "")] || null;

  function buildLoginDash(src) {
    const { visits, sessions, picksNow, season, pickLog, buildNow, names, ago, rollups, nudgeLog } = src;
    const DAY = 86400000, HR = 3600000, now = Date.now();
    const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today0 = day0(now);
    const dayLab = (t) => new Date(t).toLocaleDateString([], { weekday: "short" }).slice(0, 2).toUpperCase();
    const dayLong = (t) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const hourLab = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
    const timeLab = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const dur = (ms) => !ms ? "0m" : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < HR ? `${Math.round(ms / 60000)}m` : `${(ms / HR).toFixed(1)}h`;
    const lead = (ms) => ms < HR ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 2 * DAY ? `${Math.round(ms / HR)} hr` : `${Math.round(ms / DAY)} days`;
    const tip = (str) => `data-tip="${esc(str)}"`;
    const list = (xs) => xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
    const B = (n) => `<b>${esc(n)}</b>`;
    const N = names.length;
    const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
    const chip = (d, unit = "", invert = false) => d == null ? `<em class="ld-d new">new</em>` : d === 0 ? `<em class="ld-d flat">= same</em>` : `<em class="ld-d ${(d > 0) !== invert ? "up" : "dn"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit}</em>`;

    // Season: slates (kickoffs, matchups), results and final picks by week.
    const weekNums = (season?.weeks?.list || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const curWeek = typeof currentWeek !== "undefined" ? Number(currentWeek) : weekNums[weekNums.length - 1];
    const slateOf = (w) => (w === curWeek && typeof GAMES !== "undefined" ? GAMES : season?.season?.[w]?.games) || [];
    const lockOf = (w) => { const ks = slateOf(w).map((g) => Date.parse(g.kickoff)).filter(Number.isFinite); return ks.length ? Math.min(...ks) : null; };
    const gameWins = [];
    for (const w of weekNums) for (const g of slateOf(w)) { const k = Date.parse(g.kickoff); if (Number.isFinite(k)) gameWins.push({ w, id: Number(g.id), a: k, b: k + 3.5 * HR, label: `${g.awayShort || g.away} at ${g.homeShort || g.home}` }); }
    const inGame = (t) => gameWins.some((x) => t >= x.a && t < x.b);
    const gameDays = [...new Set(gameWins.map((x) => day0(x.a)))].filter((d) => d <= now).sort((a, b) => a - b);

    // "This week" is the calendar week: Monday 00:00 to now, local time, the
    // same weeks the saved weekly totals use. It is compared with last week
    // up to the same point (Monday to this time last week), never with a
    // whole week. Rolling seven-day numbers are labeled "last 7 days".
    const wk0 = (() => { const d = new Date(today0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); })();
    const wkP0 = (() => { const d = new Date(wk0); d.setDate(d.getDate() - 7); return d.getTime(); })();
    const nowP = now - (wk0 - wkP0);
    const wkDays = Array.from({ length: Math.round((today0 - wk0) / DAY) + 1 }, (_, i) => { const d = new Date(wk0); d.setDate(d.getDate() + i); return d.getTime(); });
    const wkDaysP = wkDays.map((t) => { const d = new Date(t); d.setDate(d.getDate() - 7); return d.getTime(); });
    const dayN = wkDays.length;

    // Per owner: opens, sessions (segments joined across quick app
    // switches, features kept in first-use order), active days.
    const people = names.map((n) => {
      const opens = (visits[n] || []).filter((v) => Number.isFinite(v.at)).sort((a, b) => a.at - b.at);
      const segs = (sessions[n] || []).filter((x) => Number.isFinite(x.at) && Number.isFinite(x.dur)).sort((a, b) => a.at - b.at);
      const sess = [];
      for (const x of segs) {
        const last = sess[sess.length - 1];
        const hx = x.h || {};
        if (last && x.at - (last.at + last.dur) < 5 * 60000) {
          last.dur = x.at + x.dur - last.at; for (const f of x.f || []) if (!last.f.includes(f)) last.f.push(f); if (x.v) last.v = x.v;
          for (const [k, ms] of Object.entries(x.gt || {})) last.gt[k] = (last.gt[k] || 0) + ms;
          last.h.e += hx.e || 0; for (const m of hx.em || []) if (!last.h.em.includes(m)) last.h.em.push(m);
          for (const b of ["espn", "worker"]) { last.h.ff[b] += hx.ff?.[b] || 0; last.h.sl[b] += hx.sl?.[b] || 0; }
          if (last.h.ld == null && Number.isFinite(hx.ld)) last.h.ld = hx.ld;
        } else sess.push({ at: x.at, dur: x.dur, f: [...(x.f || [])], v: x.v || "", gt: { ...(x.gt || {}) }, h: { e: hx.e || 0, em: [...(hx.em || [])], ff: { espn: hx.ff?.espn || 0, worker: hx.ff?.worker || 0 }, sl: { espn: hx.sl?.espn || 0, worker: hx.sl?.worker || 0 }, ld: Number.isFinite(hx.ld) ? hx.ld : null } });
      }
      const days = new Set([...opens.map((v) => day0(v.at)), ...sess.map((x) => day0(x.at))]);
      const lastAt = Math.max(0, ...opens.map((v) => v.at), ...sess.map((x) => x.at + x.dur));
      const inWin = (a, b) => ({ opens: opens.filter((v) => v.at >= a && v.at < b), sess: sess.filter((x) => x.at >= a && x.at < b) });
      const L = (endDay) => { let c = 0; for (let i = 0; i < 7; i++) if (days.has(endDay - i * DAY)) c++; return c; };
      const w7 = inWin(today0 - 6 * DAY, now + 1), p7 = inWin(today0 - 13 * DAY, today0 - 6 * DAY);
      const wk = inWin(wk0, now + 1), wkP = inWin(wkP0, nowP);
      const ver = [...sess].reverse().find((x) => x.v)?.v || [...opens].reverse().find((v) => v.v)?.v || "";
      const appKind = !opens.length ? "-" : opens.every((v) => v.app === "home") ? "home-screen app" : opens.every((v) => v.app !== "home") ? "browser only" : "app and browser";
      return { n, opens, sess, days, lastAt, L7: L(today0), L7p: L(today0 - 7 * DAY), w7, p7, wk, wkP, dW: wkDays.filter((d) => days.has(d)).length, dWP: wkDaysP.filter((d) => days.has(d)).length, time7: w7.sess.reduce((a, x) => a + x.dur, 0), timeP7: p7.sess.reduce((a, x) => a + x.dur, 0), ver, appKind, device: opens[opens.length - 1]?.device || "" };
    });
    const opensSince = Math.min(now, ...people.flatMap((p) => p.opens.map((v) => v.at)));
    const sessSince = Math.min(now, ...people.flatMap((p) => p.sess.map((x) => x.at)));
    const priorCovered = opensSince <= today0 - 13 * DAY;
    const priorSessCovered = sessSince <= today0 - 13 * DAY;

    // League KPIs and deltas.
    // Calendar week so far, and last week to the same point.
    const priorWk = opensSince <= wkP0, priorWkSess = sessSince <= wkP0;
    const actW = people.filter((p) => p.dW).length, actWP = people.filter((p) => p.dWP).length;
    const avgW = people.reduce((a, p) => a + p.dW, 0) / Math.max(1, N), avgWP = people.reduce((a, p) => a + p.dWP, 0) / Math.max(1, N);
    const opensW = people.reduce((a, p) => a + p.wk.opens.length, 0), opensWP = people.reduce((a, p) => a + p.wkP.opens.length, 0);
    const timeW = people.reduce((a, p) => a + p.wk.sess.reduce((s2, x) => s2 + x.dur, 0), 0), timeWP = people.reduce((a, p) => a + p.wkP.sess.reduce((s2, x) => s2 + x.dur, 0), 0);
    const sessW = people.flatMap((p) => p.wk.sess);
    const sinceMon = dayN === 1 ? "today (Monday)" : "since Monday";
    const opens7 = people.reduce((a, p) => a + p.w7.opens.length, 0);
    const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
    // Nine people: under ten of anything, a percentage swings on one
    // person, so show the count instead.
    const share = (a, b, noun) => b >= 10 ? `${Math.round(a / b * 100)}% of ${noun}` : `${a} of ${b} ${noun}`;
    const shareTile = (a, b) => !b ? "-" : b >= 10 ? `${Math.round(a / b * 100)}<small>%</small>` : `${a}<small>/${b}</small>`;
    const shareCell = (a, b) => !b ? "-" : b >= 10 ? `${Math.round(a / b * 100)}%` : `${a}/${b}`;
    const countChip = (a, b, invert = false) => b >= 10 ? chip(pct(a, b), "%", invert) : chip(a - b, "", invert);

    // Daily charts span from the first day on record (at least a week, at
    // most 28 days), so a new tracker isn't three weeks of empty bars.
    const spanD = Math.max(7, Math.min(28, Math.round((today0 - day0(Math.min(opensSince, now))) / DAY) + 1));
    const d28 = Array.from({ length: spanD }, (_, i) => today0 - (spanD - 1 - i) * DAY);
    const winLab = spanD < 28 ? `SINCE ${dayLong(d28[0]).toUpperCase()}` : "LAST 28 DAYS";
    const colsStyle = `style="grid-template-columns:repeat(${spanD},minmax(0,1fr))"`;
    const dayAxis = () => `<div class="lvz-tlax"><span>${dayLong(d28[0]).toUpperCase()}</span>${spanD >= 14 ? `<span>${dayLong(d28[Math.floor(spanD / 2)]).toUpperCase()}</span>` : ""}<span>TODAY</span></div>`;
    const gdSet = new Set(gameDays);

    // Game day: the chosen day's games, who was in and when, how many at
    // once, and which live games got watched.
    const gameDayView = (D) => {
      const wins = gameWins.filter((x) => day0(x.a) === D).sort((a, b) => a.a - b.a);
      const A = wins.length ? Math.min(...wins.map((x) => x.a)) - HR : D + 10 * HR;
      const Bend = Math.min(now, wins.length ? Math.max(...wins.map((x) => x.b)) + HR : D + 26 * HR);
      const span = Math.max(HR, Bend - A);
      const xp = (t) => ((t - A) / span * 100).toFixed(2);
      const STEP = 10 * 60000, nb = Math.ceil(span / STEP);
      const conc = Array.from({ length: nb }, (_, i) => { const t = A + i * STEP; return people.filter((p) => p.sess.some((x) => x.at < t + STEP && x.at + x.dur > t) || p.opens.some((v) => v.at >= t && v.at < t + STEP)).map((p) => p.n); });
      const cmax = Math.max(1, ...conc.map((c) => c.length));
      const peakI = conc.reduce((bi, c, i) => c.length > conc[bi].length ? i : bi, 0);
      const inDuring = people.filter((p) => p.opens.some((v) => wins.some((w) => v.at >= w.a && v.at < w.b)) || p.sess.some((x) => wins.some((w) => x.at < w.b && x.at + x.dur > w.a)));
      const watch = wins.map((w) => {
        const near = (x) => x.at < w.b + HR && x.at + x.dur > w.a;
        const who = people.filter((p) => p.sess.some((x) => near(x) && x.f.includes(`gamecast-g${w.id}`))).map((p) => p.n);
        const ms = people.reduce((a, p) => a + p.sess.filter(near).reduce((s2, x) => s2 + (x.gt?.[`g${w.id}`] || 0), 0), 0);
        return { w, who, ms };
      });
      const tGame = people.map((p) => ({ p, ms: p.sess.reduce((a, x) => a + wins.reduce((s, w) => s + Math.max(0, Math.min(x.at + x.dur, w.b) - Math.max(x.at, w.a)), 0), 0) }));
      const hasSess = people.some((p) => p.sess.some((x) => x.at >= A && x.at < Bend));
      // Games packed into as few rows as fit without overlap.
      const rowEnd = [];
      const laneOf = wins.map((w) => { let r = rowEnd.findIndex((e) => e <= w.a); if (r < 0) { r = rowEnd.length; rowEnd.push(0); } rowEnd[r] = w.b; return r; });
      const lanes = wins.map((w, i) => `<i class="ld-gw" style="left:${xp(Math.max(w.a, A))}%;width:${Math.max(1, (Math.min(w.b, Bend) - Math.max(w.a, A)) / span * 100)}%;top:${laneOf[i] * 11}px" ${tip(`G${w.id} ${w.label} · kickoff ${timeLab(w.a)}`)}><span>G${w.id}</span></i>`).join("");
      const laneH = Math.max(1, rowEnd.length) * 11 + 2;
      // Before visit lengths were tracked, "at once" can't be known: show
      // opens per half hour instead, and say so.
      const HALF = 30 * 60000, nh = Math.ceil(span / HALF);
      const halves = Array.from({ length: nh }, (_, i) => { const t = A + i * HALF; return people.map((p) => ({ n: p.n, c: p.opens.filter((v) => v.at >= t && v.at < t + HALF).length })).filter((x) => x.c); });
      const hmax = Math.max(1, ...halves.map((h) => h.reduce((a, x) => a + x.c, 0)));
      const peakH = halves.reduce((bi, h, i) => h.reduce((a, x) => a + x.c, 0) > halves[bi].reduce((a, x) => a + x.c, 0) ? i : bi, 0);
      const halfBars = halves.map((h, i) => { const c = h.reduce((a, x) => a + x.c, 0); return `<i class="ld-cb${i === peakH && c ? " pk" : ""}" style="height:${(c / hmax * 100).toFixed(0)}%" ${tip(`${timeLab(A + i * HALF)} to ${timeLab(A + (i + 1) * HALF)} · ${c} open${c === 1 ? "" : "s"}${c ? `: ${h.map((x) => `${x.n}${x.c > 1 ? ` ×${x.c}` : ""}`).join(", ")}` : ""}`)}></i>`; }).join("");
      // Round-hour axis: a label every three hours.
      const h0 = new Date(A); h0.setMinutes(0, 0, 0); while (h0.getTime() < A || h0.getHours() % 3) h0.setHours(h0.getHours() + 1);
      const ticks = []; for (let t = h0.getTime(); t <= Bend; t += 3 * HR) ticks.push(t);
      const hourAx = `<div class="ld-hax">${ticks.map((t) => `<span style="left:${xp(t)}%">${hourLab(new Date(t).getHours())}</span>`).join("")}</div>`;
      const opensInGames = people.reduce((a, p) => a + p.opens.filter((v) => wins.some((w) => v.at >= w.a && v.at < w.b)).length, 0);
      const bars = conc.map((c, i) => `<i class="ld-cb${i === peakI && c.length ? " pk" : ""}" style="height:${(c.length / cmax * 100).toFixed(0)}%" ${tip(`${timeLab(A + i * STEP)} · ${c.length} in the app${c.length ? `: ${c.join(", ")}` : ""}`)}></i>`).join("");
      // Overlapping games shade as one band, so the strip doesn't stack to solid.
      const merged = [];
      for (const w of wins) { const l = merged[merged.length - 1]; if (l && w.a <= l.b) l.b = Math.max(l.b, w.b); else merged.push({ a: w.a, b: w.b }); }
      const bandHtml = merged.map((w) => `<i class="lvz-band" style="left:${xp(Math.max(w.a, A))}%;width:${(Math.min(w.b, Bend) - Math.max(w.a, A)) / span * 100}%"></i>`).join("");
      const strips = people.map((p) => `<span class="lvz-nm">${esc(p.n)}</span><div class="lvz-strip">${ticks.map((t) => `<i class="lvz-mid" style="left:${xp(t)}%"></i>`).join("")}${p.sess.filter((x) => x.at < Bend && x.at + x.dur > A).map((x) => `<i class="lvz-seg" style="left:${xp(Math.max(x.at, A))}%;width:${Math.max(0.6, (Math.min(x.at + x.dur, Bend) - Math.max(x.at, A)) / span * 100)}%"></i>`).join("")}${p.opens.filter((v) => v.at >= A && v.at < Bend).map((v) => `<i class="lvz-dot${inGame(v.at) ? " gm" : ""}" style="left:${xp(v.at)}%" ${tip(`${p.n} · ${timeLab(v.at)}${inGame(v.at) ? " · during a game" : ""}`)}></i>`).join("")}</div>`).join("");
      const wmax = Math.max(1, ...watch.map((x) => x.who.length));
      const watchHtml = watch.some((x) => x.who.length) ? watch.slice().sort((a, b) => b.who.length - a.who.length).map((x) => `<div class="lvz-fb wide" ${tip(`${x.w.label} · watched live by ${x.who.length ? x.who.join(", ") : "nobody"}${x.ms ? ` · ${dur(x.ms)} on its live view in all` : ""}`)}><span>${esc(x.w.label)}</span><i><b style="width:${(x.who.length / wmax * 100).toFixed(0)}%"></b></i><em>${x.who.length}/${N}${x.ms ? ` · ${dur(x.ms)}` : ""}</em></div>`).join("") : `<div class="lvz-empty">${hasSess ? "Nobody opened a live game cast." : "Per-game viewing is recorded from the new build on; this Saturday is the first it will show."}</div>`;
      const most = watch.slice().sort((a, b) => b.who.length - a.who.length)[0];
      const facts = {
        peak: hasSess ? conc[peakI]?.length || 0 : 0, peakAt: A + peakI * STEP, peakWho: conc[peakI] || [],
        inDuring: inDuring.length, most: most && most.who.length ? most : null,
        topTime: tGame.sort((a, b) => b.ms - a.ms)[0], hasSess, wins: wins.length,
      };
      const html = `<div class="ld-kpis three">
          <div><b>${facts.inDuring}<small>/${N}</small></b><span>in during games</span></div>
          ${hasSess ? `<div><b>${facts.peak || "-"}</b><span>most at once${facts.peak ? ` · ${timeLab(facts.peakAt)}` : ""}</span></div>` : `<div><b>${halves[peakH]?.reduce((a, x) => a + x.c, 0) || "-"}</b><span>opens in the busiest half hour${halves[peakH]?.length ? ` · ${timeLab(A + peakH * HALF)}` : ""}</span></div>`}
          ${hasSess ? `<div><b>${facts.topTime?.ms ? dur(facts.topTime.ms) : "-"}</b><span>${facts.topTime?.ms ? `${esc(facts.topTime.p.n)}, most time in games` : "time in games"}</span></div>` : `<div><b>${opensInGames}</b><span>opens during games</span></div>`}
        </div>
        <div class="lvz-h">${hasSess ? "IN THE APP AT ONCE" : "OPENS EACH HALF HOUR"}</div>
        ${hasSess ? "" : `<div class="lvz-cap">Visit lengths are tracked from ${esc(dayLong(sessSince))} on, so for this day it's opens, not people in at once.</div>`}
        <div class="ld-conc"><div class="ld-cbars">${hasSess ? bars : halfBars}</div><div class="ld-glanes" style="height:${laneH}px">${lanes}</div>${hourAx}</div>
        <div class="lvz-h">WHO WAS IN · <i class="ld-key-dotg"></i> OPENED DURING A GAME</div>
        <div class="lvz-tl">${strips}<span></span>${hourAx}</div>
        <div class="lvz-h">LIVE GAME CASTS WATCHED · PEOPLE · MINUTES ON IT</div>
        <div class="lvz-feat">${watchHtml}</div>`;
      return { html, facts };
    };
    const lastGD = gameDays.filter((d) => d <= today0).slice(-1)[0] ?? null;
    const gdFacts = lastGD != null ? gameDayView(lastGD).facts : null;

    // Features: adoption (people), depth (share of visits), first stop.
    const s14 = people.flatMap((p) => p.sess.filter((x) => x.at >= now - 14 * DAY).map((x) => ({ p, x })));
    const fmap = new Map();
    // Once per visit: "gamecast" and "gamecast-g3" are the same feature.
    for (const { p, x } of s14) [...new Set(x.f.map((f) => String(f).replace(/-g\d+$/, "")).filter(ldFeat))].forEach((k, i) => { const e = fmap.get(k) || { k, ppl: new Set(), n: 0, first: 0 }; e.ppl.add(p.n); e.n++; if (i === 0) e.first++; fmap.set(k, e); });
    const fr = [...fmap.values()].sort((a, b) => b.ppl.size - a.ppl.size || b.n - a.n);
    // The gamecast and final recap need a game to have been played; with no
    // games since visit records began, nobody using them says nothing.
    const gamesSinceSess = gameWins.some((w) => w.a >= sessSince && w.a <= now);
    const unused = Object.keys(LD_FEATURES).filter((k) => !fmap.has(k) && !/^pick-|ranking-expand|wp-explain/.test(k) && (gamesSinceSess || !/^(gamecast|game-final)$/.test(k))).map((k) => LD_FEATURES[k]);
    const firstStop = [...fr].sort((a, b) => b.first - a.first)[0];

    // Gamecast: does anyone open it at all? Every session on record, since
    // it only matters on game days. Live is the gamecast proper (with time
    // on it); info and final are the same sheet before kickoff and after.
    // Time is matched to a game by its id and the hours around kickoff.
    const gcSess = people.flatMap((p) => p.sess.map((x) => ({ p, x })));
    const nearGame = (x, w) => x.at < w.b + HR && x.at + x.dur > w.a - HR;
    const gcGameDays = gameDays.filter((d) => d >= day0(sessSince) && d <= today0);
    const inGameSess = gcSess.filter(({ x }) => gameWins.some((w) => x.at < w.b && x.at + x.dur > w.a));
    const gcPeople = names.map((n) => {
      const mine = gcSess.filter((e) => e.p.n === n);
      const has = (k) => mine.filter(({ x }) => x.f.includes(k));
      const live = has("gamecast");
      const ms = mine.reduce((a, { x }) => a + Object.values(x.gt || {}).reduce((s2, v) => s2 + (Number(v) || 0), 0), 0);
      return { n, live: live.length, info: has("game-info").length, fin: has("game-final").length, ms, last: Math.max(0, ...live.map(({ x }) => x.at)) };
    });
    const gcUsers = gcPeople.filter((x) => x.live);
    const gcMs = gcPeople.reduce((a, x) => a + x.ms, 0);
    const gcInGame = inGameSess.filter(({ x }) => x.f.includes("gamecast")).length;
    const gcGames = new Map(); // "week-id" -> { w, ppl, ms }
    for (const { p, x } of gcSess) for (const [k, ms] of Object.entries(x.gt || {})) {
      const id = Number(String(k).replace(/^g/, ""));
      const w = gameWins.filter((g) => g.id === id && nearGame(x, g)).sort((a, b) => Math.abs(a.a - x.at) - Math.abs(b.a - x.at))[0];
      if (!w) continue;
      const e = gcGames.get(`${w.w}-${w.id}`) || { w, ppl: new Set(), ms: 0 };
      e.ppl.add(p.n); e.ms += Number(ms) || 0; gcGames.set(`${w.w}-${w.id}`, e);
    }
    const gcTop = [...gcGames.values()].sort((a, b) => b.ppl.size - a.ppl.size || b.ms - a.ms);
    const gcByDay = gcGameDays.map((d) => {
      const day = gcSess.filter(({ x }) => day0(x.at) === d);
      return { d, ppl: new Set(day.filter(({ x }) => x.f.includes("gamecast")).map(({ p }) => p.n)), ms: day.reduce((a, { x }) => a + Object.values(x.gt || {}).reduce((s2, v) => s2 + (Number(v) || 0), 0), 0), inN: new Set(day.map(({ p }) => p.n)).size };
    });

    // Picks: lead time to lock, edits, and whether changes paid off.
    const log = (pickLog || []).filter((r) => names.includes(r.manager) && !r.admin);
    const flips = new Map(); // manager -> { helped, hurt, net, n }
    const chain = new Map();
    for (const r of [...log].sort((a, b) => a.ts - b.ts)) for (const c of r.changes || []) {
      if (!c.game || c.rejected || c.afterKickoff) continue;
      const k = `${r.week}|${r.manager}|${c.game}`;
      // The original pick is the first one ever saved (a first save has no
      // "from"); the final one is wherever the last change landed.
      const e = chain.get(k) || { w: Number(r.week), m: r.manager, g: Number(c.game), from: c.from ?? c.to, to: c.to };
      e.to = c.to; chain.set(k, e);
    }
    const parse = (s) => { const m = String(s || "").match(/^(.*)\s(SU|ATS)$/); return m ? { team: m[1], mode: m[2] } : null; };
    for (const e of chain.values()) {
      const a = parse(e.from), b = parse(e.to);
      if (!a || !b || (a.team === b.team && a.mode === b.mode)) continue;
      const game = slateOf(e.w).find((g) => Number(g.id) === e.g), res = season?.season?.[e.w]?.results?.[e.g];
      if (!game || !res || typeof scorePick !== "function") continue;
      const d = scorePick(game, b, res) - scorePick(game, a, res);
      const f = flips.get(e.m) || { helped: 0, hurt: 0, net: 0, n: 0 };
      f.n++; f.net += d; if (d > 0) f.helped++; else if (d < 0) f.hurt++;
      flips.set(e.m, f);
    }
    const leadBy = new Map(); // manager -> [ms before lock per week]
    const editsBy = new Map();
    for (const w of new Set(log.map((r) => Number(r.week)))) {
      const lk = lockOf(w); if (!lk) continue;
      for (const n of names) {
        const mine = log.filter((r) => Number(r.week) === w && r.manager === n && r.ts <= lk);
        if (mine.length) (leadBy.get(n) || leadBy.set(n, []).get(n)).push(lk - Math.max(...mine.map((r) => r.ts)));
        const ed = mine.reduce((a, r) => a + (r.changes || []).filter((c) => c.game && c.from).length, 0);
        (editsBy.get(n) || editsBy.set(n, []).get(n)).push(ed);
      }
    }
    const pickWeekView = (w) => {
      const lk = lockOf(w) || now;
      const wk = log.filter((r) => Number(r.week) === w);
      const A = Math.min(lk - 6 * DAY, ...wk.map((r) => r.ts)), Bend = lk + 2 * HR, span = Bend - A;
      const xp = (t) => (Math.max(0, Math.min(1, (t - A) / span)) * 100).toFixed(2);
      const rows = names.map((n) => {
        const mine = wk.filter((r) => r.manager === n).sort((a, b) => a.ts - b.ts);
        const before = mine.filter((r) => r.ts <= lk);
        const last = before.length ? before[before.length - 1].ts : null;
        return `<span class="lvz-nm">${esc(n)}</span><div class="lvz-strip pk"><i class="lvz-lock" style="left:${xp(lk)}%"></i>${mine.map((r) => { const late = (r.changes || []).some((c) => c.afterKickoff || c.rejected), ed = (r.changes || []).some((c) => c.game && c.from); return `<i class="lvz-tick${late ? " late" : ed ? " edit" : ""}" style="left:${xp(r.ts)}%" ${tip(`${n} · ${dayLong(r.ts)} ${timeLab(r.ts)} · ${(r.changes || []).map((c) => `${c.game ? `G${c.game}` : "TB"} ${c.from ? `${c.from} → ` : ""}${c.to ?? "cleared"}`).join("; ")}${late ? " · blocked, after kickoff" : ""}`)}></i>`; }).join("")}</div><span class="lvz-ago">${last ? lead(lk - last) : "-"}</span>`;
      }).join("");
      const ax = [0, 0.5, 1].map((f) => `<span>${new Date(A + f * span).toLocaleDateString([], { weekday: "short" }).toUpperCase()}</span>`).join("");
      return wk.length ? `<div class="lvz-pkgrid">${rows}<span></span><div class="lvz-tlax">${ax}</div><span></span></div><div class="lvz-key"><i class="lvz-tick k"></i>saved<i class="lvz-tick k edit"></i>changed a pick<i class="lvz-tick k late"></i>blocked after kickoff<i class="lvz-lock k"></i>lock · right: last save before lock</div>` : `<div class="lvz-empty">No pick saves logged for week ${w}.</div>`;
    };
    const pickWeeks = [...new Set(log.map((r) => Number(r.week)))].sort((a, b) => b - a);

    // Season points, for context and the engagement read.
    const pts = new Map();
    for (const w of weekNums) { const sw = season?.season?.[w]; if (!sw?.games || !sw.results) continue; for (const n of names) { const pk = sw.picks?.[n]?.picks || {}; let s = 0; for (const g of sw.games) { const r = sw.results[g.id], p = pk[g.id]; if (r && p && typeof scorePick === "function") s += scorePick(g, p, r); } pts.set(n, (pts.get(n) || 0) + s); } }

    // The story: ranked insights, each tagged ACTION, TREND or NOTE.
    const story = [];
    const add = (tag, w, html) => story.push({ tag, w, html });
    const lockNow = lockOf(curWeek);
    if (lockNow && lockNow > now && picksNow) {
      const total = slateOf(curWeek).length;
      const short = names.map((n) => ({ n, k: slateOf(curWeek).filter((g) => picksNow[n]?.picks?.[g.id]).length })).filter((x) => x.k < total);
      if (short.length) add("ACTION", 100, `Picks not in before lock (${lead(lockNow - now)} left): ${short.map((x) => `${B(x.n)} ${x.k}/${total}`).join(", ")}.`);
    }
    const quiet = people.filter((p) => !p.lastAt || now - p.lastAt > 3 * DAY);
    if (quiet.length) add("ACTION", 90, `${list(quiet.map((p) => B(p.n)))} ${quiet.length === 1 ? "hasn't" : "haven't"} been in for 3+ days${quiet.length === 1 && quiet[0].lastAt ? ` (last ${dayLong(quiet[0].lastAt)})` : ""}.`);
    // An older build only matters if they came in after the update shipped
    // and still ran the old one; not having opened since is not a problem.
    // The stamp is the deploy time (UTC, YYYYMMDDHHMM). Fifteen minutes of
    // grace for GitHub Pages to publish it.
    const stampAt = (v) => /^\d{12}$/.test(v || "") ? Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12)) : null;
    const nowBuildAt = stampAt(buildNow);
    const stale = nowBuildAt ? people.filter((p) => { const after = [...p.opens, ...p.sess].filter((x) => x.v && x.at > nowBuildAt + 15 * 60000); return after.length >= 2 && !after.some((x) => x.v >= buildNow); }) : [];
    if (stale.length) add("ACTION", 60, `${list(stale.map((p) => B(p.n)))} opened the app since the last update but ${stale.length === 1 ? "is" : "are"} still on an older build. The update isn't reaching ${stale.length === 1 ? "that phone" : "those phones"}; closing the app fully and reopening fixes it.`);
    if (priorCovered) {
      const slip = people.filter((p) => p.L7p >= 3 && p.L7 <= 1);
      if (slip.length) add("TREND", 80, `Slipping: ${list(slip.map((p) => `${B(p.n)} (${p.L7p} of the 7 days before, ${p.L7} of the last 7)`))}.`);
      if (priorWk && actW !== actWP) add("TREND", 70, `${actW} of ${N} have been in ${sinceMon}, ${actW > actWP ? "up" : "down"} from ${actWP} by this point last week.`);
      const mv = [...people].map((p) => ({ p, d: p.L7 - p.L7p })).sort((a, b) => b.d - a.d);
      if (mv[0]?.d >= 2) add("TREND", 65, `${B(mv[0].p.n)} is in more: ${mv[0].p.L7} of the last 7 days against ${mv[0].p.L7p} of the 7 before.`);
    }
    const fl = [...flips.entries()].filter(([, f]) => f.n >= 2).sort((a, b) => a[1].net - b[1].net);
    if (fl.length) {
      const [wn, wf] = fl[0], [bn, bf] = fl[fl.length - 1];
      if (wf.net < 0) add("TREND", 58, `Second-guessing has cost ${B(wn)} ${-wf.net} point${wf.net === -1 ? "" : "s"} this season (${wf.n} changed picks: ${wf.helped} helped, ${wf.hurt} hurt).`);
      if (bf.net > 0 && bn !== wn) add("NOTE", 50, `${B(bn)}'s pick changes have paid off: +${bf.net} points from ${bf.n} switches.`);
    }
    if (gcGameDays.length) add(gcUsers.length ? "NOTE" : "TREND", 51, gcUsers.length
      ? `Live gamecast: ${gcUsers.length} of ${N} have opened one (${list(gcUsers.map((x) => B(x.n)))}), ${dur(gcMs)} watched in all; ${gcInGame} of ${inGameSess.length} visits while games were on included one.`
      : `Nobody has opened a live gamecast across ${gcGameDays.length} game day${gcGameDays.length === 1 ? "" : "s"} since ${esc(dayLong(sessSince))} (${inGameSess.length} visits while games were on).`);
    if (gdFacts?.most) add("NOTE", 52, `Most-watched live game on ${dayLong(lastGD)}: ${esc(gdFacts.most.w.label)}, ${gdFacts.most.who.length} of ${N} had it open.`);
    if (gdFacts?.peak >= 2) add("NOTE", 50, `Peak on ${dayLong(lastGD)}: ${gdFacts.peak} in the app at once around ${timeLab(gdFacts.peakAt)} (${list(gdFacts.peakWho.map(esc))}).`);
    const g7 = people.reduce((a, p) => a + p.w7.opens.filter((v) => inGame(v.at)).length, 0);
    const gameMs7 = gameWins.reduce((a, x) => a + Math.max(0, Math.min(x.b, now) - Math.max(x.a, today0 - 6 * DAY)), 0);
    if (opens7 >= 5 && gameMs7 > 0) add("NOTE", 45, `${share(g7, opens7, "opens in the last 7 days")} came while games were on, which is ${Math.round(gameMs7 / (7 * DAY) * 100)}% of that time.`);
    const ld = names.map((n) => ({ n, m: median(leadBy.get(n) || []) })).filter((x) => x.m != null);
    if (ld.length >= 3) { ld.sort((a, b) => a.m - b.m); add("NOTE", 44, `Pick timing: ${B(ld[ld.length - 1].n)} usually locks in ${lead(ld[ld.length - 1].m)} early; ${B(ld[0].n)} usually waits until ${lead(ld[0].m)} before lock.`); }
    if (fr.length) add("NOTE", 40, `Most-used: ${fr.slice(0, 3).map((e) => `${esc(ldFeat(e.k))} (${e.ppl.size} of ${N})`).join(", ")}${unused.length ? `. Nobody used ${list(unused.slice(0, 4).map(esc))} ${sessSince > now - 14 * DAY ? `since ${esc(dayLong(sessSince))}, when this started being tracked` : "in 14 days"}` : ""}.`);
    if (firstStop?.first >= 3) add("NOTE", 35, `Visits usually start on ${esc(ldFeat(firstStop.k))} (${share(firstStop.first, s14.length, "visits")}).`);
    const br = people.filter((p) => p.appKind === "browser only");
    const inApp = people.filter((p) => p.opens.length);
    if (br.length && br.length === inApp.length) add("NOTE", 30, `Nobody has added the app to their home screen; everyone opens it in the browser.`);
    else if (br.length > inApp.length / 2) add("NOTE", 30, `Only ${list(inApp.filter((p) => !br.includes(p)).map((p) => B(p.n)))} use${inApp.length - br.length === 1 ? "s" : ""} the home-screen app; everyone else opens it in the browser.`);
    else if (br.length) add("NOTE", 30, `${list(br.map((p) => B(p.n)))} only use${br.length === 1 ? "s" : ""} the browser, not the home-screen app.`);
    const tagOrder = { ACTION: 0, TREND: 1, NOTE: 2 };
    story.sort((a, b) => tagOrder[a.tag] - tagOrder[b.tag] || b.w - a.w);

    // Nudges, ready for the chat.
    const nudges = [];
    if (lockNow && lockNow > now && picksNow) { const total = slateOf(curWeek).length; for (const n of names) { const k = slateOf(curWeek).filter((g) => picksNow[n]?.picks?.[g.id]).length; if (k < total) nudges.push({ n, kind: "picks", why: `${k}/${total} picks`, msg: `${n}, ${total - k} pick${total - k === 1 ? "" : "s"} left before lock` }); } }
    for (const p of quiet) if (!nudges.some((x) => x.n === p.n)) nudges.push({ n: p.n, kind: "quiet", why: p.lastAt ? `last in ${ago(p.lastAt)}` : "never opened it", msg: `${p.n}, haven't seen you in the app${p.lastAt ? ` since ${dayLong(p.lastAt)}` : ""}` });
    const nudgeText = nudges.length ? `🏈 Brochiefs check-in:\n${nudges.map((x) => `• ${x.msg}`).join("\n")}${lockNow && lockNow > now ? `\nPicks lock ${new Date(lockNow).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : ""}\nbrochiefs.com` : "";

    // ---- Releases: when each build was first seen in the league ----
    const firstSeen = new Map();
    for (const p of people) for (const x of [...p.opens, ...p.sess]) if (x.v && (!firstSeen.has(x.v) || x.at < firstSeen.get(x.v))) firstSeen.set(x.v, x.at);
    const buildLab = (v) => `${v.slice(4, 6)}/${v.slice(6, 8)} ${v.slice(8, 10)}:${v.slice(10, 12)}`;
    const releases = [...firstSeen.entries()].filter(([, t]) => t >= d28[0]).sort((a, b) => a[1] - b[1]);

    // ---- Time in the app per day, 28 days (sessions) ----

    // ---- Season, week by week (saved rollups, plus this week live) ----
    const etKey = (t) => { const d = new Date(t); const dow = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dow); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const rk = Object.keys(rollups || {}).sort();
    const thisKey = etKey(now);
    const thisWeekLive = (() => {
      const a = Date.parse(`${thisKey}T00:00:00`), out = { days: 0, opens: 0, timeMs: 0, active: 0 };
      for (const p of people) { const op = p.opens.filter((v) => v.at >= a), ss = p.sess.filter((x) => x.at >= a); if (op.length || ss.length) out.active++; out.opens += op.length; out.timeMs += ss.reduce((s2, x) => s2 + x.dur, 0); }
      return out;
    })();
    const trend = [...rk.slice(-11).map((k) => ({ k, live: false, partial: !!rollups[k].partial, active: rollups[k].league?.active || 0, opens: rollups[k].league?.opens || 0, timeMs: rollups[k].league?.timeMs || 0 })), { k: thisKey, live: true, partial: true, ...thisWeekLive }];
    const trMax = N;
    const wkLab = (k) => { const [, m, d] = k.split("-"); return `${Number(m)}/${Number(d)}`; };
    const trendHtml = trend.map((w) => `<i class="ld-tw${w.live ? " live" : ""}${w.partial && !w.live ? " part" : ""}" ${tip(`Week of ${wkLab(w.k)}${w.live ? " (so far)" : w.partial ? " (tracking started mid-week)" : ""} · ${w.active} of ${N} in · ${w.opens} opens · ${dur(w.timeMs)} in the app`)}><b style="height:${(w.active / trMax * 100).toFixed(0)}%"></b><span>${wkLab(w.k)}</span></i>`).join("");

    // ---- A past week, from its rollup, against the week before ----
    const pastWeekView = (k) => {
      const r = rollups?.[k]; if (!r) return `<div class="lvz-empty">No saved totals for that week.</div>`;
      const prevK = rk[rk.indexOf(k) - 1], pr = prevK ? rollups[prevK] : null;
      const sum = (rr, f) => names.reduce((a, n) => a + (f(rr?.people?.[n] || {}) || 0), 0);
      const act = r.league?.active || 0, actP = pr?.league?.active;
      const days = sum(r, (x) => x.days) / N, daysP = pr ? sum(pr, (x) => x.days) / N : null;
      const kp = (label, val, d, tipTxt, ch = chip(d)) => `<div ${tip(tipTxt)}><b>${val}</b><span>${label}</span>${ch}</div>`;
      const rows = names.map((n) => ({ n, x: r.people?.[n] || {}, px: pr?.people?.[n] })).sort((a, b) => (b.x.days || 0) - (a.x.days || 0) || (b.x.opens || 0) - (a.x.opens || 0));
      const topF = (x) => { const e = Object.entries(x.features || {}).filter(([f]) => ldFeat(f)).sort((a, b) => b[1] - a[1])[0]; return e ? ldFeat(e[0]) : "-"; };
      return `${r.partial ? `<div class="lvz-cap">Tracking started partway through this week, so it undercounts.</div>` : ""}
        <div class="ld-kpis">
          ${kp(`active (of ${N})`, act, actP != null ? act - actP : null, `People in at least once that week${pr ? `; week before: ${actP}` : ""}`)}
          ${kp("days in, per person", days.toFixed(1), daysP != null ? Math.round((days - daysP) * 10) / 10 : null, "Average days in the app out of 7")}
          ${kp("opens", r.league?.opens || 0, null, "App opens that week", pr ? countChip(r.league?.opens || 0, pr.league?.opens || 0) : chip(null))}
          ${kp("time in app", dur(r.league?.timeMs || 0), null, "Total time in the app that week", chip(pr && pr.league?.timeMs ? pct(r.league?.timeMs || 0, pr.league.timeMs) : null, "%"))}
        </div>
        <div class="ld-fh five"><span>OWNER</span><span>DAYS</span><span>OPENS</span><span>TIME</span><span>MOST USED</span></div>
        ${rows.map(({ n, x, px }) => `<div class="ld-fr five" ${tip(`${n} · week of ${wkLab(k)} · ${x.days || 0} days, ${x.opens || 0} opens, ${dur(x.timeMs || 0)}${px ? ` · week before: ${px.days || 0} days` : ""}${x.fails ? ` · ${x.fails} failed loads` : ""}`)}><span>${esc(n)}</span><em>${x.days || 0}/7${px && px.days != null && x.days !== px.days ? ` <i class="ld-d ${x.days > px.days ? "up" : "dn"}">${x.days > px.days ? "▲" : "▼"}${Math.abs((x.days || 0) - (px.days || 0))}</i>` : ""}</em><em>${x.opens || 0}</em><em>${dur(x.timeMs || 0)}</em><em>${esc(topF(x))}</em></div>`).join("")}`;
    };
    const pastKeys = rk.slice(-6).reverse();

    // ---- Nudges: did they work? ----
    const nudgeOut = (nudgeLog || []).slice(0, 8).map((ng) => {
      const end = ng.at + 12 * HR;
      const res = (ng.who || []).map((w) => {
        const p = people.find((x) => x.n === w.n);
        const back = !!p && (p.opens.some((v) => v.at > ng.at && v.at <= end) || p.sess.some((x) => x.at > ng.at && x.at <= end));
        const picked = w.why === "picks" ? log.some((r) => r.manager === w.n && r.ts > ng.at && r.ts <= end) : null;
        return { ...w, back, picked };
      });
      return { ng, res };
    });
    const nTot = nudgeOut.reduce((a, x) => a + x.res.length, 0), nBack = nudgeOut.reduce((a, x) => a + x.res.filter((r) => r.back).length, 0);
    const nPk = nudgeOut.flatMap((x) => x.res.filter((r) => r.why === "picks")), nPkDone = nPk.filter((r) => r.picked).length;
    const nudgeHtml = nudgeOut.length ? `<div class="lvz-h">DID THE NUDGES WORK · WITHIN 12 HOURS</div>
      <div class="lvz-cap">${nBack} of ${nTot} nudged came back${nPk.length ? `; ${nPkDone} of ${nPk.length} short on picks saved some` : ""}.</div>
      ${nudgeOut.map(({ ng, res }) => `<div class="ld-ng"><span>${esc(dayLong(ng.at))} ${esc(timeLab(ng.at))}</span><div>${res.map((r) => `<em class="${r.back ? "ok" : "no"}" ${tip(`${r.n} · nudged for ${r.why === "picks" ? "picks" : "being quiet"} · ${r.back ? "came back" : "didn't come back"} within 12h${r.picked != null ? ` · ${r.picked ? "saved picks" : "no picks saved"}` : ""}`)}>${esc(r.n)} ${r.back ? "✓" : "✗"}${r.picked != null ? (r.picked ? " · picks ✓" : " · picks ✗") : ""}</em>`).join("")}</div></div>`).join("")}` : "";

    // ---- HEALTH: errors, failed and slow loads, time to usable ----
    const sAll = people.flatMap((p) => p.sess.map((x) => ({ p, x })));
    const s7h = sAll.filter(({ x }) => x.at >= today0 - 6 * DAY), s7p = sAll.filter(({ x }) => x.at >= today0 - 13 * DAY && x.at < today0 - 6 * DAY);
    const errPct = (arr) => arr.length ? Math.round(arr.filter(({ x }) => x.h.e).length / arr.length * 100) : null;
    const errN = (arr) => arr.filter(({ x }) => x.h.e).length;

    // Coverage: an open is counted the moment the app comes up; the visit
    // record (time, features, health) only when it is put away. Phones can
    // drop that last send, so match each open to a visit and say how many
    // have one. Opens in the last half hour are left out (still in progress).
    const covA = Math.max(sessSince, d28[0]), covB = now - 30 * 60000;
    const cov = people.flatMap((p) => p.opens.filter((v) => v.at >= covA && v.at < covB).map((v) => ({ p, v, ok: p.sess.some((x) => x.at <= v.at + 10 * 60000 && x.at + x.dur >= v.at - 60000) })));
    const covOk = cov.filter((c) => c.ok).length;
    const covBy = (f) => { const a = cov.filter(f); return { n: a.length, ok: a.filter((c) => c.ok).length }; };
    const covKinds = [["home-screen app", (c) => c.v.app === "home"], ["browser", (c) => c.v.app !== "home"]].map(([l, f]) => ({ l, ...covBy(f), kind: true })).filter((x) => x.n);
    const covPeople = people.map((p) => ({ l: p.n, ...covBy((c) => c.p === p) })).filter((x) => x.n).sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n);
    const covRatio = cov.length ? covOk / cov.length : 1;
    const covHtml = cov.length ? `<div class="lvz-h">IS THE DATA COMPLETE · SINCE ${esc(dayLong(covA).toUpperCase())}</div>
      <div class="ld-head"><b>${covOk} of ${cov.length}</b> opens have a visit record${cov.length >= 10 ? ` (${Math.round(covRatio * 100)}%)` : ""}. ${covRatio >= 0.9 ? "Time and feature numbers are close to complete." : `Time, feature and gamecast numbers undercount by about ${Math.round((1 - covRatio) * 100)}%.`}</div>
      <div class="lvz-feat">${[...covKinds, ...covPeople].map((x) => `<div class="lvz-fb${x.kind ? " on" : ""}" ${tip(`${x.l} · ${x.ok} of ${x.n} opens have a visit record`)}><span>${esc(x.l)}</span><i><b style="width:${(x.ok / Math.max(1, x.n) * 100).toFixed(0)}%"></b></i><em>${x.ok}/${x.n}</em></div>`).join("")}</div>
      <div class="lvz-cap">A visit record is sent when the app is put away. It's missing when the app was closed within 3 seconds, or the phone ended the app before it could send. Opens and visits with no signal are now held on the phone and sent later.</div>` : "";
    if (cov.length >= 10 && covRatio < 0.85) add(covRatio < 0.6 ? "ACTION" : "NOTE", 57, `Only ${covOk} of ${cov.length} opens have a visit record, so time, feature and gamecast numbers undercount; see HEALTH.`);
    const fails = (arr, b) => arr.reduce((a, { x }) => a + (b ? x.h.ff[b] : x.h.ff.espn + x.h.ff.worker), 0);
    const slows = (arr) => arr.reduce((a, { x }) => a + x.h.sl.espn + x.h.sl.worker, 0);
    const ldMed = (arr) => median(arr.map(({ x }) => x.h.ld).filter(Number.isFinite));
    const sec = (ms) => ms == null ? "-" : `${(ms / 1000).toFixed(1)}s`;
    const fpd = d28.map((d) => sAll.filter(({ x }) => x.at >= d && x.at < d + DAY));
    const fmaxD = Math.max(1, ...fpd.map((a) => fails(a)));
    const failBars = d28.map((d, i) => { const e = fails(fpd[i], "espn"), w = fails(fpd[i], "worker"); return `<i class="ld-fb2${gdSet.has(d) ? " gd" : ""}" ${tip(`${dayLong(d)} · ${e} ESPN and ${w} server load${e + w === 1 ? "" : "s"} failed · ${fpd[i].length} visits${fpd[i].filter(({ x }) => x.h.e).length ? ` · ${fpd[i].filter(({ x }) => x.h.e).length} with an error` : ""}`)}><b class="e" style="height:${(e / fmaxD * 100).toFixed(0)}%"></b><b class="w" style="height:${(w / fmaxD * 100).toFixed(0)}%"></b></i>`; }).join("");
    const s28 = sAll.filter(({ x }) => x.at >= d28[0]);
    const byBuild = new Map();
    for (const it of s28) { const k = it.x.v || "unknown"; const e = byBuild.get(k) || []; e.push(it); byBuild.set(k, e); }
    const buildRows = [...byBuild.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([v, arr]) => `<div class="ld-fr five" ${tip(`Build ${v === "unknown" ? "unknown" : buildLab(v)} · ${new Set(arr.map(({ p }) => p.n)).size} people (${[...new Set(arr.map(({ p }) => p.n))].join(", ")}) · ${arr.length} visits`)}><span>${v === "unknown" ? "unknown" : esc(buildLab(v))}${v === buildNow ? ` <i class="ld-cur">CURRENT</i>` : ""}</span><em>${new Set(arr.map(({ p }) => p.n)).size}</em><em>${shareCell(errN(arr), arr.length)}</em><em>${fails(arr)}</em><em>${sec(ldMed(arr))}</em></div>`).join("");
    const personH = people.map((p) => { const arr = s28.filter((it) => it.p === p); return { p, arr }; }).sort((a, b) => fails(b.arr) + b.arr.filter(({ x }) => x.h.e).length - fails(a.arr) - a.arr.filter(({ x }) => x.h.e).length);
    const personRows = personH.map(({ p, arr }) => `<div class="ld-fr five" ${tip(`${p.n} · ${arr.length} visits in 28 days · ${p.appKind}${p.device ? ` · device ${p.device.slice(0, 6)}` : ""}${p.ver ? ` · build ${buildLab(p.ver)}` : ""}`)}><span>${esc(p.n)}</span><em>${arr.filter(({ x }) => x.h.e).length}</em><em>${fails(arr, "espn")}</em><em>${fails(arr, "worker")}</em><em>${sec(ldMed(arr))}</em></div>`).join("");
    const errMsgs = new Map();
    for (const { p, x } of s28) for (const m of x.h.em) { const e = errMsgs.get(m) || { n: 0, last: 0, who: new Set(), v: new Set() }; e.n++; e.last = Math.max(e.last, x.at); e.who.add(p.n); if (x.v) e.v.add(x.v); errMsgs.set(m, e); }
    const errHtml = errMsgs.size ? [...errMsgs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([m, e]) => `<div class="ld-err" ${tip(`Seen in ${e.n} visit${e.n === 1 ? "" : "s"} · ${[...e.who].join(", ")} · builds ${[...e.v].map(buildLab).join(", ") || "unknown"} · last ${dayLong(e.last)} ${timeLab(e.last)}`)}><code>${esc(m)}</code><em>${e.n}× · ${esc(dayLong(e.last))}</em></div>`).join("") : `<div class="lvz-empty">No errors recorded${sAll.length ? "" : " yet (health is recorded from the new build on)"}.</div>`;
    const healthView = `${covHtml}<div class="lvz-h">ERRORS AND LOADS</div><div class="ld-kpis">
        <div ${tip(`Visits in the last 7 days with at least one app error: ${errN(s7h)} of ${s7h.length}. The 7 days before: ${errN(s7p)} of ${s7p.length}.`)}><b>${shareTile(errN(s7h), s7h.length)}</b><span>visits with an error</span>${!s7p.length ? chip(null) : s7h.length >= 10 && s7p.length >= 10 ? chip(errPct(s7h) - errPct(s7p), " pts", true) : chip(errN(s7h) - errN(s7p), "", true)}</div>
        <div ${tip(`Data loads that failed in 7 days: ${fails(s7h, "espn")} from ESPN, ${fails(s7h, "worker")} from our server.`)}><b>${fails(s7h)}</b><span>failed loads · ESPN ${fails(s7h, "espn")} · server ${fails(s7h, "worker")}</span>${s7p.length ? chip(fails(s7h) - fails(s7p), "", true) : chip(null)}</div>
        <div ${tip("Median time from opening the app to the first screen with data, over 7 days.")}><b>${sec(ldMed(s7h))}</b><span>to usable (median)</span>${s7p.length && ldMed(s7h) != null && ldMed(s7p) != null ? chip(Math.round((ldMed(s7h) - ldMed(s7p)) / 100) / 10, "s", true) : chip(null)}</div>
        <div ${tip("Loads that took longer than 4 seconds, over 7 days.")}><b>${slows(s7h)}</b><span>slow loads (over 4s)</span>${s7p.length ? chip(slows(s7h) - slows(s7p), "", true) : chip(null)}</div>
      </div>
      <div class="lvz-h">FAILED LOADS EACH DAY · <i class="ld-key-e"></i> ESPN · <i class="ld-key-w"></i> SERVER · <i class="ld-key-gd"></i> GAME DAY</div>
      <div class="ld-dau"><div class="ld-dbars fail" ${colsStyle}>${failBars}</div>${dayAxis()}</div>
      <div class="lvz-h">BY BUILD · ${winLab}</div>
      <div class="ld-fh five"><span>BUILD</span><span>PEOPLE</span><span>ERR VISITS</span><span>FAILS</span><span>TO USABLE</span></div>${buildRows || `<div class="lvz-empty">No visits on record yet.</div>`}
      <div class="lvz-h">BY PERSON · ${winLab}</div>
      <div class="ld-fh five"><span>OWNER</span><span>ERR VISITS</span><span>ESPN FAILS</span><span>SERVER FAILS</span><span>TO USABLE</span></div>${personRows}
      <div class="lvz-h">ERRORS SEEN</div>${errHtml}
      <div class="lvz-cap">Health is recorded from the new build on (since ${esc(dayLong(sessSince))}). Phones that are offline count as failed loads too.</div>
      <div class="lvz-h">EXPORT</div>
      <div class="ld-sort">${[["opens", "OPENS CSV"], ["sessions", "VISITS CSV"], ["weekly", "WEEKLY CSV"]].map(([k, l]) => `<button type="button" data-csv="${k}">${l}</button>`).join("")}</div>`;
    // Health in the story.
    if (fails(s7h) >= 5) add(fails(s7h, "espn") > fails(s7h, "worker") ? "TREND" : "ACTION", 62, `${fails(s7h)} data loads failed in the last 7 days (ESPN ${fails(s7h, "espn")}, our server ${fails(s7h, "worker")})${s7p.length ? `, against ${fails(s7p)} in the 7 days before` : ""}.`);
    const curB = buildNow ? byBuild.get(buildNow) : null;
    if (curB && errN(curB) >= 2 && errN(curB) / curB.length >= 0.1) add("ACTION", 66, `The current build has an error in ${share(errN(curB), curB.length, "visits")}; see HEALTH.`);
    if (releases.length) { const [v, t] = releases[releases.length - 1]; const before = people.reduce((a, p) => a + p.sess.filter((x) => x.at >= t - 7 * DAY && x.at < t).reduce((s2, x) => s2 + x.dur, 0), 0), after = people.reduce((a, p) => a + p.sess.filter((x) => x.at >= t && x.at < t + 7 * DAY).reduce((s2, x) => s2 + x.dur, 0), 0); if (before > 0 && now - t >= 3 * DAY) add("NOTE", 34, `Since the ${buildLab(v)} build, time in the app is ${after >= before ? "up" : "down"} ${Math.abs(pct(after, before))}% against the week before it.`); }
    story.sort((a, b) => tagOrder[a.tag] - tagOrder[b.tag] || b.w - a.w);

    // ---- CSV export ----
    const csvEsc = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const toCsv = (rows) => rows.map((r) => r.map(csvEsc).join(",")).join("\n");
    const csv = (kind) => {
      if (kind === "opens") return toCsv([["owner", "time", "app", "build", "device"], ...people.flatMap((p) => p.opens.map((v) => [p.n, new Date(v.at).toISOString(), v.app || "", v.v || "", v.device || ""]))]);
      if (kind === "sessions") return toCsv([["owner", "start", "seconds", "features", "build", "errors", "espn_fails", "server_fails", "load_ms"], ...people.flatMap((p) => p.sess.map((x) => [p.n, new Date(x.at).toISOString(), Math.round(x.dur / 1000), x.f.join(" "), x.v || "", x.h.e, x.h.ff.espn, x.h.ff.worker, x.h.ld ?? ""]))]);
      return toCsv([["week_of", "owner", "days", "opens", "minutes", "visits", "error_visits", "failed_loads", "load_ms", "partial"], ...rk.flatMap((k) => names.map((n) => { const x = rollups[k].people?.[n] || {}; return [k, n, x.days || 0, x.opens || 0, Math.round((x.timeMs || 0) / 60000), x.sessions || 0, x.errSessions || 0, x.fails || 0, x.loadMs ?? "", rollups[k].partial ? "yes" : ""]; }))]);
    };

    // ---- Chart headlines: each chart leads with what it shows ----
    const punchHeadOf = (grid) => { let b = { n: 0 }; grid.forEach((row, d) => row.forEach((n, h) => { const w = n + (row[(h + 1) % 24] || 0) + (row[(h + 2) % 24] || 0); if (w > b.n) b = { n: w, d, h }; })); return b.n > 0 ? `Busiest stretch: <b>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][b.d]} ${hourLab(b.h)}-${hourLab((b.h + 3) % 24)}</b>, ${b.n} opens on record.` : ""; };
    const fullWeeks = trend.filter((w) => !w.live && !w.partial);
    const seasonHtml = fullWeeks.length >= 3
      ? `<div class="ld-trend">${trendHtml}</div>`
      : (() => { const lw = trend.filter((w) => !w.live).slice(-1)[0]; const tw = trend.find((w) => w.live); return `<div class="ld-wkcmp">${lw ? `<div><span>Week of ${wkLab(lw.k)}${lw.partial ? ` (from ${esc(dayLong(opensSince).replace(/^\w+, /, ""))})` : ""}</span><b>${lw.active}<small>/${N}</small></b><em>${lw.opens} opens · ${dur(lw.timeMs)}</em></div>` : ""}${tw ? `<div class="now"><span>This week so far</span><b>${tw.active}<small>/${N}</small></b><em>${tw.opens} opens · ${dur(tw.timeMs)}</em></div>` : ""}</div><div class="lvz-cap">The week-by-week chart appears once three full weeks are on record.</div>`; })();

    // ---- The two weeks, person by day ----
    // Last week and this week, Monday first, one row per owner. Each cell is
    // shaded by time in the app that day (one cyan ramp, four steps); a dot
    // means they saved picks that day. Game days are underlined in gold,
    // days before tracking began are hatched so they never read as "out".
    const rDays = Array.from({ length: 14 }, (_, i) => { const d = new Date(wkP0); d.setDate(d.getDate() + i); return d.getTime(); });
    const trackedFrom = day0(Math.min(opensSince, now));
    const tStep = (inDay, ms) => !inDay ? 0 : ms >= 30 * 60000 ? 4 : ms >= 10 * 60000 ? 3 : ms >= 2 * 60000 ? 2 : 1;
    const cellOf = (p, d) => {
      const e = d + DAY;
      const o = p.opens.filter((v) => v.at >= d && v.at < e).length;
      const ss = p.sess.filter((x) => x.at >= d && x.at < e);
      const ms = ss.reduce((a, x) => a + x.dur, 0);
      const pk = log.filter((r) => r.manager === p.n && r.ts >= d && r.ts < e).length;
      const gc = ss.some((x) => x.f.includes("gamecast"));
      return { d, in: p.days.has(d), o, ms, pk, gc };
    };
    const rRows = people.map((p) => {
      const cells = rDays.map((d) => cellOf(p, d));
      return { p, cells, tw: cells.slice(7).filter((c) => c.in).length, lw: cells.slice(0, 7).filter((c) => c.in).length };
    }).sort((a, b) => b.tw - a.tw || b.lw - a.lw || names.indexOf(a.p.n) - names.indexOf(b.p.n));
    const rCount = rDays.map((d, i) => rRows.filter((r) => r.cells[i].in));
    const rHead = rDays.map((d, i) => {
      const rel = releases.filter(([, t]) => day0(t) === d);
      return `<span class="ld-rh${gdSet.has(d) ? " gd" : ""}${d === today0 ? " today" : ""}" ${tip(`${dayLong(d)}${gdSet.has(d) ? " · game day" : ""}${rel.length ? ` · new build ${rel.map(([v]) => buildLab(v)).join(", ")}` : ""}`)}>${rel.length ? "<b>▲</b>" : ""}${new Date(d).toLocaleDateString([], { weekday: "narrow" })}</span>${i === 6 ? "<span></span>" : ""}`;
    }).join("");
    const rBody = rRows.map((r) => `<span class="ld-rn">${esc(r.p.n)}</span>${r.cells.map((c, i) => {
      const fut = c.d > today0, nt = c.d < trackedFrom;
      const noRec = c.in && c.d < day0(sessSince);
      const cls = fut ? "fut" : nt ? "nt" : noRec ? "nr" : `s${tStep(c.in, c.ms)}`;
      const t = fut ? `${r.p.n} · ${dayLong(c.d)} · still to come` : nt ? `${r.p.n} · ${dayLong(c.d)} · before tracking began` : !c.in ? `${r.p.n} · ${dayLong(c.d)} · not in` : `${r.p.n} · ${dayLong(c.d)} · ${c.o} open${c.o === 1 ? "" : "s"}${noRec ? " · time not recorded yet" : c.ms ? ` · ${dur(c.ms)} in the app` : ""}${c.pk ? ` · saved picks (${c.pk})` : ""}${c.gc ? " · watched a gamecast" : ""}`;
      return `<i class="ld-rc ${cls}${c.pk && !fut ? " pk" : ""}" ${tip(nt && c.pk ? `${t} · saved picks (${c.pk})` : t)}></i>${i === 6 ? "<span></span>" : ""}`;
    }).join("")}<em class="ld-rt" ${tip(`${r.p.n} · ${r.lw} of 7 days last week · ${r.tw} of ${dayN} so far this week`)}>${r.lw}<small> · </small>${r.tw}</em>`).join("");
    const rFoot = rDays.map((d, i) => { const c = rCount[i].length, fut = d > today0, nt = d < trackedFrom; const ms = rRows.reduce((a, r) => a + r.cells[i].ms, 0); return `<span class="ld-rf${c === N ? " all" : ""}" ${tip(fut || nt ? dayLong(d) : `${dayLong(d)} · ${c} of ${N} in${c ? `: ${rCount[i].map((r) => r.p.n).join(", ")}` : ""}${ms ? ` · ${dur(ms)} in all` : ""}`)}>${fut || nt ? "" : c}</span>${i === 6 ? "<span></span>" : ""}`; }).join("");
    // What the grid says, in plain lines. Tracked, finished-or-today days only.
    const rSeen = rDays.map((d, i) => ({ d, i })).filter(({ d }) => d >= trackedFrom && d <= today0);
    const rGd = rSeen.filter(({ d }) => gdSet.has(d)), rOff = rSeen.filter(({ d }) => !gdSet.has(d) && d < today0);
    const avgIn = (xs) => xs.length ? xs.reduce((a, { i }) => a + rCount[i].length, 0) / xs.length : null;
    // Patterns need enough days to mean anything: "only on game days" needs
    // three finished days without a game; "most days" a full tracked week
    // and five of its last seven.
    const gdOnly = rOff.length >= 3 ? rRows.filter((r) => { const ins = rSeen.filter(({ i }) => r.cells[i].in); return ins.length && ins.every(({ d }) => gdSet.has(d)); }).map((r) => r.p.n) : [];
    const last7 = rSeen.slice(-7);
    const steady = last7.length >= 7 ? rRows.filter((r) => last7.filter(({ i }) => r.cells[i].in).length >= 5).map((r) => r.p.n) : [];
    const absent = rRows.filter((r) => rSeen.length && !rSeen.some(({ i }) => r.cells[i].in)).map((r) => r.p.n);
    const saveDow = new Array(7).fill(0); for (const r of log) if (Number.isFinite(r.ts)) saveDow[(new Date(r.ts).getDay() + 6) % 7]++;
    const saveTot = saveDow.reduce((a, b) => a + b, 0), saveTop = saveDow.indexOf(Math.max(...saveDow));
    const rLines = [
      rGd.length && rOff.length ? `Game days bring in <b>${avgIn(rGd).toFixed(1)}</b> of ${N} on average; other days <b>${avgIn(rOff).toFixed(1)}</b>.` : "",
      gdOnly.length ? `Only on game days: ${list(gdOnly.map(B))}, across ${rOff.length} other days on record.` : "",
      steady.length ? `In 5 or more of the last 7 days: ${list(steady.map(B))}.` : "",
      absent.length ? `Not in at all ${rSeen.length < 14 ? `since ${esc(dayLong(rSeen[0].d))}` : "in two weeks"}: ${list(absent.map(B))}.` : "",
      saveTot >= 5 ? `Picks get saved most on <b>${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][saveTop]}</b> (${share(saveDow[saveTop], saveTot, "saves")}).` : "",
    ].filter(Boolean);
    const rhythmHtml = `<div class="lvz-h">TWO WEEKS, PERSON BY DAY</div>
      ${rLines.length ? `<ul class="ld-rl">${rLines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
      <div class="ld-rg">
        <span></span><span class="ld-rw">LAST WEEK</span><span></span><span class="ld-rw">THIS WEEK</span><span class="ld-rw r">DAYS</span>
        <span></span>${rHead}<span class="ld-rh r">LW · TW</span>
        ${rBody}
        <span class="ld-rn dim">people in</span>${rFoot}<span></span>
      </div>
      <div class="ld-legend ld-rkey"><span><i class="ld-rc s1"></i><i class="ld-rc s2"></i><i class="ld-rc s3"></i><i class="ld-rc s4"></i>under 2m to 30m+</span><span><i class="ld-rc s2 pk"></i>saved picks</span><span><i class="ld-key-gd"></i>game day</span>${rRows.some((r) => r.cells.some((c) => c.in && c.d < day0(sessSince) && c.d >= trackedFrom)) ? `<span><i class="ld-rc nr"></i>in, time not recorded</span>` : ""}<span><i class="ld-rc nt"></i>not tracked yet</span></div>`;

    // ---- PULSE ----
    const punch = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const p of people) for (const v of p.opens) { const d = new Date(v.at); punch[(d.getDay() + 6) % 7][d.getHours()]++; }
    const pmax = Math.max(1, ...punch.flat());
    const pstep = (n) => n <= 0 ? 0 : Math.min(4, 1 + Math.floor((n / pmax) * 3.999));
    const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const punchHtml = punch.map((row, d) => `<span class="lvz-pd">${wd[d].slice(0, 2).toUpperCase()}</span>${row.map((n, h) => `<i class="lvz-p s${pstep(n)}" ${tip(`${wd[d]} ${hourLab(h)}-${hourLab((h + 1) % 24)} · ${n} open${n === 1 ? "" : "s"} on record`)}></i>`).join("")}`).join("");
    const tagCls = { ACTION: "act", TREND: "trend", NOTE: "note" };
    const lastWkTo = `${new Date(nowP).toLocaleDateString([], { weekday: "short" })} ${timeLab(nowP)}`;
    const pulseLive = `<div class="lvz-h">THIS WEEK · ${esc(dayLong(wk0).toUpperCase())} TO NOW · VS LAST WEEK TO ${esc(lastWkTo.toUpperCase())}</div>
      <div class="ld-kpis">
        <div ${tip(`People in at least once ${sinceMon}. Last week by ${lastWkTo}: ${priorWk ? actWP : "not tracked yet"}.`)}><b>${actW}<small>/${N}</small></b><span>active ${sinceMon}</span>${chip(priorWk ? actW - actWP : null)}</div>
        <div ${tip(`Average days each person was in, out of the ${dayN} day${dayN === 1 ? "" : "s"} so far this week. Last week by ${lastWkTo}: ${priorWk ? avgWP.toFixed(1) : "not tracked yet"}.`)}><b>${avgW.toFixed(1)}<small>/${dayN}</small></b><span>days in, per person</span>${chip(priorWk ? Math.round((avgW - avgWP) * 10) / 10 : null)}</div>
        <div ${tip(`App opens ${sinceMon}. Last week by ${lastWkTo}: ${priorWk ? opensWP : "not tracked yet"}.`)}><b>${opensW}</b><span>opens ${sinceMon}</span>${priorWk ? countChip(opensW, opensWP) : chip(null)}</div>
        <div ${tip(`Time in the app ${sinceMon}, from visit records. Last week by ${lastWkTo}: ${priorWkSess ? dur(timeWP) : "not tracked yet"}.`)}><b>${dur(timeW)}</b><span>time in app${sessW.length ? ` · ${dur(timeW / sessW.length)} a visit` : ""}</span>${chip(priorWkSess && timeWP ? pct(timeW, timeWP) : null, "%")}</div>
      </div>
      ${story.length ? `<div class="lvz-h">THIS WEEK'S STORY</div><ul class="ld-story">${story.slice(0, 9).map((s) => `<li><em class="ld-tag ${tagCls[s.tag]}">${s.tag}</em><span>${s.html}</span></li>`).join("")}</ul>` : ""}
      ${nudges.length ? `<div class="lvz-nudge"><div class="lvz-h">WHO TO NUDGE</div>${nudges.map((x) => `<div class="lvz-nr"><b>${esc(x.n)}</b><span>${esc(x.why)}</span></div>`).join("")}<button type="button" class="admin-btn lvz-copy" data-text="${esc(nudgeText)}" data-who="${esc(JSON.stringify(nudges.map((x) => ({ n: x.n, why: x.kind }))))}">Copy message for the chat</button></div>` : ""}
      ${nudgeHtml}
      ${rhythmHtml}
      <div class="lvz-h">SEASON · WEEK BY WEEK</div>
      ${seasonHtml}
      <div class="lvz-h">WHEN THE LEAGUE IS IN · DAY BY HOUR, SINCE ${esc(dayLong(opensSince).toUpperCase())}</div>
      ${punchHeadOf(punch) ? `<div class="ld-head">${punchHeadOf(punch)}</div>` : ""}
      <div class="lvz-punch">${punchHtml}<span></span><div class="lvz-pax"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div></div>`;
    const pulse = `${pastKeys.length ? `<div class="ld-sort"><span>WEEK</span><button type="button" data-pulseweek="live" class="on">THIS WEEK</button>${pastKeys.map((k) => `<button type="button" data-pulseweek="${k}">WK OF ${wkLab(k)}</button>`).join("")}</div>` : ""}<div class="ld-pulse-live">${pulseLive}</div><div class="ld-pulse-past" hidden></div>`;

    // ---- PEOPLE ----
    const peopleRow = (p) => {
      const dots = Array.from({ length: 7 }, (_, i) => `<i class="${p.days.has(today0 - (6 - i) * DAY) ? "on" : ""}"></i>`).join("");
      const f = flips.get(p.n);
      return `<button type="button" class="ld-pr" data-person="${esc(p.n)}" data-sort-l7="${p.L7}" data-sort-last="${p.lastAt}" data-sort-time="${p.time7}" data-sort-pts="${pts.get(p.n) ?? -1}">
        <b>${esc(p.n)}</b><span class="ld-l7" ${tip(`${p.n} · in ${p.L7} of the last 7 days`)}>${dots}</span>${priorCovered ? chip(p.L7 - p.L7p) : `<em class="ld-d flat"></em>`}<span class="ld-num">${p.w7.opens.length}</span><span class="ld-num">${dur(p.time7)}</span><span class="ld-ago">${p.lastAt ? esc(ago(p.lastAt).replace(" ago", "")) : "never"}</span>
      </button><div class="ld-drill" data-for="${esc(p.n)}" hidden></div>`;
    };
    const drill = (n) => {
      const p = people.find((x) => x.n === n); if (!p) return "";
      const cal = d28.map((d) => { const c = p.opens.filter((v) => day0(v.at) === d).length; return `<i class="lvz-c s${c <= 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 7 ? 3 : 4}${gdSet.has(d) ? " gd" : ""}" ${tip(`${dayLong(d)} · ${c} open${c === 1 ? "" : "s"}${gdSet.has(d) ? " · game day" : ""}`)}></i>`; }).join("");
      const hrs = new Array(24).fill(0); for (const v of p.opens) hrs[new Date(v.at).getHours()]++;
      const hm = Math.max(1, ...hrs);
      const hourBars = hrs.map((c, h) => `<i ${tip(`${hourLab(h)} · ${c} open${c === 1 ? "" : "s"}`)}><b style="height:${(c / hm * 100).toFixed(0)}%"></b></i>`).join("");
      const fu = new Map(); for (const x of p.sess.filter((y) => y.at >= now - 14 * DAY)) for (const k of new Set(x.f.map((y) => String(y).replace(/-g\d+$/, "")))) if (ldFeat(k)) fu.set(k, (fu.get(k) || 0) + 1);
      const feats = [...fu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `<span>${esc(ldFeat(k))} · ${c}</span>`).join("") || `<span class="dim">no sessions yet on the new build</span>`;
      const f = flips.get(n), lm = median(leadBy.get(n) || []), ed = editsBy.get(n) || [];
      const pk = picksNow?.[n]?.picks || {}, tot = slateOf(curWeek).length, have = slateOf(curWeek).filter((g) => pk[g.id]).length;
      const rank = [...pts.entries()].sort((a, b) => b[1] - a[1]).findIndex(([m]) => m === n) + 1;
      const facts = [
        ["Last in", p.lastAt ? `${dayLong(p.lastAt)} ${timeLab(p.lastAt)}` : "never"],
        ["Days in", `${p.L7}/7 in the last 7 days${priorCovered ? `, ${p.L7p}/7 in the 7 before` : ""}`],
        ["This week", `${p.dW}/${dayN} days since Monday${priorWk ? `, ${p.dWP}/${dayN} by this point last week` : ""}`],
        ["Visits", p.w7.sess.length ? `${p.w7.sess.length} in the last 7 days, ${dur(p.time7 / p.w7.sess.length)} each` : `${p.w7.opens.length} opens in the last 7 days`],
        ["Device", `${p.appKind}${p.device ? ` · ${p.device.slice(0, 6)}` : ""}`],
        ["Build", p.ver ? `${p.ver.slice(4, 8)}·${p.ver.slice(8, 12)}${buildNow ? (p.ver === buildNow ? " · current" : " · behind") : ""}` : "unknown"],
        ["Picks", `${have}/${tot} for week ${curWeek}`],
        ["Lead time", lm != null ? `${lead(lm)} before lock (median)` : "-"],
        ["Changes", ed.length ? `${(ed.reduce((a, b) => a + b, 0) / ed.length).toFixed(1)} a week${f ? ` · net ${f.net >= 0 ? "+" : ""}${f.net} pts from ${f.n} switch${f.n === 1 ? "" : "es"}` : ""}` : "-"],
        ["Season", pts.has(n) ? `${pts.get(n)} pts${rank ? ` · ${rank}${["th", "st", "nd", "rd"][rank % 10 > 3 || [11, 12, 13].includes(rank % 100) ? 0 : rank % 10]}` : ""}` : "-"],
      ];
      return `<div class="ld-dgrid">${facts.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join("")}</div>
        <div class="lvz-h">${winLab}</div><div class="ld-cal" style="grid-template-columns:repeat(${Math.min(14, spanD)},minmax(0,1fr))">${cal}</div>
        <div class="lvz-h">TIME OF DAY</div><div class="ld-hours">${hourBars}</div><div class="lvz-pax solo"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
        <div class="lvz-h">USES MOST · VISITS, 14 DAYS</div><div class="lvz-pr3">${feats}</div>`;
    };
    // Engagement against results.
    const dots = people.map((p) => ({ n: p.n, x: p.opens.length, y: pts.get(p.n) })).filter((d) => Number.isFinite(d.y));
    let scatter = `<div class="lvz-empty">Needs finished weeks with results.</div>`, rWord = "";
    if (dots.length >= 4) {
      const xs = dots.map((d) => d.x), ys = dots.map((d) => d.y), xMax = Math.max(1, ...xs), yMin = Math.min(...ys), yr = Math.max(1, Math.max(...ys) - yMin);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const cv = dots.reduce((a, d) => a + (d.x - mx) * (d.y - my), 0), vx = dots.reduce((a, d) => a + (d.x - mx) ** 2, 0), vy = dots.reduce((a, d) => a + (d.y - my) ** 2, 0);
      const r = vx && vy ? cv / Math.sqrt(vx * vy) : 0;
      rWord = Math.abs(r) < 0.2 ? "no real link" : `${Math.abs(r) < 0.5 ? "a weak" : "a fairly strong"} ${r > 0 ? "positive" : "negative"} link`;
      scatter = `<div class="lvz-sc"><span class="lvz-sc-y">${Math.max(...ys)}</span><span class="lvz-sc-y lo">${yMin}</span>${dots.map((d) => `<i class="lvz-sd" style="left:${(6 + d.x / xMax * 88).toFixed(1)}%;top:${(90 - (d.y - yMin) / yr * 80).toFixed(1)}%" ${tip(`${d.n} · ${d.x} opens · ${d.y} season points`)}><b>${esc(d.n.slice(0, 3).toUpperCase())}</b></i>`).join("")}</div>
        <div class="lvz-sc-x"><span>0 opens</span><span>${xMax} opens</span></div>
        <div class="lvz-cap">Season points (up) against app opens since ${esc(dayLong(opensSince))} (across). ${dots.length} owners, r = ${r.toFixed(2)}: ${rWord}. A pattern, not a cause.</div>`;
    }
    const peopleView = `<div class="ld-sort"><span>SORT</span>${[["l7", "DAYS IN"], ["last", "LAST SEEN"], ["time", "TIME"], ["pts", "POINTS"]].map(([k, l], i) => `<button type="button" data-sort="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="ld-ph"><span>OWNER</span><span>LAST 7 DAYS</span><span>VS LAST WK</span><span>OPENS</span><span>TIME</span><span>LAST</span></div>
      <div class="ld-people">${[...people].sort((a, b) => b.L7 - a.L7 || b.lastAt - a.lastAt).map(peopleRow).join("")}</div>
      <div class="lvz-cap">Tap a name for their full picture.</div>
      <div class="lvz-h">ENGAGEMENT VS RESULTS</div>${scatter}`;

    // ---- GAME DAY ----
    const gdChoices = gameDays.slice(-4).reverse();
    const gameView = gdChoices.length ? `<div class="ld-sort"><span>DAY</span>${gdChoices.map((d, i) => `<button type="button" data-gameday="${d}" class="${i === 0 ? "on" : ""}">${esc(dayLong(d).toUpperCase())}</button>`).join("")}</div><div class="ld-gdbody">${gameDayView(gdChoices[0]).html}</div>` : `<div class="lvz-empty">No game days on record yet.</div>`;

    // ---- FEATURES ----
    const fmaxN = N;
    const gcHead = !gcGameDays.length
      ? `No games have been played since sessions started recording (${esc(dayLong(sessSince))}). This fills in after the next game day.`
      : gcUsers.length
        ? `${B(`${gcUsers.length} of ${N}`)} have opened a live gamecast. ${inGameSess.length ? `${share(gcInGame, inGameSess.length, "visits during games")} included one.` : ""}`
        : `${B("Nobody")} has opened a live gamecast yet, across ${gcGameDays.length} game day${gcGameDays.length === 1 ? "" : "s"} and ${inGameSess.length} visit${inGameSess.length === 1 ? "" : "s"} while games were on.`;
    const gcMaxDay = Math.max(1, ...gcByDay.map((x) => x.ms));
    const gcView = `<div class="lvz-h">GAMECAST · DOES ANYONE OPEN IT</div>
      <div class="ld-head">${gcHead}</div>
      <div class="lvz-tiles">
        <div ${tip(`Opened a live gamecast at least once: ${gcUsers.map((x) => x.n).join(", ") || "nobody"}`)}><b>${gcUsers.length}<small>/${N}</small></b><span>people</span></div>
        <div ${tip(`${gcInGame} of ${inGameSess.length} visits that overlapped a game opened a live gamecast`)}><b>${shareTile(gcInGame, inGameSess.length)}</b><span>in-game visits</span></div>
        <div ${tip("Total time with a live gamecast open, everyone")}><b>${dur(gcMs)}</b><span>watched</span></div>
      </div>
      <div class="ld-fh five"><span>OWNER</span><span>LIVE</span><span>PRE</span><span>FINAL</span><span>TIME ON</span></div>
      ${[...gcPeople].sort((a, b) => b.live - a.live || b.ms - a.ms || b.info + b.fin - a.info - a.fin).map((x) => `<div class="ld-fr five" ${tip(`${x.n} · live gamecast in ${x.live} visit${x.live === 1 ? "" : "s"}${x.last ? `, last ${dayLong(x.last)} ${timeLab(x.last)}` : ""} · game info before kickoff in ${x.info} · final recap in ${x.fin}`)}><span>${esc(x.n)}</span><em>${x.live || "-"}</em><em>${x.info || "-"}</em><em>${x.fin || "-"}</em><em>${x.ms ? dur(x.ms) : "-"}</em></div>`).join("")}
      ${gcByDay.length ? `<div class="lvz-h">BY GAME DAY · MINUTES WATCHED · PEOPLE</div>
      <div class="lvz-feat">${gcByDay.slice(-6).reverse().map((x) => `<div class="lvz-fb" ${tip(`${dayLong(x.d)} · ${x.ppl.size} of the ${x.inN} who were in opened a live gamecast${x.ppl.size ? ` (${[...x.ppl].join(", ")})` : ""} · ${dur(x.ms)} watched`)}><span>${esc(dayLong(x.d))}</span><i><b style="width:${(x.ms / gcMaxDay * 100).toFixed(0)}%"></b></i><em>${x.ppl.size}/${x.inN}</em></div>`).join("")}</div>` : ""}
      ${gcTop.length ? `<div class="lvz-cap">Most watched: ${gcTop.slice(0, 3).map((e) => `${esc(e.w.label)} (W${e.w.w}, ${e.ppl.size} ${e.ppl.size === 1 ? "person" : "people"}, ${dur(e.ms)})`).join("; ")}.</div>` : ""}
      <div class="lvz-cap">Live: visits that opened the gamecast while the game was on. Pre and final: the same sheet opened before kickoff or after the final. Counted once per visit, sessions since ${esc(dayLong(sessSince))}.</div>
      <div class="lvz-h">ALL FEATURES · LAST 14 DAYS</div>`;
    const featView = fr.length ? `<div class="ld-fh"><span>FEATURE</span><span>PEOPLE WHO USED IT</span><span>VISITS</span></div>${fr.map((e) => `<div class="ld-fr" ${tip(`${ldFeat(e.k)} · ${e.ppl.size} of ${N} people (${[...e.ppl].join(", ")}) · in ${e.n} of ${s14.length} visits · first stop in ${e.first}`)}><span>${esc(ldFeat(e.k))}</span><span class="ld-ppl">${names.map((n) => `<i class="${e.ppl.has(n) ? "on" : ""}"></i>`).join("")}</span><em>${shareCell(e.n, s14.length)}</em></div>`).join("")}
      ${unused.length ? `<div class="lvz-cap">Not used by anyone ${sessSince > now - 14 * DAY ? `since ${esc(dayLong(sessSince))}` : "in 14 days"}: ${esc(unused.join(", "))}.</div>` : ""}
      <div class="lvz-h">WHERE VISITS START</div>
      <div class="lvz-feat">${[...fr].filter((e) => e.first).sort((a, b) => b.first - a.first).slice(0, 6).map((e, i, arr) => `<div class="lvz-fb" ${tip(`${e.first} visits started on ${ldFeat(e.k)}`)}><span>${esc(ldFeat(e.k))}</span><i><b style="width:${(e.first / Math.max(1, arr[0].first) * 100).toFixed(0)}%"></b></i><em>${shareCell(e.first, s14.length)}</em></div>`).join("")}</div>
      <div class="lvz-cap">From ${s14.length} visit${s14.length === 1 ? "" : "s"} in 14 days on the new build (sessions since ${esc(dayLong(sessSince))}).</div>` : `<div class="lvz-empty">Feature use is recorded from the new build on (since ${esc(dayLong(sessSince))}). It fills in as people use the app.</div>`;

    // ---- PICKS ----
    const flipRows = names.map((n) => ({ n, f: flips.get(n), lm: median(leadBy.get(n) || []), ed: editsBy.get(n) || [] })).sort((a, b) => (a.lm ?? Infinity) - (b.lm ?? Infinity));
    const picksView = `${pickWeeks.length ? `<div class="ld-sort"><span>WEEK</span>${pickWeeks.slice(0, 5).map((w, i) => `<button type="button" data-pickweek="${w}" class="${i === 0 ? "on" : ""}">W${w}</button>`).join("")}</div><div class="ld-pkbody">${pickWeekView(pickWeeks[0])}</div>` : `<div class="lvz-empty">No pick saves in the log yet.</div>`}
      <div class="lvz-h">HABITS · ALL LOGGED WEEKS</div>
      <div class="ld-fh four"><span>OWNER</span><span>USUAL LEAD</span><span>CHANGES/WK</span><span>SWITCHES PAID</span></div>
      ${flipRows.map((x) => `<div class="ld-fr four" ${tip(`${x.n} · ${x.f ? `${x.f.n} switched picks with results: ${x.f.helped} helped, ${x.f.hurt} hurt, net ${x.f.net >= 0 ? "+" : ""}${x.f.net}` : "no switched picks with results yet"}`)}><span>${esc(x.n)}</span><em>${x.lm != null ? lead(x.lm) : "-"}</em><em>${x.ed.length ? (x.ed.reduce((a, b) => a + b, 0) / x.ed.length).toFixed(1) : "-"}</em>${x.f ? `<em class="ld-d ${x.f.net > 0 ? "up" : x.f.net < 0 ? "dn" : "flat"}">${x.f.net > 0 ? "▲ +" : x.f.net < 0 ? "▼ " : "= "}${x.f.net} pts</em>` : `<em>-</em>`}</div>`).join("")}
      <div class="lvz-cap">Usual lead: median time between the last save and lock. Switches paid: points from the final pick minus what the first pick would have scored, on finished games.</div>`;

    // Where each tab's numbers come from, and how fresh they are.
    const hasOpens = opensSince < now, hasSess = sessSince < now;
    const logTs = log.map((r) => r.ts).filter(Number.isFinite);
    const srcO = hasOpens ? `opens since ${dayLong(opensSince)}` : "no opens yet";
    const srcV = hasSess ? `visit records since ${dayLong(sessSince)}` : "no visit records yet";
    const srcP = logTs.length ? `pick saves since ${dayLong(Math.min(...logTs))}` : "no pick saves logged yet";
    const asOf = (...parts) => `<div class="ld-asof">As of ${timeLab(now)} · ${parts.join(" · ")} · Jake excluded</div>`;
    const html = `<div class="lvz ld">
      <div class="ld-tabs">${[["pulse", "PULSE"], ["people", "PEOPLE"], ["gameday", "GAME DAY"], ["features", "FEATURES"], ["picks", "PICKS"], ["health", "HEALTH"]].map(([k, l], i) => `<button type="button" data-ldtab="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
      <section data-ldview="pulse">${asOf(srcO, srcV)}${pulse}</section>
      <section data-ldview="people" hidden>${asOf(srcO, srcV)}${peopleView}</section>
      <section data-ldview="gameday" hidden>${asOf(srcO, srcV)}${gameView}</section>
      <section data-ldview="features" hidden>${asOf(srcV)}${gcView}${featView}</section>
      <section data-ldview="picks" hidden>${asOf(srcP)}${picksView}</section>
      <section data-ldview="health" hidden>${asOf(srcV)}${healthView}</section>
      <div class="lvz-tip" aria-live="polite">Tap any bar, square, dot or row for the details.</div>
    </div>`;
    return { html, drill, gameDayView, pickWeekView, pastWeekView, csv };
  }

  // One listener for the whole dashboard: tabs, sorting, drill-downs,
  // day and week switches, the copy button, and the details readout.
  function wireLoginDash(root, dash) {
    const box = root.querySelector(".ld");
    const out = root.querySelector(".lvz-tip");
    if (!box || !out || !dash) return;
    let on = null;
    const show = (t) => { if (!t || t === on || !t.dataset.tip) return; on?.classList.remove("on"); on = t; t.classList.add("on"); out.textContent = t.dataset.tip; };
    box.addEventListener("pointerover", (e) => show(e.target.closest?.("[data-tip]")));
    box.addEventListener("click", async (e) => {
      const t = e.target;
      const tab = t.closest?.("[data-ldtab]");
      if (tab) { out.textContent = "Tap any bar, square, dot or row for the details."; on?.classList.remove("on"); on = null; box.querySelectorAll("[data-ldtab]").forEach((b) => b.classList.toggle("on", b === tab)); box.querySelectorAll("[data-ldview]").forEach((s) => { s.hidden = s.dataset.ldview !== tab.dataset.ldtab; }); return; }
      const so = t.closest?.("[data-sort]");
      if (so) {
        so.parentElement.querySelectorAll("[data-sort]").forEach((b) => b.classList.toggle("on", b === so));
        const wrap = box.querySelector(".ld-people"); const k = so.dataset.sort;
        const pairs = [...wrap.querySelectorAll(".ld-pr")].map((r) => [r, r.nextElementSibling]);
        pairs.sort((a, b) => Number(b[0].dataset[`sort${k[0].toUpperCase()}${k.slice(1)}`]) - Number(a[0].dataset[`sort${k[0].toUpperCase()}${k.slice(1)}`]));
        for (const [r, d] of pairs) wrap.append(r, d);
        return;
      }
      const pr = t.closest?.(".ld-pr");
      if (pr && !t.closest("[data-tip]")) {
        const d = pr.nextElementSibling;
        if (d.hidden && !d.innerHTML) d.innerHTML = dash.drill(pr.dataset.person);
        d.hidden = !d.hidden; pr.classList.toggle("open", !d.hidden);
        return;
      }
      const gd = t.closest?.("[data-gameday]");
      if (gd) { gd.parentElement.querySelectorAll("[data-gameday]").forEach((b) => b.classList.toggle("on", b === gd)); box.querySelector(".ld-gdbody").innerHTML = dash.gameDayView(Number(gd.dataset.gameday)).html; return; }
      const pw = t.closest?.("[data-pickweek]");
      if (pw) { pw.parentElement.querySelectorAll("[data-pickweek]").forEach((b) => b.classList.toggle("on", b === pw)); box.querySelector(".ld-pkbody").innerHTML = dash.pickWeekView(Number(pw.dataset.pickweek)); return; }
      const pwk = t.closest?.("[data-pulseweek]");
      if (pwk) {
        pwk.parentElement.querySelectorAll("[data-pulseweek]").forEach((b) => b.classList.toggle("on", b === pwk));
        const live = box.querySelector(".ld-pulse-live"), past = box.querySelector(".ld-pulse-past");
        if (pwk.dataset.pulseweek === "live") { live.hidden = false; past.hidden = true; }
        else { past.innerHTML = dash.pastWeekView(pwk.dataset.pulseweek); live.hidden = true; past.hidden = false; }
        return;
      }
      const cv = t.closest?.("[data-csv]");
      if (cv) {
        const blob = new Blob([dash.csv(cv.dataset.csv)], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `brochiefs-${cv.dataset.csv}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        return;
      }
      const cp = t.closest?.(".lvz-copy");
      // Copying the nudge records who was on it, for the follow-through.
      if (cp && cp.dataset.who && !cp.dataset.logged) {
        cp.dataset.logged = "1";
        try { fetch(`${WORKER_URL}/nudge?key=${encodeURIComponent(key())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ who: JSON.parse(cp.dataset.who), week: typeof currentWeek !== "undefined" ? currentWeek : null }) }).catch(() => {}); } catch {}
      }
      if (cp) { const text = cp.dataset.text || ""; try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); cp.textContent = "Copied ✓"; } } catch { try { await navigator.clipboard.writeText(text); cp.textContent = "Copied ✓"; } catch {} } return; }
      if (pr) { const d = pr.nextElementSibling; if (d.hidden && !d.innerHTML) d.innerHTML = dash.drill(pr.dataset.person); d.hidden = !d.hidden; pr.classList.toggle("open", !d.hidden); }
      show(t.closest?.("[data-tip]"));
    });
  }

  // --- Who's in -------------------------------------------------------
  // The first thing the console shows: the nine owners, who is in the app
  // now, and every open in the last seven days on one strip per person.
  // Each strip is seven equal days, overnight (midnight to 7am) shaded so
  // the time of day reads at a glance, games in gold, one dot per open and
  // a bar for time in the app. Tap a name for the day-by-day list.
  async function renderWhosIn() {
    body.innerHTML = `<div class="admin-empty">Loading who's been in…</div>`;
    const [vis, season, pk] = await Promise.allSettled([get("/visit"), get("/season"), get(`/picks?week=${currentWeek}`)]);
    const v = vis.status === "fulfilled" ? vis.value : null;
    const picksNow = pk.status === "fulfilled" ? pk.value?.picks || null : null;
    if (!v) { body.innerHTML = `<div class="admin-empty">Couldn't load logins.</div>`; return; }
    const DAY = 86400000, HR = 3600000, now = Date.now();
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const today0 = t0.getTime(), A = today0 - 6 * DAY, B = today0 + DAY, span = B - A;
    const wk0 = (() => { const d = new Date(today0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); })();
    const days = Array.from({ length: 7 }, (_, i) => A + i * DAY);
    const xp = (t) => ((t - A) / span * 100).toFixed(3);
    const dayLab = (t, i) => i === 6 ? "TODAY" : new Date(t).toLocaleDateString([], { weekday: "short" }).toUpperCase();
    const dayLong = (t) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const timeLab = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
    const ago = (t) => { const m = Math.round((now - t) / 60000); return m < 2 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
    const dur = (ms) => ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < HR ? `${Math.round(ms / 60000)}m` : `${(ms / HR).toFixed(1)}h`;
    const tip = (s) => `data-tip="${esc(s)}"`;
    // Games in the window, from every saved slate.
    const wins = [];
    for (const wk of Object.values((season.status === "fulfilled" && season.value?.season) || {})) for (const g of wk.games || []) { const k = Date.parse(g.kickoff); if (Number.isFinite(k) && k + 3.5 * HR > A && k < B) wins.push([k, k + 3.5 * HR]); }
    wins.sort((a, b) => a[0] - b[0]);
    const merged = []; for (const w of wins) { const l = merged[merged.length - 1]; if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]); else merged.push([...w]); }
    const inGame = (t) => merged.some(([a, b]) => t >= a && t < b);
    const shade = days.map((d) => `<i class="wi-night" style="left:${xp(d)}%;width:${(7 * HR / span * 100).toFixed(3)}%"></i><i class="wi-noon" style="left:${xp(d + 12 * HR)}%"></i>`).join("")
      + merged.map(([a, b]) => `<i class="wi-game" style="left:${xp(Math.max(a, A))}%;width:${((Math.min(b, B) - Math.max(a, A)) / span * 100).toFixed(3)}%"></i>`).join("")
      + days.slice(1).map((d) => `<i class="wi-div" style="left:${xp(d)}%"></i>`).join("")
      + `<i class="wi-now" style="left:${xp(now)}%"></i>`;
    // Strip width on this screen (the page caps at 920px; name and count
    // columns take about 180px), and the time one 16px marker covers.
    const stripPx = Math.max(180, Math.min(body.clientWidth || innerWidth, 920) - 180);
    const gapMs = span * 16 / stripPx;
    const multiDay = (c) => new Date(c.items[0].at).toDateString() !== new Date(c.last).toDateString();
    const people = TRACKED.map((n) => {
      const opens = (v.visits?.[n] || []).filter((x) => Number.isFinite(x.at) && x.at >= A).sort((a, b) => a.at - b.at);
      const allOpens = (v.visits?.[n] || []).filter((x) => Number.isFinite(x.at));
      const sess = (v.sessions?.[n] || []).filter((x) => Number.isFinite(x.at) && x.at + (x.dur || 0) >= A);
      const last = Math.max(0, ...allOpens.map((x) => x.at), ...(v.sessions?.[n] || []).map((x) => (x.at || 0) + (x.dur || 0)));
      const daysIn = days.filter((d) => opens.some((x) => x.at >= d && x.at < d + DAY) || sess.some((x) => x.at >= d && x.at < d + DAY)).length;
      const time = sess.filter((x) => x.at >= A).reduce((a, x) => a + (x.dur || 0), 0);
      // This week's card: games picked (hidden placeholders don't count) and the tiebreaker.
      const card = picksNow?.[n];
      const k = GAMES.filter((g) => { const x = card?.picks?.[g.id]; return x && !x.hidden && x.team; }).length;
      const tb = String(card?.tiebreaker ?? "").trim() !== "" && card?.tiebreaker !== "hidden";
      // Opens that would land within one marker's width of each other on
      // this screen are one marker with a count, at their average time: a
      // few hours apart on a desktop, most of a day on a phone. Tapping
      // one still lists every time.
      const clusters = [];
      for (const x of opens) { const c = clusters[clusters.length - 1]; if (c && x.at - c.last < gapMs) { c.items.push(x); c.last = x.at; } else clusters.push({ last: x.at, items: [x] }); }
      for (const c of clusters) c.at = c.items.reduce((a, x) => a + x.at, 0) / c.items.length;
      return { n, opens, sess, last, daysIn, time, k, tb, clusters, today: opens.some((x) => x.at >= today0) || sess.some((x) => x.at >= today0), wk: opens.some((x) => x.at >= wk0) || sess.some((x) => x.at >= wk0), now: now - last < 10 * 60000 };
    }).sort((a, b) => b.last - a.last);
    const total = GAMES.length;
    const lockAt = (typeof weekLockTime === "function" && weekLockTime()) || (total ? Math.min(...GAMES.map((g) => Date.parse(g.kickoff))) : null);
    const open = !!lockAt && lockAt > now;
    const left = (ms) => { const h = Math.floor(ms / HR), d = Math.floor(h / 24); return d ? `${d}d ${h % 24}h` : h ? `${h}h ${Math.floor((ms % HR) / 60000)}m` : `${Math.max(1, Math.round(ms / 60000))}m`; };
    const done = (p) => p.k >= total && p.tb;
    const short = picksNow && total ? people.filter((p) => !done(p)) : [];
    // The week tile is the calendar week (from Monday); the strip and the
    // "not in" line are the rolling last 7 days, and say so.
    const inNow = people.filter((p) => p.now), inToday = people.filter((p) => p.today), inWeek = people.filter((p) => p.wk), out = people.filter((p) => !p.daysIn);
    const av = (n) => { const acc = typeof accentFor === "function" ? accentFor(n) : "#1ab8cc"; const a = (typeof avatarOverrides !== "undefined" && avatarOverrides?.[n]) || n[0]; return `<span class="wi-av" style="--accent:${acc}">${esc(a)}</span>`; };
    const rows = people.map((p) => {
      const sessHtml = p.sess.map((x) => `<i class="wi-sess" style="left:${xp(Math.max(x.at, A))}%;width:${Math.max(0.35, (Math.min(x.at + x.dur, B) - Math.max(x.at, A)) / span * 100).toFixed(3)}%"></i>`).join("");
      const dots = p.clusters.map((c) => { const g = c.items.some((x) => inGame(x.at)), m = c.items.length; return `<i class="wi-dot${g ? " g" : ""}${m > 1 ? " n" : ""}" style="left:${xp(c.at)}%" ${tip(`${p.n} · ${multiDay(c) ? `${dayLong(c.items[0].at)} to ${dayLong(c.last)}` : dayLong(c.at)} · ${m > 1 ? `${m} opens: ${multiDay(c) ? c.items.map((x) => `${new Date(x.at).toLocaleDateString([], { weekday: "short" })} ${timeLab(x.at)}`).join(", ") : c.items.map((x) => timeLab(x.at)).join(", ")}` : timeLab(c.at)}${g ? " · during a game" : ""} · ${c.items[c.items.length - 1].app === "home" ? "home-screen app" : "browser"}`)}>${m > 1 ? m : ""}</i>`; }).join("");
      const pkCls = !picksNow || !total ? "" : done(p) ? "ok" : open ? "short" : "late";
      const pkTxt = !picksNow || !total ? "" : `${done(p) ? "✓ " : ""}${p.k}/${total}${p.tb ? "" : " · no TB"}`;
      const list = days.slice().reverse().map((d) => { const o = p.opens.filter((x) => x.at >= d && x.at < d + DAY); const t = p.sess.filter((x) => x.at >= d && x.at < d + DAY).reduce((a, x) => a + (x.dur || 0), 0); return o.length || t ? `<div class="wi-day"><b>${esc(dayLong(d))}</b><span>${o.length} open${o.length === 1 ? "" : "s"}${t ? ` · ${dur(t)} in app` : ""}</span><em>${o.map((x) => timeLab(x.at)).join(" · ")}</em></div>` : ""; }).join("") || `<div class="wi-day"><span>No opens in the last 7 days.</span></div>`;
      return `<button type="button" class="wi-row${p.now ? " live" : ""}" data-wi="${esc(p.n)}">
          <span class="wi-who">${av(p.n)}<span><b>${esc(p.n)}</b><small>${p.now ? `<i class="wi-pulse"></i>in now` : p.last ? esc(ago(p.last)) : "never"}</small></span></span>
          <span class="wi-strip">${shade}${sessHtml}${dots}</span>
          <span class="wi-count${p.daysIn ? "" : " zero"}"><span><b>${p.daysIn}</b>/7</span>${pkTxt ? `<em class="wi-pk ${pkCls}" ${tip(`${p.n} · ${p.k} of ${total} picks${p.tb ? ", tiebreaker in" : ", no tiebreaker"}${open ? ` · lock in ${left(lockAt - now)}` : " · locked"}`)}>${pkTxt}</em>` : ""}</span>
        </button>
        <div class="wi-more" data-for="${esc(p.n)}" hidden>${list}</div>`;
    }).join("");
    const axis = `<div class="wi-axrow"><span></span><span class="wi-axis">${days.map((d, i) => `<span${i === 6 ? ' class="t"' : ""}>${dayLab(d, i)}</span>`).join("")}</span><span class="wi-axd">DAYS${picksNow && total ? "<br>PICKS" : ""}</span></div>`;
    const allOpens = Object.values(v.visits || {}).flat().map((x) => x?.at).filter(Number.isFinite);
    const firstOpen = allOpens.length ? Math.min(...allOpens) : null;
    body.innerHTML = `<div class="wi">
      <div class="ld-asof">As of ${new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${firstOpen ? `opens since ${dayLong(firstOpen)}` : "no opens yet"} · Jake excluded</div>
      <div class="wi-tiles">
        <div class="${inNow.length ? "hot" : ""}"><b>${inNow.length}</b><span>in now</span></div>
        <div><b>${inToday.length}<small>/${TRACKED.length}</small></b><span>in today</span></div>
        <div><b>${inWeek.length}<small>/${TRACKED.length}</small></b><span>${wk0 === today0 ? "in since Mon (today)" : "in since Mon"}</span></div>
        ${picksNow && total ? `<div class="${open && short.length ? "warn" : ""}"><b>${TRACKED.length - short.length}<small>/${TRACKED.length}</small></b><span>picks in · ${open ? `lock in ${esc(left(lockAt - now))}` : "locked"}</span></div>` : ""}
      </div>
      ${open && short.length ? `<div class="wi-out">Picks not in yet: ${short.map((p) => `<b>${esc(p.n)}</b> ${p.k}/${total}${p.tb ? "" : " no TB"}`).join(", ")}</div>` : ""}
      ${out.length ? `<div class="wi-out">Not in for 7 days: ${out.map((p) => `<b>${esc(p.n)}</b>`).join(", ")}</div>` : `<div class="wi-out ok">All ${TRACKED.length} have been in within the last 7 days.</div>`}
      <div class="wi-grid">${axis}${rows}</div>
      <div class="wi-legend"><span><i class="wi-dot"></i>opened the app</span><span><i class="wi-dot n">3</i>opens close together</span><span><i class="wi-sess k"></i>time in app</span><span><i class="wi-game k"></i>game on</span><span><i class="wi-night k"></i>overnight</span></div>
      <div class="wi-tip">Tap a dot for the time, a name for their week.</div>
    </div>`;
    const tipEl = body.querySelector(".wi-tip");
    let on = null;
    body.querySelector(".wi").addEventListener("click", (e) => {
      const d = e.target.closest(".wi-dot[data-tip]");
      if (d) { on?.classList.remove("on"); on = d; d.classList.add("on"); tipEl.textContent = d.dataset.tip; return; }
      const r = e.target.closest(".wi-row");
      if (r) { const m = r.nextElementSibling; m.hidden = !m.hidden; r.classList.toggle("open", !m.hidden); }
    });
  }

  async function renderLogins() {
    // The dashboard first, then sign-ins. Everything it needs loads in
    // parallel; any one source failing leaves its panel empty, not the page.
    let opens = "", dash = null;
    body.innerHTML = `<div class="admin-empty">Loading the league dashboard…</div>`;
    try {
      const now = Date.now();
      const [vis, pk, season, plog, ver, roll, ndg] = await Promise.allSettled([
        get("/visit"),
        get(`/picks?week=${currentWeek}`),
        get("/season"),
        get(`/picks-log?format=json&since=${now - 120 * 86400000}`),
        fetch(`version.json?t=${now}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null),
        get("/rollups"),
        get("/nudge"),
      ]);
      const val = (x) => x.status === "fulfilled" ? x.value : null;
      const v = val(vis) || {};
      const keep = (o) => Object.fromEntries(Object.entries(o || {}).filter(([m]) => !NOT_TRACKED.has(m)));
      const visits = keep(v.visits), sessions = keep(v.sessions);
      const fmt = (t) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
      dash = buildLoginDash({ visits, sessions, picksNow: val(pk)?.picks || null, season: val(season), pickLog: val(plog)?.changes || [], buildNow: String(val(ver)?.v || ""), names: TRACKED, ago, rollups: Object.fromEntries(Object.entries(val(roll)?.rollups || {}).map(([k, r]) => [k, { ...r, people: keep(r.people) }])), nudgeLog: val(ndg)?.nudges || [] });
      const all = Object.entries(visits).flatMap(([m, list]) => list.map((x) => ({ m, ...x })));
      opens = dash.html + `<details class="con-more"><summary>Every open (${all.length})</summary>${all.sort((a, b) => b.at - a.at).slice(0, 200).map((x) => `<div class="con-line">${fmt(x.at)} · <b>${esc(x.m)}</b> · ${x.app === "home" ? "home-screen app" : "browser"}${x.screen ? ` · ${esc(x.screen)}` : ""}</div>`).join("")}</details>`;
    } catch (err) { console.error("login dashboard", err); opens = `<div class="admin-empty">The dashboard couldn't load.</div>`; }
    let rawEvents = [];
    try { ({ events: rawEvents } = await get("/auth-log?format=json")); } catch {}
    const events = (rawEvents || []).filter((e) => !NOT_TRACKED.has(e.manager));
    if (!events.length) { body.innerHTML = opens + `<div class="admin-empty">No sign-ins yet. Nobody has claimed a name with a code.</div>`; wireLoginDash(body, dash); return; }
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
    wireLoginDash(body, dash);
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

  const TABS = { whosin: renderWhosIn, qotw: renderQotw, experts: renderExperts, grid: renderGrid, picks: renderPicks, season: renderSeason, ledger: renderLedger, logins: renderLogins, owners: renderOwners, device: renderDevice, mode: renderMode, slate: renderSlate, feeds: renderFeeds };

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
    tab = "whosin";
    el("console-tabs").querySelectorAll(".console-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === "whosin"));
    root.classList.remove("hidden");
    document.body.classList.add("admin-open");
    root.scrollTop = 0;
    renderTab();
  };
  window.showAppConsole();
})();
