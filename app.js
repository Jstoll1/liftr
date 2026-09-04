// Brochiefs 2026 College Football Pick'em — retro arcade pick app.
// Picks are cached per-manager in localStorage and, when configured,
// synced through a small Cloudflare Worker (worker/src/index.js, the
// /picks and /results routes) so everyone can see everyone's picks and
// live rankings from one shared "scoreboard" page — not just their own
// browser. A game locks (no more changes, for anyone) once its kickoff
// time passes, independent of whether that manager has hit "Lock In".
// Hitting "Lock In" freezes ALL of that manager's picks immediately,
// even for games that haven't kicked off yet.

// Fill this in after deploying the Worker (see worker/README.md), e.g.
// "https://liftr-ai.<your-subdomain>.workers.dev". Left blank, the app
// works fine on a single device/browser but the scoreboard can only ever
// show picks made on that same device.
const WORKER_URL = "";

const STORAGE_KEY = "brochiefs_picks_v1";

// Kickoff dates confirmed against each team's published 2026 schedule:
// Week 1 Saturday slate is Sept 5, 2026; the Louisville/Ole Miss "Music
// City Kickoff" is Sunday, Sept 6, 2026.
const GAMES = [
  { id: 1, away: "Liberty", home: "James Madison", favorite: "James Madison", spread: 6.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ESPNU" },
  { id: 2, away: "Miami (OH)", home: "Pitt", favorite: "Pitt", spread: 16.5, kickoff: "2026-09-05T16:30:00Z", kickoffLabel: "Sat 12:30 PM ET", tv: "The CW" },
  { id: 3, away: "Baylor", home: "Auburn", favorite: "Auburn", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ABC" },
  { id: 4, away: "Boston College", home: "Cincinnati", favorite: "Cincinnati", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "FOX" },
  { id: 5, away: "Tulane", home: "Duke", favorite: "Duke", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ACCN" },
  { id: 6, away: "Boise State", home: "#2 Oregon", favorite: "#2 Oregon", spread: 24.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "CBS" },
  { id: 7, away: "Wyoming", home: "Colorado State", favorite: "Colorado State", spread: 3.5, kickoff: "2026-09-05T22:00:00Z", kickoffLabel: "Sat 6:00 PM ET", tv: "USA" },
  { id: 8, away: "Clemson", home: "#11 LSU", favorite: "#11 LSU", spread: 10, kickoff: "2026-09-05T23:30:00Z", kickoffLabel: "Sat 7:30 PM ET", tv: "ABC", tiebreakerGame: true },
  { id: 9, away: "East Carolina", home: "#13 Alabama", favorite: "#13 Alabama", spread: 27.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ABC" },
  { id: 10, away: "#24 Louisville", home: "#9 Ole Miss", favorite: "#9 Ole Miss", spread: 7, kickoffLabel: "Sun 7:30 PM ET", kickoff: "2026-09-06T23:30:00Z", tv: "ABC" },
];

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
  return all[name] || { picks: {}, tiebreaker: "", lockedIn: false, lockedAt: null };
}

function setManagerState(name, state) {
  const all = loadAll();
  all[name] = state;
  saveAll(all);
  schedulePush(name, state);
}

function isGameLocked(game) {
  return Date.now() >= new Date(game.kickoff).getTime();
}

// --- Worker sync (cross-device picks + results) --------------------------

let pushTimer = null;
function schedulePush(name, state) {
  if (!WORKER_URL) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushManagerState(name, state), 800);
}

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
// locked in on their phone sees it locked on their laptop too.
async function syncManagerFromCloud(name) {
  const cloud = await fetchAllPicks();
  if (!cloud || !cloud[name]) return;
  const all = loadAll();
  all[name] = cloud[name];
  saveAll(all);
}

// --- Screens / navigation -------------------------------------------------

let currentManager = null;

const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const scoreboardScreen = document.getElementById("scoreboard-screen");
const managerPicker = document.getElementById("manager-picker");
const managerBadge = document.getElementById("manager-badge");
const gamesList = document.getElementById("games-list");
const lockedBanner = document.getElementById("locked-banner");
const lockedBannerSub = document.getElementById("locked-banner-sub");
const tiebreakerInput = document.getElementById("tiebreaker-input");
const lockBtn = document.getElementById("lock-btn");
const picksProgress = document.getElementById("picks-progress");
const switchBtn = document.getElementById("switch-btn");
const toScoreboardBtn = document.getElementById("to-scoreboard-btn");
const scoreboardBackBtn = document.getElementById("scoreboard-back-btn");
const scoreboardRefreshBtn = document.getElementById("scoreboard-refresh-btn");
const rankingsList = document.getElementById("rankings-list");
const scoreboardTable = document.getElementById("scoreboard-table");
const resultsForm = document.getElementById("results-form");

function renderManagerPicker() {
  const all = loadAll();
  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const hasPicks = state && Object.keys(state.picks || {}).length > 0;
    const btn = document.createElement("button");
    btn.className = "manager-card" + (hasPicks ? " has-picks" : "");
    btn.innerHTML = `
      <span class="manager-avatar" style="--accent:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${name[0]}</span>
      <span class="manager-name">${name}</span>
    `;
    btn.addEventListener("click", () => selectManager(name));
    managerPicker.appendChild(btn);
  });
}

