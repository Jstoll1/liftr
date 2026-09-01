(() => {
  "use strict";

  const STORAGE_KEY = "liftr_history_v3";
  const NOTES_KEY = "liftr_notes_v1";

  // Fill this in with your deployed Cloudflare Worker URL once the AI
  // backend is live (see worker/README.md). Left empty, the app falls back
  // to the local rule-based planner below — everything still works without it.
  const AI_ENDPOINT = "https://liftr-ai.jhs797.workers.dev";
  const AI_TIMEOUT_MS = 9000;

  // Rotation order for the training split. "Custom" sessions sit outside
  // this rotation entirely — they don't count as a rotation step.
  const SPLIT_ORDER = ["chest-back", "legs", "cardio", "core-mobility"];

  const PERSONAS = {
    jessica: {
      name: "Jessica",
      accent: "#c13cff",
      goal: "Build lean endurance for her first half-marathon",
    },
    jake: {
      name: "Jake",
      accent: "#05d9e8",
      goal: "Pack on strength for a 405lb deadlift",
    },
  };

  const PROFILE_KEY = "liftr_profile_v1";

  function loadAllProfiles() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveProfile(user, profile) {
    const all = loadAllProfiles();
    all[user] = profile;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
    pushToCloud(user);
  }

  // ---------- bodyweight log (for the weight-trends graph) ----------

  const WEIGHIN_KEY = "liftr_weighins_v1";

  function loadAllWeighIns() {
    try {
      return JSON.parse(localStorage.getItem(WEIGHIN_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveAllWeighIns(all) {
    localStorage.setItem(WEIGHIN_KEY, JSON.stringify(all));
  }

  // Chronological (oldest first) — the graph and any date-range logic reads
  // in this order.
  function getWeighIns(user) {
    return (loadAllWeighIns()[user] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  // One entry per date — logging again for a date already on file overwrites
  // it rather than duplicating a point on the graph.
  function logWeighIn(user, date, weight) {
    const all = loadAllWeighIns();
    if (!all[user]) all[user] = [];
    const idx = all[user].findIndex((w) => w.date === date);
    if (idx >= 0) all[user][idx] = { date, weight };
    else all[user].push({ date, weight });
    saveAllWeighIns(all);

    // Keep the persona's "current" bodyweight (used for AI context on
    // Settings) in sync whenever this is the most recent weigh-in on file —
    // saveProfile already pushes to the cloud, so only push directly here
    // when that path isn't taken (e.g. backfilling an older date).
    const latest = [...all[user]].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (latest && latest.date === date) {
      const persona = getPersonaProfile(user);
      saveProfile(user, { ...persona, weightLb: weight });
    } else {
      pushToCloud(user);
    }
  }

  // ---------- local JSON backup / restore ----------
  // Manual insurance policy independent of the cloud sync below — a single
  // file with both personas' full state, in case a device's storage (or the
  // Worker) is ever unavailable.

  function exportBackupFile() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      history: loadAllHistory(),
      notes: loadAllNotes(),
      profile: loadAllProfiles(),
      cheers: loadAllCheers(),
      weighIns: loadAllWeighIns(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liftr-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch {
        alert("That file isn't valid JSON — couldn't restore it.");
        return;
      }
      if (!data || typeof data !== "object") {
        alert("That doesn't look like a Liftr backup file.");
        return;
      }
      if (data.history) saveAllHistory(data.history);
      if (data.notes) saveAllNotes(data.notes);
      if (data.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
      if (data.cheers) localStorage.setItem(CHEERS_KEY, JSON.stringify(data.cheers));
      if (data.weighIns) localStorage.setItem(WEIGHIN_KEY, JSON.stringify(data.weighIns));
      Object.keys(PERSONAS).forEach((u) => pushToCloud(u));
      alert("Backup restored. Reloading...");
      location.reload();
    };
    reader.readAsText(file);
  }

  // ---------- cross-device sync (Cloudflare KV) ----------
  // localStorage stays the source of truth for instant, offline-first reads;
  // this layer just keeps a copy in the cloud so a second phone can catch up.
  // Pull once on entry, push after each meaningful save — never on every tap.

  function pushToCloud(user) {
    if (!AI_ENDPOINT) return;
    const payload = {
      history: getHistory(user),
      notes: getNotes(user),
      profile: loadAllProfiles()[user] || {},
      weighIns: loadAllWeighIns()[user] || [],
    };
    fetch(`${AI_ENDPOINT}/kv?user=${user}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }).catch(() => {});
  }

  // Fetches the cloud copy of state + any pending cheers for this user and
  // merges them into localStorage. Fails silently — offline just means the
  // app keeps working off whatever's already local.
  async function pullFromCloud(user) {
    if (!AI_ENDPOINT) return;
    try {
      const [stateRes, cheersRes] = await Promise.all([
        fetch(`${AI_ENDPOINT}/kv?user=${user}`, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }),
        fetch(`${AI_ENDPOINT}/cheers?user=${user}`, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }),
      ]);

      if (stateRes.ok) {
        const data = await stateRes.json();
        if (data.value) {
          const { history, notes, profile, weighIns } = data.value;
          if (Array.isArray(history)) {
            const all = loadAllHistory();
            all[user] = history;
            saveAllHistory(all);
          }
          if (Array.isArray(notes)) {
            const all = loadAllNotes();
            all[user] = notes;
            saveAllNotes(all);
          }
          if (profile) {
            const all = loadAllProfiles();
            all[user] = profile;
            localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
          }
          if (Array.isArray(weighIns)) {
            const all = loadAllWeighIns();
            all[user] = weighIns;
            saveAllWeighIns(all);
          }
        } else {
          // Nothing in the cloud yet for this user — seed it from local.
          pushToCloud(user);
        }
      }

      if (cheersRes.ok) {
        const data = await cheersRes.json();
        const cloudCheers = Array.isArray(data.cheers) ? data.cheers : [];
        if (cloudCheers.length > 0) {
          const all = loadAllCheers();
          all[user] = [...(all[user] || []), ...cloudCheers];
          localStorage.setItem(CHEERS_KEY, JSON.stringify(all));
          fetch(`${AI_ENDPOINT}/cheers?user=${user}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(AI_TIMEOUT_MS),
          }).catch(() => {});
        }
      }
    } catch {
      // Worker unreachable — keep going with whatever's local.
    }
  }

  // Merges the athlete's editable settings (goal override, height, weight,
  // focus areas) over the static base persona — everything the app reads
  // about a user goes through here, so a settings edit takes effect
  // everywhere immediately without touching call sites individually.
  function getPersonaProfile(user) {
    const base = PERSONAS[user];
    const stored = loadAllProfiles()[user] || {};
    return {
      name: base.name,
      accent: base.accent,
      goal: stored.goal?.trim() || base.goal,
      heightIn: stored.heightIn ?? null,
      weightLb: stored.weightLb ?? null,
      focusAreas: Array.isArray(stored.focusAreas) ? stored.focusAreas : [],
      excludedExercises: Array.isArray(stored.excludedExercises) ? stored.excludedExercises : [],
      lastGreetingTopic: stored.lastGreetingTopic ?? null,
    };
  }

  // Permanently bans an exercise from ever being auto-suggested again (by
  // the AI or the local fallback) — not just for today's session. Reversible
  // from Settings. Kept on the profile so it syncs and backs up with
  // everything else.
  function excludeExercise(user, exerciseName) {
    const persona = getPersonaProfile(user);
    if (persona.excludedExercises.includes(exerciseName)) return;
    saveProfile(user, { ...persona, excludedExercises: [...persona.excludedExercises, exerciseName] });
  }

  function includeExercise(user, exerciseName) {
    const persona = getPersonaProfile(user);
    saveProfile(user, { ...persona, excludedExercises: persona.excludedExercises.filter((n) => n !== exerciseName) });
  }

  function otherUser(user) {
    return user === "jake" ? "jessica" : "jake";
  }

  // ---------- cross-user cheers ----------
  // A tiny "leave them a note" feature — cheers are stored keyed by the
  // RECEIVING user, shown once on their next check-in recap, then cleared.

  const CHEERS_KEY = "liftr_cheers_v1";
  const CHEER_PRESETS = ["🔥 Keep it up!", "💪 You've got this!", "👏 Proud of you!", "🙌 Crushing it lately!"];

  function loadAllCheers() {
    try {
      return JSON.parse(localStorage.getItem(CHEERS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function sendCheer(toUser, fromUser, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const all = loadAllCheers();
    if (!all[toUser]) all[toUser] = [];
    all[toUser].push({ from: fromUser, text: trimmed, date: todayStr() });
    localStorage.setItem(CHEERS_KEY, JSON.stringify(all));
    if (AI_ENDPOINT) {
      fetch(`${AI_ENDPOINT}/cheers?user=${toUser}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromUser, text: trimmed }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      }).catch(() => {});
    }
  }

  // Pops (reads + clears) any unseen cheers waiting for this user.
  function takeUnseenCheers(user) {
    const all = loadAllCheers();
    const pending = all[user] || [];
    if (pending.length === 0) return [];
    all[user] = [];
    localStorage.setItem(CHEERS_KEY, JSON.stringify(all));
    return pending;
  }

  const SPLIT_LIBRARY = {
    "chest-back": {
      name: "Chest & Back",
      icon: "💪",
      tagline: "Push-pull strength builder",
      exercises: {
        jessica: [
          { name: "Push-Up Ladder", detail: "3 x 12", superset: "A", howTo: "From a plank, lower your chest to the floor and push back up — ladder means add a rep each round.", tip: "Keep your core braced and lower with control — quality over speed." },
          { name: "Lat Pulldown", detail: "3 x 15", superset: "A", howTo: "Seated at the machine, pull the bar down to your upper chest, then control it back up.", tip: "Drive your elbows down and back, not your hands." },
          { name: "Dumbbell Chest Press", detail: "3 x 12", superset: "B", howTo: "Lying on a bench, press two dumbbells up from chest level until your arms are extended.", tip: "Lower until your elbows are just below your shoulders, then press up and slightly in." },
          { name: "Seated Cable Row", detail: "3 x 15", superset: "B", howTo: "Seated at the cable, pull the handle to your torso while keeping your back straight.", tip: "Squeeze your shoulder blades together at the finish, don't just pull with your arms." },
          { name: "Plank to Row", detail: "3 x 10/side", howTo: "In a plank with a dumbbell in each hand, row one dumbbell to your ribs, alternating sides.", tip: "Keep your hips square — resist the urge to rotate as you row." },
        ],
        jake: [
          { name: "Barbell Bench Press", detail: "4 x 6", superset: "A", howTo: "Lying on a bench, lower the bar to your chest, then press it back up to full arm extension.", tip: "Keep your feet planted and drive through your upper back for a stable base." },
          { name: "Weighted Pull-Ups", detail: "4 x 6", superset: "A", howTo: "With extra weight attached, pull your chin over the bar from a dead hang.", tip: "Full range every rep — dead hang to chin over the bar." },
          { name: "Incline Dumbbell Press", detail: "3 x 8", superset: "B", howTo: "On a slightly inclined bench, press two dumbbells up from shoulder level.", tip: "30-degree incline max — steeper turns this into a shoulder press." },
          { name: "Bent-Over Barbell Row", detail: "4 x 8", superset: "B", howTo: "Hinged forward at the hips, pull the barbell up to your lower ribs.", tip: "Hinge at the hips, flat back, pull to your lower ribs." },
          { name: "Cable Fly", detail: "3 x 12", howTo: "Standing between two cable stacks, bring the handles together in front of your chest in an arcing motion.", tip: "Slight bend in the elbows the whole way — think 'hug a tree,' not 'press.'" },
        ],
      },
    },
    legs: {
      name: "Leg Day",
      icon: "🦵",
      tagline: "Lower body power & stability",
      exercises: {
        jessica: [
          { name: "Goblet Squat", detail: "3 x 15", superset: "A", howTo: "Hold a dumbbell at your chest and squat down until your thighs are parallel to the floor.", tip: "Hold the weight close to your chest and sit straight down between your heels." },
          { name: "Leg Press", detail: "3 x 12", superset: "A", howTo: "Sit firmly against the machine pad and press the platform away by extending your legs, then lower it with control.", tip: "Use a shoulder-width stance and let your knees travel naturally over your toes to emphasize your quads." },
          { name: "Step-Ups", detail: "3 x 12/leg", superset: "A", howTo: "Step one foot fully onto a box or bench and drive up until that leg is straight.", tip: "Drive through the heel of your working leg — don't push off the back foot." },
          { name: "Glute Bridge", detail: "3 x 15", howTo: "Lying on your back with knees bent, drive your hips up toward the ceiling.", tip: "Squeeze your glutes hard at the top, pause for a beat." },
          { name: "Lateral Band Walk", detail: "3 x 20", howTo: "With a band around your ankles or knees, take small steps sideways in a partial squat.", tip: "Stay low and keep tension on the band the entire time." },
          { name: "Bodyweight Lunge", detail: "3 x 12/leg", howTo: "Step forward and drop your back knee toward the floor, then push back to standing.", tip: "Keep your front knee tracking over your ankle, not caving in." },
        ],
        jake: [
          { name: "Barbell Back Squat", detail: "5 x 5", superset: "A", howTo: "With the bar across your upper back, squat down until your hips are below your knees, then stand.", tip: "Brace your core before you unrack, and keep your chest tall through the whole rep." },
          { name: "Romanian Deadlift", detail: "4 x 6", superset: "A", howTo: "Holding the bar, push your hips back and lower it along your legs until you feel a hamstring stretch.", tip: "Push your hips back, not down — you should feel this in your hamstrings." },
          { name: "Walking Lunges", detail: "3 x 10/leg", howTo: "Step forward into a lunge, then bring your back foot through into the next lunge.", tip: "Take a long enough stride that your front knee stays behind your toes." },
          { name: "Leg Press", detail: "3 x 10", howTo: "Seated in the machine, push the platform away by extending your legs, then control it back.", tip: "Don't let your lower back round off the pad at the bottom." },
          { name: "Standing Calf Raise", detail: "4 x 15", howTo: "Rise up onto the balls of your feet, then lower back down under control.", tip: "Pause at the top and the bottom — don't just bounce through it." },
        ],
      },
    },
    cardio: {
      name: "Cardio",
      icon: "🔥",
      tagline: "Conditioning & active recovery",
      exercises: {
        jessica: [
          { name: "Tempo Run", detail: "25 min", howTo: "A steady, moderately hard run held for the full duration.", tip: "Aim for a pace you could hold a short conversation at, not a sprint." },
          { name: "Stair Climber Intervals", detail: "15 min", howTo: "Alternate between a hard push and an easier recovery pace on the stair climber.", tip: "Push the pace on work intervals, actually recover on the rest ones." },
          { name: "Cycling", detail: "20 min", howTo: "A steady-state ride at a consistent, moderate effort.", tip: "Keep a steady cadence — smooth and controlled beats mashing the pedals." },
          { name: "Mobility Flow", detail: "10 min", howTo: "A slow sequence of stretches and controlled movements to aid recovery.", tip: "Move slow and controlled — this is recovery, not a workout." },
        ],
        jake: [
          { name: "Rowing Intervals", detail: "8 x 500m", howTo: "Row hard for the target distance, then rest before the next interval.", tip: "Drive with your legs first, then lean back, then pull — legs, hips, arms." },
          { name: "Sled Push", detail: "6 rounds", howTo: "Load a sled and push it forward across the marked distance.", tip: "Stay low with a slight forward lean, drive through the balls of your feet." },
          { name: "Battle Ropes", detail: "5 x 30s", howTo: "Alternate slamming the ropes up and down as fast as you can for the interval.", tip: "Keep your core tight — the power comes from your shoulders, not your wrists." },
          { name: "Jump Rope Finisher", detail: "5 min", howTo: "Continuous jump rope at a steady pace for the full duration.", tip: "Small, quick hops — you shouldn't be jumping high off the ground." },
        ],
      },
    },
    "core-mobility": {
      name: "Core & Mobility",
      icon: "🧘",
      tagline: "Light movement & recovery",
      exercises: {
        jessica: [
          { name: "Dead Bug", detail: "3 x 12", howTo: "Lying on your back, extend opposite arm and leg while keeping your lower back flat.", tip: "Keep your lower back pressed into the floor the entire set." },
          { name: "Hip Flexor Stretch Flow", detail: "5 min", howTo: "A half-kneeling stretch sequence targeting the front of the hips.", tip: "Squeeze the glute on your back leg to deepen the stretch safely." },
          { name: "Side Plank", detail: "3 x 30s/side", howTo: "Prop yourself up on one forearm with your body in a straight line, hips lifted.", tip: "Stack your hips and keep your body in one straight line." },
          { name: "Cat-Cow Flow", detail: "5 min", howTo: "On hands and knees, alternate arching and rounding your spine with your breath.", tip: "Move with your breath — inhale to arch, exhale to round." },
        ],
        jake: [
          { name: "Hanging Leg Raise", detail: "3 x 12", howTo: "Hanging from a bar, raise your legs up toward your chest with control.", tip: "Control the descent — don't let momentum swing you through the rep." },
          { name: "90/90 Hip Flow", detail: "5 min", howTo: "Seated with both legs bent at 90 degrees, rotate between positions to open the hips.", tip: "Keep your chest tall as you rotate between positions." },
          { name: "Weighted Plank", detail: "3 x 45s", howTo: "Hold a forearm plank with a plate on your back for added load.", tip: "Squeeze your glutes and brace like you're about to get punched." },
          { name: "Thoracic Rotation Flow", detail: "5 min", howTo: "On hands and knees, rotate one arm up and open your chest toward the ceiling.", tip: "Rotate from your upper back, keep your hips still." },
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
      jessica: { name: "Finisher: Burpee Pulse", detail: "3 x 10", howTo: "A continuous, lower-impact burpee — step back instead of jumping, then step back up.", tip: "Keep the pace steady — a sustainable rhythm beats an all-out first ten seconds." },
      jake: { name: "Finisher: Death-Rep Push-Ups", detail: "2 x max", howTo: "Standard push-ups performed to full fatigue.", tip: "Go until your form breaks down, not just until it's hard." },
    },
    legs: {
      jessica: { name: "Finisher: Jump Squats", detail: "3 x 12", howTo: "A bodyweight squat with an explosive jump at the top.", tip: "Land soft, immediately absorb into your next rep." },
      jake: { name: "Finisher: Bodyweight Squat Burnout", detail: "1 x max", howTo: "Bodyweight squats performed continuously to fatigue.", tip: "Full depth every rep, even as your legs fatigue." },
    },
    cardio: {
      jessica: { name: "Finisher: All-Out Sprint", detail: "6 x 30s", howTo: "Maximum-effort sprints with brief rest between.", tip: "This is 100% effort — leave nothing in the tank." },
      jake: { name: "Finisher: Assault Bike Sprint", detail: "5 x 20s", howTo: "Maximum-effort intervals on the assault bike.", tip: "Push and pull with your arms too — it's a full-body effort." },
    },
    "core-mobility": {
      jessica: { name: "Finisher: Mountain Climbers", detail: "3 x 20", howTo: "From a plank, drive your knees toward your chest quickly, alternating legs.", tip: "Keep your hips low and driven, don't let them ride up." },
      jake: { name: "Finisher: Bear Crawl", detail: "3 x 20m", howTo: "Crawl forward on hands and feet with your knees just off the ground.", tip: "Move opposite hand and foot together, keep your hips level." },
    },
  };

  // Bonus exercise appended when training with a partner.
  const PARTNER_EXTRAS = {
    "chest-back": {
      jessica: { name: "Partner Med-Ball Chest Pass", detail: "3 x 15", howTo: "Stand facing your partner and pass a medicine ball back and forth from your chest.", tip: "Step into each pass and catch with soft hands." },
      jake: { name: "Partner Resistance Push-Off", detail: "3 x 15", howTo: "Your partner holds light resistance against your press or push movement.", tip: "Your partner provides steady resistance — communicate the pace." },
    },
    legs: {
      jessica: { name: "Partner Wall-Sit Hold", detail: "3 x 45s", howTo: "Both hold a wall-sit together, thighs parallel to the floor.", tip: "Thighs parallel to the floor, back flat against the wall." },
      jake: { name: "Partner Sled Drag", detail: "4 x 20m", howTo: "One partner drags the sled while the other walks alongside coaching form.", tip: "Take turns — one drags while the other rests and coaches form." },
    },
    cardio: {
      jessica: { name: "Partner Medicine Ball Circuit", detail: "10 min", howTo: "Trade off exercises with a medicine ball in a continuous circuit.", tip: "Keep the ball moving — minimal rest between exchanges." },
      jake: { name: "Partner Relay Sprints", detail: "6 x 100m", howTo: "Take turns sprinting a set distance while your partner rests.", tip: "Full sprint on your leg, then actively recover while you wait." },
    },
    "core-mobility": {
      jessica: { name: "Partner Plank Hand-Slap", detail: "3 x 20s", howTo: "Both hold a plank facing each other, taking turns reaching to slap hands.", tip: "Keep your core braced even as you reach to slap hands." },
      jake: { name: "Partner-Assisted Stretch Flow", detail: "8 min", howTo: "Your partner gently assists deepening a series of stretches.", tip: "Communicate constantly — you control how deep the stretch goes." },
    },
  };

  // Generic warm-up checklist shown before the exercise list — purely a
  // visual, ephemeral checklist (not persisted, not sent to the AI).
  const WARMUPS = {
    "chest-back": ["5 min light cardio to raise your heart rate", "Band pull-aparts x 15", "Arm circles + shoulder rolls x 10 each way"],
    legs: ["5 min easy bike or brisk walk", "Bodyweight squats x 15", "Leg swings x 10 each leg"],
    cardio: ["3 min easy pace ramp-up", "Dynamic leg swings x 10 each leg", "A few strides at building effort"],
    "core-mobility": ["Cat-cow x 10", "World's greatest stretch x 5 each side", "Deep breaths, slow it down"],
    custom: ["5 min light cardio to raise your heart rate", "Dynamic stretches for whatever's on today's list", "A lighter warm-up set before your first heavy set"],
  };

  function getWarmup(splitKey) {
    return WARMUPS[splitKey] || WARMUPS.custom;
  }

  // ---------- exercise images ----------
  // Looks for images/<body-part>/<slugified-exercise-name>.jpg — drop real
  // photos into that structure (see worker-free root /images folder) and
  // they'll be picked up automatically; missing files fall back to an icon
  // tile gracefully (see the onerror handling in renderWorkoutExercises).

  const CHEST_BACK_CHEST_EXERCISES = new Set([
    "Push-Up Ladder",
    "Dumbbell Chest Press",
    "Cable Fly",
    "Barbell Bench Press",
    "Incline Dumbbell Press",
    "Finisher: Burpee Pulse",
    "Finisher: Death-Rep Push-Ups",
    "Partner Med-Ball Chest Pass",
    "Partner Resistance Push-Off",
  ]);

  const SPLIT_BODY_PART = { legs: "legs", cardio: "cardio", "core-mobility": "core" };

  function getBodyPart(splitKey, exerciseName) {
    if (splitKey === "chest-back") {
      return CHEST_BACK_CHEST_EXERCISES.has(exerciseName) ? "chest" : "back";
    }
    return SPLIT_BODY_PART[splitKey] || "core";
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getExerciseImagePath(splitKey, exerciseName) {
    return `images/${getBodyPart(splitKey, exerciseName)}/${slugify(exerciseName)}.jpg`;
  }

  // ---------- set/rep parsing ----------
  // Reads a "detail" string like "4 x 6" into a set count + target reps so
  // the workout runner knows how many set rows to draw and whether they get
  // a rep stepper (clean "N x reps") or a simple complete-toggle (timed
  // cardio, AMRAP finishers, "N rounds," etc.).

  function parseSetCount(detail) {
    const m = detail.match(/^(\d+)\s*(?:x\b|rounds?\b)/i);
    return m ? Math.min(Number(m[1]), 8) : 1;
  }

  function isRepBased(detail) {
    return /^\d+\s*x\s*\d+(\/\S+)?$/i.test(detail.trim());
  }

  function parseTargetReps(detail) {
    if (!isRepBased(detail)) return null;
    const m = detail.match(/^\d+\s*x\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  const ENERGY_LABEL = { low: "Low Energy", medium: "Medium Energy", high: "High Energy" };
  const TIME_TO_COUNT = { 15: 2, 30: 3, 45: 4, 60: 6 };

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
    pushToCloud(user);
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

  // ---------- persistent check-in notes ----------
  // Free-text feedback (equipment changes, goal updates, "struggled with
  // 205 today," etc.) persists here across sessions so the AI can reference
  // it later — separate from the workout history itself.

  function loadAllNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTES_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveAllNotes(all) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  }

  function getNotes(user) {
    return loadAllNotes()[user] || [];
  }

  function logNote(user, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const all = loadAllNotes();
    if (!all[user]) all[user] = [];
    all[user].push({ date: todayStr(), text: trimmed });
    saveAllNotes(all);
    pushToCloud(user);
  }

  // Prior days' notes only — today's is passed separately as todayNote so
  // the AI sees it distinctly from the history it's meant to build on.
  function getPastNotes(user, limit = 5) {
    return getNotes(user)
      .filter((n) => n.date !== todayStr())
      .slice(-limit);
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
      reason = `You hit ${SPLIT_LIBRARY[last.splitKey].name} ${describeWhen(last.date)} — ${SPLIT_LIBRARY[rotationPick].name} is up next.`;
    }
    return { key: rotationPick, reason };
  }

  // Turns a stored YYYY-M-D date into "today" / "yesterday" / "on Aug 29".
  function describeWhen(dateStr) {
    if (dateStr === todayStr()) return "today";
    if (dateStr === daysAgo(1)) return "yesterday";
    return `on ${formatShortDate(dateStr)}`;
  }

  // ---------- workout plan builder ----------

  function normalizeExerciseText(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Every exercise name this persona could ever be offered — base lists,
  // finishers, and partner bonuses across every split. Used to match free
  // chat text (stated weights, exclusions) against a known, closed set of
  // names rather than guessing.
  function getAllExerciseNames(user) {
    const names = new Set();
    Object.values(SPLIT_LIBRARY).forEach((split) => split.exercises[user]?.forEach((ex) => names.add(ex.name)));
    Object.values(FINISHERS).forEach((entry) => entry[user] && names.add(entry[user].name));
    Object.values(PARTNER_EXTRAS).forEach((entry) => entry[user] && names.add(entry[user].name));
    return Array.from(names);
  }

  // The base list for a split with anything the athlete has permanently
  // excluded already filtered out — the single choke point every planner
  // (AI candidates and the local fallback alike) reads through, so an
  // excluded exercise can never come back as a suggestion.
  function getAvailableExercises(user, splitKey) {
    const excluded = new Set(getPersonaProfile(user).excludedExercises);
    return SPLIT_LIBRARY[splitKey].exercises[user].filter((ex) => !excluded.has(ex.name));
  }

  // Turns a base exercise list into today's actual plan based on the
  // amount of time available, energy level, and whether a partner is along.
  function buildWorkoutPlan(user, splitKey, { minutes, energy, partner }) {
    const base = getAvailableExercises(user, splitKey);
    let count = Math.min(TIME_TO_COUNT[minutes] ?? base.length, base.length);
    if (energy === "low") count = Math.max(2, count - 1);
    if (energy === "high") count = Math.min(base.length, count + 1);

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

  // Body-part/focus keywords, each anchored to a nearby intent verb so
  // "focus on my back" counts but "my lower back hurts" doesn't get
  // misread as a training focus instead of a pain flag.
  const FOCUS_INTENT = /\b(focus(?:ing)? on|emphasi[sz]e|work(?:ing)? on|target(?:ing)?|hit|prioriti[sz]e|more|extra)\b/;
  const FOCUS_KEYWORDS = {
    quads: /\b(quad|quads|quadriceps)\b/,
    glutes: /\b(glute|glutes|booty)\b/,
    hamstrings: /\b(hamstring|hamstrings|posterior chain)\b/,
    chest: /\b(chest|pecs?)\b/,
    back: /\b(back|lats?)\b/,
  };
  // Which exercise traits (from getExerciseTraits) satisfy each focus —
  // this is what lets focus-reordering work on every split instead of a
  // hardcoded exercise list per muscle group.
  const FOCUS_TRAITS = {
    quads: ["quads"],
    glutes: ["glutes"],
    hamstrings: ["hamstrings"],
    chest: ["horizontalPush"],
    back: ["horizontalPull", "verticalPull"],
  };

  // Matches free text like "225 on bench" or "start me at 185 for squat"
  // against this persona's known exercise names by word overlap, so a
  // stated weight actually seeds that exercise today instead of the app
  // falling back to stale history or a generic AI guess.
  function detectWeightOverrides(text, user) {
    const overrides = [];
    const names = getAllExerciseNames(user);
    const pattern = /(\d{2,4})\s*(?:lb|lbs|pounds?)?\s*(?:on|for|with)\s+(?:the\s+)?([a-z][a-z\s-]{2,40})/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const weight = Number(match[1]);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const phraseWords = new Set(normalizeExerciseText(match[2]).split(" ").filter((w) => w.length > 2));
      if (phraseWords.size === 0) continue;
      let best = null;
      names.forEach((name) => {
        const nameWords = normalizeExerciseText(name.replace(/^finisher:\s*/i, "")).split(" ").filter((w) => w.length > 2);
        const overlap = nameWords.filter((w) => phraseWords.has(w)).length;
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { name, overlap };
      });
      if (best) overrides.push({ exercise: best.name, weight });
    }
    return overrides;
  }

  // Qualitative ("go lighter today") rather than a specific number — applies
  // as a relative adjustment to whatever the weight cascade would otherwise
  // pick, for every weighted exercise today, not just one named lift.
  function detectWeightDirection(text) {
    const value = String(text || "").toLowerCase();
    if (/\b(lighter|light today|go easy|easier|ease up|back off|less weight|reduce the weight|deload)\b/.test(value)) return "lighter";
    if (/\b(heavier|heavy today|push harder|more weight|increase the weight|max out|go big)\b/.test(value)) return "heavier";
    return null;
  }

  const EXCLUSION_INTENT = /\b(no|never|avoid|hate|can't|cannot|don't|do not|won't|stop|skip|remove|exclude|drop|without|take out)\b/;

  // Matches a specific named exercise against negative-intent language
  // ("no weighted pullups", "never squats") — comparison is on normalized
  // text (punctuation/case/hyphens stripped from both sides) so phrasing
  // like a missing hyphen doesn't cause a miss. Checked clause-by-clause
  // (split on sentence punctuation) rather than across the whole message,
  // so "no wait, let's do 225 on bench" doesn't misfire — the "no" and
  // "bench" never share a clause. Anything matched gets permanently
  // excluded, not just filtered for today — see excludeExercise.
  function detectExclusionRequests(text, user) {
    const names = getAllExerciseNames(user);
    const matches = new Set();
    String(text || "")
      .split(/[.!?;,]+/)
      .forEach((clause) => {
        if (!EXCLUSION_INTENT.test(clause.toLowerCase())) return;
        const norm = normalizeExerciseText(clause);
        names.forEach((name) => {
          const normName = normalizeExerciseText(name.replace(/^finisher:\s*/i, ""));
          if (normName && norm.includes(normName)) matches.add(name);
        });
      });
    return Array.from(matches);
  }

  // Interprets common focus requests locally so the recommendation reacts
  // immediately even when the coach service is offline or still responding.
  function getCoachFocus(text) {
    const value = String(text || "").toLowerCase();
    if (!FOCUS_INTENT.test(value)) return null;
    for (const [focus, pattern] of Object.entries(FOCUS_KEYWORDS)) {
      if (pattern.test(value)) return focus;
    }
    return null;
  }

  function inferSplitFromChat(text) {
    const value = String(text || "").toLowerCase();
    if (getCoachFocus(value) === "chest") return "chest-back";
    if (getCoachFocus(value) || /\b(leg|legs|lower body|squat|deadlift|lunge)\b/.test(value)) return "legs";
    if (/\b(chest|back|upper body|push|pull)\b/.test(value)) return "chest-back";
    if (/\b(cardio|run|running|conditioning|endurance)\b/.test(value)) return "cardio";
    if (/\b(core|abs|mobility|stretch|recovery)\b/.test(value)) return "core-mobility";
    return null;
  }

  // Keeps a requested muscle group visible in the actual draft rather than
  // only mentioning it in chat. Works for any split by ranking the real
  // candidate pool on trait overlap with the requested focus, instead of a
  // fixed exercise list per muscle group.
  function applyCoachFocus(user, splitKey, exercises, note) {
    const focus = getCoachFocus(note);
    const pool = buildCandidatePool(user, splitKey);
    let result = exercises;

    const traits = focus ? FOCUS_TRAITS[focus] : null;
    if (traits) {
      const requested = pool.filter((exercise) => {
        const exerciseTraits = getExerciseTraits(exercise);
        return traits.some((trait) => exerciseTraits.has(trait));
      });
      if (requested.length > 0) {
        const combined = [...requested, ...exercises];
        const unique = combined.filter((exercise, index, all) => all.findIndex((item) => item.name === exercise.name) === index);
        result = unique.slice(0, Math.max(exercises.length, Math.min(4, requested.length)));
      }
    }

    // Naming a specific exercise to skip is handled once, centrally, in
    // sendChatMessage (detectExclusionRequests bans it durably via
    // excludeExercise) — buildCandidatePool already keeps it out of `pool`
    // above, so it can't come back in `result` either. Only the general
    // "trim the volume" request needs handling here.
    const request = String(note || "").toLowerCase();
    if (/\b(fewer exercises|shorter workout|remove one exercise)\b/i.test(request) && result.length > 2) {
      result = result.slice(0, -1);
    }
    return result;
  }

  function getEntryExercises(user, entry) {
    if (Array.isArray(entry.exercises)) return entry.exercises;
    return buildWorkoutPlan(user, entry.splitKey, entry); // backward-compat for older logged entries
  }

  function buildTags({ minutes, energy, partner }) {
    const tags = [`${minutes} MIN`, ENERGY_LABEL[energy].toUpperCase()];
    if (partner) tags.push("W/ PARTNER");
    return tags;
  }

  // Everything the AI (or the local fallback) is allowed to choose from —
  // the base list plus the finisher/partner bonus moves, all up for grabs
  // based on today's actual context instead of always-on rules.
  function buildCandidatePool(user, splitKey) {
    const excluded = new Set(getPersonaProfile(user).excludedExercises);
    const pool = getAvailableExercises(user, splitKey);
    const finisher = FINISHERS[splitKey]?.[user];
    const partnerExtra = PARTNER_EXTRAS[splitKey]?.[user];
    if (finisher && !excluded.has(finisher.name)) pool.push(finisher);
    if (partnerExtra && !excluded.has(partnerExtra.name)) pool.push(partnerExtra);
    return pool;
  }

  // Asks the Cloudflare Worker (which holds the OpenAI key) to pick today's
  // exercises from the real candidate pool. Falls back to the local
  // rule-based planner on any failure, timeout, or if no endpoint is set.
  async function computePlan(user, splitKey, checkIn) {
    if (AI_ENDPOINT) {
      try {
        const persona = getPersonaProfile(user);
        const meta = SPLIT_LIBRARY[splitKey];
        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: {
              name: persona.name,
              goal: persona.goal,
              heightIn: persona.heightIn,
              weightLb: persona.weightLb,
              focusAreas: persona.focusAreas,
            },
            split: { key: splitKey, name: meta.name, tagline: meta.tagline },
            minutes: checkIn.minutes,
            energy: checkIn.energy,
            partner: Boolean(checkIn.partner),
            todayNote: (checkIn.note || "").trim() || null,
            pastNotes: getPastNotes(user, 5),
            weightHistory: buildWeightHistory(user),
            candidates: buildCandidatePool(user, splitKey),
          }),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });

        if (res.ok) {
          const data = await res.json();
          const validPlan =
            Array.isArray(data.exercises) &&
            data.exercises.length > 0 &&
            data.exercises.every((e) => e && typeof e.name === "string" && typeof e.detail === "string");
          if (validPlan) {
            const suggestedWeights = new Map(
              Array.isArray(data.suggestedWeights)
                ? data.suggestedWeights
                    .filter((s) => s && typeof s.exercise === "string" && Number.isFinite(s.weight))
                    .map((s) => [s.exercise, s.weight])
                : []
            );
            return {
              exercises: applyCoachFocus(user, splitKey, data.exercises, checkIn.note),
              reason: typeof data.reason === "string" ? data.reason : null,
              source: "ai",
              suggestedWeights,
            };
          }
        }
      } catch {
        // network error, timeout, or malformed response — fall through to local plan
      }
    }

    return {
      exercises: applyCoachFocus(user, splitKey, buildWorkoutPlan(user, splitKey, checkIn), checkIn.note),
      reason: null,
      source: "local",
      suggestedWeights: new Map(),
    };
  }

  // ---------- state ----------

  let currentUser = null;
  let checkInState = { minutes: 30, energy: "medium", partner: false, note: "", weightOverrides: {}, weightDirection: null };
  let chatMessages = []; // [{ role: "coach" | "user", text }] for the check-in chat
  let chatBusy = false;
  // Split key the coach picked up on from the conversation (e.g. "let's do
  // legs today"), overriding the rule-based recommendation when set.
  let chatSuggestedSplit = null;
  let recommendationDraft = null; // live exercise-level plan shown inside the recommendation card
  let recommendationDraftKey = null;
  let recommendationRequestId = 0; // prevents a slower, older coach response replacing a newer request
  let selectedSplitKey = null; // split chosen on the select screen, awaiting log
  let previewPlan = null; // { exercises, reason, source } computed for the current preview
  let customSelection = new Map(); // exerciseId -> { name, detail, splitKey, tip, superset }
  let activeWorkout = null; // { sessionSplitKey, exercises, logs, reason, source } for the in-progress workout runner

  // ---------- screen helpers ----------

  const SCREEN_IDS = [
    "login-screen",
    "welcome-screen",
    "checkin-screen",
    "settings-screen",
    "history-screen",
    "graph-screen",
    "select-screen",
    "custom-screen",
    "session-screen",
    "workout-screen",
  ];

  function showScreen(id) {
    SCREEN_IDS.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
    const homeButton = document.getElementById("home-button");
    if (homeButton) homeButton.classList.toggle("hidden", id === "login-screen" || id === "welcome-screen");
  }

  // ---------- rendering: clock / goal ----------

  function renderClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const timeHtml = `${hours}<span class="colon">:</span>${minutes} <span class="clock-ampm">${ampm}</span>`;

    const dateEl = document.getElementById("clock-date");
    const timeEl = document.getElementById("clock-time");
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
    if (timeEl) timeEl.innerHTML = timeHtml;

    // Same live clock also drives the flash banner on the active workout screen.
    const workoutTimeEl = document.getElementById("workout-clock-time");
    if (workoutTimeEl) workoutTimeEl.innerHTML = timeHtml;
  }

  function renderGoal(persona) {
    document.documentElement.style.setProperty("--accent", persona.accent);
    document.getElementById("goal-avatar").textContent = persona.name[0];
    document.getElementById("goal-avatar").style.setProperty("--accent", persona.accent);
    document.getElementById("goal-username").textContent = persona.name;
    document.getElementById("goal-text").textContent = persona.goal;
  }

  // ---------- rendering: session screen ----------

  // Compact "what you actually did" string for one exercise's logged sets —
  // e.g. "185×6, 185×5, 190×4" — falling back gracefully per set when only
  // reps or only weight were touched.
  function formatPerformanceSummary(perf) {
    const touched = (perf?.sets || []).filter((s) => s.actual != null || s.weight != null);
    if (touched.length === 0) return null;
    return touched
      .map((s) => {
        const reps = s.target != null ? String(s.actual ?? "-") : s.actual ? "✓" : "-";
        return s.weight != null ? `${s.weight}×${reps}` : reps;
      })
      .join(", ");
  }

  function renderExerciseList(exercises, performance) {
    const list = document.getElementById("session-exercises");
    list.innerHTML = "";
    exercises.forEach((ex) => {
      const loggedSummary = performance ? formatPerformanceSummary(performance[ex.name]) : null;
      const li = document.createElement("li");
      if (loggedSummary) li.classList.add("ex-logged");
      li.innerHTML = `<span>${escapeHtml(ex.name)}</span><span class="ex-detail">${escapeHtml(loggedSummary || ex.detail)}</span>`;
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

  function renderAiNote(text) {
    const el = document.getElementById("session-ai-note");
    if (!text) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = `🤖 ${text}`;
  }

  // Shown while computePlan() is awaiting the AI (or immediately resolving
  // the local fallback) — keeps the screen from looking frozen mid-fetch.
  function renderSessionLoading(splitKey) {
    const meta = getSplitMeta(splitKey);
    document.getElementById("session-icon").textContent = meta.icon;
    document.getElementById("session-name").textContent = meta.name;
    document.getElementById("session-tagline").textContent = "Personalizing your session…";
    document.getElementById("session-status").classList.add("hidden");
    renderTags(null);
    renderAiNote(null);

    const list = document.getElementById("session-exercises");
    list.innerHTML = '<li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li>';

    const btn = document.getElementById("log-session-btn");
    document.getElementById("preview-coach-section").classList.remove("hidden");
    document.getElementById("preview-actions").classList.remove("hidden");
    document.getElementById("edit-preview-btn").disabled = true;
    placeTerminalPanel("preview");
    btn.textContent = "Loading…";
    btn.disabled = true;
    btn.onclick = null;
    document.getElementById("back-to-options").classList.remove("hidden");
    document.getElementById("session-done-note").classList.add("hidden");
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
      document.getElementById("preview-coach-section").classList.add("hidden");
      document.getElementById("preview-actions").classList.add("hidden");
      renderExerciseList(getEntryExercises(user, entry), entry.performance);
      renderTags(buildTags(entry));
      renderAiNote(entry.source === "ai" ? entry.reason : null);
      statusEl.classList.remove("hidden");
      btn.textContent = "Session Logged ✓";
      btn.disabled = true;
      btn.onclick = null;
      backLink.classList.add("hidden");
      const hasPerformance = entry.performance && Object.keys(entry.performance).length > 0;
      document.getElementById("session-done-note").textContent = hasPerformance
        ? "🎉 Nice work — here's what you actually logged. See you tomorrow!"
        : "🎉 Session complete. See you tomorrow!";
      document.getElementById("session-done-note").classList.remove("hidden");
      return;
    }
    document.getElementById("session-done-note").classList.add("hidden");
    document.getElementById("preview-coach-section").classList.remove("hidden");
    document.getElementById("preview-actions").classList.remove("hidden");
    placeTerminalPanel("preview");

    if (!previewPlan) {
      renderSessionLoading(splitKey);
      return;
    }

    renderExerciseList(previewPlan.exercises);
    renderTags(buildTags(checkInState));
    renderAiNote(previewPlan.source === "ai" ? previewPlan.reason : null);
    statusEl.classList.add("hidden");
    document.getElementById("edit-preview-btn").disabled = false;
    btn.textContent = "Start Workout";
    btn.disabled = false;
    btn.onclick = () => {
      const exercises = previewPlan.exercises.map((ex) => ({ ...ex, splitKey }));
      showWorkout(user, splitKey, exercises, {
        reason: previewPlan.reason,
        source: previewPlan.source,
        suggestedWeights: previewPlan.suggestedWeights,
      });
    };
    backLink.classList.remove("hidden");
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
        ${entry.note ? `<span class="hist-note">📝 “${escapeHtml(entry.note)}”</span>` : ""}
      `;
      list.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
    const persona = getPersonaProfile(user);
    const history = getHistory(user);
    renderGoal(persona);
    renderSessionScreen(user, history);
    renderHistory(history);
    renderStreak(history);
  }

  // Navigates to the session screen for a freshly chosen split, shows a
  // loading state, then fills in the AI (or local fallback) plan once ready.
  async function selectSplitAndPreview(user, splitKey) {
    selectedSplitKey = splitKey;
    previewPlan = null;
    showScreen("session-screen");
    renderSessionFull(user);

    const plan = await computePlan(user, splitKey, checkInState);
    if (selectedSplitKey !== splitKey) return; // user navigated away while we were waiting
    previewPlan = plan;
    renderSessionScreen(user, getHistory(user));
  }

  async function refreshPreviewFromCoach(user) {
    const nextSplit = chatSuggestedSplit || selectedSplitKey;
    const requestId = ++recommendationRequestId;
    selectedSplitKey = nextSplit;
    previewPlan = null;
    renderSessionScreen(user, getHistory(user));

    const plan = await computePlan(user, nextSplit, { ...checkInState });
    if (requestId !== recommendationRequestId || selectedSplitKey !== nextSplit) return;
    if (document.getElementById("session-screen").classList.contains("hidden")) return;
    previewPlan = plan;
    recommendationDraftKey = nextSplit;
    recommendationDraft = plan;
    renderSessionScreen(user, getHistory(user));
  }

  // ---------- rendering: active workout runner ----------

  // Scans history newest-first for the last weight logged against this
  // exact exercise name, so the weight field starts pre-filled instead of
  // making the athlete re-enter it every time nothing's changed.
  function getLastWeight(user, exerciseName) {
    const history = getHistory(user);
    for (let i = history.length - 1; i >= 0; i--) {
      const sets = history[i].performance?.[exerciseName]?.sets;
      if (!sets) continue;
      // Anchor on the last set they actually logged a weight for — usually
      // their heaviest/working weight for the day.
      const withWeight = [...sets].reverse().find((s) => s.weight != null);
      if (withWeight) return withWeight.weight;
    }
    return null;
  }

  // Every exercise this athlete has ever logged a weight for, most recent
  // value each — sent to the AI so it can estimate a sensible starting
  // weight for something they've never logged by reasoning from what they
  // actually lift elsewhere (e.g. deadlift weight informs RDL weight).
  function buildWeightHistory(user) {
    const latest = new Map(); // name -> { weight, date }
    getHistory(user).forEach((entry) => {
      Object.entries(entry.performance || {}).forEach(([name, perf]) => {
        const withWeight = [...(perf.sets || [])].reverse().find((s) => s.weight != null);
        if (!withWeight) return;
        const existing = latest.get(name);
        if (!existing || entry.date >= existing.date) {
          latest.set(name, { weight: withWeight.weight, date: entry.date });
        }
      });
    });
    return Array.from(latest, ([exercise, v]) => ({ exercise, weight: v.weight }));
  }

  // A rough "does this exercise typically use added weight" heuristic —
  // strength splits and anything explicitly named "Weighted ___" get the
  // weight field; pure cardio/mobility work doesn't.
  function usesWeight(ex) {
    if (/bodyweight|push-up|plank|dead bug|mobility|stretch|flow|cat-cow|jump squat|mountain climber/i.test(ex.name)) return false;
    return ex.splitKey === "chest-back" || ex.splitKey === "legs" || /weighted/i.test(ex.name);
  }

  function getExerciseLoadFactor(exerciseName) {
    const name = exerciseName.toLowerCase();
    const factors = [
      [/leg press/, 1.5], [/back squat/, 1], [/romanian deadlift/, 0.72], [/deadlift/, 1],
      [/goblet squat/, 0.28], [/step.?up|lunge/, 0.22], [/glute bridge/, 0.55],
      [/barbell bench/, 1], [/incline dumbbell press/, 0.62], [/dumbbell chest press/, 0.68],
      [/cable fly/, 0.32], [/lat pulldown/, 0.62], [/cable row/, 0.65], [/barbell row/, 0.72],
      [/calf raise/, 0.5], [/weighted pull.?up/, 0.18],
    ];
    return factors.find(([pattern]) => pattern.test(name))?.[1] ?? 0.4;
  }

  function roundTrainingWeight(value) {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.max(5, Math.round(value / 5) * 5);
  }

  function getLoggedExercisePerformances(user, exerciseName) {
    return getHistory(user)
      .map((entry) => ({ date: entry.date, performance: entry.performance?.[exerciseName] }))
      .filter((entry) => entry.performance?.sets?.some((set) => Number.isFinite(set.weight) && set.weight > 0));
  }

  function completedTarget(performance) {
    const targeted = performance.sets.filter((set) => set.target != null && set.weight != null);
    return targeted.length > 0 && targeted.every((set) => Number(set.actual) >= Number(set.target));
  }

  function computeBaseWeightRecommendation(user, ex, aiWeight) {
    if (!usesWeight(ex)) return null;

    // What the athlete just told the coach beats everything else, including
    // logged history — it's fresh, explicit, and about today specifically.
    const stated = checkInState.weightOverrides?.[ex.name];
    if (Number.isFinite(stated) && stated > 0) {
      return {
        weight: roundTrainingWeight(stated),
        source: "stated",
        explanation: `You told your coach to start at ${stated} lb today.`,
      };
    }

    const exactHistory = getLoggedExercisePerformances(user, ex.name);
    if (exactHistory.length > 0) {
      const latest = exactHistory[exactHistory.length - 1];
      const weightedSets = latest.performance.sets.filter((set) => Number.isFinite(set.weight) && set.weight > 0);
      const lastWeight = weightedSets[weightedSets.length - 1].weight;
      const previous = exactHistory[exactHistory.length - 2];
      const repeatedSuccess = completedTarget(latest.performance) && previous && completedTarget(previous.performance);
      const missed = latest.performance.sets.some(
        (set) => set.target != null && set.actual != null && Number(set.actual) < Number(set.target) * 0.8
      );
      const change = repeatedSuccess ? 5 : missed ? -5 : 0;
      const weight = roundTrainingWeight(Math.max(5, lastWeight + change));
      return {
        weight,
        source: "history",
        explanation: repeatedSuccess
          ? `You completed the target at ${lastWeight} lb in your last two sessions, so the coach added 5 lb.`
          : missed
            ? `Your last logged reps fell short at ${lastWeight} lb, so the coach reduced the starting load slightly.`
            : `Starts from your most recent ${ex.name} working weight.`
      };
    }

    if (Number.isFinite(aiWeight) && aiWeight > 0) {
      return {
        weight: roundTrainingWeight(aiWeight),
        source: "ai",
        explanation: "Estimated by the coach from your profile, target reps, and related logged lifts.",
      };
    }

    const traits = getExerciseTraits(ex);
    let bestRelated = null;
    buildWeightHistory(user).forEach((entry) => {
      const relatedTraits = getExerciseTraits({ name: entry.exercise, howTo: "" });
      const overlap = [...traits].filter((trait) => relatedTraits.has(trait)).length;
      if (overlap > 0 && (!bestRelated || overlap > bestRelated.overlap)) bestRelated = { ...entry, overlap };
    });
    if (bestRelated) {
      const converted = bestRelated.weight * (getExerciseLoadFactor(ex.name) / getExerciseLoadFactor(bestRelated.exercise));
      return {
        weight: roundTrainingWeight(converted * 0.9),
        source: "related",
        explanation: `Conservative estimate from your logged ${bestRelated.exercise} weight and the similar movement pattern.`,
      };
    }

    const bodyweight = getPersonaProfile(user).weightLb;
    if (Number.isFinite(bodyweight) && bodyweight > 0) {
      return {
        weight: roundTrainingWeight(bodyweight * getExerciseLoadFactor(ex.name) * 0.5),
        source: "profile",
        explanation: "Conservative first-session estimate from your bodyweight and this exercise’s loading pattern.",
      };
    }
    return null;
  }

  // A qualitative "let's go lighter/heavier today" (checkInState.weightDirection)
  // adjusts whatever the cascade above landed on — every weighted exercise,
  // not just one named lift. Skipped when the athlete stated an exact
  // number for THIS exercise ("stated") — that's already a deliberate,
  // specific override and shouldn't be second-guessed by a general mood.
  function getWeightRecommendation(user, ex, aiWeight) {
    const base = computeBaseWeightRecommendation(user, ex, aiWeight);
    if (!base || base.source === "stated") return base;

    const direction = checkInState.weightDirection;
    if (!direction) return base;

    const factor = direction === "lighter" ? 0.85 : 1.1;
    const adjusted = roundTrainingWeight(base.weight * factor);
    if (adjusted === base.weight) return base;

    return {
      weight: adjusted,
      source: base.source,
      explanation: `${base.explanation} You said you're going ${direction} today, so the coach adjusted from ${base.weight} lb to ${adjusted} lb.`,
    };
  }

  function buildInitialLogs(user, exercises, suggestedWeights) {
    const logs = {};
    exercises.forEach((ex) => {
      const setCount = parseSetCount(ex.detail);
      const target = parseTargetReps(ex.detail);
      const recommendation = getWeightRecommendation(user, ex, suggestedWeights?.get(ex.name));
      const seedWeight = recommendation?.weight ?? null;
      logs[ex.name] = {
        // Weight lives per set, not per exercise — sets often ramp
        // (e.g. 135/155/175/185), so each one gets its own adjustable value,
        // all seeded from wherever the athlete left off last time.
        sets: Array.from({ length: setCount }, () => ({ target, actual: target, weight: seedWeight, touched: false })),
        flag: "",
        weightRecommendation: recommendation,
      };
    });
    return logs;
  }

  // Groups exercises sharing a (splitKey, superset) tag together for
  // display, so a real pair renders as one bracketed superset card.
  function groupExercisesForDisplay(exercises) {
    const groups = [];
    const bySupersetKey = new Map();
    exercises.forEach((ex) => {
      if (ex.superset) {
        const key = `${ex.splitKey}:${ex.superset}`;
        if (bySupersetKey.has(key)) {
          bySupersetKey.get(key).items.push(ex);
        } else {
          const group = { items: [ex] };
          bySupersetKey.set(key, group);
          groups.push(group);
        }
      } else {
        groups.push({ items: [ex] });
      }
    });
    return groups;
  }

  function renderWorkoutHeader(splitKey) {
    const meta = getSplitMeta(splitKey);
    document.getElementById("workout-icon").textContent = meta.icon;
    document.getElementById("workout-name").textContent = meta.name;
    document.getElementById("workout-tagline").textContent = meta.tagline;
    document.getElementById("workout-regenerate").classList.toggle("hidden", splitKey === "custom");
  }

  function renderWarmup(splitKey) {
    const list = document.getElementById("warmup-list");
    list.innerHTML = "";
    getWarmup(splitKey).forEach((text) => {
      const li = document.createElement("li");
      li.className = "warmup-item";
      li.innerHTML = `<span class="warmup-check">☐</span><span>${escapeHtml(text)}</span>`;
      li.addEventListener("click", () => {
        li.classList.toggle("checked");
        li.querySelector(".warmup-check").textContent = li.classList.contains("checked") ? "☑" : "☐";
      });
      list.appendChild(li);
    });
  }

  function getExerciseTraits(exercise) {
    const text = `${exercise.name} ${exercise.howTo || ""}`.toLowerCase();
    const traits = new Set();
    const patterns = {
      squat: /squat|leg press|wall.?sit/,
      lunge: /lunge|step.?up|split squat/,
      hinge: /deadlift|hinge|good morning|glute bridge/,
      horizontalPush: /bench press|chest press|push.?up|chest pass|cable fly/,
      verticalPull: /pull.?up|pulldown/,
      horizontalPull: /row/,
      core: /plank|dead bug|leg raise|mountain climber/,
      conditioning: /run|sprint|bike|cycling|rower|rope|sled|stair|burpee/,
      mobility: /stretch|mobility|flow|rotation|cat.?cow/,
      quads: /squat|leg press|lunge|step.?up|wall.?sit/,
      glutes: /glute|bridge|squat|lunge|step.?up|deadlift/,
      hamstrings: /deadlift|hinge|hamstring|glute bridge/,
    };
    Object.entries(patterns).forEach(([trait, pattern]) => {
      if (pattern.test(text)) traits.add(trait);
    });
    return traits;
  }

  function conflictsWithSwapReason(exercise, reason) {
    const request = String(reason || "").toLowerCase();
    const text = `${exercise.name} ${exercise.howTo || ""}`.toLowerCase();
    if (/\b(no|avoid|without|don't have|do not have)\s+(a\s+)?barbell\b/.test(request) && /barbell/.test(text)) return true;
    if (/\b(no|avoid|without|don't have|do not have)\s+(a\s+)?dumbbells?\b/.test(request) && /dumbbell/.test(text)) return true;
    if (/\b(no|avoid|without|don't have|do not have)\s+(a\s+)?(?:machine|cable)\b/.test(request) && /machine|cable|pulldown|leg press/.test(text)) return true;
    if (/\b(knee|knees)\b/.test(request) && /jump|lunge|step.?up|deep squat/.test(text)) return true;
    if (/\b(shoulder|shoulders|rotator cuff)\b/.test(request) && /press|push.?up|fly|pull.?up|pulldown/.test(text)) return true;
    if (/\b(lower back|low back|back pain)\b/.test(request) && /deadlift|bent.?over|hinge/.test(text)) return true;
    return false;
  }

  function chooseLocalSwap(ex, options, reason) {
    const originalTraits = getExerciseTraits(ex);
    const request = `${checkInState.note || ""} ${reason || ""}`.toLowerCase();
    const focus = getCoachFocus(request);
    const ranked = options
      .map((candidate, index) => {
        const traits = getExerciseTraits(candidate);
        let score = 0;
        originalTraits.forEach((trait) => {
          if (traits.has(trait)) score += ["quads", "glutes", "hamstrings"].includes(trait) ? 2 : 8;
        });
        if (focus && traits.has(focus)) score += 7;
        if (/\b(bodyweight|no equipment)\b/.test(request) && !/barbell|dumbbell|cable|machine|sled|ball|band/i.test(candidate.name)) score += 9;
        if (conflictsWithSwapReason(candidate, request)) score -= 100;
        if (/finisher|partner/i.test(candidate.name) && !/finisher|partner/i.test(ex.name)) score -= 3;
        return { candidate, score, index };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return ranked[0]?.candidate || null;
  }

  async function requestAiSwap(ex, options, reason) {
    if (!AI_ENDPOINT || options.length === 0) return null;
    try {
      const persona = getPersonaProfile(currentUser);
      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "swap",
          persona: { name: persona.name, goal: persona.goal, focusAreas: persona.focusAreas },
          workout: getSplitMeta(ex.splitKey).name,
          currentExercise: ex,
          currentWorkout: activeWorkout.exercises.map((item) => item.name),
          reason: reason || "Choose the closest useful alternative.",
          todayNote: checkInState.note || null,
          candidates: options,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const exercise = options.find((option) => option.name === data.exercise);
      if (!exercise) return null;
      return { exercise, explanation: typeof data.reason === "string" ? data.reason : null, source: "ai" };
    } catch {
      return null;
    }
  }

  // Chooses a safe, non-duplicate replacement. The AI gets first choice;
  // the deterministic movement/constraint scorer keeps Swap useful offline.
  async function swapExercise(ex, reason) {
    if (!activeWorkout) return null;
    const currentNames = new Set(activeWorkout.exercises.map((e) => e.name));
    const unused = buildCandidatePool(currentUser, ex.splitKey).filter((c) => !currentNames.has(c.name));
    const fullReason = `${checkInState.note || ""} ${reason || ""}`;
    const constraintSafe = unused.filter((candidate) => !conflictsWithSwapReason(candidate, fullReason));
    const options = constraintSafe.length > 0 ? constraintSafe : unused;
    if (options.length === 0) return null;

    const aiChoice = await requestAiSwap(ex, options, reason);
    const localChoice = chooseLocalSwap(ex, options, reason);
    const chosen = aiChoice?.exercise || localChoice;
    if (!chosen) return null;
    const replacement = { ...chosen, splitKey: ex.splitKey, superset: ex.superset || chosen.superset };
    const idx = activeWorkout.exercises.findIndex((e) => e.name === ex.name);
    if (idx === -1) return null;

    activeWorkout.exercises[idx] = replacement;
    delete activeWorkout.logs[ex.name];
    activeWorkout.logs[replacement.name] = buildInitialLogs(currentUser, [replacement])[replacement.name];
    const sharedTraits = [...getExerciseTraits(ex)].filter((trait) => getExerciseTraits(replacement).has(trait));
    const explanation = aiChoice?.explanation || (reason
      ? `Best available match for “${reason}” while keeping the workout balanced.`
      : sharedTraits.length > 0
        ? `Keeps the same ${sharedTraits[0].replace(/([A-Z])/g, " $1").toLowerCase()} training purpose without duplicating another exercise.`
        : "Best unused option for this workout and your current focus.");
    return { exercise: replacement, explanation, source: aiChoice?.source || "local" };
  }

  // Tap = one step. Press and hold = repeats, accelerating the longer it's
  // held — so jumping a weight from 0 to 225 doesn't take forty taps.
  function attachHoldStepper(btn, onStep) {
    let timeoutId = null;
    let active = false;

    const scheduleNext = (delay) => {
      timeoutId = setTimeout(() => {
        if (!active) return;
        onStep();
        scheduleNext(Math.max(45, delay * 0.72));
      }, delay);
    };

    const start = (e) => {
      e.preventDefault();
      if (active) return;
      active = true;
      onStep();
      scheduleNext(450);
    };

    const stop = () => {
      active = false;
      clearTimeout(timeoutId);
    };

    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
  }

  function renderExerciseCard(ex) {
    const card = document.createElement("div");
    card.className = "wex-card";

    const imgPath = getExerciseImagePath(ex.splitKey, ex.name);
    const fallbackIcon = getSplitMeta(ex.splitKey).icon;
    const log = activeWorkout.logs[ex.name];

    const head = document.createElement("button");
    head.type = "button";
    head.className = "wex-head";
    head.innerHTML = `
      <span class="wex-image">
        <img src="${imgPath}" alt="" class="wex-img" />
        <span class="wex-img-fallback">${fallbackIcon}</span>
      </span>
      <span class="wex-head-copy">
        <span class="wex-name">${escapeHtml(ex.name)}</span>
        <span class="wex-detail">${escapeHtml(ex.detail)}</span>
      </span>
      <span class="wex-chevron">▾</span>
    `;
    // Real image missing (404) — quietly fall back to the icon tile underneath.
    head.querySelector(".wex-img").addEventListener("error", (e) => {
      e.target.style.display = "none";
      e.target.nextElementSibling.style.display = "flex";
    });

    const body = document.createElement("div");
    body.className = "wex-body hidden";

    const showWeight = usesWeight(ex);
    const weightRecommendation = log.weightRecommendation;

    // Weight lives inside each set row (ramping sets are the norm, not the
    // exception), alongside either a rep stepper or a simple complete-toggle.
    const setsHtml = log.sets
      .map((s, i) => {
        const weightControl = showWeight
          ? `<div class="wex-mini-stepper" data-role="weight">
               <button type="button" class="wex-mini-btn" data-dir="-1">−</button>
               <input type="number" inputmode="numeric" pattern="[0-9]*" class="wex-mini-input" placeholder="—" value="${s.weight ?? ""}" />
               <span class="wex-mini-unit">lb</span>
               <button type="button" class="wex-mini-btn" data-dir="1">+</button>
             </div>`
          : "";
        const repsControl =
          s.target != null
            ? `<div class="wex-mini-stepper" data-role="reps">
                 <button type="button" class="wex-mini-btn" data-dir="-1">−</button>
                 <span class="wex-mini-value">${s.actual}</span>
                 <span class="wex-mini-unit">reps</span>
                 <button type="button" class="wex-mini-btn" data-dir="1">+</button>
               </div>`
            : `<button type="button" class="wex-toggle-btn">Mark Done</button>`;
        const label =
          s.target != null
            ? `Set ${i + 1} <span class="wex-set-target">· target ${s.target}</span>`
            : log.sets.length > 1
              ? `Round ${i + 1}`
              : "This one";

        return `
          <div class="wex-set-row" data-set-index="${i}">
            <span class="wex-set-label">${label}</span>
            <div class="wex-set-controls">${weightControl}${repsControl}</div>
          </div>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="wex-body-image">
        <img src="${imgPath}" alt="" class="wex-img-large" />
        <span class="wex-img-large-fallback">${fallbackIcon}</span>
      </div>
      ${ex.howTo ? `<p class="wex-howto">${escapeHtml(ex.howTo)}</p>` : ""}
      ${ex.tip ? `<p class="wex-tip">💡 ${escapeHtml(ex.tip)}</p>` : ""}
      ${showWeight && weightRecommendation ? `
        <div class="wex-weight-rec">
          <div>
            <span class="wex-weight-rec-label">⚡ COACH STARTING WEIGHT</span>
            <strong>${weightRecommendation.weight} lb</strong>
            <p>${escapeHtml(weightRecommendation.explanation)}</p>
          </div>
          <button type="button" class="wex-apply-weight">Use ${weightRecommendation.weight} lb</button>
        </div>
      ` : ""}
      <div class="wex-sets">${setsHtml}</div>
      <input type="text" class="wex-flag-input" placeholder="Anything to flag on this one? (optional)" maxlength="140" />
      <div class="wex-swap-row">
        <input type="text" class="wex-swap-input" placeholder="Want to swap this? e.g. 'replace flies, shoulder is sore'" maxlength="140" />
        <button type="button" class="wex-swap-btn">🔁 Swap</button>
      </div>
      <p class="wex-swap-status hidden" aria-live="polite"></p>
    `;
    // Real image missing (404) — quietly fall back to the icon tile underneath.
    body.querySelector(".wex-img-large").addEventListener("error", (e) => {
      e.target.style.display = "none";
      e.target.nextElementSibling.style.display = "flex";
    });

    body.querySelectorAll(".wex-set-row").forEach((row) => {
      const idx = Number(row.dataset.setIndex);
      const set = log.sets[idx];

      const weightStepper = row.querySelector('.wex-mini-stepper[data-role="weight"]');
      if (weightStepper) {
        const weightInput = weightStepper.querySelector(".wex-mini-input");
        const setWeight = (value) => {
          set.weight = value;
          set.touched = true;
          weightInput.value = value ?? "";
          row.classList.add("touched");
        };
        weightInput.addEventListener("input", (e) => {
          const parsed = e.target.value === "" ? null : Number(e.target.value);
          set.weight = Number.isFinite(parsed) ? parsed : null;
          set.touched = true;
          row.classList.add("touched");
        });
        weightStepper.querySelectorAll(".wex-mini-btn").forEach((btn) => {
          const dir = Number(btn.dataset.dir);
          attachHoldStepper(btn, () => setWeight(Math.max(0, (set.weight ?? 0) + dir * 5)));
        });
      }

      const repsStepper = row.querySelector('.wex-mini-stepper[data-role="reps"]');
      if (repsStepper) {
        const valueEl = repsStepper.querySelector(".wex-mini-value");
        repsStepper.querySelectorAll(".wex-mini-btn").forEach((btn) => {
          const dir = Number(btn.dataset.dir);
          attachHoldStepper(btn, () => {
            set.actual = Math.max(0, (set.actual ?? 0) + dir);
            set.touched = true;
            valueEl.textContent = set.actual;
            row.classList.add("touched");
          });
        });
        return;
      }

      const toggleBtn = row.querySelector(".wex-toggle-btn");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          set.touched = !set.touched;
          set.actual = set.touched ? 1 : null;
          toggleBtn.classList.toggle("done", set.touched);
          toggleBtn.textContent = set.touched ? "✓ Done" : "Mark Done";
          row.classList.toggle("touched", set.touched);
        });
      }
    });

    const applyWeightButton = body.querySelector(".wex-apply-weight");
    if (applyWeightButton && weightRecommendation) {
      applyWeightButton.addEventListener("click", () => {
        log.sets.forEach((set) => {
          set.weight = weightRecommendation.weight;
          set.touched = true;
        });
        body.querySelectorAll('.wex-mini-stepper[data-role="weight"] .wex-mini-input').forEach((input) => {
          input.value = weightRecommendation.weight;
          input.closest(".wex-set-row")?.classList.add("touched");
        });
        applyWeightButton.textContent = `Applied ${weightRecommendation.weight} lb ✓`;
      });
    }

    body.querySelector(".wex-flag-input").addEventListener("input", (e) => {
      log.flag = e.target.value;
    });

    body.querySelector(".wex-swap-btn").addEventListener("click", async () => {
      const swapInput = body.querySelector(".wex-swap-input");
      const swapButton = body.querySelector(".wex-swap-btn");
      const swapStatus = body.querySelector(".wex-swap-status");
      const reasonText = swapInput.value.trim();
      swapButton.disabled = true;
      swapButton.textContent = "Choosing…";
      swapStatus.textContent = "Coach is comparing movement patterns and your constraints…";
      swapStatus.classList.remove("hidden");
      const result = await swapExercise(ex, reasonText);
      if (!result) {
        swapButton.disabled = false;
        swapButton.textContent = "🔁 Swap";
        swapStatus.textContent = "No unused replacement fits this workout yet. Try editing the workout instead.";
        return;
      }
      if (reasonText) {
        logNote(currentUser, `Swapped ${ex.name} → ${result.exercise.name} (${reasonText})`);
      }
      renderWorkoutExercises();
      const newCard = Array.from(document.querySelectorAll(".wex-card")).find((item) => item.querySelector(".wex-name")?.textContent === result.exercise.name);
      if (newCard) {
        const newStatus = newCard.querySelector(".wex-swap-status");
        newCard.querySelector(".wex-body")?.classList.remove("hidden");
        newCard.querySelector(".wex-head")?.classList.add("expanded");
        if (newStatus) {
          newStatus.textContent = `Coach swap: ${ex.name} → ${result.exercise.name}. ${result.explanation}`;
          newStatus.classList.remove("hidden");
        }
      }
    });

    head.addEventListener("click", () => {
      body.classList.toggle("hidden");
      head.classList.toggle("expanded");
    });

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function renderWorkoutExercises() {
    const container = document.getElementById("workout-exercise-list");
    container.innerHTML = "";
    groupExercisesForDisplay(activeWorkout.exercises).forEach((group) => {
      if (group.items.length > 1) {
        const wrap = document.createElement("div");
        wrap.className = "superset-group";
        wrap.innerHTML = `<span class="superset-label">SUPERSET · ALTERNATE BETWEEN THESE</span>`;
        group.items.forEach((ex) => wrap.appendChild(renderExerciseCard(ex)));
        container.appendChild(wrap);
      } else {
        container.appendChild(renderExerciseCard(group.items[0]));
      }
    });
  }

  // Compiles whatever the athlete actually logged (touched sets, flags) into
  // a compact free-text summary — feeds straight into the persistent notes
  // log so future AI recommendations can reference it. Empty if they
  // engaged with none of it, since feedback here is entirely optional.
  function summarizeWorkoutLog(logs) {
    const lines = [];
    Object.entries(logs).forEach(([name, log]) => {
      const touchedSets = log.sets.filter((s) => s.touched);
      if (touchedSets.length > 0) {
        const parts = touchedSets.map((s) => {
          const reps = s.target != null ? `${s.actual}/${s.target}` : s.actual ? "done" : "skipped";
          return s.weight != null ? `${s.weight}lb×${reps}` : reps;
        });
        lines.push(`${name}: ${parts.join(", ")}`);
      }
      if (log.flag && log.flag.trim()) {
        lines.push(`${name} note: "${log.flag.trim()}"`);
      }
    });
    return lines.join(" · ");
  }

  // Distills each log down to just {weight, sets} for storage on the
  // history entry — this is what getLastWeight() reads back later to
  // pre-fill the weight field next time this exercise comes up.
  function extractPerformance(logs) {
    const performance = {};
    Object.entries(logs).forEach(([name, log]) => {
      if (log.sets.some((s) => s.touched)) {
        performance[name] = { sets: log.sets.map((s) => ({ target: s.target, actual: s.actual, weight: s.weight })) };
      }
    });
    return performance;
  }

  function showWorkout(user, sessionSplitKey, exercises, meta = {}) {
    activeWorkout = {
      sessionSplitKey,
      exercises,
      logs: buildInitialLogs(user, exercises, meta.suggestedWeights),
      reason: meta.reason ?? null,
      source: meta.source ?? "local",
    };
    showScreen("workout-screen");
    renderWorkoutHeader(sessionSplitKey);
    renderWarmup(sessionSplitKey);
    renderWorkoutExercises();
  }

  function initWorkoutScreen() {
    document.getElementById("workout-switch").addEventListener("click", () => {
      activeWorkout = null;
      showLogin();
    });

    document.getElementById("workout-abandon").addEventListener("click", () => {
      activeWorkout = null;
      showSelect(currentUser);
    });

    document.getElementById("workout-regenerate").addEventListener("click", async () => {
      if (!activeWorkout || activeWorkout.sessionSplitKey === "custom") return;
      const btn = document.getElementById("workout-regenerate");
      btn.disabled = true;
      const plan = await computePlan(currentUser, activeWorkout.sessionSplitKey, checkInState);
      const exercises = plan.exercises.map((ex) => ({ ...ex, splitKey: activeWorkout.sessionSplitKey }));
      activeWorkout.exercises = exercises;
      activeWorkout.logs = buildInitialLogs(currentUser, exercises, plan.suggestedWeights);
      activeWorkout.reason = plan.reason;
      activeWorkout.source = plan.source;
      renderWorkoutExercises();
      btn.disabled = false;
    });

    document.getElementById("finish-workout-btn").addEventListener("click", () => {
      if (!activeWorkout) return;
      const summary = summarizeWorkoutLog(activeWorkout.logs);
      const combinedNote = [checkInState.note?.trim(), summary].filter(Boolean).join(" | ") || null;

      logSession(currentUser, activeWorkout.sessionSplitKey, {
        ...checkInState,
        exercises: activeWorkout.exercises.map(({ name, detail, tip, howTo, superset }) => ({ name, detail, tip, howTo, superset })),
        reason: activeWorkout.reason,
        source: activeWorkout.source,
        note: combinedNote,
        performance: extractPerformance(activeWorkout.logs),
      });

      if (summary) logNote(currentUser, summary);

      activeWorkout = null;
      showScreen("session-screen");
      renderSessionFull(currentUser);
    });
  }

  // ---------- rendering: check-in screen ----------

  function selectChip(row, value) {
    row.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.value === String(value));
    });
  }

  function getMotivationalLine(streak) {
    if (streak >= 7) return `🔥 ${streak} days strong — this is who you are now.`;
    if (streak >= 3) return `🔥 ${streak} days strong — you're on a roll.`;
    if (streak >= 1) return "You're building a habit. Keep it going.";
    return "Every rep counts — let's build some momentum today.";
  }

  // Personalized recap shown at the top of check-in: a first-timer welcome,
  // or a "here's where you left off" summary for returning users — makes it
  // obvious the app is actually tracking them, not just a blank form.
  function renderRecapCard(user) {
    const persona = getPersonaProfile(user);
    const history = getHistory(user);
    const el = document.getElementById("recap-card");

    const cheers = takeUnseenCheers(user);
    const cheerHtml = cheers
      .map((c) => `<p class="recap-cheer">💌 ${escapeHtml(getPersonaProfile(c.from).name)} says: "${escapeHtml(c.text)}"</p>`)
      .join("");

    if (history.length === 0) {
      el.innerHTML = `
        ${cheerHtml}
        <span class="recap-eyebrow">🎉 FIRST CHECK-IN</span>
        <p class="recap-line">Welcome to Liftr, ${escapeHtml(persona.name)}! We're excited to have you — let's get your first session logged.</p>
        <p class="recap-mission">🎯 ${escapeHtml(persona.goal)}</p>
      `;
      return;
    }

    const last = history[history.length - 1];
    const lastMeta = getSplitMeta(last.splitKey);
    const streak = currentStreak(history);

    el.innerHTML = `
      ${cheerHtml}
      <span class="recap-eyebrow">YOUR PROGRESS</span>
      <p class="recap-line">Last time, ${describeWhen(last.date)} — you crushed <strong>${lastMeta.icon} ${escapeHtml(lastMeta.name)}</strong>.</p>
      <div class="recap-stats">
        ${streak > 0 ? `<span class="recap-stat">🔥 ${streak} day streak</span>` : ""}
        <span class="recap-stat">📈 ${history.length} session${history.length === 1 ? "" : "s"} logged</span>
      </div>
      <p class="recap-motivation">${getMotivationalLine(streak)}</p>
      <p class="recap-mission">🎯 ${escapeHtml(persona.goal)}</p>
    `;
  }

  function renderCheckIn(user) {
    placeTerminalPanel("checkin");
    checkInState = { minutes: 30, energy: "medium", partner: false, note: "", weightOverrides: {}, weightDirection: null };
    document.getElementById("checkin-name").textContent = getPersonaProfile(user).name;
    document.getElementById("hub-cheer-btn").title = `Cheer ${getPersonaProfile(otherUser(user)).name}`;
    renderRecapCard(user);
    selectChip(document.getElementById("checkin-energy"), checkInState.energy);
    selectChip(document.getElementById("checkin-minutes"), checkInState.minutes);
    selectChip(document.getElementById("checkin-partner"), checkInState.partner ? "yes" : "no");
    resetChat(user);
    document.getElementById("checkin-form").classList.add("hidden");
    document.getElementById("checkin-start-btn").classList.remove("hidden");
  }

  // ---------- check-in chat ----------
  // A short conversational front door — the athlete can mention pain,
  // fatigue, or equipment limits and have it actually shape today's
  // exercise selection, instead of typing into a note nobody responds to.
  // The same panel (and conversation) physically moves onto the workout
  // selection screen after check-in, via placeTerminalPanel — it's one
  // continuous chat, not a reset-per-screen widget.

  // Moves the single terminal-panel DOM node into whichever screen's slot
  // is currently relevant, so the chat thread/state carries over instead
  // of resetting each time the user moves from check-in into selection.
  function placeTerminalPanel(target) {
    const panel = document.getElementById("terminal-panel");
    const slotId = target === "select" ? "select-chat-slot" : target === "preview" ? "preview-chat-slot" : "checkin-chat-slot";
    const slot = document.getElementById(slotId);
    if (panel && slot) slot.appendChild(panel);
  }

  // Opens with whatever the athlete told the coach last time, so it feels
  // like a coach who was actually paying attention — not a blank "how are
  // you" every single day. Falls back to a generic opener when there's
  // nothing recent to reference.
  function buildCoachOpening(user, history) {
    const recentNotes = getNotes(user).slice(-6);
    if (recentNotes.length === 0) {
      return history.length === 0
        ? `👋 Hey ${PERSONAS[user].name}! Anything going on today I should know about before we get moving?`
        : "👋 Welcome back! Any sore spots, schedule changes, or goals you want me to account for today?";
    }

    const topics = [
      { key: "basketball", pattern: /\b(basketball|hoops?|pickup(?: game)?)\b/i, emoji: "🏀", question: "How was your basketball game? Anything from it you want to work on today?" },
      { key: "running", pattern: /\b(run|running|race|marathon|5k|10k|tempo|miles?)\b/i, emoji: "🏃", question: "How did your run go? Anything you want today’s workout to improve or protect?" },
      { key: "quads", pattern: /\b(quad|quads|quadriceps|front of (my )?legs?)\b/i, emoji: "🦵", question: "How are your quads feeling today? Do you want to keep emphasizing them or shift the focus?" },
      { key: "knees", pattern: /\b(knee|knees)\b/i, emoji: "🦵", question: "How are your knees feeling today? Should I reduce impact or adjust your exercise choices?" },
      { key: "shoulders", pattern: /\b(shoulder|shoulders|rotator cuff)\b/i, emoji: "💪", question: "How is your shoulder feeling today? Anything you want me to avoid or strengthen?" },
      { key: "back", pattern: /\b(lower back|low back|back pain|back soreness)\b/i, emoji: "💪", question: "How is your back feeling today? Should I adjust loading or movement choices?" },
      { key: "soreness", pattern: /\b(sore|soreness|pain|hurt|tight|ache)\b/i, emoji: "🤕", question: "How is that soreness feeling today? Is it improving, unchanged, or worse?" },
      { key: "energy", pattern: /\b(tired|fatigue|fatigued|sleep|energy|exhausted)\b/i, emoji: "😴", question: "How is your energy today? Should I keep the session lighter or are you ready to push?" },
      { key: "equipment", pattern: /\b(equipment|gym|home workout|dumbbell|barbell|machine|bands?)\b/i, emoji: "🏋️", question: "What equipment do you have available today? I can reshape the workout around it." },
    ];

    // Frequency wins; recency breaks ties. This keeps a recurring concern
    // prominent while still allowing a new, specific update to take over.
    const ranked = topics
      .map((topic) => {
        let matches = 0;
        let latestIndex = -1;
        recentNotes.forEach((note, index) => {
          if (topic.pattern.test(note.text)) {
            matches++;
            latestIndex = index;
          }
        });
        return { ...topic, matches, latestIndex };
      })
      .filter((topic) => topic.matches > 0)
      .sort((a, b) => b.matches - a.matches || b.latestIndex - a.latestIndex);

    // Never ask about the exact same topic two check-ins in a row. Without
    // this, answering "how's your knee?" logs a note that still says
    // "knee" — which keeps that topic winning the ranking above forever,
    // so it ends up asking the same question every single login.
    const persona = getPersonaProfile(user);
    const repeat = persona.lastGreetingTopic;
    const topic = ranked.find((t) => t.key !== repeat) || null;

    if (topic) {
      saveProfile(user, { ...persona, lastGreetingTopic: topic.key });
      return `${topic.emoji} ${topic.question}`;
    }

    saveProfile(user, { ...persona, lastGreetingTopic: null });
    const raw = recentNotes[recentNotes.length - 1].text;
    const clean = raw.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100);
    return clean
      ? `💬 Last time you mentioned “${clean}.” How is that going, and what would you like to work on today?`
      : "👋 Welcome back! What feels most important for today’s workout?";
  }

  function resetChat(user) {
    const history = getHistory(user);
    const greeting = buildCoachOpening(user, history);
    chatMessages = [{ role: "coach", text: greeting }];
    chatBusy = false;
    chatSuggestedSplit = null;
    recommendationDraft = null;
    recommendationDraftKey = null;
    recommendationRequestId++;
    renderChatThread();
    setChatBusy(false);
  }

  function renderChatThread() {
    const el = document.getElementById("chat-thread");
    el.innerHTML = chatMessages
      .map((m) => `<div class="chat-bubble chat-${m.role}">${escapeHtml(m.text)}</div>`)
      .join("");
    // Wait a frame so layout has settled before measuring — otherwise
    // scrollHeight can be read before the new bubble's height is final.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      // The thread's own scroll isn't enough if the panel itself is off
      // the bottom of the page (e.g. after a chip pick or a tall reply
      // pushed the input row out of the viewport) — bring the input into
      // view too so the latest exchange is always visible without a
      // manual page scroll.
      document.getElementById("chat-input")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function setChatBusy(busy) {
    chatBusy = busy;
    document.getElementById("chat-send").disabled = busy;
    document.getElementById("chat-send").textContent = busy ? "…" : "Send";
    document.getElementById("chat-input").disabled = busy;
  }

  // Keeps the retro block cursor glued to the real caret position. The app
  // font isn't monospace, so a simple "N characters * fixed width" guess
  // would drift — instead a hidden same-font span measures the actual
  // pixel width of the text before the caret on every change.
  let updateChatCursor = () => {};

  function initTerminalCursor() {
    const input = document.getElementById("chat-input");
    const cursor = document.getElementById("chat-cursor");
    if (!input || !cursor) return;

    // The `font` shorthand doesn't carry letter-spacing, so copy it
    // explicitly too — otherwise the cursor drifts earlier than the real
    // caret on longer strings. The input's own left padding also has to be
    // added back in since the cursor is positioned relative to the wrap,
    // not the input's text content box.
    const inputStyle = getComputedStyle(input);
    const paddingLeft = parseFloat(inputStyle.paddingLeft) || 0;
    const measurer = document.createElement("span");
    measurer.style.position = "absolute";
    measurer.style.visibility = "hidden";
    measurer.style.whiteSpace = "pre";
    measurer.style.font = inputStyle.font;
    measurer.style.letterSpacing = inputStyle.letterSpacing;
    document.body.appendChild(measurer);

    updateChatCursor = () => {
      const pos = input.selectionStart ?? input.value.length;
      measurer.textContent = input.value.slice(0, pos);
      // Once typed text overflows the box, the input scrolls internally to
      // keep the real caret visible — subtract that scroll or the cursor
      // drifts off past the visible text.
      cursor.style.left = `${paddingLeft + measurer.offsetWidth - input.scrollLeft}px`;
    };

    ["input", "keyup", "click", "focus", "select", "scroll"].forEach((evt) => input.addEventListener(evt, updateChatCursor));
    updateChatCursor();
  }

  function isWorkoutRelevantMessage(text) {
    const value = String(text || "").toLowerCase();
    return Boolean(
      inferSplitFromChat(value) ||
      getCoachFocus(value) ||
      /\b(sore|pain|hurt|injury|tight|fatigue|tired|energy|equipment|barbell|dumbbell|machine|cable|band|gym|home workout|partner|minutes?|shorter|longer|remove|skip|swap|exercise|workout|sets?|reps?|weight)\b/.test(value)
    );
  }

  function extractGoalUpdate(text) {
    const match = String(text || "").match(/\b(?:change|set|update)\s+(?:my\s+)?goal\s+to\s+(.+)|\bmy\s+(?:new\s+)?goal\s+is\s+(.+)/i);
    const goal = (match?.[1] || match?.[2] || "").trim().replace(/[.!?]+$/, "");
    return goal.length >= 5 ? goal.slice(0, 180) : null;
  }

  function buildLocalCoachReply(user, text) {
    const value = text.toLowerCase();
    const history = getHistory(user);
    const streak = currentStreak(history);
    if (/\b(motivation|motivated|unmotivated|don't feel like|do not feel like|struggling to start|skip today)\b/.test(value)) {
      const evidence = history.length > 0
        ? `You’ve already logged ${history.length} session${history.length === 1 ? "" : "s"}${streak ? ` and built a ${streak}-day streak` : ""}.`
        : "You do not need a perfect session to begin building momentum.";
      return `${evidence} Let’s lower the barrier: commit to the warm-up and one exercise, then decide whether to continue. What is making today feel hardest—energy, time, or confidence?`;
    }
    const goal = extractGoalUpdate(text);
    if (goal) return `I’ve updated your goal to “${goal}.” What would make progress toward that goal feel meaningful over the next four weeks?`;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const questionCount = (text.match(/\?/g) || []).length;
    if (wordCount >= 28 || questionCount >= 2) {
      return "There are a few connected pieces in what you shared, and they deserve more than a quick workout tweak. Which part feels most important right now, and what outcome would make this conversation useful for you?";
    }
    return "I’m here for that too. Tell me a little more about what is going on and what kind of support would help most right now.";
  }

  async function sendChatMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || chatBusy) return;

    chatMessages.push({ role: "user", text });
    input.value = "";
    updateChatCursor();
    renderChatThread();
    setChatBusy(true);

    // General coaching belongs in memory without automatically changing the
    // workout. Only messages with training constraints enter today's plan.
    let reply = buildLocalCoachReply(currentUser, text);
    let constraint = isWorkoutRelevantMessage(text) ? text : null;
    let goalUpdate = extractGoalUpdate(text);
    const localSuggestedSplit = inferSplitFromChat(text);
    const localFocus = getCoachFocus(text);
    if (localSuggestedSplit) chatSuggestedSplit = localSuggestedSplit;
    if (localFocus) {
      reply = `I’ll shift today’s workout toward your ${localFocus}. Anything sore or any equipment you want me to avoid? Open the workout below to review it.`;
    }

    // Explicit "225 on bench" style statements seed that exercise's weight
    // today, ahead of history or any AI guess. Naming a specific exercise
    // with negative intent ("no weighted pullups") bans it for good, not
    // just today — see excludeExercise. Both can fire on the same message,
    // so build the fallback reply from whichever apply instead of one
    // overwriting the other.
    const localAcks = [];
    const weightOverrides = detectWeightOverrides(text, currentUser);
    if (weightOverrides.length > 0) {
      weightOverrides.forEach((o) => {
        checkInState.weightOverrides[o.exercise] = o.weight;
      });
      localAcks.push(`starting you at ${weightOverrides.map((o) => `${o.exercise} at ${o.weight} lb`).join(", ")} today`);
    }
    const excludedNow = detectExclusionRequests(text, currentUser);
    if (excludedNow.length > 0) {
      excludedNow.forEach((name) => excludeExercise(currentUser, name));
      localAcks.push(`won't suggest ${excludedNow.join(", ")} again — bring it back anytime from Settings`);
    }
    // A general "let's go lighter today" (no specific number) adjusts every
    // weighted exercise's suggested load, not just one named lift.
    const weightDirection = detectWeightDirection(text);
    if (weightDirection) {
      checkInState.weightDirection = weightDirection;
      localAcks.push(`going ${weightDirection} across the board today`);
    }
    if (localAcks.length > 0) {
      reply = `Got it — ${localAcks.join("; and ")}.`;
    }

    if (AI_ENDPOINT) {
      try {
        const persona = getPersonaProfile(currentUser);
        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "chat",
            persona: {
              name: persona.name,
              goal: persona.goal,
              heightIn: persona.heightIn,
              weightLb: persona.weightLb,
              focusAreas: persona.focusAreas,
            },
            messages: chatMessages,
            context: {
              streak: currentStreak(getHistory(currentUser)),
              sessionsLogged: getHistory(currentUser).length,
              recentNotes: getNotes(currentUser).slice(-6),
              recentWorkouts: getHistory(currentUser).slice(-5).map((entry) => ({
                date: entry.date,
                workout: getSplitMeta(entry.splitKey).name,
                note: entry.note || null,
              })),
            },
          }),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.reply === "string" && data.reply.trim()) {
            reply = data.reply.trim();
            if (typeof data.constraint === "string" && data.constraint.trim()) constraint = data.constraint.trim();
          }
          if (typeof data.goalUpdate === "string" && data.goalUpdate.trim()) goalUpdate = data.goalUpdate.trim().slice(0, 180);
          if (!localSuggestedSplit && SPLIT_ORDER.includes(data.suggestedSplit)) {
            chatSuggestedSplit = data.suggestedSplit;
          }
        }
      } catch {
        // network error or timeout — fall through to the local fallback above
      }
    }

    if (localFocus && !reply.includes("?")) {
      reply += " Anything sore or any equipment you want me to avoid?";
    }

    chatMessages.push({ role: "coach", text: reply });
    renderChatThread();
    setChatBusy(false);

    if (constraint) {
      checkInState.note = [checkInState.note, constraint].filter(Boolean).join(". ");
    }
    // Preserve the conversation theme for future openings without forcing
    // a general motivation or goal discussion into today's workout prompt.
    logNote(currentUser, constraint || text);

    if (goalUpdate) {
      const persona = getPersonaProfile(currentUser);
      saveProfile(currentUser, {
        goal: goalUpdate,
        heightIn: persona.heightIn,
        weightLb: persona.weightLb,
        focusAreas: persona.focusAreas,
      });
      renderRecapCard(currentUser);
    }

    // If the athlete's already on the workout-selection screen, let the
    // recommendation react immediately instead of waiting for a re-visit.
    if (!document.getElementById("select-screen").classList.contains("hidden")) {
      renderSelectScreen(currentUser, getHistory(currentUser));
    } else if (!document.getElementById("session-screen").classList.contains("hidden") && selectedSplitKey && !loggedToday(getHistory(currentUser))) {
      refreshPreviewFromCoach(currentUser);
    }
  }

  function initCheckIn() {
    ["checkin-energy", "checkin-minutes", "checkin-partner"].forEach((id) => {
      const row = document.getElementById(id);
      row.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const key = row.dataset.option;
        const raw = chip.dataset.value;
        // partner's chip values are "yes"/"no" strings, but a non-empty
        // string is always truthy — store it as a real boolean instead.
        checkInState[key] = key === "minutes" ? Number(raw) : key === "partner" ? raw === "yes" : raw;
        selectChip(row, raw);
      });
    });

    document.getElementById("chat-send").addEventListener("click", sendChatMessage);
    document.getElementById("chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChatMessage();
    });

    document.getElementById("checkin-submit").addEventListener("click", () => {
      showSelect(currentUser);
    });

    document.getElementById("checkin-start-btn").addEventListener("click", (e) => {
      if (activeWorkout) {
        showScreen("workout-screen");
        return;
      }
      e.currentTarget.classList.add("hidden");
      document.getElementById("checkin-form").classList.remove("hidden");
    });

    document.getElementById("checkin-switch").addEventListener("click", showLogin);

    document.getElementById("hub-settings-btn").addEventListener("click", () => showSettings(currentUser));
    document.getElementById("hub-history-btn").addEventListener("click", () => showHistory(currentUser));
    document.getElementById("hub-graph-btn").addEventListener("click", () => showGraph(currentUser));
    document.getElementById("hub-cheer-btn").addEventListener("click", () => showCheerModal(currentUser));
  }

  // ---------- rendering: select screen ----------

  function renderRecommendationExercises(exercises, focus, loading = false) {
    const update = document.getElementById("rec-live-update");
    const list = document.getElementById("rec-exercises");
    if (!update || !list) return;

    if (focus) {
      update.textContent = `LIVE UPDATE · ${focus.toUpperCase()} FOCUS APPLIED`;
      update.classList.remove("hidden");
    } else if (loading) {
      update.textContent = "COACH IS FINE-TUNING THIS DRAFT…";
      update.classList.remove("hidden");
    } else {
      update.classList.add("hidden");
      update.textContent = "";
    }

    list.innerHTML = exercises
      .map((exercise) => `<li><span>${escapeHtml(exercise.name)}</span><strong>${escapeHtml(exercise.detail)}</strong></li>`)
      .join("");
  }

  function openRecommendationPreview(user, splitKey) {
    if (!recommendationDraft || recommendationDraftKey !== splitKey) {
      selectSplitAndPreview(user, splitKey);
      return;
    }
    selectedSplitKey = splitKey;
    previewPlan = recommendationDraft;
    showScreen("session-screen");
    renderSessionFull(user);
  }

  async function refreshRecommendationDraft(user, splitKey, reason) {
    const requestId = ++recommendationRequestId;
    const plan = await computePlan(user, splitKey, { ...checkInState });
    if (requestId !== recommendationRequestId || currentUser !== user) return;
    if (document.getElementById("select-screen").classList.contains("hidden")) return;

    recommendationDraftKey = splitKey;
    recommendationDraft = { ...plan, reason: plan.reason || reason };
    renderRecommendationExercises(plan.exercises, getCoachFocus(checkInState.note), false);
  }

  function renderSelectScreen(user, history) {
    placeTerminalPanel("select");
    // The coach can steer this straight from the chat ("let's do legs
    // today") — that override wins over the rotation-based guess until the
    // next check-in resets it.
    const rec = chatSuggestedSplit
      ? { key: chatSuggestedSplit, reason: "Based on what you told your coach — let's do it." }
      : recommendSplit(history, checkInState);
    const recMeta = getSplitMeta(rec.key);

    document.getElementById("rec-icon").textContent = recMeta.icon;
    document.getElementById("rec-name").textContent = recMeta.name;
    document.getElementById("rec-tagline").textContent = recMeta.tagline;
    document.getElementById("rec-reason").textContent = rec.reason;
    const localExercises = applyCoachFocus(user, rec.key, buildWorkoutPlan(user, rec.key, checkInState), checkInState.note);
    recommendationDraftKey = rec.key;
    recommendationDraft = { exercises: localExercises, reason: rec.reason, source: "local", suggestedWeights: new Map() };
    renderRecommendationExercises(localExercises, getCoachFocus(checkInState.note), Boolean(AI_ENDPOINT));
    document.getElementById("recommended-card").onclick = () => openRecommendationPreview(user, rec.key);
    refreshRecommendationDraft(user, rec.key, rec.reason);

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

  function initSelectScreen() {
    document.getElementById("select-switch").addEventListener("click", showLogin);
    document.getElementById("custom-workout-btn").addEventListener("click", () => showCustom(currentUser));
    document.getElementById("back-to-options").addEventListener("click", () => showSelect(currentUser));
    document.getElementById("edit-preview-btn").addEventListener("click", () => {
      if (previewPlan) showCustom(currentUser, previewPlan.exercises);
    });
  }

  // ---------- rendering: custom builder screen ----------

  function renderCustomScreen(user, seedExercises = []) {
    customSelection = new Map();
    const seededNames = new Set(seedExercises.map((exercise) => exercise.name));
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
        const selected = seededNames.has(ex.name);
        if (selected) customSelection.set(id, { ...ex, splitKey });
        const row = document.createElement("label");
        row.className = "custom-ex-row";
        row.innerHTML = `
          <input type="checkbox" data-id="${id}" data-name="${ex.name}" data-detail="${ex.detail}"
                 data-split="${splitKey}" data-tip="${ex.tip || ""}" data-superset="${ex.superset || ""}" ${selected ? "checked" : ""} />
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
      const { id, name, detail, split, tip, superset } = input.dataset;
      if (input.checked) {
        customSelection.set(id, { name, detail, splitKey: split, tip: tip || undefined, superset: superset || undefined });
      } else {
        customSelection.delete(id);
      }
      updateCustomFooter();
    });

    document.getElementById("custom-start-btn").addEventListener("click", () => {
      if (customSelection.size === 0) return;
      showWorkout(currentUser, "custom", Array.from(customSelection.values()));
    });
  }

  // ---------- navigation ----------

  function showLogin() {
    currentUser = null;
    selectedSplitKey = null;
    activeWorkout = null;
    showScreen("login-screen");
  }

  function showHome() {
    if (!currentUser) {
      showLogin();
      return;
    }
    showScreen("checkin-screen");
    placeTerminalPanel("checkin");
    renderRecapCard(currentUser);
    const startButton = document.getElementById("checkin-start-btn");
    startButton.textContent = activeWorkout ? "▶ Resume Workout" : "🏋️ Start a Workout";
    startButton.classList.remove("hidden");
    document.getElementById("checkin-form").classList.add("hidden");
  }

  function showWelcome(user) {
    const persona = getPersonaProfile(user);
    document.documentElement.style.setProperty("--accent", persona.accent);
    document.getElementById("welcome-name").textContent = persona.name.toUpperCase();

    showScreen("welcome-screen");
    const welcome = document.getElementById("welcome-screen");

    // Vega scurries across Jessica's welcome screen only. Removing and
    // re-adding the class restarts the run when she returns to this screen.
    welcome.classList.remove("vega-active");
    if (user === "jessica") {
      const vegaImage = document.querySelector("#vega-scurry img");
      vegaImage.onerror = () => welcome.classList.remove("vega-active");
      void welcome.offsetWidth;
      welcome.classList.add("vega-active");
    }

    // restart the pulse animation on a fresh element
    const nameEl = document.getElementById("welcome-name");
    nameEl.classList.remove("riff-pulse");
    void nameEl.offsetWidth;
    nameEl.classList.add("riff-pulse");

    const advance = async () => {
      welcome.removeEventListener("click", advance);
      currentUser = user;
      await pullFromCloud(user);
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
    // Waits for the tap — matches the "tap anywhere to continue" hint
    // instead of secretly auto-advancing on a timer underneath it.
    welcome.addEventListener("click", advance);
  }

  function showSelect(user) {
    currentUser = user;
    showScreen("select-screen");
    renderSelectScreen(user, getHistory(user));
  }

  function showCustom(user, seedExercises = []) {
    currentUser = user;
    showScreen("custom-screen");
    renderCustomScreen(user, seedExercises);
  }

  // Returns to the check-in hub WITHOUT resetting it — used by Settings/
  // History's back buttons so an in-progress chat or chip picks survive a
  // trip to a sub-screen. Only the recap card is refreshed (a goal edit or
  // a cheer may have just landed).
  function returnToCheckIn(user) {
    showScreen("checkin-screen");
    renderRecapCard(user);
    document.getElementById("hub-cheer-btn").title = `Cheer ${getPersonaProfile(otherUser(user)).name}`;
  }

  // ---------- settings screen ----------

  function renderSettings(user) {
    const persona = getPersonaProfile(user);
    document.getElementById("settings-name").textContent = persona.name;
    document.getElementById("settings-goal").value = persona.goal;
    document.getElementById("settings-height-ft").value = persona.heightIn != null ? Math.floor(persona.heightIn / 12) : "";
    document.getElementById("settings-height-in").value = persona.heightIn != null ? persona.heightIn % 12 : "";
    document.getElementById("settings-weight").value = persona.weightLb ?? "";

    const focusContainer = document.getElementById("settings-focus");
    focusContainer.innerHTML = "";
    SPLIT_ORDER.forEach((key) => {
      const meta = SPLIT_LIBRARY[key];
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.value = key;
      chip.textContent = `${meta.icon} ${meta.name}`;
      if (persona.focusAreas.includes(key)) chip.classList.add("selected");
      chip.addEventListener("click", () => chip.classList.toggle("selected"));
      focusContainer.appendChild(chip);
    });

    renderExcludedList(user);
  }

  function renderExcludedList(user) {
    const container = document.getElementById("settings-excluded");
    const empty = document.getElementById("settings-excluded-empty");
    const excluded = getPersonaProfile(user).excludedExercises;
    container.innerHTML = excluded
      .map(
        (name) => `
      <span class="excluded-chip">
        ${escapeHtml(name)}
        <button type="button" class="excluded-chip-remove" data-name="${escapeHtml(name)}" title="Allow again">✕</button>
      </span>
    `
      )
      .join("");
    empty.classList.toggle("hidden", excluded.length > 0);
  }

  function showSettings(user) {
    currentUser = user;
    showScreen("settings-screen");
    renderSettings(user);
  }

  function initSettings() {
    document.getElementById("settings-back").addEventListener("click", () => returnToCheckIn(currentUser));

    document.getElementById("settings-save").addEventListener("click", () => {
      const ft = Number(document.getElementById("settings-height-ft").value) || 0;
      const inch = Number(document.getElementById("settings-height-in").value) || 0;
      const heightIn = ft || inch ? ft * 12 + inch : null;
      const weightVal = document.getElementById("settings-weight").value;
      const weightLb = weightVal === "" ? null : Number(weightVal);
      const goal = document.getElementById("settings-goal").value.trim() || PERSONAS[currentUser].goal;
      const focusAreas = Array.from(document.querySelectorAll("#settings-focus .chip.selected")).map((c) => c.dataset.value);

      // Spread the current profile first so any field this form doesn't
      // edit (excludedExercises, lastGreetingTopic, ...) survives a save
      // instead of getting silently wiped by a partial object here.
      saveProfile(currentUser, { ...getPersonaProfile(currentUser), goal, heightIn, weightLb, focusAreas });
      returnToCheckIn(currentUser);
    });

    document.getElementById("settings-excluded").addEventListener("click", (e) => {
      const btn = e.target.closest(".excluded-chip-remove");
      if (!btn) return;
      includeExercise(currentUser, btn.dataset.name);
      renderExcludedList(currentUser);
    });

    document.getElementById("settings-export").addEventListener("click", exportBackupFile);

    const importInput = document.getElementById("settings-import-file");
    document.getElementById("settings-import").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) importBackupFile(file);
      importInput.value = "";
    });
  }

  // ---------- history screen ----------

  function renderHistoryFull(user) {
    document.getElementById("history-name").textContent = getPersonaProfile(user).name;
    const list = document.getElementById("history-full-list");
    list.innerHTML = "";
    const history = getHistory(user);

    if (history.length === 0) {
      const note = document.createElement("li");
      note.className = "empty-note";
      note.textContent = "No sessions logged yet.";
      list.appendChild(note);
      return;
    }

    [...history].reverse().forEach((entry) => {
      const meta = getSplitMeta(entry.splitKey);
      const metaLine = entry.minutes
        ? `${entry.minutes} min · ${ENERGY_LABEL[entry.energy]}${entry.partner ? " · w/ partner" : ""}`
        : "";
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="hist-icon">${meta.icon}</span>
        <span class="hist-name">${escapeHtml(meta.name)}</span>
        <span class="hist-date">${formatShortDate(entry.date)}</span>
        ${metaLine ? `<span class="hist-meta">${escapeHtml(metaLine)}</span>` : ""}
        ${entry.note ? `<span class="hist-note">📝 “${escapeHtml(entry.note)}”</span>` : ""}
      `;
      list.appendChild(li);
    });
  }

  function showHistory(user) {
    currentUser = user;
    showScreen("history-screen");
    renderHistoryFull(user);
  }

  function initHistory() {
    document.getElementById("history-back").addEventListener("click", () => returnToCheckIn(currentUser));
  }

  // ---------- weight trends / graph screen ----------

  // Which chosen series are plotted. Bodyweight starts on; the lift trends
  // are opt-in since most sessions won't have touched them.
  let graphActiveSeries = new Set(["bodyweight"]);

  // Matches logged exercise names loosely rather than hardcoding per-persona
  // exercise lists — Jake's "Barbell Bench Press" and Jessica's "Dumbbell
  // Chest Press" both count toward "Bench", any "Squat" variant toward "Squat".
  const GRAPH_LIFT_KEYWORDS = {
    bench: ["bench", "chest press"],
    squat: ["squat"],
  };

  const GRAPH_SERIES_META = {
    bodyweight: { label: "Bodyweight" },
    // Fixed colors distinct from both personas' accent colors (purple and
    // cyan) so a lift trend never blends into the bodyweight line.
    bench: { label: "Bench (est. 1RM)", color: "#ffb703" },
    squat: { label: "Squat (est. 1RM)", color: "#39ff88" },
  };

  function getBodyweightTrend(user) {
    return getWeighIns(user).map((w) => ({ date: w.date, weight: w.weight }));
  }

  // Epley formula: a rough but standard way to compare strength across sets
  // of different rep counts — a heavy single and a lighter set of 8 both
  // resolve to one comparable number.
  function estimate1RM(weight, reps) {
    if (!Number.isFinite(weight) || weight <= 0) return null;
    const r = Number.isFinite(reps) && reps > 0 ? reps : 1;
    return weight * (1 + r / 30);
  }

  // For each logged session, finds the single best estimated 1RM among any
  // set on any exercise matching the given keywords — e.g. the day's best
  // bench set, whichever bench variant it was.
  function getLiftTrend(user, keywords) {
    const points = [];
    getHistory(user).forEach((entry) => {
      let dayBest = null;
      Object.entries(entry.performance || {}).forEach(([name, perf]) => {
        const lower = name.toLowerCase();
        if (!keywords.some((kw) => lower.includes(kw))) return;
        (perf.sets || []).forEach((s) => {
          const reps = Number.isFinite(s.actual) ? s.actual : s.target;
          const oneRM = estimate1RM(s.weight, reps);
          if (oneRM != null && (dayBest == null || oneRM > dayBest)) dayBest = oneRM;
        });
      });
      if (dayBest != null) points.push({ date: entry.date, weight: Math.round(dayBest) });
    });
    return points;
  }

  function renderGraph(user) {
    document.getElementById("graph-name").textContent = getPersonaProfile(user).name;

    const svg = document.getElementById("graph-svg");
    svg.innerHTML = "";

    const seriesData = [];
    if (graphActiveSeries.has("bodyweight")) {
      const points = getBodyweightTrend(user);
      if (points.length) seriesData.push({ key: "bodyweight", color: getPersonaProfile(user).accent, points });
    }
    ["bench", "squat"].forEach((key) => {
      if (!graphActiveSeries.has(key)) return;
      const points = getLiftTrend(user, GRAPH_LIFT_KEYWORDS[key]);
      if (points.length) seriesData.push({ key, color: GRAPH_SERIES_META[key].color, points });
    });

    const empty = document.getElementById("graph-empty");
    if (seriesData.length === 0) {
      empty.classList.remove("hidden");
      renderGraphLegend([]);
      return;
    }
    empty.classList.add("hidden");

    const withTimes = seriesData.map((s) => ({
      ...s,
      points: [...s.points].map((p) => ({ ...p, t: new Date(p.date).getTime() })).sort((a, b) => a.t - b.t),
    }));
    const allPoints = withTimes.flatMap((s) => s.points);
    const minT = Math.min(...allPoints.map((p) => p.t));
    const maxT = Math.max(...allPoints.map((p) => p.t));
    const minW = Math.min(...allPoints.map((p) => p.weight));
    const maxW = Math.max(...allPoints.map((p) => p.weight));
    const padW = Math.max((maxW - minW) * 0.15, 5);
    const yMin = Math.max(0, minW - padW);
    const yMax = maxW + padW;

    const W = 600,
      H = 300,
      PAD_L = 34,
      PAD_R = 10,
      PAD_T = 14,
      PAD_B = 10;
    const xFor = (t) =>
      maxT === minT ? PAD_L + (W - PAD_L - PAD_R) / 2 : PAD_L + ((t - minT) / (maxT - minT)) * (W - PAD_L - PAD_R);
    const yFor = (w) =>
      yMax === yMin ? H - PAD_B - (H - PAD_T - PAD_B) / 2 : H - PAD_B - ((w - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

    const ns = "http://www.w3.org/2000/svg";

    for (let i = 0; i <= 3; i++) {
      const w = yMin + ((yMax - yMin) * i) / 3;
      const y = yFor(w);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", PAD_L);
      line.setAttribute("x2", W - PAD_R);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("class", "graph-gridline");
      svg.appendChild(line);

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", PAD_L - 6);
      label.setAttribute("y", y + 3);
      label.setAttribute("class", "graph-axis-label");
      label.setAttribute("text-anchor", "end");
      label.textContent = Math.round(w);
      svg.appendChild(label);
    }

    withTimes.forEach((s) => {
      const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t)} ${yFor(p.weight)}`).join(" ");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "graph-line");
      path.style.stroke = s.color;
      path.style.color = s.color;
      svg.appendChild(path);

      s.points.forEach((p) => {
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", xFor(p.t));
        c.setAttribute("cy", yFor(p.weight));
        c.setAttribute("r", 3.5);
        c.setAttribute("class", "graph-point");
        c.style.fill = s.color;
        const title = document.createElementNS(ns, "title");
        title.textContent = `${formatShortDate(p.date)}: ${p.weight} lb${s.key === "bodyweight" ? "" : " (est. 1RM)"}`;
        c.appendChild(title);
        svg.appendChild(c);
      });
    });

    renderGraphLegend(seriesData);
  }

  function renderGraphLegend(seriesData) {
    const el = document.getElementById("graph-legend");
    el.innerHTML = seriesData
      .map(
        (s) => `
      <span class="graph-legend-item">
        <span class="graph-legend-dot" style="background:${s.color}"></span>${escapeHtml(GRAPH_SERIES_META[s.key].label)}
      </span>
    `
      )
      .join("");
  }

  function showGraph(user) {
    currentUser = user;
    showScreen("graph-screen");
    document.getElementById("graph-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("graph-weight-input").value = "";
    renderGraph(user);
  }

  function initGraphScreen() {
    document.getElementById("graph-back").addEventListener("click", () => returnToCheckIn(currentUser));

    document.getElementById("graph-log-btn").addEventListener("click", () => {
      const date = document.getElementById("graph-date").value;
      const weight = Number(document.getElementById("graph-weight-input").value);
      if (!date || !Number.isFinite(weight) || weight <= 0) return;
      logWeighIn(currentUser, date, weight);
      document.getElementById("graph-weight-input").value = "";
      renderGraph(currentUser);
    });

    document.querySelectorAll(".graph-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.series;
        if (graphActiveSeries.has(key)) graphActiveSeries.delete(key);
        else graphActiveSeries.add(key);
        btn.classList.toggle("selected");
        renderGraph(currentUser);
      });
    });
  }

  // ---------- cheer modal ----------

  function renderCheerModal(user) {
    const target = otherUser(user);
    const targetProfile = getPersonaProfile(target);
    const streak = currentStreak(getHistory(target));

    document.getElementById("cheer-title").textContent = `👋 Cheer on ${targetProfile.name}`;
    document.getElementById("cheer-subtext").textContent =
      streak > 0
        ? `${targetProfile.name} is on a ${streak}-day streak — send them some love.`
        : `Let ${targetProfile.name} know you're thinking of them.`;

    const presets = document.getElementById("cheer-presets");
    presets.innerHTML = "";
    CHEER_PRESETS.forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        sendCheer(target, user, text);
        closeCheerModal();
      });
      presets.appendChild(chip);
    });

    document.getElementById("cheer-custom").value = "";
  }

  function showCheerModal(user) {
    renderCheerModal(user);
    document.getElementById("cheer-modal").classList.remove("hidden");
  }

  function closeCheerModal() {
    document.getElementById("cheer-modal").classList.add("hidden");
  }

  function initCheerModal() {
    document.getElementById("cheer-cancel").addEventListener("click", closeCheerModal);

    document.getElementById("cheer-send").addEventListener("click", () => {
      const text = document.getElementById("cheer-custom").value.trim();
      if (!text) return;
      sendCheer(otherUser(currentUser), currentUser, text);
      closeCheerModal();
    });

    document.getElementById("cheer-modal").addEventListener("click", (e) => {
      if (e.target.id === "cheer-modal") closeCheerModal();
    });
  }

  // ---------- init ----------

  document.querySelectorAll(".user-card").forEach((card) => {
    card.addEventListener("click", () => showWelcome(card.dataset.user));
  });

  document.getElementById("switch-user").addEventListener("click", showLogin);
  document.getElementById("home-button").addEventListener("click", showHome);

  initCheckIn();
  initSettings();
  initHistory();
  initGraphScreen();
  initCheerModal();
  initSelectScreen();
  initCustomScreen();
  initWorkoutScreen();
  initTerminalCursor();

  renderClock();
  setInterval(renderClock, 1000);

  showLogin();
})();
