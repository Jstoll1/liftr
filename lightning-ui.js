// Lightning in the app: the late night five-bet pot the commissioner
// activates from the live page. When it is on, a flash card offers it on
// open (play, pass or later); playing deals the five bets one at a time to
// swipe (right for the side on the right, left for the left, or tap), then
// a tiebreaker guess and "I'm in". A ⚡ button stays on screen all night:
// before the lock it changes your answers, after it shows everyone's picks,
// the late scores as they go and the standings. Finals are posted back by
// whichever phone sees each game end, as the side bet does.
(() => {
  if (typeof WORKER_URL === "undefined" || !WORKER_URL || window.LEAGUE?.sport === "nfl") return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND = { ats: "Spread", su: "To win", ou: "Total" };
  const hm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const me = () => { const w = (typeof currentManager !== "undefined" && currentManager) || (typeof loadMe === "function" && loadMe()); return w && MANAGERS.includes(w) ? w : null; };
  const logo = (id) => (id && typeof logoUrl === "function" ? `<img src="${logoUrl(id)}" alt="" loading="lazy">` : "");
  // The question on each card, and a side as a logo (or ▲ ▼ for a total)
  // over its label, so the bet reads at a glance.
  const ask = (b) => b.kind === "ou" ? `Over or under ${b.total} total points?` : b.kind === "su" ? "Who wins?" : "Who covers the spread?";
  const side = (b, k, draft) => {
    const g = b.game, id = b.kind === "ou" ? null : k === "a" ? g.awayId : g.homeId;
    const pic = id ? logo(id) : `<span class="lt-ou">${k === "a" ? "▲" : "▼"}</span>`;
    return `<div class="lt-side ${k}${draft[b.id] === k ? " sel" : ""}">${pic}<b>${esc(k === "a" ? b.a : b.b)}</b><i>${k === "a" ? "Swipe →" : "← Swipe"}</i></div>`;
  };
  let night = null, at = 0, scores = {}, scoresAt = 0;

  async function load(force = false) {
    if (!force && Date.now() - at < 20000) return night;
    const who = me(), tok = who && typeof tokenFor === "function" ? tokenFor(who) : null;
    try {
      const r = await fetch(`${WORKER_URL}/lightning?${who ? `me=${encodeURIComponent(who)}${tok ? `&token=${encodeURIComponent(tok)}` : ""}&` : ""}t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) { night = (await r.json()).night || null; at = Date.now(); }
    } catch {}
    paintFab();
    return night;
  }
  const mine = () => (night && me() ? night.entrants?.[me()] : null);
  const passed = () => !!(night && me() && night.declined?.includes(me()));
  const open = () => !!(night && night.status === "live" && Date.now() < night.closesAt);

  // Late scores for the five games, straight from ESPN, and finals posted
  // back once a game ends (the Worker checks it could be over).
  async function readScores() {
    if (!night || Date.now() - scoresAt < 30000) return;
    scoresAt = Date.now();
    const days = [...new Set(night.bets.map((b) => new Date(b.game.kickoff).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "")))];
    const want = new Set(night.bets.map((b) => b.game.eventId));
    try {
      const boards = await Promise.all(days.map((d) => fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=80&limit=300&t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      for (const ev of boards.flatMap((b) => b?.events || [])) {
        if (!want.has(String(ev.id))) continue;
        const c = ev.competitions?.[0] || {}, side = (ha) => (c.competitors || []).find((x) => x.homeAway === ha) || {};
        scores[ev.id] = { away: Number(side("away").score), home: Number(side("home").score), state: c.status?.type?.state, done: !!c.status?.type?.completed, detail: c.status?.type?.shortDetail || "" };
      }
    } catch {}
    const finals = {};
    for (const b of night.bets) { const s = scores[b.game.eventId]; if (s?.done && !night.finals?.[b.game.eventId] && Number.isFinite(s.away) && Number.isFinite(s.home)) finals[b.game.eventId] = { awayScore: s.away, homeScore: s.home }; }
    if (Object.keys(finals).length && Date.now() >= night.closesAt) {
      try { await fetch(`${WORKER_URL}/lightning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finals", week: night.week, nightId: night.id, finals }) }); at = 0; await load(true); } catch {}
    }
  }

  // ---- The ⚡ button -----------------------------------------------------
  function paintFab() {
    let f = document.getElementById("lt-fab");
    const show = night && night.status === "live" && me();
    if (!show) { f?.remove(); return; }
    if (!f) { f = document.createElement("button"); f.id = "lt-fab"; f.type = "button"; f.addEventListener("click", () => openSheet()); document.body.appendChild(f); }
    const e = mine();
    f.className = `lt-fab${open() && !e && !passed() ? " call" : ""}`;
    f.innerHTML = `<b>⚡</b><span>${open() ? (e ? "You're in" : "Lightning") : "Lightning"}</span>`;
    f.setAttribute("aria-label", "Lightning");
  }

  // ---- The sheet ---------------------------------------------------------
  let draft = {}, draftTb = "", step = 0, view = "intro", busy = false, err = "";
  function modal() {
    let m = document.getElementById("lt-modal");
    if (!m) { m = document.createElement("div"); m.id = "lt-modal"; m.className = "lt-modal"; m.setAttribute("role", "dialog"); document.body.appendChild(m); m.addEventListener("click", onClick); }
    return m;
  }
  function close() { document.getElementById("lt-modal")?.remove(); paintFab(); }
  function openSheet(from = "fab") {
    const e = mine();
    draft = e?.picks ? { ...e.picks } : {}; draftTb = e?.tb != null ? String(e.tb) : ""; step = 0; err = "";
    view = !open() ? "board" : e ? "done" : "intro";
    if (typeof noteUse === "function") noteUse("lightning-open", from);
    paint();
    if (!open()) readScores().then(() => paint());
    // A stale copy may miss the lock or new finals: refresh, and repaint the
    // board (never mid swipe).
    load(true).then(() => { if (document.getElementById("lt-modal") && (view === "board" || view === "done")) { if (!open()) view = "board"; paint(); } });
  }
  const head = (right = "") => `<div class="lt-h"><b>⚡ LIGHTNING</b>${right}<button type="button" class="lt-x" data-lt="close" aria-label="Close">✕</button></div>`;
  function paint() {
    if (!night) return close();
    const m = modal(), n = night, bets = n.bets;
    if (view === "intro") {
      m.innerHTML = `<div class="lt-card lt-intro">${head()}
        <h2>Late night lightning ⚡️ Round</h2>
        <p class="lt-sub">5 Picks - Are you in?</p>
        <p class="lt-pay">Venmo Jake $${n.buyIn}</p>
        <div class="lt-facts"><span><b>5</b>picks</span><span><b>${esc(hm(n.closesAt))}</b>locks</span></div>
        ${err ? `<p class="lt-err">${esc(err)}</p>` : ""}
        <div class="lt-btns"><button type="button" class="lt-pass" data-lt="pass"${busy ? " disabled" : ""}>Pass</button><button type="button" class="lt-go" data-lt="play">⚡ I'm in</button></div>
      </div>`;
      return;
    }
    if (view === "swipe") {
      const b = bets[step], g = b.game;
      m.innerHTML = `<div class="lt-card lt-deck">${head(`<span class="lt-step">${step + 1} / ${bets.length}</span>`)}
        <div class="lt-dots">${bets.map((x, i) => `<i class="${draft[x.id] ? "on" : ""}${i === step ? " now" : ""}"></i>`).join("")}</div>
        <div class="lt-bet" data-bet="${b.id}">
          <div class="lt-kind">${esc(KIND[b.kind])}</div>
          <div class="lt-q">${esc(ask(b))}</div>
          <div class="lt-when">${esc(g.awayShort)} at ${esc(g.homeShort)} · ${esc(g.kickoffLabel || hm(g.kickoff))}</div>
          <div class="lt-sides">${side(b, "b", draft)}${side(b, "a", draft)}</div>
        </div>
        ${step ? `<button type="button" class="lt-back" data-lt="back">↶ Back</button>` : ""}
      </div>`;
      bindSwipe(m.querySelector(".lt-bet"));
      return;
    }
    if (view === "tb") {
      const ready = bets.every((x) => draft[x.id]) && /^\d{1,3}$/.test(draftTb);
      m.innerHTML = `<div class="lt-card">${head()}
        <h3 class="lt-h3">Your five</h3>
        <div class="lt-recap">${bets.map((x, i) => `<button type="button" class="lt-rc" data-lt="edit" data-i="${i}"><em>${i + 1}</em><span>${esc(x.game.awayShort)} at ${esc(x.game.homeShort)} · ${esc(KIND[x.kind])}</span><b>${esc(draft[x.id] === "a" ? x.a : draft[x.id] === "b" ? x.b : "?")}</b></button>`).join("")}</div>
        <label class="lt-tb"><span>Tiebreaker: total points in ${esc(n.tbLabel)}</span><input type="number" inputmode="numeric" min="0" max="200" data-lt-tb="1" value="${esc(draftTb)}" placeholder="e.g. 51"></label>
        ${err ? `<p class="lt-err">${esc(err)}</p>` : ""}
        <div class="lt-btns"><button type="button" class="lt-go wide" data-lt="join"${ready && !busy ? "" : " disabled"}>${busy ? "Saving…" : mine() ? "Save changes" : `I'm in · $${n.buyIn}`}</button></div>
      </div>`;
      return;
    }
    if (view === "done") {
      const e = mine();
      m.innerHTML = `<div class="lt-card">${head()}
        <div class="lt-bolt small" aria-hidden="true">⚡</div><h2>You're in</h2>
        <p class="lt-sub">Locks at ${esc(hm(n.closesAt))}. Everyone's picks show after that.</p>
        <div class="lt-recap">${bets.map((x, i) => `<div class="lt-rc"><em>${i + 1}</em><span>${esc(x.game.awayShort)} at ${esc(x.game.homeShort)} · ${esc(KIND[x.kind])}</span><b>${esc(e?.picks?.[x.id] === "a" ? x.a : x.b)}</b></div>`).join("")}</div>
        <p class="lt-sub">Tiebreaker: ${esc(e?.tb)} · ${Object.keys(n.entrants || {}).length} in so far</p>
        <div class="lt-btns">${open() ? `<button type="button" class="lt-pass" data-lt="change">Change picks</button>` : ""}<button type="button" class="lt-go" data-lt="close">Done</button></div>
      </div>`;
      return;
    }
    // After the lock: the board.
    const t = n.table || { rows: [], results: {}, winners: [] }, who = me();
    const res = (x) => t.results?.[x.id];
    const sc = (x) => { const s = scores[x.game.eventId], f = n.finals?.[x.game.eventId]; return f ? `Final ${f.awayScore}-${f.homeScore}` : s && s.state !== "pre" ? `${s.away}-${s.home} · ${esc(s.detail)}` : esc(x.game.kickoffLabel || hm(x.game.kickoff)); };
    const people = Object.entries(n.entrants || {});
    m.innerHTML = `<div class="lt-card lt-board">${head(`<span class="lt-step">${t.done ? "Final" : "Locked"}</span>`)}
      ${t.done && t.winners.length ? `<div class="lt-win">🏆 ${t.winners.map((x) => esc(typeof shown === "function" ? shown(x) : x)).join(" & ")} ${t.winners.length > 1 ? "split" : "takes"} the pot</div>` : ""}
      <div class="lt-bets">${n.bets.map((x, i) => `<div class="lt-br"><em>${i + 1}</em><span><b>${esc(x.game.awayShort)} at ${esc(x.game.homeShort)}</b><small>${esc(KIND[x.kind])} · ${sc(x)}</small></span><span class="lt-res">${res(x) ? (res(x) === "push" ? "Push" : `<small>Won</small> ${esc(res(x) === "a" ? x.a : x.b)}`) : "…"}</span></div>`).join("")}</div>
      <h3 class="lt-h3">Standings</h3>
      <div class="lt-tab">${people.length ? (t.rows.length ? t.rows : people.map(([name]) => ({ name, points: 0 }))).map((r) => { const e = n.entrants[r.name] || {}; return `<div class="lt-tr${r.name === who ? " me" : ""}${t.winners.includes(r.name) ? " win" : ""}"><b>${esc(typeof shown === "function" ? shown(r.name) : r.name)}</b><span class="lt-marks">${n.bets.map((x) => { const p = e.picks?.[x.id], rr = res(x); return `<i class="${!rr || rr === "push" ? "" : p === rr ? "y" : "n"}">${p === "a" ? "→" : p === "b" ? "←" : "·"}</i>`; }).join("")}</span><em>${r.points}/5${r.off != null ? ` · TB ±${r.off}` : e.tb != null ? ` · TB ${e.tb}` : ""}</em></div>`; }).join("") : `<p class="lt-sub">Nobody played tonight.</p>`}</div>
      <p class="lt-note">→ took the right side, ← the left. Pot $${n.buyIn} each; settle up outside the app.</p>
    </div>`;
  }
  function choose(side) {
    const b = night.bets[step];
    draft[b.id] = side;
    if (typeof navigator.vibrate === "function") { try { navigator.vibrate(8); } catch {} }
    const card = document.querySelector("#lt-modal .lt-bet");
    if (card) { card.classList.add(side === "a" ? "fly-a" : "fly-b"); setTimeout(next, 180); } else next();
  }
  // On to the next bet still to answer, or to the recap once all five are.
  function next() {
    const n = night.bets.findIndex((x) => !draft[x.id]);
    if (n >= 0) step = n; else view = "tb";
    paint();
  }
  // Swipe: the card follows the finger and leans to the side it would take.
  function bindSwipe(card) {
    if (!card) return;
    let x0 = null, dx = 0, side = null;
    card.addEventListener("pointerdown", (e) => { x0 = e.clientX; dx = 0; side = e.target.closest?.(".lt-side"); card.setPointerCapture?.(e.pointerId); card.style.transition = "none"; });
    card.addEventListener("pointermove", (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      card.classList.toggle("lean-a", dx > 40); card.classList.toggle("lean-b", dx < -40);
    });
    const end = (e) => {
      if (x0 == null) return; x0 = null;
      card.style.transition = ""; card.style.transform = "";
      card.classList.remove("lean-a", "lean-b");
      if (Math.abs(dx) > 80) choose(dx > 0 ? "a" : "b");
      // A tap on a side (the pointer capture swallows its click).
      else if (Math.abs(dx) < 6 && side && e.type === "pointerup") choose(side.classList.contains("a") ? "a" : "b");
    };
    card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
  }
  async function send(action) {
    const who = me();
    if (!who) { err = "Pick who you are first."; return paint(); }
    busy = true; err = ""; paint();
    try {
      const r = await fetch(`${WORKER_URL}/lightning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, week: night.week, manager: who, token: (typeof tokenFor === "function" && tokenFor(who)) || undefined, ...(action === "join" ? { picks: draft, tb: Number(draftTb) } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.needsLogin && typeof requireOwnerAuth === "function") { busy = false; await requireOwnerAuth(who); return send(action); }
      if (!r.ok) throw new Error(d.error || "Didn't save. Try again.");
      if (d.night) night = d.night;
      if (typeof noteUse === "function") noteUse(action === "join" ? "lightning-join" : "lightning-pass");
      busy = false;
      if (action === "join") { view = "done"; paint(); } else close();
      paintFab();
    } catch (e) { busy = false; err = e.message || "Didn't save. Try again."; paint(); }
  }
  function onClick(e) {
    const t = e.target.closest("[data-lt]");
    if (e.target.id === "lt-modal" && view !== "swipe") return close();
    if (!t) return;
    const a = t.dataset.lt;
    if (a === "close") return close();
    if (a === "play") { view = "swipe"; step = 0; return paint(); }
    if (a === "change") { view = "tb"; return paint(); }
    if (a === "pass") return send("decline");
    if (a === "a" || a === "b") return choose(a);
    if (a === "back") { step = Math.max(0, step - 1); return paint(); }
    if (a === "edit") { step = Number(t.dataset.i) || 0; delete draft[night.bets[step].id]; view = "swipe"; return paint(); }
    if (a === "join") return send("join");
  }
  document.addEventListener("input", (e) => {
    if (!e.target.matches?.("[data-lt-tb]")) return;
    draftTb = e.target.value.replace(/\D/g, "").slice(0, 3);
    const go = document.querySelector('#lt-modal [data-lt="join"]');
    if (go && !busy) go.disabled = !(night.bets.every((x) => draft[x.id]) && /^\d{1,3}$/.test(draftTb));
  });

  // The flash: once a session, when Lightning is on and you have not
  // answered. "Later" (the ✕) waits for the next open; the ⚡ stays.
  const FLASH = (n) => `brochiefs_lt_seen_${n.id}`;
  async function check() {
    await load(true);
    if (!night || !open() || !me() || mine() || passed()) return;
    let seen = null; try { seen = sessionStorage.getItem(FLASH(night)); } catch {}
    if (seen || document.getElementById("lt-modal")) return;
    // Another pop up is up (the question of the week, the grid check): wait
    // for it to close, then flash, rather than stacking on top of it.
    if (document.querySelector(".modal-overlay:not(.hidden), .wpx-overlay:not(.hidden), .pi-screen")) { clearTimeout(check.t); check.t = setTimeout(check, 2000); return; }
    try { sessionStorage.setItem(FLASH(night), "1"); } catch {}
    openSheet("flash");
  }
  check();
  setInterval(() => { if (!document.hidden) load().then(() => { if (document.getElementById("lt-modal") && view === "board") readScores().then(paint); }); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  window.openLightning = openSheet;
})();
