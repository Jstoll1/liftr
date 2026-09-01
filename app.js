(() => {
  "use strict";

  const STORAGE_KEY = "liftr_history_v3";
  const NOTES_KEY = "liftr_notes_v1";
  const SOUND_KEY = "liftr_sound_enabled";

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
    const pool = [...SPLIT_LIBRARY[splitKey].exercises[user]];
    const finisher = FINISHERS[splitKey]?.[user];
    const partnerExtra = PARTNER_EXTRAS[splitKey]?.[user];
    if (finisher) pool.push(finisher);
    if (partnerExtra) pool.push(partnerExtra);
    return pool;
  }

  // Asks the Cloudflare Worker (which holds the OpenAI key) to pick today's
  // exercises from the real candidate pool. Falls back to the local
  // rule-based planner on any failure, timeout, or if no endpoint is set.
  async function computePlan(user, splitKey, checkIn) {
    if (AI_ENDPOINT) {
      try {
        const persona = PERSONAS[user];
        const meta = SPLIT_LIBRARY[splitKey];
        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: { name: persona.name, goal: persona.goal },
            split: { key: splitKey, name: meta.name, tagline: meta.tagline },
            minutes: checkIn.minutes,
            energy: checkIn.energy,
            partner: Boolean(checkIn.partner),
            todayNote: (checkIn.note || "").trim() || null,
            pastNotes: getPastNotes(user, 5),
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
            return { exercises: data.exercises, reason: typeof data.reason === "string" ? data.reason : null, source: "ai" };
          }
        }
      } catch {
        // network error, timeout, or malformed response — fall through to local plan
      }
    }

    return { exercises: buildWorkoutPlan(user, splitKey, checkIn), reason: null, source: "local" };
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
  let checkInState = { minutes: 30, energy: "medium", partner: false, note: "" };
  let chatMessages = []; // [{ role: "coach" | "user", text }] for the check-in chat
  let chatBusy = false;
  let selectedSplitKey = null; // split chosen on the select screen, awaiting log
  let previewPlan = null; // { exercises, reason, source } computed for the current preview
  let customSelection = new Map(); // exerciseId -> { name, detail, splitKey, tip, superset }
  let activeWorkout = null; // { sessionSplitKey, exercises, logs, reason, source } for the in-progress workout runner

  // ---------- screen helpers ----------

  const SCREEN_IDS = [
    "login-screen",
    "welcome-screen",
    "checkin-screen",
    "select-screen",
    "custom-screen",
    "session-screen",
    "workout-screen",
  ];

  function showScreen(id) {
    SCREEN_IDS.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
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

    if (!previewPlan) {
      renderSessionLoading(splitKey);
      return;
    }

    renderExerciseList(previewPlan.exercises);
    renderTags(buildTags(checkInState));
    renderAiNote(previewPlan.source === "ai" ? previewPlan.reason : null);
    statusEl.classList.add("hidden");
    btn.textContent = "Start Workout";
    btn.disabled = false;
    btn.onclick = () => {
      const exercises = previewPlan.exercises.map((ex) => ({ ...ex, splitKey }));
      showWorkout(user, splitKey, exercises, { reason: previewPlan.reason, source: previewPlan.source });
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
    const persona = PERSONAS[user];
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

  // A rough "does this exercise typically use added weight" heuristic —
  // strength splits and anything explicitly named "Weighted ___" get the
  // weight field; pure cardio/mobility work doesn't.
  function usesWeight(ex) {
    return ex.splitKey === "chest-back" || ex.splitKey === "legs" || /weighted/i.test(ex.name);
  }

  function buildInitialLogs(user, exercises) {
    const logs = {};
    exercises.forEach((ex) => {
      const setCount = parseSetCount(ex.detail);
      const target = parseTargetReps(ex.detail);
      const seedWeight = usesWeight(ex) ? getLastWeight(user, ex.name) : null;
      logs[ex.name] = {
        // Weight lives per set, not per exercise — sets often ramp
        // (e.g. 135/155/175/185), so each one gets its own adjustable value,
        // all seeded from wherever the athlete left off last time.
        sets: Array.from({ length: setCount }, () => ({ target, actual: target, weight: seedWeight, touched: false })),
        flag: "",
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

  // Swaps one exercise for a different one from the same body part's full
  // candidate pool (base + finisher + partner move), skipping anything
  // already in today's workout. Purely local — no AI round trip needed for
  // "replace flies with something else."
  function swapExercise(ex) {
    if (!activeWorkout) return null;
    const currentNames = new Set(activeWorkout.exercises.map((e) => e.name));
    const options = buildCandidatePool(currentUser, ex.splitKey).filter((c) => !currentNames.has(c.name));
    if (options.length === 0) return null;

    const replacement = { ...options[Math.floor(Math.random() * options.length)], splitKey: ex.splitKey };
    const idx = activeWorkout.exercises.findIndex((e) => e.name === ex.name);
    if (idx === -1) return null;

    activeWorkout.exercises[idx] = replacement;
    delete activeWorkout.logs[ex.name];
    activeWorkout.logs[replacement.name] = buildInitialLogs(currentUser, [replacement])[replacement.name];
    return replacement;
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
      <div class="wex-sets">${setsHtml}</div>
      <input type="text" class="wex-flag-input" placeholder="Anything to flag on this one? (optional)" maxlength="140" />
      <div class="wex-swap-row">
        <input type="text" class="wex-swap-input" placeholder="Want to swap this? e.g. 'replace flies, shoulder is sore'" maxlength="140" />
        <button type="button" class="wex-swap-btn">🔁 Swap</button>
      </div>
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
          btn.addEventListener("click", () => {
            const dir = Number(btn.dataset.dir);
            setWeight(Math.max(0, (set.weight ?? 0) + dir * 5));
          });
        });
      }

      const repsStepper = row.querySelector('.wex-mini-stepper[data-role="reps"]');
      if (repsStepper) {
        const valueEl = repsStepper.querySelector(".wex-mini-value");
        repsStepper.querySelectorAll(".wex-mini-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const dir = Number(btn.dataset.dir);
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

    body.querySelector(".wex-flag-input").addEventListener("input", (e) => {
      log.flag = e.target.value;
    });

    body.querySelector(".wex-swap-btn").addEventListener("click", () => {
      const swapInput = body.querySelector(".wex-swap-input");
      const reasonText = swapInput.value.trim();
      const replaced = swapExercise(ex);
      if (!replaced) return;
      if (reasonText) {
        logNote(currentUser, `Swapped ${ex.name} → ${replaced.name} (${reasonText})`);
      }
      renderWorkoutExercises();
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
      logs: buildInitialLogs(user, exercises),
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
      activeWorkout.logs = buildInitialLogs(currentUser, exercises);
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
    const persona = PERSONAS[user];
    const history = getHistory(user);
    const el = document.getElementById("recap-card");

    if (history.length === 0) {
      el.innerHTML = `
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
    checkInState = { minutes: 30, energy: "medium", partner: false, note: "" };
    document.getElementById("checkin-name").textContent = PERSONAS[user].name;
    renderRecapCard(user);
    selectChip(document.getElementById("checkin-energy"), checkInState.energy);
    selectChip(document.getElementById("checkin-minutes"), checkInState.minutes);
    selectChip(document.getElementById("checkin-partner"), checkInState.partner ? "yes" : "no");
    resetChat(user);
  }

  // ---------- check-in chat ----------
  // A short conversational front door — the athlete can mention pain,
  // fatigue, or equipment limits and have it actually shape today's
  // exercise selection, instead of typing into a note nobody responds to.

  function resetChat(user) {
    const history = getHistory(user);
    const greeting =
      history.length === 0
        ? `Hey ${PERSONAS[user].name}! I'm your coach. Anything going on today I should know about before we get moving?`
        : "Welcome back! Anything going on today — sore spots, low on time, equipment changes — before I help pick your session?";
    chatMessages = [{ role: "coach", text: greeting }];
    chatBusy = false;
    renderChatThread();
    setChatBusy(false);
  }

  function renderChatThread() {
    const el = document.getElementById("chat-thread");
    el.innerHTML = chatMessages
      .map((m) => `<div class="chat-bubble chat-${m.role}">${escapeHtml(m.text)}</div>`)
      .join("");
    el.scrollTop = el.scrollHeight;
  }

  function setChatBusy(busy) {
    chatBusy = busy;
    document.getElementById("chat-send").disabled = busy;
    document.getElementById("chat-send").textContent = busy ? "…" : "Send";
    document.getElementById("chat-input").disabled = busy;
  }

  async function sendChatMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || chatBusy) return;

    chatMessages.push({ role: "user", text });
    input.value = "";
    renderChatThread();
    setChatBusy(true);

    // Best-effort fallback if the AI is unreachable or unconfigured — the
    // raw message still becomes today's note so nothing typed is lost.
    let reply = "Got it, I'll keep that in mind for today.";
    let constraint = text;

    if (AI_ENDPOINT) {
      try {
        const persona = PERSONAS[currentUser];
        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "chat",
            persona: { name: persona.name, goal: persona.goal },
            messages: chatMessages,
          }),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.reply === "string" && data.reply.trim()) {
            reply = data.reply.trim();
            constraint = typeof data.constraint === "string" && data.constraint.trim() ? data.constraint.trim() : null;
          }
        }
      } catch {
        // network error or timeout — fall through to the local fallback above
      }
    }

    chatMessages.push({ role: "coach", text: reply });
    renderChatThread();
    setChatBusy(false);

    if (constraint) {
      checkInState.note = [checkInState.note, constraint].filter(Boolean).join(". ");
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
      logNote(currentUser, checkInState.note);
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
          <input type="checkbox" data-id="${id}" data-name="${ex.name}" data-detail="${ex.detail}"
                 data-split="${splitKey}" data-tip="${ex.tip || ""}" data-superset="${ex.superset || ""}" />
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
    // Waits for the tap — matches the "tap anywhere to continue" hint
    // instead of secretly auto-advancing on a timer underneath it.
    welcome.addEventListener("click", advance);
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
  initWorkoutScreen();

  renderClock();
  setInterval(renderClock, 1000);

  showLogin();
})();
