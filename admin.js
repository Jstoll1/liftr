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
    renderFound();
  }

  const say = (msg, kind = "") => { const s = el("admin-status"); s.textContent = msg; s.className = "admin-status " + kind; };

  // ESPN's scoreboard takes a season week, which returns every game from
  // Thursday through Sunday in one call. groups=80 is all of FBS.
  async function loadEspn() {
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
      const k = new Date(g.kickoff);
      const time = k.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${header}<div class="admin-game ${on ? "on" : ""}" data-key="${esc(g.key)}">
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
      else if (picked.size >= MAX_PICKS) { say(`That is ${MAX_PICKS} already. Untap one first.`, "bad"); return; }
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
