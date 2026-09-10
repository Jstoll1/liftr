// Commissioner's slate editor. No page and no link of its own: three taps
// on the header wordmark asks for the admin key, and this file is only
// fetched once that key checks out, so none of it ships with the app the
// league loads. The key itself is the gate in app.js and is left in
// sessionStorage for this tab; the Worker re-checks it on every load and
// rejects a save without it.
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

  let loadedWeek = 0;       // the week `found` was loaded for
  let calendar = new Map(); // week number -> { start, end } from ESPN

  const dayLabel = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  function weekRangeText(wk) {
    const c = calendar.get(wk);
    if (!c) return "";
    const a = dayLabel(c.start), b = dayLabel(c.end);
    return a === b ? a : `${a} – ${b}`;
  }

  function renderWeekOptions(selected) {
    const sel = el("admin-espn-week");
    sel.innerHTML = Array.from({ length: 16 }, (_, i) => {
      const n = i + 1;
      const r = weekRangeText(n);
      return `<option value="${n}">Week ${n}${r ? ` · ${r}` : ""}</option>`;
    }).join("");
    sel.value = String(selected);
    showWeekDates();
  }

  // Before a week is loaded the only reference is ESPN's calendar window,
  // which runs Tuesday to Tuesday and so is not the first kickoff. Once the
  // week is loaded the real opener replaces it.
  function showWeekDates() {
    const wk = Number(el("admin-espn-week").value);
    const out = el("admin-when");
    if (!out) return;
    const opener = found.length ? found[0] : null;
    if (opener && Number(loadedWeek) === wk) {
      const k = new Date(opener.kickoff);
      const when = k.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      // The countdown comes from app.js, which runs the same clock on the
      // picks page. Loaded on its own the editor just skips it.
      const cd = typeof kickoffCountdown === "function" ? kickoffCountdown(opener.kickoff) : null;
      const left = !cd ? "" : cd.past ? " · already kicked off" : ` · kicks off in ${cd.text}`;
      out.textContent = `First game ${when} ET · ${opener.awayShort} at ${opener.homeShort}${left}`;
      return;
    }
    const r = weekRangeText(wk);
    out.textContent = r ? `Week window ${r}` : "";
  }

  // Keep the opener's countdown moving once a week is loaded.
  setInterval(() => { if (found.length) showWeekDates(); }, 1000);

  async function show() {
    let week = 1;
    let year = new Date().getFullYear();
    // ESPN knows what week it is, and ships the season calendar alongside,
    // so the dropdown can carry real dates instead of bare numbers.
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?limit=1&t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const wk = Number(data?.week?.number) || Number(data?.leagues?.[0]?.season?.type?.week?.number);
      const yr = Number(data?.season?.year) || Number(data?.leagues?.[0]?.season?.year);
      if (Number.isInteger(wk) && wk >= 1 && wk <= 16) week = wk;
      if (Number.isInteger(yr) && yr >= 2000) year = yr;
      readCalendar(data?.leagues?.[0]?.calendar);
    } catch {
      try {
        const res = await fetch(`${WORKER_URL}/games?t=${Date.now()}`, { cache: "no-store" });
        const list = (await res.json())?.weeks?.list;
        if (Array.isArray(list) && list.length) week = Math.min(16, Math.max(...list) + 1);
      } catch {}
    }
    renderWeekOptions(week);
    el("admin-year").value = String(year);
    const note = el("admin-season-note");
    if (note) note.textContent = year === new Date().getFullYear() ? "" : `${year} season`;
    syncGate();
    renderFound();
    // Opening the editor almost always means working on this week, so load
    // it rather than making the commissioner tap Load to see anything. The
    // key is already held from the gate, and loading re-checks whatever is
    // saved for the week, so a slate in progress comes back selected.
    if (getKey().trim()) loadEspn();
  }

  // The calendar is either a flat list of weeks or a list of season types
  // each holding its own weeks. Regular season is type 2.
  function readCalendar(cal) {
    if (!Array.isArray(cal)) return;
    const entries = cal[0]?.entries
      ? (cal.find((c) => String(c.value) === "2") || cal[0]).entries
      : cal;
    for (const e of entries || []) {
      const n = Number(e.value ?? e.label);
      if (!Number.isInteger(n) || !e.startDate || !e.endDate) continue;
      calendar.set(n, { start: e.startDate, end: e.endDate });
    }
  }

  // Sheets sit at body level. Flag the body while one is open so the app
  // nav gets out of the way and the board behind stops scrolling.
  const openSheet = (id) => { el(id).classList.remove("hidden"); document.body.classList.add("sheet-open"); };
  const closeSheet = (id) => { el(id).classList.add("hidden"); document.body.classList.remove("sheet-open"); };

  const say = (msg, kind = "") => { const s = el("admin-status"); s.textContent = msg; s.className = "admin-status " + kind; };

  // Loading a week is gated the same way saving is. This is not a security
  // boundary on its own, the Worker is that, but it means a wrong key fails
  // before ten games get picked out rather than after.
  async function verifyKey() {
    const key = getKey().trim();
    if (!key) { say("The admin key is missing. Close and re-open the editor.", "bad"); return ""; }
    if (keyOk) return key;
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
    const has = !!getKey().trim();
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
      loadedWeek = wk;
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
      showWeekDates();
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
    openSheet("admin-suggest");
    el("admin-suggest-list").scrollTop = 0;
  }

  function updateSuggestCount() {
    const n = suggested.filter((x) => x.on).length;
    const btn = el("admin-suggest-use");
    btn.textContent = n ? `Use these ${n}` : "None chosen";
    btn.disabled = !n;
  }

  // What taking the chosen recommendations would cost the current slate.
  function suggestDiff() {
    const want = suggested.filter((x) => x.on).map((x) => x.key);
    const incoming = want.filter((k) => !picked.has(k));
    const outgoing = [...picked.keys()].filter((k) => !want.includes(k));
    return { want, incoming, outgoing, kept: want.length - incoming.length };
  }

  const nameOf = (key) => {
    const g = found.find((x) => x.key === key);
    return g ? `${g.awayShort} @ ${g.homeShort}` : "";
  };

  // Taking recommendations replaces the slate. Anything already selected
  // that is not in the chosen set would be dropped, so say so first.
  function confirmSuggest() {
    const d = suggestDiff();
    if (!d.want.length) return;
    if (!d.outgoing.length) { applySuggest(); return; }
    el("admin-override-body").innerHTML = `
      <p class="ov-lead">${d.outgoing.length === picked.size ? `All ${picked.size} of your selected games are` : `${d.outgoing.length} of your ${picked.size} selected ${d.outgoing.length === 1 ? "games is" : "games are"}`} not in this set and would be dropped.</p>
      <div class="ov-cols">
        <div class="ov-col out"><div class="ov-head">Dropping ${d.outgoing.length}</div>${d.outgoing.map((k) => `<div>${esc(nameOf(k))}</div>`).join("")}</div>
        <div class="ov-col in"><div class="ov-head">Adding ${d.incoming.length}</div>${d.incoming.length ? d.incoming.map((k) => `<div>${esc(nameOf(k))}</div>`).join("") : "<div>Nothing new</div>"}</div>
      </div>
      <p class="ov-lead">${d.kept} ${d.kept === 1 ? "game stays" : "games stay"}. The slate becomes ${d.want.length} of ${MAX_PICKS}.</p>`;
    el("admin-override-ok").textContent = `Override ${picked.size}`;
    openSheet("admin-override");
  }

  function applySuggest() {
    const { want } = suggestDiff();
    if (!want.length) return;
    // Whoever held the tiebreaker keeps it if they survive the swap.
    const heldTb = [...picked.entries()].find(([, v]) => v.tiebreaker)?.[0];
    picked = new Map();
    for (const key of want.slice(0, MAX_PICKS)) picked.set(key, { tiebreaker: false });
    const tb = heldTb && picked.has(heldTb) ? heldTb : want[0];
    if (picked.has(tb)) picked.get(tb).tiebreaker = true;
    closeSheet("admin-override");
    closeSheet("admin-suggest");
    filter = "";
    el("admin-search").value = "";
    say(`Slate replaced with ${picked.size} games. ${nameOf(tb)} is the tiebreaker. Change anything you like.`, "ok");
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
          <label class="admin-tb"><input type="checkbox" data-act="tb" ${p.tiebreaker ? "checked" : ""} /> Tiebreaker game</label>
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
      // One tiebreaker at a time, and tapping the one that is set clears it.
      const p = picked.get(key); if (!p) return;
      const was = p.tiebreaker;
      picked.forEach((v) => { v.tiebreaker = false; });
      p.tiebreaker = !was;
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

  el("admin-espn-week").addEventListener("change", showWeekDates);
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
  el("admin-suggest-use").addEventListener("click", confirmSuggest);
  el("admin-suggest-list").addEventListener("click", (e) => {
    const row = e.target.closest(".sg-row");
    if (!row) return;
    const item = suggested.find((x) => x.key === row.dataset.key);
    if (!item) return;
    item.on = !item.on;
    row.classList.toggle("on", item.on);
    updateSuggestCount();
  });
  el("admin-suggest-close").addEventListener("click", () => closeSheet("admin-suggest"));
  el("admin-override-ok").addEventListener("click", applySuggest);
  el("admin-override-cancel").addEventListener("click", () => { closeSheet("admin-override"); openSheet("admin-suggest"); });
  el("admin-override").addEventListener("click", (e) => { if (e.target.id === "admin-override") { closeSheet("admin-override"); openSheet("admin-suggest"); } });
  el("admin-suggest").addEventListener("click", (e) => { if (e.target.id === "admin-suggest") closeSheet("admin-suggest"); });
  // Inside the app the editor is an overlay, so Exit closes it and leaves
  // the league's screen underneath untouched.
  el("admin-exit").addEventListener("click", () => {
    if (typeof window.closeSlateEditor === "function") window.closeSlateEditor();
    else location.href = "index.html";
  });


  // --- Preview the lineup ---------------------------------------------
  // What the league will see, before it is saved: the games tapped so far
  // in kickoff order, with both logos, both names and the line. Ten rows
  // fit without scrolling on a phone, so it answers "where am I" in one
  // look. Read-only — tapping a row does nothing, closing changes nothing.
  function openPreview() {
    const list = el("admin-preview-list");
    const count = el("admin-preview-count");
    const rows = found.filter((g) => picked.has(g.key));
    const hasTb = [...picked.values()].some((v) => v.tiebreaker);
    if (count) count.textContent = `${rows.length}/${MAX_PICKS}${rows.length && !hasTb ? " · no TB" : ""}`;
    if (!rows.length) {
      list.innerHTML = `<div class="admin-empty">${found.length ? "Nothing tapped yet." : "Load a week first."}</div>`;
    } else {
      let lastDay = "";
      list.innerHTML = rows.map((g) => {
        const day = new Date(g.kickoff).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        const header = day !== lastDay ? `<div class="admin-day">${esc(day)}</div>` : "";
        lastDay = day;
        const p = picked.get(g.key) || {};
        const favShort = g.favSide === "home" ? g.homeShort : g.awayShort;
        const line = g.spread === null ? "no line" : `${favShort} -${g.spread}`;
        const time = new Date(g.kickoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const logo = (src) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : `<i></i>`);
        return `${header}<div class="lp-row${g.spread === null ? " noline" : ""}">
          <span class="lp-logos">${logo(g.awayLogo)}${logo(g.homeLogo)}</span>
          <span class="lp-teams">${esc(g.awayShort)} <span class="lp-at">at</span> ${esc(g.homeShort)}${p.tiebreaker ? ` <span class="lp-tb">TB</span>` : ""}</span>
          <span class="lp-line${g.spread === null ? " none" : ""}">${esc(line)}</span>
          <span class="lp-when">${esc(time)}${g.tv ? " · " + esc(g.tv) : ""}</span>
        </div>`;
      }).join("");
    }
    openSheet("admin-preview");
  }

  const closePreview = () => closeSheet("admin-preview");
  el("admin-preview-btn").addEventListener("click", openPreview);
  el("admin-preview-close").addEventListener("click", closePreview);
  el("admin-preview").addEventListener("click", (e) => { if (e.target.id === "admin-preview") closePreview(); });

  show();
})();
