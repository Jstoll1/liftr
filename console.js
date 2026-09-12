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

  let tab = "picks";

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
  async function renderLogins() {
    const { events } = await get("/auth-log?format=json");
    if (!events.length) { body.innerHTML = `<div class="admin-empty">No logins yet. Nobody has claimed a name.</div>`; return; }
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
    body.innerHTML = `<div class="con-summary"><span>${events.length} event${events.length === 1 ? "" : "s"}</span><span class="${failed.length ? "warn" : ""}">${failed.length} failed</span></div>`
      + (alerts.length ? alerts.map((a) => `<div class="con-row bad"><div class="con-line">⚠ ${a}</div></div>`).join("") : `<div class="con-ok">Nothing unusual.</div>`)
      + events.map((e) => `<div class="con-row${e.ok ? "" : " warn"}">
          <div class="con-row-head"><b>${esc(e.manager)}</b><span>${when(e.ts)} · ${esc(e.kind)}</span>
            ${e.ok ? "" : `<span class="con-tag bad">failed</span>`}${e.newDevice ? `<span class="con-tag warn">new device</span>` : ""}${e.newNetwork ? `<span class="con-tag warn">new network</span>` : ""}</div>
          <div class="con-line dim">${esc(where(e))}${e.asOrg ? ` · ${esc(e.asOrg)}` : ""} · ${esc(e.ipShort || "—")}</div>
          <div class="con-line dim">${esc(what(e))}${e.device ? ` ${esc(e.device)}` : ""}${e.screen ? ` · ${esc(e.screen)}` : ""}${e.deviceId ? ` · ${esc(e.deviceId.slice(0, 8))}…` : ""}</div>
        </div>`).join("");
  }

  // --- Owners ---------------------------------------------------------
  async function renderOwners() {
    const auth = await get("/auth");
    const claimed = new Set(auth.claimed || []);
    body.innerHTML = `<p class="admin-intro">Each owner claims their own name with a code they choose. Reset frees a name so it can be claimed again — for a forgotten code, or when the wrong person got there first.</p>
      <div class="admin-owners-list">${OWNERS.map((name) => `<div class="admin-owner${claimed.has(name) ? " on" : ""}">
        <span class="ao-name">${esc(name)}</span>
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

  const TABS = { picks: renderPicks, season: renderSeason, ledger: renderLedger, logins: renderLogins, owners: renderOwners, device: renderDevice, mode: renderMode, slate: renderSlate };

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
    root.classList.remove("hidden");
    document.body.classList.add("admin-open");
    root.scrollTop = 0;
    renderTab();
  };
  window.showAppConsole();
})();
