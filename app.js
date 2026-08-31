(() => {
  "use strict";

  const STORAGE_KEY = "liftr_history_v2";
  const SOUND_KEY = "liftr_sound_enabled";

  // Rotation order for the training split. "Custom" sessions sit outside
  // this rotation entirely — they don't count as a rotation step.
  const SPLIT_ORDER = ["chest-back", "legs", "cardio", "core-mobility"];

  const PERSONAS = {
    jessica: {
      name: "Jessica",
      accent: "#ff2e97",
      goal: "Build lean endurance for her first half-marathon",
    },
    jake: {
      name: "Jake",
      accent: "#05d9e8",
      goal: "Pack on strength for a 405lb deadlift",
    },
  };

  const SPLIT_LIBRARY = {
    "chest-back": {
      name: "Chest & Back",
      icon: "💪",
      tagline: "Push-pull strength builder",
      exercises: {
        jessica: [
          { name: "Push-Up Ladder", detail: "3 x 12" },
          { name: "Lat Pulldown", detail: "3 x 15" },
          { name: "Dumbbell Chest Press", detail: "3 x 12" },
          { name: "Seated Cable Row", detail: "3 x 15" },
          { name: "Plank to Row", detail: "3 x 10/side" },
        ],
        jake: [
          { name: "Barbell Bench Press", detail: "4 x 6" },
          { name: "Weighted Pull-Ups", detail: "4 x 6" },
          { name: "Incline Dumbbell Press", detail: "3 x 8" },
          { name: "Bent-Over Barbell Row", detail: "4 x 8" },
          { name: "Cable Fly", detail: "3 x 12" },
        ],
      },
    },
    legs: {
      name: "Leg Day",
      icon: "🦵",
      tagline: "Lower body power & stability",
      exercises: {
        jessica: [
          { name: "Goblet Squat", detail: "3 x 15" },
          { name: "Step-Ups", detail: "3 x 12/leg" },
          { name: "Glute Bridge", detail: "3 x 15" },
          { name: "Lateral Band Walk", detail: "3 x 20" },
          { name: "Bodyweight Lunge", detail: "3 x 12/leg" },
        ],
        jake: [
          { name: "Barbell Back Squat", detail: "5 x 5" },
          { name: "Romanian Deadlift", detail: "4 x 6" },
          { name: "Walking Lunges", detail: "3 x 10/leg" },
          { name: "Leg Press", detail: "3 x 10" },
          { name: "Standing Calf Raise", detail: "4 x 15" },
        ],
      },
    },
    cardio: {
      name: "Cardio",
      icon: "🔥",
      tagline: "Conditioning & active recovery",
      exercises: {
        jessica: [
          { name: "Tempo Run", detail: "25 min" },
          { name: "Stair Climber Intervals", detail: "15 min" },
          { name: "Cycling", detail: "20 min" },
          { name: "Mobility Flow", detail: "10 min" },
        ],
        jake: [
          { name: "Rowing Intervals", detail: "8 x 500m" },
          { name: "Sled Push", detail: "6 rounds" },
          { name: "Battle Ropes", detail: "5 x 30s" },
          { name: "Jump Rope Finisher", detail: "5 min" },
        ],
      },
    },
    "core-mobility": {
      name: "Core & Mobility",
      icon: "🧘",
      tagline: "Light movement & recovery",
      exercises: {
        jessica: [
          { name: "Dead Bug", detail: "3 x 12" },
          { name: "Hip Flexor Stretch Flow", detail: "5 min" },
          { name: "Side Plank", detail: "3 x 30s/side" },
          { name: "Cat-Cow Flow", detail: "5 min" },
        ],
        jake: [
          { name: "Hanging Leg Raise", detail: "3 x 12" },
          { name: "90/90 Hip Flow", detail: "5 min" },
          { name: "Weighted Plank", detail: "3 x 45s" },
          { name: "Thoracic Rotation Flow", detail: "5 min" },
        ],
      },
    },
  };

  const CUSTOM_META = { name: "Custom Session", icon: "🛠", tagline: "Your own mix" };

  function getSplitMeta(splitKey) {
    return SPLIT_LIBRARY[splitKey] || CUSTOM_META;
  }

  // Bonus exercise appended when energy is high and time allows it.
  const FINISHERS = {
    "chest-back": {
      jessica: { name: "Finisher: Burpee Pulse", detail: "3 x 10" },
      jake: { name: "Finisher: Death-Rep Push-Ups", detail: "2 x max" },
    },
    legs: {
      jessica: { name: "Finisher: Jump Squats", detail: "3 x 12" },
      jake: { name: "Finisher: Bodyweight Squat Burnout", detail: "1 x max" },
    },
    cardio: {
      jessica: { name: "Finisher: All-Out Sprint", detail: "6 x 30s" },
      jake: { name: "Finisher: Assault Bike Sprint", detail: "5 x 20s" },
    },
    "core-mobility": {
      jessica: { name: "Finisher: Mountain Climbers", detail: "3 x 20" },
      jake: { name: "Finisher: Bear Crawl", detail: "3 x 20m" },
    },
  };

  // Bonus exercise appended when training with a partner.
  const PARTNER_EXTRAS = {
    "chest-back": {
      jessica: { name: "Partner Med-Ball Chest Pass", detail: "3 x 15" },
      jake: { name: "Partner Resistance Push-Off", detail: "3 x 15" },
    },
    legs: {
      jessica: { name: "Partner Wall-Sit Hold", detail: "3 x 45s" },
      jake: { name: "Partner Sled Drag", detail: "4 x 20m" },
    },
    cardio: {
      jessica: { name: "Partner Medicine Ball Circuit", detail: "10 min" },
      jake: { name: "Partner Relay Sprints", detail: "6 x 100m" },
    },
    "core-mobility": {
      jessica: { name: "Partner Plank Hand-Slap", detail: "3 x 20s" },
      jake: { name: "Partner-Assisted Stretch Flow", detail: "8 min" },
    },
  };

  const ENERGY_LABEL = { low: "Low Energy", medium: "Medium Energy", high: "High Energy" };
  const TIME_TO_COUNT = { 15: 2, 30: 3, 45: 4, 60: 5 };

  // ---------- storage helpers ----------

  function loadAllHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveAllHistory(all) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function getHistory(user) {
    const all = loadAllHistory();
    return all[user] || [];
  }

  function logSession(user, splitKey, params) {
    const all = loadAllHistory();
    if (!all[user]) all[user] = [];
    all[user].push({ date: todayStr(), splitKey, ...params });
    saveAllHistory(all);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // ---------- rotation & recommendation ----------

  function getLastRotationEntry(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (SPLIT_ORDER.includes(history[i].splitKey)) return history[i];
    }
    return null;
  }

  function loggedToday(history) {
    return history.length > 0 && history[history.length - 1].date === todayStr();
  }

  function currentStreak(history) {
    const days = new Set(history.map((h) => h.date));
    // if nothing logged today yet, start counting from yesterday so an
    // active streak isn't reset to 0 before today's session is done
    let offset = days.has(todayStr()) ? 0 : 1;
    let streak = 0;
    while (days.has(daysAgo(offset))) {
      streak++;
      offset++;
    }
    return streak;
  }

  // Picks today's recommended split from the rotation, then lets a low
  // energy check-in override a heavy lifting day in favor of something lighter.
  function recommendSplit(history, checkIn) {
    const last = getLastRotationEntry(history);
    const rotationPick = last
      ? SPLIT_ORDER[(SPLIT_ORDER.indexOf(last.splitKey) + 1) % SPLIT_ORDER.length]
      : SPLIT_ORDER[0];

    if (checkIn.energy === "low" && (rotationPick === "chest-back" || rotationPick === "legs")) {
      const key = "core-mobility";
      return {
        key,
        reason: `Running low on energy today — let's swap the heavy lifting for ${SPLIT_LIBRARY[key].name} and keep the streak alive.`,
      };
    }

    let reason;
    if (!last) {
      reason = `Fresh start — let's kick off with ${SPLIT_LIBRARY[rotationPick].name}.`;
    } else {
      const when = last.date === daysAgo(1) ? "yesterday" : `on ${formatShortDate(last.date)}`;
      reason = `You hit ${SPLIT_LIBRARY[last.splitKey].name} ${when} — ${SPLIT_LIBRARY[rotationPick].name} is up next.`;
    }
    return { key: rotationPick, reason };
  }

  // ---------- workout plan builder ----------

  // Turns a base exercise list into today's actual plan based on the
  // amount of time available, energy level, and whether a partner is along.
  function buildWorkoutPlan(user, splitKey, { minutes, energy, partner }) {
    const base = SPLIT_LIBRARY[splitKey].exercises[user];
    let count = Math.min(TIME_TO_COUNT[minutes] ?? base.length, base.length);
    if (energy === "low") count = Math.max(2, count - 1);

    let list = base.slice(0, count);

    if (energy === "high" && minutes >= 45) {
      const finisher = FINISHERS[splitKey][user];
      if (finisher) list = [...list, finisher];
    }
    if (partner) {
      const extra = PARTNER_EXTRAS[splitKey][user];
      if (extra) list = [...list, extra];
    }
    return list;
  }

  function getEntryExercises(user, entry) {
    return entry.splitKey === "custom" ? entry.exercises : buildWorkoutPlan(user, entry.splitKey, entry);
  }

  function buildTags({ minutes, energy, partner }) {
    const tags = [`${minutes} MIN`, ENERGY_LABEL[energy].toUpperCase()];
    if (partner) tags.push("W/ PARTNER");
    return tags;
  }

  // ---------- retro guitar riff synth ----------

  let audioCtx = null;
  let soundEnabled = localStorage.getItem(SOUND_KEY) !== "off";

  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
  }

  function makeDistortionCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function playRiff() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);

    const distortion = ctx.createWaveShaper();
    distortion.curve = makeDistortionCurve(320);
    distortion.oversample = "4x";

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2400;

    distortion.connect(lowpass);
    lowpass.connect(master);

    // Palm-muted gallop riff on a low power chord (E2 root + fifth).
    const rootFreq = 82.41; // E2
    const fifthFreq = 123.47; // B2
    const pattern = [0, 0, 1, 0, 0, 1, 2, 0]; // 0=root,1=fifth,2=octave
    const noteLen = 0.11;
    const start = ctx.currentTime + 0.02;

    pattern.forEach((step, i) => {
      const freq = step === 1 ? fifthFreq : step === 2 ? rootFreq * 2 : rootFreq;
      const t0 = start + i * noteLen;

      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.value = freq;

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, t0);
      noteGain.gain.exponentialRampToValueAtTime(1, t0 + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteLen * 0.9);

      osc1.connect(noteGain);
      osc2.connect(noteGain);
      noteGain.connect(distortion);

      osc1.start(t0);
      osc1.stop(t0 + noteLen);
      osc2.start(t0);
      osc2.stop(t0 + noteLen);
    });

    // Final held power chord hit.
    const hitT = start + pattern.length * noteLen + 0.05;
    [rootFreq, fifthFreq, rootFreq * 2].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, hitT);
      g.gain.exponentialRampToValueAtTime(0.9, hitT + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, hitT + 0.9);
      osc.connect(g);
      g.connect(distortion);
      osc.start(hitT);
      osc.stop(hitT + 0.9);
    });
  }

  function setSoundEnabled(enabled) {
    soundEnabled = enabled;
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
    const btn = document.getElementById("sound-toggle");
    btn.textContent = enabled ? "🔊" : "🔇";
    btn.classList.toggle("muted", !enabled);
  }

  // ---------- state ----------

  let currentUser = null;
  let checkInState = { minutes: 30, energy: "medium", partner: "no" };
  let selectedSplitKey = null; // split chosen on the select screen, awaiting log
  let customSelection = new Map(); // exerciseId -> { name, detail }

  // ---------- screen helpers ----------

  const SCREEN_IDS = ["login-screen", "welcome-screen", "checkin-screen", "select-screen", "custom-screen", "session-screen"];

  function showScreen(id) {
    SCREEN_IDS.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
  }

  // ---------- rendering: clock / goal ----------

  function renderClock() {
    const now = new Date();
    const dateEl = document.getElementById("clock-date");
    const timeEl = document.getElementById("clock-time");
    if (!dateEl || !timeEl) return;

    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;

    timeEl.innerHTML = `${hours}<span class="colon">:</span>${minutes} <span style="font-size:14px;color:var(--text-dim)">${ampm}</span>`;
  }

  function renderGoal(persona) {
    document.documentElement.style.setProperty("--accent", persona.accent);
    document.getElementById("goal-avatar").textContent = persona.name[0];
    document.getElementById("goal-avatar").style.setProperty("--accent", persona.accent);
    document.getElementById("goal-username").textContent = persona.name;
    document.getElementById("goal-text").textContent = persona.goal;
  }

  // ---------- rendering: session screen ----------

  function renderExerciseList(exercises) {
    const list = document.getElementById("session-exercises");
    list.innerHTML = "";
    exercises.forEach((ex) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${ex.name}</span><span class="ex-detail">${ex.detail}</span>`;
      list.appendChild(li);
    });
  }

  function renderTags(tags) {
    const el = document.getElementById("session-tags");
    if (!tags || tags.length === 0) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = tags.map((t) => `<span class="tag-chip">${t}</span>`).join("");
  }

  function renderSessionScreen(user, history) {
    const done = loggedToday(history);
    const entry = done ? history[history.length - 1] : null;
    const splitKey = done ? entry.splitKey : selectedSplitKey;
    const meta = getSplitMeta(splitKey);

    document.getElementById("session-icon").textContent = meta.icon;
    document.getElementById("session-name").textContent = meta.name;
    document.getElementById("session-tagline").textContent = meta.tagline;

    const statusEl = document.getElementById("session-status");
    const btn = document.getElementById("log-session-btn");
    const backLink = document.getElementById("back-to-options");

    if (done) {
      renderExerciseList(getEntryExercises(user, entry));
      renderTags(buildTags(entry));
      statusEl.classList.remove("hidden");
      btn.textContent = "Session Logged ✓";
      btn.disabled = true;
      btn.onclick = null;
      backLink.classList.add("hidden");
    } else {
      renderExerciseList(buildWorkoutPlan(user, splitKey, checkInState));
      renderTags(buildTags(checkInState));
      statusEl.classList.add("hidden");
      btn.textContent = "Start Session";
      btn.disabled = false;
      btn.onclick = () => {
        logSession(user, splitKey, checkInState);
        renderSessionScreen(user, getHistory(user));
      };
      backLink.classList.remove("hidden");
    }
  }

  function renderHistory(history) {
    const list = document.getElementById("history-list");
    list.innerHTML = "";

    if (history.length === 0) {
      const note = document.createElement("li");
      note.className = "empty-note";
      note.textContent = "No sessions logged yet — start today's to kick things off.";
      list.appendChild(note);
      return;
    }

    const recent = history.slice(-5).reverse();
    recent.forEach((entry) => {
      const meta = getSplitMeta(entry.splitKey);
      const metaLine = entry.minutes
        ? `${entry.minutes} min · ${ENERGY_LABEL[entry.energy]}${entry.partner ? " · w/ partner" : ""}`
        : "";
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="hist-icon">${meta.icon}</span>
        <span class="hist-name">${meta.name}</span>
        <span class="hist-date">${formatShortDate(entry.date)}</span>
        ${metaLine ? `<span class="hist-meta">${metaLine}</span>` : ""}
      `;
      list.appendChild(li);
    });
  }

  function formatShortDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function renderStreak(history) {
    const streak = currentStreak(history);
    const badge = document.getElementById("streak-badge");
    if (streak > 0) {
      badge.classList.remove("hidden");
      document.getElementById("streak-count").textContent = streak;
    } else {
      badge.classList.add("hidden");
    }
  }

  function renderSessionFull(user) {
    const persona = PERSONAS[user];
    const history = getHistory(user);
    renderGoal(persona);
    renderSessionScreen(user, history);
    renderHistory(history);
    renderStreak(history);
  }

  // ---------- rendering: check-in screen ----------

  function selectChip(row, value) {
    row.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.value === String(value));
    });
  }

  function renderCheckIn(user) {
    checkInState = { minutes: 30, energy: "medium", partner: "no" };
    document.getElementById("checkin-name").textContent = PERSONAS[user].name;
    selectChip(document.getElementById("checkin-energy"), checkInState.energy);
    selectChip(document.getElementById("checkin-minutes"), checkInState.minutes);
    selectChip(document.getElementById("checkin-partner"), checkInState.partner);
  }

  function initCheckIn() {
    ["checkin-energy", "checkin-minutes", "checkin-partner"].forEach((id) => {
      const row = document.getElementById(id);
      row.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const key = row.dataset.option;
        const raw = chip.dataset.value;
        checkInState[key] = key === "minutes" ? Number(raw) : raw;
        selectChip(row, raw);
      });
    });

    document.getElementById("checkin-submit").addEventListener("click", () => {
      showSelect(currentUser);
    });

    document.getElementById("checkin-switch").addEventListener("click", showLogin);
  }

  // ---------- rendering: select screen ----------

  function renderSelectScreen(user, history) {
    const rec = recommendSplit(history, checkInState);
    const recMeta = getSplitMeta(rec.key);

    document.getElementById("rec-icon").textContent = recMeta.icon;
    document.getElementById("rec-name").textContent = recMeta.name;
    document.getElementById("rec-tagline").textContent = recMeta.tagline;
    document.getElementById("rec-reason").textContent = rec.reason;
    document.getElementById("recommended-card").onclick = () => selectSplitAndPreview(user, rec.key);

    const altKeys = SPLIT_ORDER.filter((k) => k !== rec.key);
    const altContainer = document.getElementById("alt-options");
    altContainer.innerHTML = "";
    altKeys.forEach((key) => {
      const meta = getSplitMeta(key);
      const card = document.createElement("button");
      card.className = "alt-card";
      card.innerHTML = `
        <span class="alt-icon">${meta.icon}</span>
        <span class="alt-name">${meta.name}</span>
        <span class="alt-tagline">${meta.tagline}</span>
      `;
      card.onclick = () => selectSplitAndPreview(user, key);
      altContainer.appendChild(card);
    });
  }

  function selectSplitAndPreview(user, splitKey) {
    selectedSplitKey = splitKey;
    showScreen("session-screen");
    renderSessionFull(user);
  }

  function initSelectScreen() {
    document.getElementById("select-switch").addEventListener("click", showLogin);
    document.getElementById("custom-workout-btn").addEventListener("click", () => showCustom(currentUser));
    document.getElementById("back-to-options").addEventListener("click", () => showSelect(currentUser));
  }

  // ---------- rendering: custom builder screen ----------

  function renderCustomScreen(user) {
    customSelection = new Map();
    const container = document.getElementById("custom-groups");
    container.innerHTML = "";

    SPLIT_ORDER.forEach((splitKey) => {
      const meta = getSplitMeta(splitKey);
      const group = document.createElement("div");
      group.className = "custom-group";

      const heading = document.createElement("span");
      heading.className = "custom-group-heading";
      heading.textContent = `${meta.icon} ${meta.name}`;
      group.appendChild(heading);

      const list = document.createElement("div");
      list.className = "custom-ex-list";

      SPLIT_LIBRARY[splitKey].exercises[user].forEach((ex, i) => {
        const id = `${splitKey}:${i}`;
        const row = document.createElement("label");
        row.className = "custom-ex-row";
        row.innerHTML = `
          <input type="checkbox" data-id="${id}" data-name="${ex.name}" data-detail="${ex.detail}" />
          <span class="custom-ex-name">${ex.name}</span>
          <span class="custom-ex-detail">${ex.detail}</span>
        `;
        list.appendChild(row);
      });

      group.appendChild(list);
      container.appendChild(group);
    });

    updateCustomFooter();
  }

  function updateCustomFooter() {
    const count = customSelection.size;
    document.getElementById("custom-count").textContent = `${count} selected`;
    document.getElementById("custom-start-btn").disabled = count === 0;
  }

  function initCustomScreen() {
    document.getElementById("custom-back").addEventListener("click", () => showSelect(currentUser));

    document.getElementById("custom-groups").addEventListener("change", (e) => {
      const input = e.target.closest("input[type=checkbox]");
      if (!input) return;
      const { id, name, detail } = input.dataset;
      if (input.checked) customSelection.set(id, { name, detail });
      else customSelection.delete(id);
      updateCustomFooter();
    });

    document.getElementById("custom-start-btn").addEventListener("click", () => {
      if (customSelection.size === 0) return;
      logSession(currentUser, "custom", {
        ...checkInState,
        partner: checkInState.partner === "yes",
        exercises: Array.from(customSelection.values()),
      });
      showScreen("session-screen");
      renderSessionFull(currentUser);
    });
  }

  // ---------- navigation ----------

  function showLogin() {
    currentUser = null;
    selectedSplitKey = null;
    showScreen("login-screen");
  }

  function showWelcome(user) {
    const persona = PERSONAS[user];
    document.documentElement.style.setProperty("--accent", persona.accent);
    document.getElementById("welcome-name").textContent = persona.name.toUpperCase();

    showScreen("welcome-screen");
    const welcome = document.getElementById("welcome-screen");

    // restart the pulse animation on a fresh element
    const nameEl = document.getElementById("welcome-name");
    nameEl.classList.remove("riff-pulse");
    void nameEl.offsetWidth;
    nameEl.classList.add("riff-pulse");

    playRiff();

    const advance = () => {
      welcome.removeEventListener("click", advance);
      clearTimeout(timer);
      currentUser = user;
      const history = getHistory(user);
      if (loggedToday(history)) {
        selectedSplitKey = null;
        showScreen("session-screen");
        renderSessionFull(user);
      } else {
        showScreen("checkin-screen");
        renderCheckIn(user);
      }
    };
    welcome.addEventListener("click", advance);
    const timer = setTimeout(advance, 2600);
  }

  function showSelect(user) {
    currentUser = user;
    showScreen("select-screen");
    renderSelectScreen(user, getHistory(user));
  }

  function showCustom(user) {
    currentUser = user;
    showScreen("custom-screen");
    renderCustomScreen(user);
  }

  // ---------- init ----------

  document.querySelectorAll(".user-card").forEach((card) => {
    card.addEventListener("click", () => showWelcome(card.dataset.user));
  });

  document.getElementById("switch-user").addEventListener("click", showLogin);

  document.getElementById("sound-toggle").addEventListener("click", () => {
    setSoundEnabled(!soundEnabled);
  });
  setSoundEnabled(soundEnabled);

  initCheckIn();
  initSelectScreen();
  initCustomScreen();

  renderClock();
  setInterval(renderClock, 1000);

  showLogin();
})();
