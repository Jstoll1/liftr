// Brochiefs 2026 College Football Pick'em — retro arcade pick app.
// Picks are cached per-manager in localStorage and, when configured,
// synced through a small Cloudflare Worker (worker/src/index.js, the
// /picks and /results routes) so everyone can see everyone's picks and
// live rankings from one shared "scoreboard" page — not just their own
// browser.
//
// Each game is submitted individually: pick a team, hit Submit, and it's
// saved. You can change your mind and resubmit as many times as you want
// right up until that specific game's kickoff — at that instant it locks
// for everyone, submitted or not.

// Fill this in after deploying the Worker (see worker/README.md), e.g.
// "https://liftr-ai.<your-subdomain>.workers.dev". Left blank, the app
// works fine on a single device/browser but the scoreboard can only ever
// show picks made on that same device.
const WORKER_URL = "https://liftr-ai.jhs797.workers.dev";

const STORAGE_KEY = "brochiefs_picks_v1";

// Kickoff dates confirmed against each team's published 2026 schedule:
// Week 1 Saturday slate is Sept 5, 2026; the Louisville/Ole Miss "Music
// City Kickoff" is Sunday, Sept 6, 2026.
// ESPN team IDs, used to hotlink official logos from ESPN's CDN
// (a.espncdn.com/i/teamlogos/ncaa/500/<id>.png) — nothing downloaded or
// stored in this repo, just referenced by URL like any other <img src>.
const GAMES = [
  { id: 1, away: "Liberty", awayId: 2335, home: "James Madison", homeId: 2349, favorite: "James Madison", spread: 6.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ESPNU" },
  { id: 2, away: "Miami (OH)", awayId: 193, home: "Pitt", homeId: 221, favorite: "Pitt", spread: 16.5, kickoff: "2026-09-05T16:30:00Z", kickoffLabel: "Sat 12:30 PM ET", tv: "The CW" },
  { id: 3, away: "Baylor", awayId: 239, home: "Auburn", homeId: 2, favorite: "Auburn", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ABC" },
  { id: 4, away: "Boston College", awayId: 103, home: "Cincinnati", homeId: 2132, favorite: "Cincinnati", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "FOX" },
  { id: 5, away: "Tulane", awayId: 2655, home: "Duke", homeId: 150, favorite: "Duke", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ACCN" },
  { id: 6, away: "Boise State", awayId: 68, home: "#2 Oregon", homeId: 2483, favorite: "#2 Oregon", spread: 24.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "CBS" },
  { id: 7, away: "Wyoming", awayId: 2751, home: "Colorado State", homeId: 36, favorite: "Colorado State", spread: 3.5, kickoff: "2026-09-05T22:00:00Z", kickoffLabel: "Sat 6:00 PM ET", tv: "USA" },
  { id: 8, away: "Clemson", awayId: 228, home: "#11 LSU", homeId: 99, favorite: "#11 LSU", spread: 10, kickoff: "2026-09-05T23:30:00Z", kickoffLabel: "Sat 7:30 PM ET", tv: "ABC", tiebreakerGame: true },
  { id: 9, away: "East Carolina", awayId: 151, home: "#13 Alabama", homeId: 333, favorite: "#13 Alabama", spread: 27.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ABC" },
  { id: 10, away: "#24 Louisville", awayId: 97, home: "#9 Ole Miss", homeId: 145, favorite: "#9 Ole Miss", spread: 7, kickoffLabel: "Sun 7:30 PM ET", kickoff: "2026-09-06T23:30:00Z", tv: "ABC" },
];

function logoUrl(espnId) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

const MANAGERS = [
  "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
  "Nissan", "Skills", "Jake", "Curt", "Andrew",
];

const AVATAR_COLORS = ["#ff2079", "#05d9e8", "#c13cff", "#ffe45e", "#39ff88"];

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getManagerState(name) {
  const all = loadAll();
  return all[name] || { picks: {}, tiebreaker: "" };
}

function setManagerState(name, state) {
  const all = loadAll();
  all[name] = state;
  saveAll(all);
}

function isGameLocked(game) {
  return Date.now() >= new Date(game.kickoff).getTime();
}

// --- Worker sync (cross-device picks + results) --------------------------

async function pushManagerState(manager, state) {
  if (!WORKER_URL) return;
  try {
    await fetch(`${WORKER_URL}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manager, state }),
    });
  } catch {
    // Offline or worker unreachable — local copy still saved, fine.
  }
}

async function fetchAllPicks() {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/picks`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.picks || {};
  } catch {
    return null;
  }
}

async function fetchResults() {
  if (!WORKER_URL) return {};
  try {
    const res = await fetch(`${WORKER_URL}/results`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.results || {};
  } catch {
    return {};
  }
}

async function pushResult(gameId, winner) {
  if (!WORKER_URL) return;
  try {
    await fetch(`${WORKER_URL}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, winner }),
    });
  } catch {
    // Offline or worker unreachable.
  }
}

// Cloud is the source of truth across devices — pull once per manager
// select and merge into local storage before rendering, so a manager who
// submitted a pick on their phone sees it submitted on their laptop too.
async function syncManagerFromCloud(name) {
  const cloud = await fetchAllPicks();
  if (!cloud || !cloud[name]) return;
  const all = loadAll();
  all[name] = cloud[name];
  saveAll(all);
}

// --- Screens / navigation -------------------------------------------------

let currentManager = null;

// Ephemeral, per-manager, not persisted: what's currently selected on
// screen but not yet submitted. Reset whenever a manager is (re)selected.
let draftPicks = {};
let draftTiebreaker = null;

const logoScreen = document.getElementById("logo-screen");
const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const scoreboardScreen = document.getElementById("scoreboard-screen");
const managerPicker = document.getElementById("manager-picker");
const managerBadge = document.getElementById("manager-badge");
const gamesList = document.getElementById("games-list");
const tiebreakerInput = document.getElementById("tiebreaker-input");
const tiebreakerSubmitBtn = document.getElementById("tiebreaker-submit-btn");
const tiebreakerStatus = document.getElementById("tiebreaker-status");
const picksProgress = document.getElementById("picks-progress");
const switchBtn = document.getElementById("switch-btn");
const toScoreboardBtn = document.getElementById("to-scoreboard-btn");
const scoreboardBackBtn = document.getElementById("scoreboard-back-btn");
const scoreboardRefreshBtn = document.getElementById("scoreboard-refresh-btn");
const rankingsList = document.getElementById("rankings-list");
const scoreboardTable = document.getElementById("scoreboard-table");
const resultsForm = document.getElementById("results-form");

// --- Logo / splash screen ---------------------------------------------

function goToPlayerSelect() {
  logoScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

logoScreen.addEventListener("click", goToPlayerSelect);

async function renderManagerPicker() {
  const local = loadAll();
  const cloud = await fetchAllPicks();
  const all = cloud ? { ...local, ...cloud } : local; // cloud wins where it has data

  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const submittedCount = state ? Object.values(state.picks || {}).filter(Boolean).length : 0;
    const tiebreakerDone = !!(state && String(state.tiebreaker || "").trim() !== "");
    const complete = submittedCount === GAMES.length && tiebreakerDone;
    const partial = !complete && (submittedCount > 0 || tiebreakerDone);

    const btn = document.createElement("button");
    btn.className = "manager-card" + (complete ? " has-picks" : "") + (partial ? " partial-picks" : "");
    btn.innerHTML = `
      <span class="manager-avatar" style="--accent:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${name[0]}</span>
      <span class="manager-name">${name}</span>
      <span class="manager-pick-status">${complete ? "✓ All in" : partial ? `${submittedCount}/${GAMES.length} in` : ""}</span>
    `;
    btn.addEventListener("click", () => selectManager(name));
    managerPicker.appendChild(btn);
  });
}

async function selectManager(name) {
  currentManager = name;
  draftPicks = {};
  draftTiebreaker = null;
  managerBadge.textContent = name.toUpperCase();
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  await syncManagerFromCloud(name);
  renderPicksScreen();
}

function renderPicksScreen() {
  const state = getManagerState(currentManager);

  gamesList.innerHTML = "";
  GAMES.forEach((game) => {
    const gameLocked = isGameLocked(game);
    const submittedPick = state.picks[game.id];

    if (draftPicks[game.id] === undefined) {
      draftPicks[game.id] = submittedPick;
    }
    const draft = draftPicks[game.id];
    const hasUnsavedChange = draft && draft !== submittedPick;

    const card = document.createElement("div");
    card.className = "game-card" + (gameLocked ? " game-locked" : "") + (submittedPick && !hasUnsavedChange ? " game-submitted" : "");

    let statusLabel = "OPEN";
    let statusClass = "open";
    if (gameLocked) {
      statusLabel = "LOCKED";
      statusClass = "locked";
    } else if (submittedPick && !hasUnsavedChange) {
      statusLabel = "SUBMITTED";
      statusClass = "submitted";
    }

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="matchup-row">
        <button class="team-btn away-btn" type="button">
          <img class="team-logo" src="${logoUrl(game.awayId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
          <span class="team-name">${game.away}</span>
          <span class="team-spread">${game.favorite === game.away ? "-" + game.spread : "+" + game.spread}</span>
        </button>
        <span class="vs-divider"><span class="vs-bolt">⚡</span>VS</span>
        <button class="team-btn home-btn" type="button">
          <img class="team-logo" src="${logoUrl(game.homeId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
          <span class="team-name">${game.home}</span>
          <span class="team-spread">${game.favorite === game.home ? "-" + game.spread : "+" + game.spread}</span>
        </button>
      </div>
      <div class="game-submit-row">
        <span class="game-submit-note">${gameLocked ? (submittedPick ? `Final pick: ${submittedPick}` : "No pick submitted — locked") : submittedPick && !hasUnsavedChange ? `✓ Submitted: ${submittedPick}` : ""}</span>
        <button class="ghost-btn submit-pick-btn" type="button" ${gameLocked ? "disabled" : ""}>Submit</button>
      </div>
    `;

    const awayBtn = card.querySelector(".away-btn");
    const homeBtn = card.querySelector(".home-btn");
    const submitPickBtn = card.querySelector(".submit-pick-btn");

    [
      [awayBtn, game.away],
      [homeBtn, game.home],
    ].forEach(([btn, team]) => {
      if (draft === team) btn.classList.add("selected");
      btn.disabled = gameLocked;
      btn.addEventListener("click", () => {
        draftPicks[game.id] = team;
        renderPicksScreen();
      });
    });

    submitPickBtn.disabled = gameLocked || !draft || draft === submittedPick;
    submitPickBtn.textContent = submittedPick && !hasUnsavedChange ? "Submitted" : "Submit";
    submitPickBtn.addEventListener("click", () => {
      const s = getManagerState(currentManager);
      s.picks[game.id] = draft;
      setManagerState(currentManager, s);
      pushManagerState(currentManager, s);
      renderPicksScreen();
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = isGameLocked(tiebreakerGame);
  if (draftTiebreaker === null) {
    draftTiebreaker = state.tiebreaker || "";
  }
  tiebreakerInput.value = draftTiebreaker;
  tiebreakerInput.disabled = tiebreakerLocked;
  tiebreakerInput.oninput = () => {
    draftTiebreaker = tiebreakerInput.value;
    const changed = draftTiebreaker !== "" && draftTiebreaker !== String(state.tiebreaker || "");
    tiebreakerSubmitBtn.disabled = tiebreakerLocked || !changed;
  };
  const tbChanged = draftTiebreaker !== "" && draftTiebreaker !== String(state.tiebreaker || "");
  tiebreakerSubmitBtn.disabled = tiebreakerLocked || !tbChanged;
  tiebreakerStatus.textContent = tiebreakerLocked
    ? (state.tiebreaker ? `Final: ${state.tiebreaker}` : "No tiebreaker submitted — locked")
    : state.tiebreaker ? `✓ Submitted: ${state.tiebreaker}` : "";

  const totalSubmitted = Object.values(state.picks).filter(Boolean).length;
  picksProgress.textContent = `${totalSubmitted} of ${GAMES.length} games submitted` + (state.tiebreaker ? " · tiebreaker submitted" : " · tiebreaker not submitted");
}

tiebreakerSubmitBtn.addEventListener("click", () => {
  const s = getManagerState(currentManager);
  s.tiebreaker = draftTiebreaker;
  setManagerState(currentManager, s);
  pushManagerState(currentManager, s);
  renderPicksScreen();
});

switchBtn.addEventListener("click", () => {
  currentManager = null;
  picksScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderManagerPicker();
});

// --- Scoreboard ------------------------------------------------------------

function showScoreboard() {
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.remove("hidden");
  renderScoreboard();
}

toScoreboardBtn.addEventListener("click", showScoreboard);
scoreboardBackBtn.addEventListener("click", () => {
  scoreboardScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
});
scoreboardRefreshBtn.addEventListener("click", renderScoreboard);

async function renderScoreboard() {
  const cloudPicks = (await fetchAllPicks()) || loadAll();
  const results = await fetchResults();

  renderResultsForm(results);
  renderScoreboardTable(cloudPicks, results);
  renderRankings(cloudPicks, results);
}

function renderResultsForm(results) {
  resultsForm.innerHTML = "";
  GAMES.forEach((game) => {
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `
      <span>G${game.id} &middot; ${game.away} @ ${game.home}</span>
      <select data-game="${game.id}">
        <option value="">— pending —</option>
        <option value="${game.away}">${game.away} covered</option>
        <option value="${game.home}">${game.home} covered</option>
      </select>
    `;
    const select = row.querySelector("select");
    select.value = results[game.id] || "";
    select.addEventListener("change", async () => {
      await pushResult(game.id, select.value);
      renderScoreboard();
    });
    resultsForm.appendChild(row);
  });
}

function renderScoreboardTable(cloudPicks, results) {
  const headCells = GAMES.map((g) => `<th>G${g.id}</th>`).join("");
  let html = `<thead><tr><th class="manager-col">Manager</th>${headCells}<th>Tiebreak</th></tr></thead><tbody>`;

  MANAGERS.forEach((name) => {
    const state = cloudPicks[name] || { picks: {}, tiebreaker: "" };
    const cells = GAMES.map((game) => {
      const gameStarted = isGameLocked(game);
      const pick = state.picks[game.id];

      if (!gameStarted) {
        return `<td class="pick-cell hidden-pick">🔒</td>`;
      }
      if (!pick) {
        return `<td class="pick-cell pending">—</td>`;
      }
      const result = results[game.id];
      let cls = "pending";
      if (result) cls = result === pick ? "correct" : "incorrect";
      const pickId = pick === game.away ? game.awayId : game.homeId;
      return `<td class="pick-cell ${cls}"><img class="pick-cell-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.style.display='none'" />${pick}</td>`;
    }).join("");

    const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
    const tbVisible = isGameLocked(tiebreakerGame);
    const tbCell = tbVisible ? (state.tiebreaker || "—") : "🔒";
    const submittedCount = Object.values(state.picks).filter(Boolean).length;

    html += `<tr><td class="manager-col">${name} <span class="ranking-lock">(${submittedCount}/${GAMES.length})</span></td>${cells}<td>${tbCell}</td></tr>`;
  });

  html += "</tbody>";
  scoreboardTable.innerHTML = html;
}

function computeScore(state, results) {
  let correct = 0;
  GAMES.forEach((game) => {
    const result = results[game.id];
    const pick = state.picks[game.id];
    if (result && pick && result === pick) correct += 1;
  });
  return correct;
}

function renderRankings(cloudPicks, results) {
  const rows = MANAGERS.map((name) => {
    const state = cloudPicks[name] || { picks: {} };
    const submittedCount = Object.values(state.picks).filter(Boolean).length;
    return { name, score: computeScore(state, results), submittedCount };
  }).sort((a, b) => b.score - a.score);

  rankingsList.innerHTML = "";
  rows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "");
    div.innerHTML = `
      <span class="ranking-place">#${i + 1}</span>
      <span class="ranking-name">${row.name}</span>
      <span class="ranking-lock">${row.submittedCount}/${GAMES.length} submitted</span>
      <span class="ranking-score">${row.score} correct</span>
    `;
    rankingsList.appendChild(div);
  });
}

// Re-render periodically so games auto-lock the moment kickoff passes,
// and the scoreboard/rankings stay live without a manual refresh.
setInterval(() => {
  if (currentManager && !picksScreen.classList.contains("hidden")) {
    renderPicksScreen();
  }
  if (!scoreboardScreen.classList.contains("hidden")) {
    renderScoreboard();
  }
}, 30000);

renderManagerPicker();