async function selectManager(name) {
  currentManager = name;
  managerBadge.textContent = name.toUpperCase();
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  await syncManagerFromCloud(name);
  renderPicksScreen();
}

function renderPicksScreen() {
  const state = getManagerState(currentManager);
  const lockedIn = state.lockedIn;

  lockedBanner.classList.toggle("hidden", !lockedIn);
  if (lockedIn) {
    lockedBannerSub.textContent = `Locked at ${new Date(state.lockedAt).toLocaleString()} — picks are final.`;
  }

  gamesList.innerHTML = "";
  GAMES.forEach((game) => {
    const gameLocked = lockedIn || isGameLocked(game);
    const card = document.createElement("div");
    card.className = "game-card" + (gameLocked ? " game-locked" : "");

    const selected = state.picks[game.id];

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${gameLocked ? "locked" : "open"}">${gameLocked ? "LOCKED" : "OPEN"}</span>
      </div>
      <div class="matchup-row">
        <button class="team-btn away-btn" type="button">${game.away}<span class="team-spread">${game.favorite === game.away ? "-" + game.spread : "+" + game.spread}</span></button>
        <span class="vs-divider">VS</span>
        <button class="team-btn home-btn" type="button">${game.home}<span class="team-spread">${game.favorite === game.home ? "-" + game.spread : "+" + game.spread}</span></button>
      </div>
    `;

    const awayBtn = card.querySelector(".away-btn");
    const homeBtn = card.querySelector(".home-btn");

    [
      [awayBtn, game.away],
      [homeBtn, game.home],
    ].forEach(([btn, team]) => {
      if (selected === team) btn.classList.add("selected");
      btn.disabled = gameLocked;
      btn.addEventListener("click", () => {
        const s = getManagerState(currentManager);
        s.picks[game.id] = team;
        setManagerState(currentManager, s);
        renderPicksScreen();
      });
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = lockedIn || isGameLocked(tiebreakerGame);
  tiebreakerInput.value = state.tiebreaker || "";
  tiebreakerInput.disabled = tiebreakerLocked;
  tiebreakerInput.oninput = () => {
    const s = getManagerState(currentManager);
    s.tiebreaker = tiebreakerInput.value;
    setManagerState(currentManager, s);
  };

  const totalPicked = Object.keys(state.picks).length;
  picksProgress.textContent = `${totalPicked} of ${GAMES.length} games picked` + (state.tiebreaker ? " · tiebreaker set" : " · tiebreaker not set");

  const allPicked = totalPicked === GAMES.length && String(state.tiebreaker).trim() !== "";
  lockBtn.disabled = lockedIn || !allPicked;
  lockBtn.textContent = lockedIn ? "🔒 PICKS LOCKED IN" : "🔒 LOCK IN PICKS";
}

lockBtn.addEventListener("click", () => {
  const state = getManagerState(currentManager);
  if (state.lockedIn) return;
  state.lockedIn = true;
  state.lockedAt = new Date().toISOString();
  setManagerState(currentManager, state);
  pushManagerState(currentManager, state); // push immediately, don't wait on the debounce
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
    const state = cloudPicks[name] || { picks: {}, tiebreaker: "", lockedIn: false };
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
      return `<td class="pick-cell ${cls}">${pick}</td>`;
    }).join("");

    const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
    const tbVisible = isGameLocked(tiebreakerGame);
    const tbCell = tbVisible ? (state.tiebreaker || "—") : "🔒";

    html += `<tr><td class="manager-col">${name}${state.lockedIn ? " 🔒" : ""}</td>${cells}<td>${tbCell}</td></tr>`;
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
    const state = cloudPicks[name] || { picks: {}, lockedIn: false };
    return { name, score: computeScore(state, results), lockedIn: !!state.lockedIn };
  }).sort((a, b) => b.score - a.score);

  rankingsList.innerHTML = "";
  rows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "");
    div.innerHTML = `
      <span class="ranking-place">#${i + 1}</span>
      <span class="ranking-name">${row.name}</span>
      <span class="ranking-lock">${row.lockedIn ? "🔒 locked" : "editing"}</span>
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
