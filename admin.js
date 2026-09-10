// Commissioner's slate editor. Reached at brochiefs.com/#admin, gated by
// the same ARCHIVE_LOG_KEY the log pages use. Nothing here is reachable
// without that key: the Worker rejects a save that does not carry it.
//
// The flow avoids typing ESPN team ids by hand. The browser asks ESPN for
// a date's college slate (the Worker cannot, Cloudflare's IPs are blocked),
// lists the games, and the commissioner taps the ones the league is playing.
(() => {
  const KEY_STORE = "brochiefs_admin_key";
  const root = document.getElementById("admin-screen");
  if (!root) return;

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_PICKS = 10;   // the league plays ten games a week
  let found = [];         // games ESPN returned for the chosen week
  let picked = new Map(); // espn event id -> { spread, favSide, tiebreaker }

  let keyOk = false;      // the Worker has confirmed this key

  const getKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
  const setKey = (k) => { try { sessionStorage.setItem(KEY_STORE, k); } catch {} };

  function show() {
    [logoScreen, loginScreen, picksScreen, scoreboardScreen, historyScreen, triviaScreen].forEach((s) => s && s.classList.add("hidden"));
    homeHeader.classList.remove("hidden");
    bottomNav.classList.add("hidden");
    root.classList.remove("hidden");
    el("admin-key").value = getKey();
    const next = Math.max(1, ...(typeof weekList !== "undefined" ? weekList : [1])) + 1;
    el("admin-week").value = String(next);
    const sel = el("admin-espn-week");
    if (!sel.options.length) {
      sel.innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">Week ${i + 1}</option>`).join("");
    }
    sel.value = String(Math.min(16, next));
    el("admin-year").value = String(new Date().getFullYear());
    syncGate();
    renderFound();
  }

  const say = (msg, kind = "") => { const s = el("admin-status"); s.textContent = msg; s.className = "admin-status " + kind; };

  // Loading a week is gated the same way saving is. This is not a security
  // boundary on its own, the Worker is that, but it means a wrong key fails
  // before ten games get picked out rather than after.
  async function verifyKey() {
    const key = el("admin-key").value.trim();
    if (!key) { say("Enter the admin key first.", "bad"); return ""; }
    if (keyOk && key === getKey()) return key;
    say("Checking the key…");
    try {
      const res = await fetch(`${WORKER_URL}/games?check=1&key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) { keyOk = false; say("That key is not right.", "bad"); return ""; }
      keyOk = true;
      setKey(key);
      return key;
    } catch (err) {
      keyOk = false;
      say(`Could not reach the Worker to check the key (${err.message}).`, "bad");
      return "";
    }
  }

  function syncGate() {
    const has = !!el("admin-key").value.trim();
    el("admin-load").disabled = !has;
    el("admin-save").disabled = !has;
  }

  // ESPN's scoreboard takes a season week, which returns every game from
  // Thursday through Sunday in one call. groups=80 is all of FBS.
  async function loadEspn() {
    if (!(await verifyKey())) return;
    const wk = Number(el("admin-espn-week").value);
    const year = Number(el("admin-year").value);
    if (!Number.isInteger(wk) || wk < 1 || wk > 20) { say("Pick a week.", "bad"); return; }
    if (!Number.isInteger(year) || year < 2000) { say("Enter the season year.", "bad"); return; }
    say(`Asking ESPN for ${year} week ${wk}…`);
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${year}&seasontype=2&week=${wk}&groups=80&limit=500&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      found = (data.events || []).map((ev) => {
        const c = ev.competitions?.[0] || {};
        const away = (c.competitors || []).find((x) => x.homeAway === "away");
        const home = (c.competitors || []).find((x) => x.homeAway === "home");
        if (!away || !home) return null;
        // The line comes from ESPN and is never editable here. ESPN's
        // spread is signed from the home side, so a negative number means
        // the home team is laying it. A game ESPN has no line for cannot
        // be picked: there is nothing to play against.
        const odds = (c.odds || [])[0] || {};
        const raw = Number(odds.spread);
        const hasLine = Number.isFinite(raw) && raw !== 0;
        const favSide = !hasLine ? "" : odds.homeTeamOdds?.favorite ? "home"
          : odds.awayTeamOdds?.favorite ? "away" : raw < 0 ? "home" : "away";
        const spread = hasLine ? Math.abs(raw) : null;
        return {
          key: ev.id,
          away: away.team?.displayName || away.team?.name || "",
          home: home.team?.displayName || home.team?.name || "",
          awayShort: away.team?.shortDisplayName || away.team?.abbreviation || "",
          homeShort: home.team?.shortDisplayName || home.team?.abbreviation || "",
          awayId: Number(away.team?.id),
          homeId: Number(home.team?.id),
          rank: Number(home.curatedRank?.current) || Number(away.curatedRank?.current) || 99,
          kickoff: ev.date,
          tv: (c.broadcasts || []).flatMap((b) => b.names || [])[0] || "",
          spread, favSide,
        };
      }).filter(Boolean).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      picked = new Map();
      if (!found.length) {
        say(`ESPN returned no games for ${year} week ${wk}. Check the year and week.`, "bad");
      } else {
        say(`${found.length} games in week ${wk}. Tap up to ${MAX_PICKS}.`, "ok");
      }
      renderFound();
    } catch (err) {
      say(`Could not reach ESPN (${err.message}).`, "bad");
    }
  }

  function renderFound() {
    const list = el("admin-games");
    if (!found.length) { list.innerHTML = `<div class="admin-empty">Pick a week and tap Load week.</div>`; return; }
    let lastDay = "";
    list.innerHTML = found.map((g) => {
      const dayLabel = new Date(g.kickoff).toLocaleDateString("en-US", { weekday: "long", month: "numeric", day: "numeric" });
      const header = dayLabel !== lastDay ? `<div class="admin-day">${esc(dayLabel)}</div>` : "";
      lastDay = dayLabel;
      const on = picked.has(g.key);
      const p = picked.get(g.key) || {};
      const favShort = g.favSide === "home" ? g.homeShort : g.awayShort;
      const lineText = g.spread === null ? "No line yet" : `${favShort} -${g.spread}`;
      const k = new Date(g.kickoff);
      const time = k.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${header}<div class="admin-game ${on ? "on" : ""} ${g.spread === null ? "noline" : ""}" data-key="${esc(g.key)}">
        <button class="admin-pick" type="button" data-act="toggle">
          <span class="admin-check">${on ? "✓" : ""}</span>
          <span class="admin-teams">${esc(g.awayShort)} @ ${esc(g.homeShort)}</span>
          <span class="admin-odds ${g.spread === null ? "none" : ""}">${esc(lineText)}</span>
          <span class="admin-time">${esc(time)}${g.tv ? " · " + esc(g.tv) : ""}</span>
        </button>
        ${on ? `<div class="admin-line">
          <label class="admin-tb"><input type="radio" name="admin-tb" data-act="tb" ${p.tiebreaker ? "checked" : ""} /> Tiebreaker game</label>
        </div>` : ""}
      </div>`;
    }).join("");
    el("admin-count").textContent = `${picked.size} of ${MAX_PICKS} selected`;
  }

  el("admin-games").addEventListener("click", (e) => {
    const row = e.target.closest(".admin-game");
    if (!row) return;
    const key = row.dataset.key;
    const g = found.find((x) => x.key === key);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "toggle") {
      if (picked.has(key)) { picked.delete(key); say(""); }
      else if (g.spread === null) { say(`ESPN has no line on ${g.awayShort} @ ${g.homeShort} yet. Load the week again closer to kickoff.`, "bad"); return; }
      else if (picked.size >= MAX_PICKS) { say(`That is ${MAX_PICKS} already. Untap one first.`, "bad"); return; }
      else picked.set(key, { tiebreaker: false });
      renderFound();
    } else if (act === "tb") {
      picked.forEach((v) => { v.tiebreaker = false; });
      const p = picked.get(key); if (p) p.tiebreaker = true;
      renderFound();
    }
  });

  async function save() {
    const key = await verifyKey();
    if (!key) return;
    const week = Number(el("admin-week").value);
    if (!Number.isInteger(week) || week < 1) { say("Week must be a whole number.", "bad"); return; }
    if (!picked.size) { say("Select at least one game.", "bad"); return; }
    const tb = [...picked.values()].filter((p) => p.tiebreaker);
    if (tb.length !== 1) { say("Mark exactly one game as the tiebreaker.", "bad"); return; }

    const games = [];
    let id = 0;
    for (const g of found) {
      const p = picked.get(g.key);
      if (!p) continue;
      if (!Number.isFinite(g.spread)) { say(`ESPN has no line on ${g.awayShort} @ ${g.homeShort}. Untap it.`, "bad"); return; }
      id += 1;
      games.push({
        id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort,
        awayId: g.awayId, homeId: g.homeId,
        favorite: g.favSide === "away" ? g.away : g.home,
        spread: g.spread, kickoff: g.kickoff, tv: g.tv,
        ...(p.tiebreaker ? { tiebreakerGame: true } : {}),
      });
    }

    say("Saving…");
    try {
      const res = await fetch(`${WORKER_URL}/games?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, games, makeCurrent: el("admin-current").checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { say(`Not saved: ${data.error || res.status}`, "bad"); return; }
      say(`Week ${data.week} saved with ${data.games} games${data.current === data.week ? " and is now live" : ""}. Reload to see it.`, "ok");
    } catch (err) {
      say(`Not saved: ${err.message}`, "bad");
    }
  }

  el("admin-key").addEventListener("input", () => { keyOk = false; syncGate(); });
  el("admin-load").addEventListener("click", loadEspn);
  el("admin-clear").addEventListener("click", () => {
    picked = new Map();
    say("Selections cleared.");
    renderFound();
  });
  el("admin-save").addEventListener("click", save);
  el("admin-exit").addEventListener("click", () => { location.hash = ""; location.reload(); });

  if (location.hash === "#admin") show();
  window.addEventListener("hashchange", () => { if (location.hash === "#admin") show(); });
})();
