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
  let found = [];      // games ESPN returned for the chosen date
  let picked = new Map(); // espn event id -> { spread, favSide, tiebreaker }

  const getKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
  const setKey = (k) => { try { sessionStorage.setItem(KEY_STORE, k); } catch {} };

  function show() {
    [logoScreen, loginScreen, picksScreen, scoreboardScreen, historyScreen, triviaScreen].forEach((s) => s && s.classList.add("hidden"));
    homeHeader.classList.remove("hidden");
    bottomNav.classList.add("hidden");
    root.classList.remove("hidden");
    el("admin-key").value = getKey();
    el("admin-week").value = String(Math.max(1, ...(typeof weekList !== "undefined" ? weekList : [1])) + 1);
    el("admin-date").value = nextSaturday();
    renderFound();
  }

  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  }

  const say = (msg, kind = "") => { const s = el("admin-status"); s.textContent = msg; s.className = "admin-status " + kind; };

  // ESPN's scoreboard for one date. groups=80 is all of FBS.
  async function loadEspn() {
    const date = el("admin-date").value.replace(/-/g, "");
    if (!/^\d{8}$/.test(date)) { say("Pick a date first.", "bad"); return; }
    say("Asking ESPN for that day's games…");
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=80&limit=300&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      found = (data.events || []).map((ev) => {
        const c = ev.competitions?.[0] || {};
        const away = (c.competitors || []).find((x) => x.homeAway === "away");
        const home = (c.competitors || []).find((x) => x.homeAway === "home");
        if (!away || !home) return null;
        // ESPN often carries the closing line. Use it as a starting point;
        // the commissioner can overwrite every number.
        const odds = (c.odds || [])[0] || {};
        const favSide = odds.homeTeamOdds?.favorite ? "home" : odds.awayTeamOdds?.favorite ? "away" : "home";
        const spread = Number.isFinite(Number(odds.spread)) ? Math.abs(Number(odds.spread)) : "";
        return {
          key: ev.id,
          away: away.team?.displayName || away.team?.name || "",
          home: home.team?.displayName || home.team?.name || "",
          awayShort: away.team?.shortDisplayName || away.team?.abbreviation || "",
          homeShort: home.team?.shortDisplayName || home.team?.abbreviation || "",
          awayId: Number(away.team?.id),
          homeId: Number(home.team?.id),
          kickoff: ev.date,
          tv: (c.broadcasts || []).flatMap((b) => b.names || [])[0] || "",
          spread, favSide,
        };
      }).filter(Boolean).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      picked = new Map();
      say(`${found.length} games on ${el("admin-date").value}. Tap the ones the league is playing.`, "ok");
      renderFound();
    } catch (err) {
      say(`Could not reach ESPN (${err.message}). Try again, or check the date.`, "bad");
    }
  }

  function renderFound() {
    const list = el("admin-games");
    if (!found.length) { list.innerHTML = `<div class="admin-empty">Choose a date and tap Load games.</div>`; return; }
    list.innerHTML = found.map((g) => {
      const on = picked.has(g.key);
      const p = picked.get(g.key) || {};
      const time = new Date(g.kickoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `<div class="admin-game ${on ? "on" : ""}" data-key="${esc(g.key)}">
        <button class="admin-pick" type="button" data-act="toggle">
          <span class="admin-check">${on ? "✓" : ""}</span>
          <span class="admin-teams">${esc(g.awayShort)} @ ${esc(g.homeShort)}</span>
          <span class="admin-time">${esc(time)}${g.tv ? " · " + esc(g.tv) : ""}</span>
        </button>
        ${on ? `<div class="admin-line">
          <label>Spread<input class="admin-spread" type="number" step="0.5" min="0" max="80" inputmode="decimal" value="${p.spread ?? ""}" /></label>
          <div class="admin-fav">
            <button type="button" class="admin-favbtn ${p.favSide === "away" ? "on" : ""}" data-act="fav" data-side="away">${esc(g.awayShort)}</button>
            <button type="button" class="admin-favbtn ${p.favSide === "home" ? "on" : ""}" data-act="fav" data-side="home">${esc(g.homeShort)}</button>
          </div>
          <label class="admin-tb"><input type="radio" name="admin-tb" data-act="tb" ${p.tiebreaker ? "checked" : ""} /> Tiebreaker</label>
        </div>` : ""}
      </div>`;
    }).join("");
    el("admin-count").textContent = `${picked.size} selected`;
  }

  el("admin-games").addEventListener("click", (e) => {
    const row = e.target.closest(".admin-game");
    if (!row) return;
    const key = row.dataset.key;
    const g = found.find((x) => x.key === key);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "toggle") {
      if (picked.has(key)) picked.delete(key);
      else picked.set(key, { spread: g.spread, favSide: g.favSide, tiebreaker: false });
      renderFound();
    } else if (act === "fav") {
      const p = picked.get(key); if (!p) return;
      p.favSide = e.target.dataset.side;
      renderFound();
    } else if (act === "tb") {
      picked.forEach((v) => { v.tiebreaker = false; });
      const p = picked.get(key); if (p) p.tiebreaker = true;
      renderFound();
    }
  });
  // Spread edits are read on save, but keep the map current as they type so
  // a re-render never wipes a number.
  el("admin-games").addEventListener("input", (e) => {
    if (!e.target.classList.contains("admin-spread")) return;
    const key = e.target.closest(".admin-game")?.dataset.key;
    const p = picked.get(key); if (p) p.spread = e.target.value;
  });

  async function save() {
    const key = el("admin-key").value.trim();
    if (!key) { say("Enter the admin key.", "bad"); return; }
    setKey(key);
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
      const spread = Number(p.spread);
      if (!Number.isFinite(spread) || spread < 0) { say(`Enter a spread for ${g.awayShort} @ ${g.homeShort}.`, "bad"); return; }
      id += 1;
      games.push({
        id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort,
        awayId: g.awayId, homeId: g.homeId,
        favorite: p.favSide === "away" ? g.away : g.home,
        spread, kickoff: g.kickoff, tv: g.tv,
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

  el("admin-load").addEventListener("click", loadEspn);
  el("admin-save").addEventListener("click", save);
  el("admin-exit").addEventListener("click", () => { location.hash = ""; location.reload(); });

  if (location.hash === "#admin") show();
  window.addEventListener("hashchange", () => { if (location.hash === "#admin") show(); });
})();
