// Commissioner's slate editor. Its own page at brochiefs.com/admin.html so
// none of it ships with the app the league loads. Gated by the same
// ARCHIVE_LOG_KEY the log pages use: the Worker rejects a save without it.
//
// The flow avoids typing ESPN team ids by hand. The browser asks ESPN for
// a date's college slate (the Worker cannot, Cloudflare's IPs are blocked),
// lists the games, and the commissioner taps the ones the league is playing.
(() => {
  const WORKER_URL = "https://liftr-ai.jhs797.workers.dev";
  const KEY_STORE = "brochiefs_admin_key";
  const root = document.getElementById("admin-screen");
  if (!root) return;

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_PICKS = 10;   // the league plays ten games a week
  let found = [];         // games ESPN returned for the chosen week
  let picked = new Map(); // espn event id -> { spread, favSide, tiebreaker }

  let suggested = [];    // [{key, on}] from the last recommendation
  let filter = "";       // live team-name filter over the loaded week
  let keyOk = false;      // the Worker has confirmed this key

  const getKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
  const setKey = (k) => { try { sessionStorage.setItem(KEY_STORE, k); } catch {} };

  async function show() {
    el("admin-key").value = getKey();
    // The next unplayed week is the one being set, so default to it.
    let next = 2;
    try {
      const res = await fetch(`${WORKER_URL}/games?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const list = data?.weeks?.list;
      if (Array.isArray(list) && list.length) next = Math.max(...list) + 1;
    } catch {}
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

  // One control: the ESPN season week is also the league week it publishes
  // to, so week 4 of the season is always week 4 of the pick'em. ESPN's
  // scoreboard returns Thursday through Sunday in one call; groups=80 is FBS.
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
          awayLogo: away.team?.logo || "",
          homeLogo: home.team?.logo || "",
          awayRank: Number(away.curatedRank?.current) || 99,
          homeRank: Number(home.curatedRank?.current) || 99,
          conf: !!c.conferenceCompetition,
          note: (ev.competitions?.[0]?.notes || [])[0]?.headline || "",
          kickoff: ev.date,
          tv: (c.broadcasts || []).flatMap((b) => b.names || [])[0] || "",
          spread, favSide,
          hay: `${away.team?.displayName || ""} ${away.team?.shortDisplayName || ""} ${away.team?.abbreviation || ""} ${away.team?.location || ""} ${home.team?.displayName || ""} ${home.team?.shortDisplayName || ""} ${home.team?.abbreviation || ""} ${home.team?.location || ""}`.toLowerCase(),
        };
      }).filter(Boolean).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      picked = new Map();
      filter = "";
      el("admin-search").value = "";
      if (!found.length) {
        say(`ESPN returned no games for ${year} week ${wk}. Check the year and week.`, "bad");
        renderFound();
        return;
      }
      const restored = await preselectSaved();
      const note = restored === null ? ""
        : restored.missing ? ` ${restored.count} already saved, ${restored.missing === 1 ? "one of which is" : `${restored.missing} of which are`} not in this ESPN week.`
        : restored.count ? ` ${restored.count} already saved and re-checked.` : "";
      say(`${found.length} games in week ${wk}. Tap up to ${MAX_PICKS}.${note}`, "ok");
      renderFound();
    } catch (err) {
      say(`Could not reach ESPN (${err.message}).`, "bad");
    }
  }

  // Coming back to a week the commissioner has already started should show
  // that work, not a blank board. The saved slate carries ESPN team ids, so
  // each stored game re-checks the row it came from.
  async function preselectSaved() {
    const week = Number(el("admin-espn-week").value);
    if (!Number.isInteger(week) || week < 1) return null;
    try {
      const res = await fetch(`${WORKER_URL}/games?week=${week}&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      const saved = Array.isArray(data.games) ? data.games : [];
      if (!saved.length) return { count: 0, missing: 0 };
      let missing = 0;
      for (const g of saved) {
        const row = found.find((f) => f.awayId === Number(g.awayId) && f.homeId === Number(g.homeId));
        if (!row) { missing += 1; continue; }
        picked.set(row.key, { tiebreaker: !!g.tiebreakerGame });
      }
      return { count: saved.length, missing };
    } catch { return null; }
  }

  // Recommendations. Everything here comes off the ESPN record the week
  // was loaded with, so the ranking is reproducible and explainable: each
  // suggestion carries the reasons that earned it a spot.
  const BIG_FOUR = /\b(ABC|CBS|NBC|FOX)\b/i;
  const CABLE = /\b(ESPN|ESPN2|FS1|BTN|SECN|TNT)\b/i;

  function rateGame(g) {
    const why = [];
    let score = 0;
    const ranked = [g.awayRank, g.homeRank].filter((r) => r <= 25);
    if (ranked.length === 2) {
      score += 40 + (26 - Math.max(...ranked));
      why.push(`No. ${Math.min(g.awayRank, g.homeRank)} vs No. ${Math.max(g.awayRank, g.homeRank)}`);
    } else if (ranked.length === 1) {
      score += 14 + (26 - ranked[0]) / 3;
      why.push(`No. ${ranked[0]} in it`);
    }
    const sp = g.spread;
    if (sp === null) { score -= 50; }
    else if (sp <= 3) { score += 22; why.push("Pick em"); }
    else if (sp <= 7) { score += 15; why.push("One score line"); }
    else if (sp <= 10) { score += 8; }
    else if (sp <= 17) { score += 1; }
    else if (sp <= 24) { score -= 8; }
    else { score -= 26; why.push("Likely blowout"); }

    const et = Number(new Date(g.kickoff).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
    if (et >= 20) { score += 12; why.push("Prime time"); }
    else if (et >= 19) { score += 9; why.push("Night game"); }
    else if (et >= 15) { score += 4; }

    if (BIG_FOUR.test(g.tv)) { score += 9; why.push(g.tv); }
    else if (CABLE.test(g.tv)) { score += 4; }

    if (g.conf) { score += 5; why.push("Conference game"); }
    if (g.note) why.push(g.note);
    return { score, why: why.slice(0, 3) };
  }

  // A slate that is all Saturday afternoon is a worse watch than one that
  // spreads across the week, so each extra game on a day it already has
  // pays a little less.
  function recommend() {
    const rated = found.filter((g) => g.spread !== null)
      .map((g) => ({ g, ...rateGame(g) }))
      .sort((a, b) => b.score - a.score);
    const perDay = new Map();
    const out = [];
    for (const r of rated) {
      if (out.length >= MAX_PICKS) break;
      const day = new Date(r.g.kickoff).toDateString();
      const n = perDay.get(day) || 0;
      r.adjusted = r.score - n * 3;
      out.push(r);
      perDay.set(day, n + 1);
    }
    return out.sort((a, b) => b.adjusted - a.adjusted);
  }

  function openSuggest() {
    if (!found.length) { say("Load a week first.", "bad"); return; }
    const picks = recommend();
    if (!picks.length) { say("Nothing in this week has a line yet.", "bad"); return; }
    suggested = picks.map((r) => ({ key: r.g.key, on: true }));
    el("admin-suggest-list").innerHTML = picks.map((r, i) => {
      const g = r.g;
      const fav = g.favSide === "home" ? g.homeShort : g.awayShort;
      const when = new Date(g.kickoff).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      return `<button type="button" class="sg-row on" data-key="${esc(g.key)}">
        <span class="sg-num">${i + 1}</span>
        <span class="sg-check">✓</span>
        <div class="sg-body">
          <div class="sg-teams">${esc(g.awayShort)} @ ${esc(g.homeShort)}</div>
          <div class="sg-meta">${esc(fav)} -${g.spread} · ${esc(when)}${g.tv ? " · " + esc(g.tv) : ""}</div>
          <div class="sg-why">${r.why.map((w) => `<span>${esc(w)}</span>`).join("")}</div>
        </div>
      </button>`;
    }).join("");
    updateSuggestCount();
    el("admin-suggest").classList.remove("hidden");
  }

  function updateSuggestCount() {
    const n = suggested.filter((x) => x.on).length;
    const btn = el("admin-suggest-use");
    btn.textContent = n ? `Add ${n}` : "None chosen";
    btn.disabled = !n;
  }

  // Recommendations add to whatever is already selected rather than
  // replacing it, so a slate part built by hand survives the suggestion.
  function applySuggest() {
    const want = suggested.filter((x) => x.on).map((x) => x.key);
    let added = 0, skipped = 0;
    for (const key of want) {
      if (picked.has(key)) continue;
      if (picked.size >= MAX_PICKS) { skipped += 1; continue; }
      picked.set(key, { tiebreaker: false });
      added += 1;
    }
    if (picked.size && ![...picked.values()].some((v) => v.tiebreaker)) {
      const first = want.find((k) => picked.has(k)) || [...picked.keys()][0];
      picked.get(first).tiebreaker = true;
    }
    el("admin-suggest").classList.add("hidden");
    filter = "";
    el("admin-search").value = "";
    const tail = skipped ? ` ${skipped} did not fit under the ${MAX_PICKS} game cap.` : "";
    say(`${added} added, ${picked.size} of ${MAX_PICKS} selected.${tail} Change anything you like.`, skipped ? "bad" : "ok");
    renderFound();
  }

  function renderFound() {
    const list = el("admin-games");
    const shown = el("admin-shown");
    if (!found.length) {
      list.innerHTML = `<div class="admin-empty">Pick a week and tap Load week.</div>`;
      shown.textContent = "";
      updateCount();
      return;
    }
    // Filtering only hides rows. A game stays selected while it is out of
    // view, so typing a search never costs the commissioner a pick.
    const rows = filter ? found.filter((g) => g.hay.includes(filter)) : found;
    shown.textContent = filter ? `${rows.length} of ${found.length} shown` : `${found.length} games`;
    if (!rows.length) {
      list.innerHTML = `<div class="admin-empty">No team in this week matches "${esc(filter)}".</div>`;
      updateCount();
      return;
    }
    let lastDay = "";
    list.innerHTML = rows.map((g) => {
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
          <span class="admin-logos">${g.awayLogo ? `<img src="${esc(g.awayLogo)}" alt="" loading="lazy" />` : `<i></i>`}${g.homeLogo ? `<img src="${esc(g.homeLogo)}" alt="" loading="lazy" />` : `<i></i>`}</span>
          <span class="admin-teams">${esc(g.awayShort)} @ ${esc(g.homeShort)}</span>
          <span class="admin-odds ${g.spread === null ? "none" : ""}">${esc(lineText)}</span>
          <span class="admin-time">${esc(time)}${g.tv ? " · " + esc(g.tv) : ""}</span>
        </button>
        ${on ? `<div class="admin-line">
          <label class="admin-tb"><input type="radio" name="admin-tb" data-act="tb" ${p.tiebreaker ? "checked" : ""} /> Tiebreaker game</label>
        </div>` : ""}
      </div>`;
    }).join("");
    updateCount();
  }

  function updateCount() {
    const hasTb = [...picked.values()].some((v) => v.tiebreaker);
    const tbNote = !picked.size ? "" : hasTb ? " · TB set" : " · no TB yet";
    el("admin-count").textContent = `${picked.size} of ${MAX_PICKS} selected${tbNote}`;
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
    const week = Number(el("admin-espn-week").value);
    if (!Number.isInteger(week) || week < 1) { say("Pick a week.", "bad"); return; }
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
  el("admin-search").addEventListener("input", (e) => {
    filter = e.target.value.trim().toLowerCase();
    renderFound();
  });
  el("admin-load").addEventListener("click", loadEspn);
  el("admin-clear").addEventListener("click", () => {
    picked = new Map();
    say("Selections cleared.");
    renderFound();
  });
  el("admin-save").addEventListener("click", save);
  el("admin-suggest-btn").addEventListener("click", openSuggest);
  el("admin-suggest-use").addEventListener("click", applySuggest);
  el("admin-suggest-list").addEventListener("click", (e) => {
    const row = e.target.closest(".sg-row");
    if (!row) return;
    const item = suggested.find((x) => x.key === row.dataset.key);
    if (!item) return;
    item.on = !item.on;
    row.classList.toggle("on", item.on);
    updateSuggestCount();
  });
  el("admin-suggest-close").addEventListener("click", () => el("admin-suggest").classList.add("hidden"));
  el("admin-suggest").addEventListener("click", (e) => { if (e.target.id === "admin-suggest") el("admin-suggest").classList.add("hidden"); });
  el("admin-exit").addEventListener("click", () => { location.href = "index.html"; });

  show();
})();
