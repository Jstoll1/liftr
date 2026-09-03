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

  function removeWeighIn(user, date) {
    const all = loadAllWeighIns();
    if (!all[user]) return;
    all[user] = all[user].filter((w) => w.date !== date);
    saveAllWeighIns(all);
    pushToCloud(user);
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

  // ---------- exercise library (uploaded PDFs, referenced by the AI) ----------
  // Shared across both personas (a training program or PT protocol usually
  // isn't personal to one of them) — stored as extracted plain text, not the
  // original PDF bytes, so it fits easily in localStorage/KV and can be
  // dropped straight into an AI prompt with no server-side parsing needed.

  const LIBRARY_KEY = "liftr_library_v1";
  // Caps how much of one document's text we keep. Generous enough for a
  // real program PDF; just a ceiling against something huge blowing out
  // localStorage/KV or every future AI call's token cost.
  const MAX_LIBRARY_DOC_CHARS = 80000;
  // Hard ceiling on how much library text rides along on any single AI
  // call — keeps token cost bounded no matter how large the library grows.
  const MAX_LIBRARY_CONTEXT_CHARS = 3000;

  // Id for the pre-seeded "Shortcut to Shred" reference doc (see
  // seedLibraryIfNeeded below) — fixed so re-seeding logic can recognize it,
  // and so the dedicated Jake workouts below can point back to it by id.
  const SHRED_PDF_SEED_ID = "seed-shortcut-to-shred";
  const SHRED_PDF_SEED_TEXT = `WORKOUT PROGRAM
Cardio acceleration is critical to Shortcut to Shred. It will fire up Knee Tuck Jump
your fat-burning furnace like nothing else. Cardio acceleration Diagonal Bound
is a technique that combines high-intensity cardio and
 Tire Flip
resistance training into one fast-paced workout. Instead
of resting between your lifts, you will do cardio between Skipping (in place)
every single set. Simply put, you’ll lift one set of a prescribed Elliptical
exercise, such as bench press, and then immediately follow it DB Clean
with one minute of cardio. Smith Machine Clean
 Step-up with Knee Raise
Cardio effectively replaces your rest periods. Now, I don’t
mean you have to rack the barbell, run across the gym, and
jump on a treadmill or stationary bike. Your cardio acceleration
exercises can be as simple as running in place next to the
bench. You can also jump rope, perform dumbbell cleans,
step-ups, or any combination of full-body exercises. Whatever SHORTCUT TO SHRED
you do, the point is to move for an entire minute.
 WORKOUT PROGRAM
Between each set, you’ll do one minute of a cardio acceleration
exercise. If you’re new to fitness and find that one minute is PHASE 1: WEEK 1
too long, you can reduce the time to 30 seconds, or go at a
slower pace. The goal is to gradually increase the time you WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
spend doing high-intensity cardio. You want to keep each
cardio acceleration minute as intense and demanding as EXERCISE SETS REPS
possible. Bench Press 4 9-11
 Incline Dumbbell Press 3 9-11
CARDIO ACCELERATION OPTIONS Decline Smith Machine Press 3 9-11
KB Swing Dips 4 9-11
Goblet Squat Close-Grip Bench Press 4 9-11
Squat Jump Cable Crunch 3 9-11
Box Jump Smith Machine Hip Thrust 3 9-11
DB Step-up
BB Step-up
Sprints
 WORKOUT 2: SHOULDERS, LEGS, CALVES (MULTI-JOINT)
Running in Place EXERCISE SETS REPS
Medicine Ball Slam Barbell Shoulder Press 4 9-11
Dumbbell Lunge Alternating Dumbbell
Lunge Jumps Shoulder Press (Standing) 3 9-11
Side-to-Side Box Shuffle Smith Machine One-Arm
Sledgehammer Swing Upright Row 3 9-11
Battling Ropes Squat 4 9-11
Rocket Jump Deadlift 3 9-11
Lateral Bound Walking Lunge 3 9-11
Lateral Box Jump Standing Calf Raise 3 9-11
Side Standing Long Jump Seated Calf Raise 3 9-11
Mountain Climber
Jump Rope
WORKOUT 3: BACK, TRAPS, BICEPS (MULTI-JOINT) Straight-Arm Pulldown 3 12-15
 Smith Machine
EXERCISE SETS REPS Behind-the-Back Shrug 4 12-15
Barbell Bent Over Row 4 9-11 Incline Dumbbell Curl 3 12-15
Dumbbell Bent-Over Row 3 9-11 High Cable Curl 3 12-15
Seated Cable Row 3 9-11 Rope Cable Curl 3 12-15
Barbell Shrug 4 9-11 Dumbbell Reverse Wrist Curl 3 12-15
Barbell Curl 3 9-11
Barbell or EZ-Bar Preacher Curl 3 9-11
Reverse-Grip Barbell Curl 3 9-11
Barbell Wrist Curl 3 9-11 PHASE 1: WEEK 2
 WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT) EXERCISE SETS REPS
 Bench Press 4 6-8
EXERCISE SETS REPS
 Incline Dumbbell Press 3 6-8
Incline Dumbbell Flye 3 12-15
 Decline Smith Machine Press 3 6-8
Dumbbell Flye 3 12-15
 Dips 4 6-8
Cable Crossover 3 12-15
 Close-Grip Bench Press 4 6-8
Triceps Pressdown 3 12-15
 Cable Crunch 3 7-8
Overhead Dumbbell Extension 3 12-15
 Smith Machine Hip Thrust 3 7-8
Cable Lying Triceps Extension 3 12-15
Crunch 3 12-15
Standing Oblique Cable Crunch 3 12-15
 WORKOUT 2: SHOULDERS, LEGS, CALVES
 EXERCISE SETS REPS
WORKOUT 5: SHOULDERS, LEGS, CALVES Barbell Shoulder Press 4 6-8
 Alternating Dumbbell
EXERCISE SETS REPS
 Shoulder Press (Standing) 3 6-8
Dumbbell Lateral Raise 3 12-15
 Smith Machine
Barbell Front Raise 3 12-15
 One-Arm Upright Row 3 6-8
Dumbbell Bent-Over Lateral Raise 3 12-15
 Squat 4 6-8
Leg Extension 4 12-15
 Deadlift 3 6-8
Leg Curl 4 12-15
 Walking Lunge 3 6-8
Seated Calf Raise 3 12-15
 Standing Calf Raise 3 7-8
Donkey or Leg Press Calf Raise 3 12-15
 Seated Calf Raise 3 7-8
WORKOUT 6: BACK, TRAPS, BICEPS
 WORKOUT 3: BACK, TRAPS, BICEPS
EXERCISE SETS REPS
 EXERCISE SETS REPS
Lat Pulldown 3 12-15
 Barbell Bent Over Row 4 6-8
Reverse-Grip Pulldown 3 12-15
 Dumbbell Bent-Over Row 3 6-8
Seated Cable Row 3 6-8 PHASE 1: WEEK 3
Barbell Shrug 4 6-8
Barbell Curl 3 6-8 WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
Barbell or EZ-Bar Preacher Curl 3 6-8
 EXERCISE SETS REPS
Reverse-Grip Barbell Curl 3 6-8
 Bench Press 4 2-5
Barbell Wrist Curl 3 6-8
 Incline Dumbbell Press 3 2-5
 Decline Smith Machine Press 3 2-5
 Dips 4 2-5
WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT) Close-Grip Bench Press 4 2-5
EXERCISE SETS REPS Cable Crunch 3 5-6
Incline Dumbbell Flye 3 16-20 Smith Machine Hip Thrust 3 5-6
Dumbbell Flye 3 16-20
Cable Crossover 3 16-20
Triceps Pressdown 3 16-20 WORKOUT 2: SHOULDERS, LEGS, CALVES
Overhead Dumbbell Extension 3 16-20
 EXERCISE SETS REPS
Cable Lying Triceps Extension 3 16-20
 Barbell Shoulder Press 4 2-5
Crunch 3 16-20
 Alternating Dumbbell
Standing Oblique Cable Crunch 3 16-20
 Shoulder Press (Standing) 3 2-5
 Smith Machine
 One-Arm Upright Row 3 4-5
WORKOUT 5: SHOULDERS, LEGS, CALVES Squat 4 2-5
EXERCISE SETS REPS Deadlift 3 2-5
Dumbbell Lateral Raise 3 16-20 Walking Lunge 3 4-5
Barbell Front Raise 3 16-20 Standing Calf Raise 3 5-6
Dumbbell Bent-Over Lateral Raise 3 16-20 Seated Calf Raise 3 5-6
Leg Extension 4 16-20
Leg Curl 4 16-20
Seated Calf Raise 3 16-20 WORKOUT 3: BACK, TRAPS, BICEPS
Donkey or Leg Press Calf Raise 3 16-20
 EXERCISE SETS REPS
 Barbell Bent Over Row 4 2-5
 Dumbbell Bent-Over Row 3 2-5
WORKOUT 6: BACK, TRAPS, BICEPS Seated Cable Row 3 2-5
EXERCISE SETS REPS Barbell Shrug 4 2-5
Lat Pulldown 3 16-20 Barbell Curl 3 2-5
Reverse-Grip Pulldown 3 16-20 Barbell or EZ-Bar Preacher Curl 3 4-5
Straight-Arm Pulldown 3 16-20 Reverse-Grip Barbell Curl 3 4-5
Smith Machine Barbell Wrist Curl 3 4-5
 Behind-the-Back Shrug 4 16-20
Incline Dumbbell Curl 3 16-20
High Cable Curl 3 16-20 WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT)
Rope Cable Curl 3 16-20
 EXERCISE SETS REPS
Dumbbell Reverse Wrist Curl 3 16-20
 Incline Dumbbell Flye 3 21-30
Dumbbell Flye 3 21-30 by 20-30 percent and lift until you reach muscle failure again.
Cable Crossover 3 21-30 You are now done with the set and ready to move to the next
Triceps Pressdown 3 21-30 exercise.
Overhead Dumbbell Extension 3 21-30 WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
Cable Lying Triceps Extension 3 21-30
Crunch 3 21-30 EXERCISE SETS REPS
Standing Oblique Cable Crunch 3 21-30 Bench Press 4* 9-11
 Incline Bench Press 3* 9-11
 Decline Dumbbell Press 3* 9-11
WORKOUT 5: SHOULDERS, LEGS, CALVES Dips 4* 9-11
 Close-Grip Bench Press 4* 9-11
EXERCISE SETS REPS Smith Machine Crunch 3* 9-11
Dumbbell Lateral Raise 3 21-30 Hanging Leg Raise 3* 9-11
Barbell Front Raise 3 21-30
Dumbbell Bent-Over Lateral Raise 3 21-30 *On the last set do a cardio accelerated rest-pause dropset
Leg Extension 4 21-30
Leg Curl 4 21-30
Seated Calf Raise 3 21-30 WORKOUT 2: SHOULDERS, LEGS, CALVES (MULTI-JOINT)
Donkey or Leg Press Calf Raise 3 21-30
 EXERCISE SETS REPS
 Barbell Shoulder Press 4* 9-11
 Dumbbell Shoulder Press (Seated) 3* 9-11
WORKOUT 6: BACK, TRAPS, BICEPS Dumbbell Upright Row 3* 9-11
EXERCISE SETS REPS Squat 4* 9-11
Lat Pulldown 3 21-30 Deadlift 3* 9-11
Reverse-Grip Pulldown 3 21-30 Leg Press 3* 9-11
Straight-Arm Pulldown 3 21-30 Standing Calf Raise 3* 9-11
Smith Machine Seated Calf Raise 3* 9-11
 Behind-the-Back Shrug 4 21-30 *On the last set do a cardio accelerated rest-pause dropset
Incline Dumbbell Curl 3 21-30
High Cable Curl 3 21-30
Rope Cable Curl 3 21-30
 WORKOUT 3: BACK, TRAPS, BICEPS (MULTI-JOINT)
Dumbbell Reverse Wrist Curl 3 21-30
 EXERCISE SETS REPS
 Barbell Bent Over Row 4* 9-11
 Incline Dumbbell Row 3* 9-11
PHASE 2: WEEK 4 Seated Cable Row 3* 9-11
If you’re feeling really good and want to make the Shortcut to
 Barbell Shrug 4* 9-11
Shred sessions even more intense, start performing a “cardio
accelerated rest-pause dropset” on the last set of each major Barbell Curl 3* 9-11
exercise. The technique is as brutal as it sounds, believe me. Seated Barbell Curl 3* 9-11
 Reverse-Grip Barbell or EZ-Bar Curl 3* 9-11
Cardio accelerated rest-pause dropset: Take the last set of Behind-The-Back Wrist Curl 3* 9-11
each exercise to muscle failure. Then, rack the weight and
perform cardio acceleration by running in place for 15-20 *On the last set do a cardio accelerated rest-pause dropset
seconds. Pick up the weight and continue doing reps until you
reach muscle failure again. Immediately decrease the weight
WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT) PHASE 2: WEEK 5
EXERCISE SETS REPS WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
Cable Crossover from Low Pulley 4* 12-15
 EXERCISE SETS REPS
Cable Crossover 3* 12-15
 Bench Press 4* 6-8
Dumbbell Flye 3* 12-15
 Incline Bench Press 3* 6-8
Overhead Cable Triceps Extension 3* 12-15
 Decline Dumbbell Press 3* 6-8
Lying Triceps Extension 3* 12-15
 Dips 4* 6-8
Rope Triceps Pressdown 3* 12-15
 Close-Grip Bench Press 4* 6-8
Crossover Crunch 3* 12-15
 Smith Machine Crunch 3* 7-8
Cable Woodchopper 3* 12-15
 Hanging Leg Raise^ 3* 7-8
*On the last set do a cardio accelerated rest-pause dropset
 *On the last set do a cardio accelerated rest-pause dropset
 ^Use ankle weights or hold dumbbell between feet if needed
WORKOUT 5: SHOULDERS, LEGS, CALVES
EXERCISE SETS REPS
 WORKOUT 2: SHOULDERS, LEGS, CALVES (MULTI-JOINT)
Dumbbell Lateral Raise 4* 12-15
Cable Front Raise 3* 12-15 EXERCISE SETS REPS
Lying Cable Rear Delt Flye 3* 12-15 Barbell Shoulder Press 4* 6-8
Leg Extension 4* 12-15 Dumbbell Shoulder Press (Seated) 3* 6-8
Leg Curl 4* 12-15 Dumbbell Upright Row 3* 6-8
Seated Calf Raise 3* 12-15 Squat 4* 6-8
Donkey or Leg Press Calf Raise 3* 12-15 Deadlift 3* 6-8
 Leg Press 3* 6-8
*On the last set do a cardio accelerated rest-pause dropset
 Standing Calf Raise 3* 7-8
 Seated Calf Raise 3* 7-8
 WORKOUT 6: BACK, TRAPS, BICEPS *On the last set do a cardio accelerated rest-pause dropset
EXERCISE SETS REPS
Lat Pulldown 4* 12-15
 WORKOUT 3: BACK, TRAPS, BICEPS (MULTI-JOINT)
Behind-the-Neck Pulldown 3* 12-15
Rope Straight-Arm Pulldown 3* 12-15 EXERCISE SETS REPS
Dumbbell Shrug 4* 12-15 Barbell Bent Over Row 4* 6-8
EZ-Bar Cable Curl 3* 12-15 Incline Dumbbell Row 3* 6-8
Incline Dumbbell Curl 3* 12-15 Seated Cable Row 3* 6-8
Dumbbell Hammer Curl 3* 12-15 Barbell Shrug 4* 6-8
Dumbbell Reverse Wrist Curl 3* 12-15 Barbell Curl 3* 6-8
 Seated Barbell Curl 3* 6-8
*On the last set do a cardio accelerated rest-pause dropset
 Reverse-Grip Barbell or EZ-Bar Curl 3* 6-8
 Behind-The-Back Wrist Curl 3* 6-8
 *On the last set do a cardio accelerated rest-pause dropset
WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT) PHASE 2: WEEK 6
EXERCISE SETS REPS WORKOUT 1: CHEST, TRICEPS, ABS (MULTI-JOINT)
Cable Crossover from Low Pulley 4* 16-20
 EXERCISE SETS REPS
Cable Crossover 3* 16-20
 Bench Press 4* 2-5
Dumbbell Flye 3* 16-20
 Incline Bench Press 3* 2-5
Overhead Cable Triceps Extension 3* 16-20
 Decline Dumbbell Press 3* 2-5
Lying Triceps Extension 3* 16-20
 Dips 4* 2-5
Rope Triceps Pressdown 3* 16-20
 Close-Grip Bench Press 4* 2-5
Crossover Crunch 3* 16-20
 Smith Machine Crunch 3* 4-5
Cable Woodchopper 3* 16-20
 Hanging Leg Raise^ 3* 4-5
*On the last set do a cardio accelerated rest-pause dropset
 *On the last set do a cardio accelerated rest-pause dropset
 ^Use ankle weights or hold dumbbell between feet if needed
WORKOUT 5: SHOULDERS, LEGS, CALVES
EXERCISE SETS REPS
 WORKOUT 2: SHOULDERS, LEGS, CALVES (MULTI-JOINT)
Dumbbell Lateral Raise 4* 16-20
Cable Front Raise 3* 16-20 EXERCISE SETS REPS
Lying Cable Rear Delt Flye 3* 16-20 Barbell Shoulder Press 4* 2-5
Leg Extension 4* 16-20 Dumbbell Shoulder Press (Seated) 3* 2-5
Leg Curl 4* 16-20 Dumbbell Upright Row 3* 2-5
Seated Calf Raise 3* 16-20 Squat 4* 2-5
Donkey or Leg Press Calf Raise 3* 16-20 Deadlift 3* 2-5
 Leg Press 3* 2-5
*On the last set do a cardio accelerated rest-pause dropset
 Standing Calf Raise 3* 4-5
 Seated Calf Raise 3* 4-5
WORKOUT 6: BACK, TRAPS, BICEPS *On the last set do a cardio accelerated rest-pause dropset
EXERCISE SETS REPS
Lat Pulldown 4* 16-20
 WORKOUT 3: BACK, TRAPS, BICEPS (MULTI-JOINT)
Behind-the-Neck Pulldown 3* 16-20
Rope Straight-Arm Pulldown 3* 16-20 EXERCISE SETS REPS
Dumbbell Shrug 4* 16-20 Barbell Bent Over Row 4* 2-5
EZ-Bar Cable Curl 3* 16-20 Incline Dumbbell Row 3* 2-5
Incline Dumbbell Curl 3* 16-20 Seated Cable Row 3* 2-5
Dumbbell Hammer Curl 3* 16-20 Barbell Shrug 4* 2-5
Dumbbell Reverse Wrist Curl 3* 16-20 Barbell Curl 3* 2-5
 Seated Barbell Curl 3* 2-5
*On the last set do a cardio accelerated rest-pause dropset
 Reverse-Grip Barbell or EZ-Bar Curl 3* 4-5
 Behind-The-Back Wrist Curl 3* 4-5
 *On the last set do a cardio accelerated rest-pause dropset
WORKOUT 4: CHEST, TRICEPS, ABS (SINGLE JOINT) NUTRITION PLAN
 Shortcut to Shred is built on three distinct nutrition phases.
EXERCISE SETS REPS Each phase calls for different amounts of carbohydrates
Cable Crossover from Low Pulley 4* 21-30 and calories. Your protein and fat intake remains the same
Cable Crossover 3* 21-30 throughout Shortcut to Shred, but your carb intake gradually
Dumbbell Flye 3* 21-30 drops, which also drops your overall calories.
Overhead Cable Triceps Extension 3* 21-30
Lying Triceps Extension 3* 21-30 SHORTCUT TO SHRED
Rope Triceps Pressdown 3* 21-30 NUTRITION PLAN
Crossover Crunch 3* 21-30
Cable Woodchopper 3* 21-30 PROTEIN
 Phase 1-3: 1.5 g per pound of body weight
*On the last set do a cardio accelerated rest-pause dropset
 FAT
 Phase 1-3: 0.5 g per pound of body weight
WORKOUT 5: SHOULDERS, LEGS, CALVES CARBS
 Phase 1, Week 1: 1.5 g per pound of body weight
EXERCISE SETS REPS
 Phase 2, Weeks 2-3: 1 g per pound of body weight
Dumbbell Lateral Raise 4* 21-30
 Phase 3, Weeks 3-6: 0.5 g per pound of body weight
Cable Front Raise 3* 21-30
Lying Cable Rear Delt Flye 3* 21-30 In Phases 1 and 2, your caloric intake is different on workout
Leg Extension 4* 21-30 days and rest days, because on rest days you will not ingest a
Leg Curl 4* 21-30 pre- or post-workout meal.
Seated Calf Raise 3* 21-30
 In Phase 3, you will have more calories on your rest days than
Donkey or Leg Press Calf Raise 3* 21-30 on workout days. Why? When you drop your carb intake down
 to 0.5 grams per pound of bodyweight, your leptin levels may
*On the last set do a cardio accelerated rest-pause dropset
 drop if you don’t have enough calories. Leptin is a critical
 hormone for maintaining your metabolic rate. If leptin levels
 drop too low, your metabolic rate drops, too.
WORKOUT 6: BACK, TRAPS, BICEPS
 By giving your body a high-carb day, you can keep your leptin
EXERCISE SETS REPS levels even, which helps you continue burning fat and get
Lat Pulldown 4* 21-30 through the diet. A high-carb rest day will do wonders for your
 mind.
Behind-the-Neck Pulldown 3* 21-30
Rope Straight-Arm Pulldown 3* 21-30
Dumbbell Shrug 4* 21-30 PHASE I
EZ-Bar Cable Curl 3* 21-30 Protein: 1.5 grams per pound
Incline Dumbbell Curl 3* 21-30 Fats: 0.5 grams per pound
Dumbbell Hammer Curl 3* 21-30 Carbs: 1.5 grams per pound
Dumbbell Reverse Wrist Curl 3* 21-30
 WAKE-UP SUPPLEMENTS
*On the last set do a cardio accelerated rest-pause dropset
 200 mg caffeine
 500-1000 mg green tea extract
 2 g acetyl-L-carnitine
BREAKFAST 14 small Wonka Pixy Stix or 1 Giant Pixy Stix
30-60 min after wake-up supplements 5 g BCAAs
3 whole eggs 1.5-5 g creatine
3 egg whites 1.5-2 g beta-alanine
1 cup cooked oatmeal 2 g carnitine
1 tbsp honey
1/2 large grapefruit DINNER
 8 oz top sirloin steak
LATE-MORNING SNACK 1 large sweet potato
8 oz. reduced-fat Greek yogurt 2 cups mixed green salad
1 tbsp honey 1 tbsp olive oil
1/2 oz. walnuts (7 halves) crushed 1 tbsp vinegar
 2-3 g fish oil
LATE-MORNING SUPPLEMENTS 2-3 g CLA
200 mg caffeine
500-1000 mg green tea extract NIGHTTIME SNACK
2 g acetyl-L-carnitine 8 oz low-fat cottage cheese
 1 cup sliced pineapple
LUNCH 2-3 g fish oil
5 oz. can tuna 2-3 g CLA
2 slices whole-wheat bread
1 tbsp light mayonnaise NUTRITIONAL INFO
1/2 large grapefruit Calories: 3,000
 Protein: 285 g
MIDDAY SNACK Carbs: 270 g
3 sticks light mozzarella string cheese Fat: 90 g
1 medium apple
1 oz mixed nuts
PRE-WORKOUT SUPPLEMENTS PHASE II – WEEKS 2-3
30-60 minutes before workout Protein: 1.5 grams per pound of body weight
200 mg caffeine Fats: 0.5 grams per pound
500-1000 mg green tea extract Carbs: 1 gram per pound
2 g acetyl-L-carnitine Like in Phase 1, on the one day of the week that you don’t train,
 these numbers will be slightly lower since you skip the pre-
WORKOUT MEAL and post-workout meals. Feel free to have your pre-workout
Sip throughout workout shake as an extra snack on that rest day if you get hungry.
1 scoop protein powder
 The sample meals are similar to Phase 1, but this does not
1.5-5 g creatine mean you need to eat these exact foods and only these foods
1.5-2 g beta-alanine for all 3 weeks of the first 2 phases of this program. The foods
 are similar so you can see what I removed and changed to
POST-WORKOUT MEAL bring the carbs down without affecting protein and fat much.
Within 30 minutes after workout
 Refer to the alternative foods list for foods that you can use
2 scoops protein powder to replace these sample choices so the diet doesn’t become
 boring and bereft of nutrient diversity.
WAKE-UP SUPPLEMENTS WORKOUT MEAL
200 mg caffeine Sip throughout workout
500-1000 mg green tea extract 1 scoop protein powder
2 g acetyl-L-carnitine 1.5-5 g creatine
 1.5-2 g beta-alanine
BREAKFAST
30-60 min after wake-up supplements POST-WORKOUT MEAL
1 scoop protein powder (sip while prepping breakfast) Within 30 minutes after workout
3 whole eggs 2 scoops protein powder
3 egg whites 14 small Wonka Pixy Stix or 1 Giant Pixy Stix
1 cup cooked oatmeal 5 g BCAAs
1 tbsp honey 1.5-5 g creatine
1/2 large grapefruit 1.5-2 g beta-alanine
2-3 g fish oil 2 g carnitine
2-3 g CLA
 DINNER
LATE-MORNING SNACK 8 oz top sirloin steak
8 oz. reduced-fat Greek yogurt 1 large sweet potato
1 tsp honey 1 cup chopped broccoli
1/2 oz walnuts (7 halves), crushed 2-3 g fish oil
 2-3 g CLA
LATE-MORNING SUPPLEMENTS
200 mg caffeine NIGHTTIME SNACK
500-1000 mg green tea extract 1 cup low-fat cottage cheese
2 g acetyl-L-carnitine 2-3 g fish oil
 2-3 g CLA
LUNCH
5 oz. can tuna TOTALS
2 cups mixed green salad Calories: 2,600
1 tbsp olive oil Protein: 280 g
1 tbsp vinegar Carbs: 180 g
1/2 large grapefruit Fat: 80 g
MIDDAY SNACK
3 sticks light mozzarella string cheese PHASE III – WEEKS 4-6
1 oz mixed nuts Protein: 1.5 grams per pound
 Fats: 0.5 grams per pound
PRE-WORKOUT SUPPLEMENTS Carbs: 0.5 grams per pound
30-60 minutes before workout Dropping calories and carbs again will cause your body to
200 mg caffeine continue burning fat. Unlike in Phases 1 and 2, where you eat
500-1000 mg green tea extract fewer calories and carbs on your rest day, the opposite holds
 true in Phase 3. You will eat more carbs and calories on your
2 g acetyl-L-carnitine
 rest days.
 On your rest days throughout Phase 3, you get to enjoy a
 high-carb, pig-out day. Since you go so low in carbs six days
of the week, you will need this one high-carb day to prevent 1 tbsp olive oil
your metabolism from sputtering and slowing down to spare 1 tbsp vinegar
energy reserves (body fat). The high-carb day will help kick
start your metabolism again, keeping you in a fat-burning
mode for the final phase MIDDAY SNACK
 3 sticks light mozzarella string cheese
 1 oz mixed nuts
HIGH-CARB, REST DAY MACROS
Protein: 1.5 grams of protein per pound of body weight PRE-WORKOUT SUPPLEMENTS
Carbs: At least 2 grams of carbs per pound of body weight 30-60 minutes before workout
Fat: 0.5 grams per pound of body weight 200 mg caffeine
A high-carb pig-out day does not mean you’ll eat pizza and 500-1000 mg green tea extract
drink beer all day. Sure, a couple beers or a glass of wine 2 g acetyl-L-carnitine
won’t derail your progress, but your high-carb day isn’t a full
24-hour chest session.
 WORKOUT MEAL
Shoot for low-fat carb sources. High-glycemic or fast-digesting Sip throughout workout
carbs are fine during the first half of the day, as is fruit, but 1 scoop protein powder
to prevent any of those carbs from being stored as body fat, 1.5-5 g creatine
focus on slow-digesting or low-glycemic carbs later in the day.
 1.5-2 g beta-alanine
 POST-WORKOUT MEAL
WORKOUT DAYS Within 30 minutes after workout
WAKE-UP SUPPLEMENTS 2 scoops protein powder
200 mg caffeine 14 small Wonka Pixy Stix or 1 Giant Pixy Stix
500-1000 mg green tea extract 5 g BCAAs
2 g acetyl-L-carnitine 1.5-5 g creatine
 1.5-2 g beta-alanine
BREAKFAST 2 g carnitine
30-60 min after wake-up supplements
1 scoop protein powder (sip while prepping breakfast) DINNER
3 whole eggs 8 oz top sirloin steak
3 egg whites 1 cup chopped broccoli
2-3 g fish oil 2-3 g fish oil
2-3 g CLA 2-3 g CLA
LATE-MORNING SNACK NIGHTTIME SNACK
Turkey, Swiss, and avocado rolls 8 oz low-fat cottage cheese
 2-3 g fish oil
LATE-MORNING SUPPLEMENTS 2-3 g CLA
200 mg caffeine
500-1000 mg green tea extract TOTALS
2 g acetyl-L-carnitine Calories: 2,200
 Protein: 280 g
LUNCH Carbs: 80 g
5 oz. can tuna Fat: 80 g
2 cups mixed green salad
HIGH-CARB REST DAYS MID-DAY SNACK
WAKE-UP SUPPLEMENTS 3 sticks light mozzarella string cheese
200 mg caffeine
 6 cups air-popped popcorn or 1 bag low-fat microwave
500-1000 mg green tea extract
 popcorn
2 g acetyl-L-carnitine
 1/2 medium cantaloupe
BREAKFAST DINNER
30-60 min after wake-up supplements
 8 oz chicken breast
1 scoop whey protein (sip while prepping breakfast)
 1 cup cooked brown rice
5 g BCAAs
 1 cup cooked black beans
1.5-5 g creatine
 1 cup chopped broccoli
1.5-2 g beta-alanine
 2-3 g fish oil
2 g carnitine
 2-3 g CLA
3 whole eggs
3 egg whites
 NIGHTTIME SNACK
3 four-inch pancakes
 1 cup reduced-fat Greek yogurt
2 tbsp maple syrup
 1 tbsp honey
2-3 g fish oil
 1/2 oz. walnuts (7 halves), crushed
2-3 g CLA
 2-3 g fish oil
 2-3 g CLA
LATE-MORNING SNACK
1 scoop protein powder (sip while prepping pizza)
 TOTALS
Stoppani EZ Pizza
 Calories: 3,100
 Protein: 260 g
Ingredients:
 Carbs: 360 g
1/4 Boboli whole-wheat pizza crust
 Fat: 70 g
1/4 cup light mozzarella
1/4 cup marinara sauce
 SUPPLEMENT PLAN
Directions: The Shortcut to Shred supplement schedule is practiced and
1. Spread sauce on crust and top with cheese. precise. Everything I do is researched, tested in the lab, and
 tried on my own physique. My body is a product of my brain.
2. Place in oven and bake for about 15 minutes or
 If you want the best results from this program, you need to
 until cheese is melted. follow this regimen. Every capsule, every shake, and every
 dose is intended to help you achieve your best physique.
LATE-MORNING SUPPLEMENTS
200 mg caffeine
500-1000 mg green tea extract PROTEIN
 If you still think that drinking a whey protein shake before
2 g acetyl-L-carnitine
 and after workouts is the best way to ensure proper muscle
 growth, you’re only half right. Yes, whey is critical to take
LUNCH both before and after workouts. But using whey alone will
6-inch Subway Turkey and ham (double meat) shortchange your results.
 on wheat
 Research suggests that a combination of fast-digesting whey
1 oz. bag Baked Lays
 protein along with both a medium-digesting protein, like egg-
1 large diet soda white protein, and a very slow-digesting protein, such as
 micellar casein, is superior to a single protein source. Based
 on the research and real-world data, your protein shake
should be about 25-40% whey, 50% casein, and 10-25% carnitine is best taken after a tough workout to enhance
medium-digesting protein like egg-white protein. recovery and promote fatty acid metabolism. Whey and
 carbohydrates consumed post-workout are the perfect
 vehicles for this form of carnitine.
BCAAS
The three BCAAs are leucine, isoleucine, and valine. They are
critical for muscle growth. While whey protein is rich in BCAAs, CREATINE
taking additional BCAAs around your workouts can further Creatine is one of the most-researched sports nutrition
enhance recovery and provide a quick source of muscular supplements on the market. It provides muscular energy for
energy. As a result, BCAAs can improve your workouts and high-intensity exercise, helps you build muscle, and boosts
boost performance. strength gains. Research suggests that creatine can boost
 muscle gains by as much as 10 pounds and strength by 10
In fact, one study I performed with the Weider Research percent in just a few weeks.
Group—presented at the 2009 annual meeting of the
International Society of Sports Nutrition—further supports For best delivery, put creatine in your pre- and post-workout
BCAAs’ ability to help build muscle. We discovered that protein shakes. That’s when you get a bigger insulin response,
subjects taking them around workouts gained nearly twice and insulin helps drive creatine into your muscles.
as much muscle mass on an 8-week training program than
subjects taking only whey or Gatorade around workouts.
 BETA-ALANINE
Specific BCAAs offer additional benefits, such as: Research suggests that when trained lifters add beta-alanine
Leucine: Turns on muscle protein synthesis; increases satiety and creatine to their supplement regimen, they gain more
Isoleucine: Supports fat loss; provides energy muscle and lose more body fat than those taking creatine
Valine: Decreases fatigue; supports fat loss; prolongs energy alone. Beta-alanine can also increase muscle strength and
 endurance during workouts.
FISH OIL
Fish oil supplements are a great source of essential omega-3 CAFFEINE
fats, especially EPA and DHA. Omega-3 fats may help reduce This potent central nervous system stimulant increases
your risk of coronary heart disease, as well as support healthy alertness, mental focus, and your pain threshold during
brain and joint function. But for those who train, nothing is workouts. It also functions as a powerful fat burner. Since it’s a
more exciting than current research suggesting fish oil may stimulant, caffeine naturally increases the number of calories
help with muscle growth and recovery as well as support fat your body burns. Caffeine also attaches to receptors on fat
loss. If you’re not already taking a fish oil supplement, reel cells to blunt fat storage and increase fatty acid release.
one in today.
 GREEN TEA EXTRACT
ACETYL L-CARNITINE Green tea enhances fat loss and offers a host of additional
Acetyl L-carnitine (ALCAR) is L-carnitine with an acetyl group health and physique benefits, including joint support and
attached. This attachment increases carnitine’s uptake by the muscle recovery. Green tea aids fat loss by boosting daily
body, making it more effective. ALCAR is able to enter the calorie burn. The ingredients in green tea responsible for this
brain, where it may aid in brain function, boost alertness, and effect are called catechins. The most important catechin is
support positive mood. epigallocatechin gallate (EGCG).
In other areas of the body, such as muscle cells, carnitine aids EGCG inhibits an enzyme that normally breaks down
fat loss transporting fatty acids into the power centers of cells, norepinephrine, a neurotransmitter and hormone that boosts
called mitochondria. These power centers work to generate metabolic rate and fat burning.
energy by burning up nutrients such as fat for fuel.
 CONJUGATED LINOLEIC ACID (CLA)
L-CARNITINE L-TARTRATE Conjugated linoleic acid (CLA) is a naturally occurring group
L-carnitine L-tartrate supports fat loss and increases energy. of omega-6 fats that aids fat loss and supports lean mass. CLA
This pure form of carnitine requires insulin for absorption. burns body fat by boosting your metabolic rate and inhibiting
Unlike ALCAR, which is great throughout the day, straight the enzyme lipoprotein lipase (LPL). LPL allows fat cells to pull
fat from the bloodstream and store it as body fat. By inhibiting BEFORE BED
LPL, CLA encourages the body to burn fat instead of store it. Protein powder: 1 scoop
By helping the body use fat for fuel, CLA also spares your
muscle mass. When your body is fueling itself with fats, it
doesn’t need to break down muscle tissue for additional fuel. ALTERNATIVE FOODS
In this way, CLA can help you burn unwanted blubber and You will notice that the sample meals given in each phase of
preserve your hard-earned muscle. Shortcut to Shred are very similar. This does not mean that
 you should eat these exact foods, and only these foods,
 throughout the program. Refer to the alternative foods below
SUPPLEMENT TIMING so you can keep your diet diverse and well-stocked with
AND DOSAGE myriad nutrients!
MORNING
Protein powder: 1 scoop MEAT REPLACEMENTS
Fish oil: 2-3 g The following meats can be used for any meal on Shortcut to
Caffeine: 200 mg Shred. You can also replace any meat with roughly 2 servings
Green tea extract: 500-1,000 mg of the dairy products listed below, or 2 scoops of whey or
Acetyl L-carnitine: 1.5-2 g mixed protein powder.
CLA: 2-3 g
 chicken breast
LATE MORNING/EARLY AFTERNOON chicken thighs
Caffeine: 200-300 mg chicken drumstick
Green tea extract: 500-1,000 mg turkey breast
Acetyl L-carnitine: 1.5-2 g turkey leg
 lean ground turkey
30-45 MINUTES PRE-WORKOUT lean ground beef
Caffeine: 200-300 mg tri-tip steak
Green tea extract: 500-1,000 mg flank steak
Acetyl L-carnitine: 1.5-2 g pork tenderloin
BCAAs: 5 g bison
Creatine: 1 serving venison
Beta-alanine: 1.5-3 g ostrich
 lamb
IMMEDIATELY PRE-WORKOUT goat
Protein powder: 1 scoop salmon
 sardines
IMMEDIATELY POST-WORKOUT herring
Protein powder: 2 scoops trout
 tilapia
BCAAs: 5 g
 cod
Creatine: 1 serving
 halibut
Beta-alanine: 1.5-3 g
 sole or flounder
L-carnitine: 2 g
 arctic char
 shrimp
WITH DINNER crab
Fish oil: 2-3 g
 scallop
CLA: 2-3 g clams
 mussels
WITH FINAL MEAL oysters
Fish oil: 2-3 g lobster
CLA: 2-3 g squid
octopus
lean deli turkey breast
 FRUIT REPLACEMENTS
 Replace any of the fruit with any of these:
lean deli chicken breast
lean deli ham orange
lean deli roast beef peach
 nectarine
 banana
DAIRY REPLACEMENTS pear
You will eat dairy at several meals, including foods like Greek Asian pear
yogurt, cottage cheese, and low-fat string cheese. Feel to strawberries
replace any of these with each other, or any of the following: blueberries
 raspberries
4-6 oz of any of the meats above blackberries
2 oz beef jerky cherries
3 slices or oz of low-fat cheese grapes
1 scoop of whey or mixed protein kiwifruit
1 scoop casein or mixed protein
 OATMEAL REPLACEMENTS
 Replace the morning oatmeal with any of these alternatives:
EGG REPLACEMENTS
I highly recommend that you do not replace eggs due to the whole-grain cold cereal
benefits that they provide for muscle growth and strength. granola
However, I understand that some people cannot stand eggs, whole-wheat waffle
others are allergic, and some of you just get sick of eating Ezekiel bread
them. So, if you must, you can replace eggs with the following:
 whole-wheat bread
 whole-wheat English muffin
1-2 scoops egg protein
 whole-wheat pita bread
1-2 scoops whey protein or a mixed protein
 whole-wheat bagel
1 serving of the dairy foods listed
6 oz of any of the meats listed
 WHOLE-WHEAT BREAD REPLACEMENTS
 Replace whole-wheat bread with any of these:
VEGETABLE REPLACEMENTS Ezekiel bread
These vegetables can replace the salad at dinner, and since rye bread
they are low in carbs, you can add 0.5-1 cup to almost any
 sourdough bread
meal on the plan:
 whole-wheat English muffin
 whole-wheat pita bread
asparagus
 whole-wheat bagel
green beans
 whole-wheat tortilla
broccoli
cauliflower
onion SWEET POTATO REPLACEMENTS
bell peppers When get to eat a sweet potato in the early stage of the diet,
Brussels sprouts you can replace it with any of these:
zucchini 1 cup brown rice
eggplant 1 cup whole-wheat pasta (small amount of marinara sauce)
bok choy (Chinese cabbage) 1 cup of beans
mushrooms 1 cup quinoa
spinach
cucumber
okra`;

  // { docs: [...uploaded PDFs...], routines: [...saved structured workouts...] }
  // Kept as one object (one KV key, one localStorage key) so the two
  // collections always sync together. Reads tolerate the pre-routines shape
  // (a bare array) that shipped before this — that's what "docs" used to be.
  function loadLibrary() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY));
      if (Array.isArray(parsed)) return { docs: parsed, routines: [] };
      return {
        docs: Array.isArray(parsed?.docs) ? parsed.docs : [],
        routines: Array.isArray(parsed?.routines) ? parsed.routines : [],
      };
    } catch {
      return { docs: [], routines: [] };
    }
  }

  function saveLibrary(library) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  }

  function pushLibraryToCloud() {
    if (!AI_ENDPOINT) return;
    fetch(`${AI_ENDPOINT}/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loadLibrary()),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }).catch(() => {});
  }

  // Merges the cloud copy in by id (union, not overwrite) so a document or
  // saved routine added from one device isn't lost if the other device syncs
  // first — this app has no per-item "last modified" or tombstone tracking,
  // so union is the safest default even though a delete on one device can
  // resurface after a pull from a device that hasn't seen it yet.
  async function pullLibraryFromCloud() {
    if (!AI_ENDPOINT) return;
    try {
      const res = await fetch(`${AI_ENDPOINT}/library`, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
      if (!res.ok) return;
      const data = await res.json();
      const cloudDocs = Array.isArray(data.docs) ? data.docs : [];
      const cloudRoutines = Array.isArray(data.routines) ? data.routines : [];
      if (cloudDocs.length === 0 && cloudRoutines.length === 0) {
        pushLibraryToCloud();
        return;
      }
      const local = loadLibrary();
      const docsById = new Map(local.docs.map((d) => [d.id, d]));
      cloudDocs.forEach((d) => {
        if (d && typeof d.id === "string" && !docsById.has(d.id)) docsById.set(d.id, d);
      });
      const routinesById = new Map(local.routines.map((r) => [r.id, r]));
      cloudRoutines.forEach((r) => {
        if (r && typeof r.id === "string" && !routinesById.has(r.id)) routinesById.set(r.id, r);
      });
      saveLibrary({ docs: Array.from(docsById.values()), routines: Array.from(routinesById.values()) });
    } catch {
      // Worker unreachable — keep going with whatever's local.
    }
  }

  // A hand-picked reference workout gets bundled straight into the app so
  // it's already there on first load — the athlete shouldn't have to
  // re-upload a PDF I was explicitly asked to add. Tracked separately from
  // the library itself (not just "is it in there now") so a deliberate
  // delete sticks instead of the seed silently reappearing next load.
  const LIBRARY_SEEDS_KEY = "liftr_library_seeds_v1";

  function seedLibraryIfNeeded() {
    let seeded;
    try {
      seeded = JSON.parse(localStorage.getItem(LIBRARY_SEEDS_KEY)) || [];
    } catch {
      seeded = [];
    }
    if (seeded.includes(SHRED_PDF_SEED_ID)) return;

    const library = loadLibrary();
    library.docs.push({
      id: SHRED_PDF_SEED_ID,
      title: "Shortcut to Shred (Jim Stoppani)",
      addedAt: "2015-9-9",
      pageCount: 15,
      text: SHRED_PDF_SEED_TEXT,
      tags: ["pdf"],
    });
    saveLibrary(library);
    localStorage.setItem(LIBRARY_SEEDS_KEY, JSON.stringify([...seeded, SHRED_PDF_SEED_ID]));
    pushLibraryToCloud();
  }

  // Runs entirely client-side via pdf.js (loaded in index.html) — the Worker
  // never sees the raw PDF, just whatever plain text this pulls out of it.
  async function extractPdfText(file) {
    if (!window.pdfjsLib) throw new Error("PDF reader didn't load — check your connection and try again.");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => item.str).join(" "));
    }
    const text = pageTexts.join("\n\n").replace(/[ \t]+/g, " ").trim();
    return { text: text.slice(0, MAX_LIBRARY_DOC_CHARS), pageCount: pdf.numPages };
  }

  const LIBRARY_CHUNK_SIZE = 700;
  const LIBRARY_CHUNK_STRIDE = 550; // overlaps so a match near a chunk edge isn't split awkwardly
  const MAX_LIBRARY_CHUNKS = 8;

  // Ranks PASSAGES within library docs by keyword overlap with today's
  // context (split, note, focus), not whole documents — a long upload's
  // most relevant part to today's query is rarely at the very start, so
  // scoring whole docs and then just sending their opening characters
  // (the old approach) meant a real match deep in a program often lost to
  // the doc's introduction/disclaimer text sitting at char 0. Chunking
  // first, then scoring each chunk, sends the actually relevant passage.
  function getLibraryContext(queryText) {
    const docs = loadLibrary().docs;
    if (docs.length === 0) return [];
    const queryWords = new Set(normalizeExerciseText(queryText || "").split(" ").filter((w) => w.length > 3));

    const chunks = [];
    docs.forEach((doc) => {
      const text = doc.text || "";
      if (text.length <= LIBRARY_CHUNK_SIZE) {
        chunks.push({ doc, text, start: 0, score: 0 });
        return;
      }
      for (let start = 0; start < text.length; start += LIBRARY_CHUNK_STRIDE) {
        chunks.push({ doc, text: text.slice(start, start + LIBRARY_CHUNK_SIZE), start, score: 0 });
        if (start + LIBRARY_CHUNK_SIZE >= text.length) break;
      }
    });

    if (queryWords.size > 0) {
      chunks.forEach((chunk) => {
        const chunkWords = normalizeExerciseText(chunk.text).split(" ");
        let score = 0;
        chunkWords.forEach((w) => {
          if (queryWords.has(w)) score++;
        });
        chunk.score = score;
      });
    }

    const scored = chunks.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_LIBRARY_CHUNKS);
    // With no keyword signal anywhere, still surface a small library — the
    // athlete uploaded it to be used, not to sit idle until a matching
    // word happens to appear. A couple of opening chunks per doc, same
    // fallback intent as before.
    const picked = scored.length > 0 ? scored : chunks.filter((c) => c.start === 0).slice(0, 2);

    // Multiple winning chunks from the same doc get merged back together
    // in reading order, so the excerpt reads as one passage instead of
    // score-shuffled fragments.
    const byDoc = new Map();
    picked.forEach((chunk) => {
      if (!byDoc.has(chunk.doc.id)) byDoc.set(chunk.doc.id, { doc: chunk.doc, chunks: [] });
      byDoc.get(chunk.doc.id).chunks.push(chunk);
    });

    const results = [];
    let budget = MAX_LIBRARY_CONTEXT_CHARS;
    for (const { doc, chunks: docChunks } of byDoc.values()) {
      if (budget <= 0) break;
      const excerpt = docChunks
        .sort((a, b) => a.start - b.start)
        .map((c) => c.text)
        .join(" […] ")
        .slice(0, budget);
      if (!excerpt) continue;
      results.push({ title: doc.title, excerpt });
      budget -= excerpt.length;
    }
    return results;
  }

  // Compact form of the athlete's own saved routines — proven combos they've
  // kept, like "bench press pairs with pull-ups" — for the AI to draw on
  // when asked for a variation or a similar workout. Names only (no
  // howTo/tip prose) keeps this small regardless of library size.
  function getLibraryRoutinesContext() {
    return loadLibrary()
      .routines.slice(-8)
      .map((r) => ({ name: r.name, splitKey: r.splitKey || null, exercises: r.exercises.map((ex) => ex.name) }));
  }

  // Saves the actual exercises the athlete is looking at right now (already
  // formatted by the app — name/detail/howTo/tip) as a reusable named
  // routine, so "give me a workout like X" has real, proven combos to draw
  // on instead of the AI guessing what worked before.
  function saveWorkoutToLibrary(name, splitKey, exercises) {
    const library = loadLibrary();
    library.routines.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      splitKey: splitKey || null,
      addedAt: todayStr(),
      exercises: exercises.map((ex) => ({ name: ex.name, detail: ex.detail, howTo: ex.howTo || null, tip: ex.tip || null })),
    });
    saveLibrary(library);
    pushLibraryToCloud();
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
      lastGreetingText: stored.lastGreetingText ?? null,
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
          { name: "Dumbbell Bench Press", detail: "4 x 8", superset: "A", howTo: "Lying on a bench, press two dumbbells up from chest level until your arms are extended.", tip: "Use a load that makes reps seven and eight challenging without losing shoulder position." },
          { name: "Lat Pulldown", detail: "4 x 8-10", superset: "A", howTo: "Seated at the machine, pull the bar down to your upper chest, then control it back up.", tip: "Drive your elbows down and back, not your hands." },
          { name: "Incline Dumbbell Press", detail: "3 x 10", superset: "B", howTo: "On a low incline, press two dumbbells from shoulder level until your arms are extended.", tip: "Keep the bench near 30 degrees so the chest stays the main driver." },
          { name: "Chest-Supported Row", detail: "3 x 10", superset: "B", howTo: "Lying chest-down on an incline bench, row the dumbbells toward your ribs.", tip: "Pause at the top and keep your chest connected to the pad." },
          { name: "Plank to Row", detail: "3 x 10/side", howTo: "In a plank with a dumbbell in each hand, row one dumbbell to your ribs, alternating sides.", tip: "Keep your hips square — resist the urge to rotate as you row." },
          { name: "Cable Chest Fly", detail: "3 x 12", superset: "C", howTo: "Standing between two cable stacks, bring the handles together in front of your chest in an arcing motion.", tip: "Slight bend in the elbows the whole way — think 'hug a tree,' not 'press.'" },
          { name: "Seated Cable Row", detail: "3 x 12", superset: "C", howTo: "Seated at the cable, pull the handle to your torso while keeping your back straight.", tip: "Squeeze your shoulder blades together at the finish, don't just pull with your arms." },
          { name: "Push-Up Ladder", detail: "2 x max", howTo: "From a plank, lower your chest to the floor and push back up, stopping when clean reps break down.", tip: "Use this after the loaded work, not instead of it." },
          { name: "Incline Push-Up", detail: "3 x 15", howTo: "Hands on a bench or box, lower your chest toward it and push back up.", tip: "The higher the surface, the easier the rep — pick a height that's still a real challenge." },
          { name: "One-Arm Dumbbell Row", detail: "3 x 12/side", howTo: "One hand and knee on a bench, row a dumbbell up to your hip with the other arm.", tip: "Keep your back flat and pull with your elbow, not your hand." },
        ],
        jake: [
          { name: "Barbell Bench Press", detail: "4 x 6", superset: "A", howTo: "Lying on a bench, lower the bar to your chest, then press it back up to full arm extension.", tip: "Keep your feet planted and drive through your upper back for a stable base." },
          { name: "Weighted Pull-Ups", detail: "4 x 6", superset: "A", howTo: "With extra weight attached, pull your chin over the bar from a dead hang.", tip: "Full range every rep — dead hang to chin over the bar." },
          { name: "Incline Dumbbell Press", detail: "3 x 8", superset: "B", howTo: "On a slightly inclined bench, press two dumbbells up from shoulder level.", tip: "30-degree incline max — steeper turns this into a shoulder press." },
          { name: "Bent-Over Barbell Row", detail: "4 x 8", superset: "B", howTo: "Hinged forward at the hips, pull the barbell up to your lower ribs.", tip: "Hinge at the hips, flat back, pull to your lower ribs." },
          { name: "Cable Fly", detail: "3 x 12", howTo: "Standing between two cable stacks, bring the handles together in front of your chest in an arcing motion.", tip: "Slight bend in the elbows the whole way — think 'hug a tree,' not 'press.'" },
          { name: "Dumbbell Bench Press", detail: "4 x 8", superset: "C", howTo: "Lying on a bench, press two dumbbells up from chest level until your arms are extended.", tip: "Let the dumbbells travel slightly in as you press — don't lock them straight up." },
          { name: "Pull-Up", detail: "4 x max", superset: "C", howTo: "From a dead hang, pull your chin over the bar and lower back down under control.", tip: "Full range every rep — dead hang to chin over the bar, no half reps." },
          { name: "Straight-Arm Pulldown", detail: "3 x 15", howTo: "Standing at a high cable, keep your arms straight and pull the bar down to your thighs.", tip: "Hinge slightly at the hips and let your lats, not your arms, do the pulling." },
          { name: "Dips", detail: "3 x 10", howTo: "Support yourself on parallel bars and lower until your shoulders are below your elbows, then press back up.", tip: "Lean forward slightly to bias chest over triceps." },
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
          { name: "Hip Thrust", detail: "3 x 15", superset: "B", howTo: "Upper back against a bench, drive your hips up until your body forms a straight line.", tip: "Tuck your chin slightly and drive through your heels, not your toes." },
          { name: "Leg Curl", detail: "3 x 15", superset: "B", howTo: "Lying face down on the machine, curl the pad up toward your glutes.", tip: "Control the negative — don't let the weight snap your legs back down." },
          { name: "Wall Sit", detail: "3 x 45s", howTo: "Back against a wall, slide down until your thighs are parallel to the floor and hold.", tip: "Keep your knees tracking over your ankles, not caving inward." },
          { name: "Bulgarian Split Squat", detail: "3 x 10/leg", howTo: "Rear foot elevated on a bench, lower your back knee toward the floor, then drive back up.", tip: "Keep most of your weight on the front leg — the back foot is just for balance." },
        ],
        jake: [
          { name: "Barbell Back Squat", detail: "5 x 5", superset: "A", howTo: "With the bar across your upper back, squat down until your hips are below your knees, then stand.", tip: "Brace your core before you unrack, and keep your chest tall through the whole rep." },
          { name: "Romanian Deadlift", detail: "4 x 6", superset: "A", howTo: "Holding the bar, push your hips back and lower it along your legs until you feel a hamstring stretch.", tip: "Push your hips back, not down — you should feel this in your hamstrings." },
          { name: "Walking Lunges", detail: "3 x 10/leg", howTo: "Step forward into a lunge, then bring your back foot through into the next lunge.", tip: "Take a long enough stride that your front knee stays behind your toes." },
          { name: "Leg Press", detail: "3 x 10", howTo: "Seated in the machine, push the platform away by extending your legs, then control it back.", tip: "Don't let your lower back round off the pad at the bottom." },
          { name: "Standing Calf Raise", detail: "4 x 15", howTo: "Rise up onto the balls of your feet, then lower back down under control.", tip: "Pause at the top and the bottom — don't just bounce through it." },
          { name: "Bulgarian Split Squat", detail: "4 x 8/leg", superset: "B", howTo: "Rear foot elevated on a bench, lower your back knee toward the floor, then drive back up.", tip: "Keep most of your weight on the front leg — the back foot is just for balance." },
          { name: "Leg Extension", detail: "3 x 15", superset: "B", howTo: "Seated in the machine, extend your legs until straight, then lower with control.", tip: "Pause at the top for a beat instead of just swinging through." },
          { name: "Seated Calf Raise", detail: "4 x 15", howTo: "Knees under the pad, rise up onto your toes, then lower under control.", tip: "Go for a full stretch at the bottom — don't cut the range short." },
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
          { name: "Rowing Intervals", detail: "6 x 400m", howTo: "Row hard for the target distance, then rest before the next interval.", tip: "Drive with your legs first, then lean back, then pull — legs, hips, arms." },
          { name: "Battle Ropes", detail: "5 x 20s", howTo: "Alternate slamming the ropes up and down as fast as you can for the interval.", tip: "Keep your core tight — the power comes from your shoulders, not your wrists." },
        ],
        jake: [
          { name: "Rowing Intervals", detail: "8 x 500m", howTo: "Row hard for the target distance, then rest before the next interval.", tip: "Drive with your legs first, then lean back, then pull — legs, hips, arms." },
          { name: "Sled Push", detail: "6 rounds", howTo: "Load a sled and push it forward across the marked distance.", tip: "Stay low with a slight forward lean, drive through the balls of your feet." },
          { name: "Battle Ropes", detail: "5 x 30s", howTo: "Alternate slamming the ropes up and down as fast as you can for the interval.", tip: "Keep your core tight — the power comes from your shoulders, not your wrists." },
          { name: "Jump Rope Finisher", detail: "5 min", howTo: "Continuous jump rope at a steady pace for the full duration.", tip: "Small, quick hops — you shouldn't be jumping high off the ground." },
          { name: "Stair Climber Intervals", detail: "15 min", howTo: "Alternate between a hard push and an easier recovery pace on the stair climber.", tip: "Push the pace on work intervals, actually recover on the rest ones." },
          { name: "Cycling", detail: "20 min", howTo: "A steady-state ride at a consistent, moderate effort.", tip: "Keep a steady cadence — smooth and controlled beats mashing the pedals." },
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
          { name: "Bird Dog", detail: "3 x 10/side", howTo: "From hands and knees, extend the opposite arm and leg, then return with control.", tip: "Keep your hips square to the floor the whole time." },
          { name: "Crunch", detail: "3 x 20", howTo: "Lying on your back, knees bent, curl your shoulders up off the floor.", tip: "Lead with your chest, not your chin — don't yank your neck." },
          { name: "World's Greatest Stretch", detail: "4/side", howTo: "From a deep lunge, rotate your torso and reach the same-side arm toward the ceiling.", tip: "Keep your back knee off the floor and hips square." },
          { name: "Deep Squat Hold", detail: "3 x 30s", howTo: "Sink into the bottom of a bodyweight squat and hold, chest up.", tip: "Let your elbows gently press your knees out if it helps you settle in." },
        ],
        jake: [
          { name: "Hanging Leg Raise", detail: "3 x 12", howTo: "Hanging from a bar, raise your legs up toward your chest with control.", tip: "Control the descent — don't let momentum swing you through the rep." },
          { name: "90/90 Hip Flow", detail: "5 min", howTo: "Seated with both legs bent at 90 degrees, rotate between positions to open the hips.", tip: "Keep your chest tall as you rotate between positions." },
          { name: "Weighted Plank", detail: "3 x 45s", howTo: "Hold a forearm plank with a plate on your back for added load.", tip: "Squeeze your glutes and brace like you're about to get punched." },
          { name: "Thoracic Rotation Flow", detail: "5 min", howTo: "On hands and knees, rotate one arm up and open your chest toward the ceiling.", tip: "Rotate from your upper back, keep your hips still." },
          { name: "Cable Crunch", detail: "3 x 15", howTo: "Kneeling below a high cable, curl your torso down toward your knees.", tip: "Round through your spine — this is a crunch, not a hip hinge." },
          { name: "Standing Oblique Cable Crunch", detail: "3 x 12/side", howTo: "Standing beside a high cable, crunch your torso down and to the side.", tip: "Keep your hips still — the movement comes from your obliques, not your legs." },
          { name: "Figure-4 Stretch", detail: "45s/side", howTo: "Lying on your back, cross one ankle over the opposite knee and pull the leg in.", tip: "Keep your lower back flat on the floor as you pull the leg toward you." },
          { name: "Open-Book Rotation", detail: "8/side", howTo: "Lying on your side with knees bent, rotate your top arm open toward the floor behind you.", tip: "Keep your knees stacked and let your eyes follow your hand." },
        ],
      },
    },
  };

  const SPECIAL_WORKOUTS = {
    // Jess + Partner: Core & Mobility — trunk stability, cross-body control,
    // and hip mobility rather than a generic ab circuit, built specifically
    // as a low-fatigue pre-basketball session (anti-extension + lateral
    // stability + cross-body coordination work, per ACE's guidance on
    // mixing ab exercise types instead of one movement pattern). Replaces
    // the app's original game-day preset with a more deliberately designed
    // version of the same idea.
    "jess-game-day-core": {
      user: "jessica",
      name: "Jess + Partner: Core & Mobility",
      icon: "🏀",
      tagline: "35–40 min · partner · low fatigue",
      reason: "Trunk stability, cross-body control, and hip mobility — not 20 minutes of crunches. Built so Jess walks out looser and more energized, not gassed, before basketball.",
      defaultCheckIn: { minutes: 40, energy: "medium", partner: true },
      warmup: [
        "Treadmill: easy walk · 3 min",
        "Treadmill: brisk walk · 4 min",
        "Treadmill: moderate incline · 3 min — finish warm, not winded",
      ],
      exercises: [
        { phase: "Mobility Flow · 5 min · move together", name: "Cat-Cow", detail: "8 reps", howTo: "On hands and knees, alternate between arching and rounding your spine.", tip: "Move with your breath — inhale to arch, exhale to round." },
        { phase: "Mobility Flow · 5 min · move together", name: "90/90 Hip Switches", detail: "8/side", howTo: "Sit tall with both knees bent and rotate them side to side through the 90/90 positions.", tip: "Move smoothly and use your hands only as needed." },
        { phase: "Mobility Flow · 5 min · move together", name: "World’s Greatest Stretch", detail: "4/side", howTo: "From a deep lunge, rotate your torso and reach the same-side arm toward the ceiling.", tip: "Keep your back knee off the floor and hips square." },
        { phase: "Mobility Flow · 5 min · move together", name: "Deep Squat Hold", detail: "30 sec", howTo: "Sink into the bottom of a bodyweight squat and hold, chest up.", tip: "Let your elbows gently press your knees out if it helps you settle in." },
        { phase: "Mobility Flow · 5 min · move together", name: "Hip-Flexor Stretch + Overhead Reach", detail: "30 sec/side", howTo: "From a half-kneeling lunge position, tuck your pelvis and reach both arms overhead.", tip: "Squeeze the glute on your kneeling-leg side to deepen the stretch." },
        { phase: "Partner Core Circuit · 3 rounds · both work at once, stay slow", name: "Forearm Plank", detail: "3 x 30–45 sec", howTo: "Hold a forearm plank with a straight line from shoulders to heels.", tip: "Squeeze your glutes and brace your abs — don't let your hips sag or pike." },
        { phase: "Partner Core Circuit · 3 rounds · both work at once, stay slow", name: "Dead Bug", detail: "3 x 8/side", howTo: "Lying on your back, extend one arm and the opposite leg while keeping your low back pressed into the floor.", tip: "Move slow — the goal is spinal stability, not speed." },
        { phase: "Partner Core Circuit · 3 rounds · both work at once, stay slow", name: "Elbow-to-Opposite-Knee", detail: "3 x 10/side", howTo: "Lying on your back, hands behind your head, bring one elbow toward the opposite knee while extending the other leg.", tip: "This is cross-body coordination, not a crunch race — move deliberately." },
        { phase: "Partner Core Circuit · 3 rounds · both work at once, stay slow", name: "Side Plank", detail: "3 x 20–30 sec/side", howTo: "Stack your feet and prop up on one forearm, hips lifted off the floor.", tip: "Stack shoulders over your elbow and keep hips high — shorten the hold before your form breaks." },
        { phase: "Partner Core Circuit · 3 rounds · both work at once, stay slow", name: "Bird Dog", detail: "3 x 8/side", howTo: "From hands and knees, extend the opposite arm and leg, then return with control.", tip: "Keep your hips square to the floor." },
        { phase: "Partner Legs + Movement · 2 rounds · Partner A works, then Partner B, then switch", name: "Goblet Squat", detail: "12", superset: "A", howTo: "Hold a dumbbell (or just bodyweight) at your chest and squat between your knees.", tip: "Light enough that every rep looks the same as the first — this isn't leg day." },
        { phase: "Partner Legs + Movement · 2 rounds · Partner A works, then Partner B, then switch", name: "Reverse Lunge", detail: "8/side", superset: "A", howTo: "Step one foot back and lower until both knees are near 90 degrees.", tip: "Keep your torso upright and front knee tracking over your foot." },
        { phase: "Partner Legs + Movement · 2 rounds · Partner A works, then Partner B, then switch", name: "Glute Bridge", detail: "15", superset: "B", howTo: "Lying on your back, feet flat, drive your hips up by squeezing your glutes.", tip: "Pause at the top without overarching your lower back." },
        { phase: "Partner Legs + Movement · 2 rounds · Partner A works, then Partner B, then switch", name: "Slow Lateral Lunge", detail: "8/side", superset: "B", howTo: "Step wide to one side and sit back into that hip while the other leg stays straight.", tip: "Slow and controlled — no speed or momentum here." },
        { phase: "Partner Finisher · 4 min · alternate every 30 sec, switch, repeat x4", name: "Plank", detail: "30 sec", superset: "F", howTo: "Hold a forearm or high plank while your partner does bodyweight squats, then switch.", tip: "Keep breathing steadily through the hold." },
        { phase: "Partner Finisher · 4 min · alternate every 30 sec, switch, repeat x4", name: "Bodyweight Squats", detail: "30 sec", superset: "F", howTo: "Bodyweight squats at a smooth, controlled pace while your partner holds a plank, then switch.", tip: "Keep the squats smooth rather than fast — steady movement, not a burnout." },
        { phase: "Cooldown · finish together", name: "Figure-4 Stretch", detail: "30 sec/side", howTo: "Lying on your back, cross one ankle over the opposite knee and pull the uncrossed leg toward your chest.", tip: "Keep your head and shoulders relaxed on the floor." },
        { phase: "Cooldown · finish together", name: "Half-Kneeling Hip-Flexor Stretch", detail: "30 sec/side", howTo: "From a half-kneeling position, tuck your pelvis and shift your weight forward.", tip: "Squeeze the glute of your kneeling-leg side." },
        { phase: "Cooldown · finish together", name: "Hamstring Stretch", detail: "30 sec/side", howTo: "Extend one leg straight and hinge forward from the hips, keeping your back flat.", tip: "Stop at a gentle pull — don't round your lower back to reach further." },
        { phase: "Cooldown · finish together", name: "Open-Book Rotation", detail: "6/side", howTo: "Lying on your side with knees stacked, rotate your top arm open across your body toward the floor.", tip: "Keep both knees together as your upper back rotates." },
        { phase: "Cooldown · finish together", name: "Child’s Pose + Side Reach", detail: "30 sec/side", howTo: "Sink your hips back toward your heels, arms extended, then walk both hands to one side.", tip: "Breathe deeply into your low back and the side of your ribcage." },
      ],
    },
  };


  // "Shortcut to Shred" — Jim Stoppani's 6-day cardio-acceleration program
  // (see the seeded library doc above for the source PDF). Real Phase 1 /
  // Week 1 sets, reps, and exercise order, transcribed from the program —
  // the entry-level intensity of what's actually a 6-week progression
  // (rep ranges tighten and a rest-pause dropset gets added in later
  // weeks). Six day-types in rotation, not one static workout — jake's
  // dedicated select-screen button below walks through them in order.
  const SHORTCUT_TO_SHRED_CARDIO_NOTE =
    "⚡ Cardio Acceleration: after EVERY set below, do 60 sec of continuous movement — jump rope, DB clean, running in place, KB swing, or a squat jump — before your next set. That minute IS your rest period; don't take a normal rest on top of it.";

  const SHORTCUT_TO_SHRED_WORKOUTS = {
    "shortcut-to-shred-1": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 1,
      name: "Shortcut to Shred — Day 1: Chest, Triceps & Abs",
      icon: "🔥",
      tagline: "Multi-joint · 9-11 reps · cardio acceleration",
      reason: "Jim Stoppani's fat-loss protocol — cardio between every single set keeps your heart rate up the whole session.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Push-up x 10", "Band pull-aparts x 15", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Bench Press", detail: "4 x 9-11", howTo: "Barbell bench press, flat bench, standard grip.", tip: "Keep your shoulder blades pinned and drive through your feet." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Incline Dumbbell Press", detail: "3 x 9-11", howTo: "Press dumbbells up and slightly in from an incline bench.", tip: "Don't let your elbows flare past 45 degrees." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Decline Smith Machine Press", detail: "3 x 9-11", howTo: "Press on a decline bench using the Smith machine bar.", tip: "Control the negative — don't bounce off your chest." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dips", detail: "4 x 9-11", howTo: "Chest dips on parallel bars, leaning forward slightly.", tip: "Stop at a comfortable shoulder depth — don't overstretch." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Close-Grip Bench Press", detail: "4 x 9-11", howTo: "Bench press with hands just inside shoulder width to target triceps.", tip: "Keep your elbows tucked close to your body." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Cable Crunch", detail: "3 x 9-11", howTo: "Kneel facing a high cable and crunch down, pulling with your abs, not your arms.", tip: "Round your spine — don't just bend at the hips." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Smith Machine Hip Thrust", detail: "3 x 9-11", howTo: "Upper back on a bench, bar across your hips on the Smith machine, drive your hips up.", tip: "Squeeze your glutes hard at the top — avoid overarching your low back." },
      ],
    },
    "shortcut-to-shred-2": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 2,
      name: "Shortcut to Shred — Day 2: Shoulders, Legs & Calves",
      icon: "🔥",
      tagline: "Multi-joint · 9-11 reps · cardio acceleration",
      reason: "Squats and deadlifts with a minute of cardio wedged between every set — brutal, but it's exactly what makes this program work.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Bodyweight squat x 15", "Leg swings x 10 each leg", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Shoulder Press", detail: "4 x 9-11", howTo: "Standing or seated barbell press overhead.", tip: "Brace your core — don't lean back excessively." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Alternating Dumbbell Shoulder Press (Standing)", detail: "3 x 9-11", howTo: "Press one dumbbell at a time overhead while standing.", tip: "Keep your hips square, resist twisting." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Smith Machine One-Arm Upright Row", detail: "3 x 9-11", howTo: "Grip the Smith bar with one hand and pull it up toward your chin.", tip: "Lead with your elbow, keep the bar close to your body." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Squat", detail: "4 x 9-11", howTo: "Barbell back squat, feet shoulder-width.", tip: "Break at the hips and knees together, keep your chest up." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Deadlift", detail: "3 x 9-11", howTo: "Conventional barbell deadlift from the floor.", tip: "Keep the bar close to your shins the entire pull." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Walking Lunge", detail: "3 x 9-11", howTo: "Alternating walking lunges, holding dumbbells at your sides.", tip: "Keep your torso upright, front knee tracking over your foot." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Standing Calf Raise", detail: "3 x 9-11", howTo: "Rise onto your toes on a standing calf raise machine.", tip: "Pause and squeeze at the top." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Seated Calf Raise", detail: "3 x 9-11", howTo: "Rise onto your toes with weight across your knees, seated.", tip: "Use a full stretch at the bottom of each rep." },
      ],
    },
    "shortcut-to-shred-3": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 3,
      name: "Shortcut to Shred — Day 3: Back, Traps & Biceps",
      icon: "🔥",
      tagline: "Multi-joint · 9-11 reps · cardio acceleration",
      reason: "Rows, shrugs, and curls — keep the cardio acceleration going between every set to stay in the fat-burning zone.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Band pull-aparts x 15", "Dead hang x 20 sec", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Bent Over Row", detail: "4 x 9-11", howTo: "Hinge at the hips and row the barbell to your lower ribs.", tip: "Keep your back flat — don't jerk the weight up." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dumbbell Bent-Over Row", detail: "3 x 9-11", howTo: "Bent-over row with dumbbells, one or both arms.", tip: "Squeeze your shoulder blade at the top of each rep." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Seated Cable Row", detail: "3 x 9-11", howTo: "Seated row, pulling the handle to your midsection.", tip: "Don't lean back excessively to move more weight." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Shrug", detail: "4 x 9-11", howTo: "Hold a barbell at arm's length and shrug your shoulders straight up.", tip: "Avoid rolling your shoulders — straight up and down." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Curl", detail: "3 x 9-11", howTo: "Standing barbell curl, elbows pinned to your sides.", tip: "Don't swing — control the weight on the way down." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell or EZ-Bar Preacher Curl", detail: "3 x 9-11", howTo: "Curl on a preacher bench to isolate the biceps.", tip: "Don't fully lock out at the bottom — keep tension on." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Reverse-Grip Barbell Curl", detail: "3 x 9-11", howTo: "Barbell curl with an overhand (pronated) grip.", tip: "Go lighter than a regular curl — this hits your forearms hard." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Wrist Curl", detail: "3 x 9-11", howTo: "Forearms on a bench, curl the bar up using just your wrists.", tip: "Keep the movement slow and controlled." },
      ],
    },
    "shortcut-to-shred-4": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 4,
      name: "Shortcut to Shred — Day 4: Chest, Triceps & Abs (Single-Joint)",
      icon: "🔥",
      tagline: "Single-joint · 12-15 reps · cardio acceleration",
      reason: "Isolation day — higher reps, same relentless cardio acceleration between every set.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Push-up x 10", "Band pull-aparts x 15", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Incline Dumbbell Flye", detail: "3 x 12-15", howTo: "Flye motion on an incline bench with a slight bend in the elbows.", tip: "Think 'hug a tree' — don't let it turn into a press." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dumbbell Flye", detail: "3 x 12-15", howTo: "Flat bench flye with dumbbells.", tip: "Stop the stretch at shoulder level to protect the joint." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Cable Crossover", detail: "3 x 12-15", howTo: "Standing cable crossover, pulling the handles down and together.", tip: "Cross your hands slightly at the bottom for a full squeeze." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Triceps Pressdown", detail: "3 x 12-15", howTo: "Cable pressdown with a straight or angled bar.", tip: "Keep your elbows pinned at your sides the whole set." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Overhead Dumbbell Extension", detail: "3 x 12-15", howTo: "Extend one or two dumbbells overhead behind your head.", tip: "Keep your elbows pointed forward, not flared out." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Cable Lying Triceps Extension", detail: "3 x 12-15", howTo: "Lying on a bench, extend a cable attachment overhead.", tip: "Keep your upper arms still — only the forearm moves." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Crunch", detail: "3 x 12-15", howTo: "Standard floor crunch.", tip: "Exhale hard at the top of each rep." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Standing Oblique Cable Crunch", detail: "3 x 12-15", howTo: "Standing side crunch against cable resistance.", tip: "Crunch your ribs toward your hip — don't just lean." },
      ],
    },
    "shortcut-to-shred-5": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 5,
      name: "Shortcut to Shred — Day 5: Shoulders, Legs & Calves (Single-Joint)",
      icon: "🔥",
      tagline: "Single-joint · 12-15 reps · cardio acceleration",
      reason: "Leg extensions, curls, and raises — the isolation counterpart to Day 2, still cardio-accelerated the whole way through.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Bodyweight squat x 15", "Leg swings x 10 each leg", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dumbbell Lateral Raise", detail: "3 x 12-15", howTo: "Raise dumbbells out to the sides to shoulder height.", tip: "Lead with your elbows, keep a slight bend the whole time." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Barbell Front Raise", detail: "3 x 12-15", howTo: "Raise a barbell straight out in front to shoulder height.", tip: "Don't swing — control the weight down slowly." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dumbbell Bent-Over Lateral Raise", detail: "3 x 12-15", howTo: "Hinge forward and raise dumbbells out to the sides.", tip: "Keep a soft bend in the knees and a flat back." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Leg Extension", detail: "4 x 12-15", howTo: "Seated leg extension machine.", tip: "Pause and squeeze your quads at the top." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Leg Curl", detail: "4 x 12-15", howTo: "Lying or seated leg curl machine.", tip: "Control the negative — don't let the weight snap back." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Seated Calf Raise", detail: "3 x 12-15", howTo: "Rise onto your toes with weight across your knees, seated.", tip: "Full stretch at the bottom, full squeeze at the top." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Donkey or Leg Press Calf Raise", detail: "3 x 12-15", howTo: "Calf raise on a donkey calf machine or leg press platform.", tip: "Use a full range of motion — don't bounce." },
      ],
    },
    "shortcut-to-shred-6": {
      user: "jake",
      program: "shortcut-to-shred",
      programLabel: "Shortcut to Shred",
      dayNumber: 6,
      name: "Shortcut to Shred — Day 6: Back, Traps & Biceps (Single-Joint)",
      icon: "🔥",
      tagline: "Single-joint · 12-15 reps · cardio acceleration",
      reason: "The last day in the rotation — pulldowns, shrugs, and curls to finish the cycle before it repeats.",
      sourceTags: ["📄 Source: Shortcut to Shred (PDF)"],
      defaultCheckIn: { minutes: 60, energy: "high", partner: false },
      warmup: ["5 min easy bike or jump rope to get moving", "Band pull-aparts x 15", "Dead hang x 20 sec", "Arm circles x 10 each way"],
      exercises: [
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Lat Pulldown", detail: "3 x 12-15", howTo: "Pull a wide bar down to your upper chest.", tip: "Lead with your elbows, avoid leaning back too far." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Reverse-Grip Pulldown", detail: "3 x 12-15", howTo: "Lat pulldown with an underhand grip.", tip: "This shifts more emphasis to your lower lats and biceps." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Straight-Arm Pulldown", detail: "3 x 12-15", howTo: "Standing at a high cable, pull a straight bar down with straight arms.", tip: "Keep a very slight elbow bend — don't turn it into a triceps move." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Smith Machine Behind-the-Back Shrug", detail: "4 x 12-15", howTo: "Stand facing away from a Smith bar behind you and shrug straight up.", tip: "This angle hits your traps from a different line of pull." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Incline Dumbbell Curl", detail: "3 x 12-15", howTo: "Curl dumbbells while seated on an incline bench, arms hanging behind you.", tip: "The incline stretches the biceps — don't rush the negative." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "High Cable Curl", detail: "3 x 12-15", howTo: "Cross-body curl pulling from two high cable pulleys.", tip: "Keep your elbows up and stationary throughout." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Rope Cable Curl", detail: "3 x 12-15", howTo: "Curl a rope attachment from a low cable, twisting your wrists up at the top.", tip: "Turn your pinkies toward your shoulders at the top for peak contraction." },
        { phase: SHORTCUT_TO_SHRED_CARDIO_NOTE, name: "Dumbbell Reverse Wrist Curl", detail: "3 x 12-15", howTo: "Forearms on a bench, palms down, curl the dumbbells up using your wrists.", tip: "Use light weight — this is a small, isolated movement." },
      ],
    },
  };

  const SHORTCUT_TO_SHRED_ORDER = [
    "shortcut-to-shred-1",
    "shortcut-to-shred-2",
    "shortcut-to-shred-3",
    "shortcut-to-shred-4",
    "shortcut-to-shred-5",
    "shortcut-to-shred-6",
  ];

  // Rotates through the 6 day-types in order based on how many Shortcut to
  // Shred sessions this athlete has already logged — so the dedicated
  // button always picks up where they left off instead of repeating Day 1
  // every time.
  function nextShortcutToShredKey(user) {
    const count = getHistory(user).filter((e) => SHORTCUT_TO_SHRED_ORDER.includes(e.splitKey)).length;
    return SHORTCUT_TO_SHRED_ORDER[count % SHORTCUT_TO_SHRED_ORDER.length];
  }

  Object.assign(SPECIAL_WORKOUTS, SHORTCUT_TO_SHRED_WORKOUTS);

  const CUSTOM_META = { name: "Custom Session", icon: "🛠", tagline: "Your own mix" };

  function getSplitMeta(splitKey) {
    return SPLIT_LIBRARY[splitKey] || SPECIAL_WORKOUTS[splitKey] || CUSTOM_META;
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
    return SPECIAL_WORKOUTS[splitKey]?.warmup || WARMUPS[splitKey] || WARMUPS.custom;
  }

  // ---------- exercise images ----------
  // Looks for images/<body-part>/<slugified-exercise-name>.jpg. Body part
  // used to be guessed from splitKey (chest-back/legs/cardio/core-mobility)
  // — that broke down the moment an exercise came from anywhere else
  // (a SPECIAL_WORKOUTS preset like Shortcut to Shred, a saved library
  // routine, a custom-built session): none of those carry one of the four
  // canonical splitKeys, so every image lookup silently fell through to a
  // wrong folder and missed real photos that actually existed. Exercise
  // NAME is the only thing guaranteed present regardless of source, so the
  // lookup now tries every body-part folder that actually has photos in it
  // and takes whichever one 404s last — no splitKey involved at all, which
  // also means a newly added split/program/preset just works without a
  // matching code change here.
  const IMAGE_BODY_PARTS = ["chest", "back", "legs", "shoulders", "arms", "core"];

  function slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getExerciseImageCandidates(exerciseName) {
    const slug = slugify(exerciseName);
    return IMAGE_BODY_PARTS.map((part) => `images/${part}/${slug}.jpg`);
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
    // Covers both a flat rep count ("4 x 6") and a rep range ("4 x 9-11") —
    // programs like Shortcut to Shred write targets as ranges, and those
    // were previously falling through to the generic round/toggle UI.
    return /^\d+\s*x\s*\d+(-\d+)?(\/\S+)?$/i.test(detail.trim());
  }

  function parseTargetReps(detail) {
    if (!isRepBased(detail)) return null;
    // Use the low end of a range as the target so "as planned" defaults to
    // the minimum the program actually asks for; the rep stepper covers
    // pushing past it.
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

  // Patches the most recently logged entry — used by the post-workout
  // rating/recommendation-feedback chips on the done screen, which apply
  // to a session after logSession already wrote it, not during.
  function patchLastSession(user, patch) {
    const all = loadAllHistory();
    const entries = all[user];
    if (!entries || entries.length === 0) return;
    Object.assign(entries[entries.length - 1], patch);
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
    Object.values(SPECIAL_WORKOUTS).forEach((workout) => {
      if (workout.user === user) workout.exercises.forEach((exercise) => names.add(exercise.name));
    });
    return Array.from(names);
  }

  // The base list for a split with anything the athlete has permanently
  // excluded already filtered out — the single choke point every planner
  // (AI candidates and the local fallback alike) reads through, so an
  // excluded exercise can never come back as a suggestion.
  function getAvailableExercises(user, splitKey) {
    // "custom" (a saved routine with no splitKey, or a library-doc workout)
    // has no base pool of its own to draw more candidates from — the
    // preview's "+ Add an exercise" picker just has nothing to offer
    // there, which is correct: there's no wider category to pull from.
    if (!SPLIT_LIBRARY[splitKey]) return [];
    const excluded = new Set(getPersonaProfile(user).excludedExercises);
    return SPLIT_LIBRARY[splitKey].exercises[user].filter((ex) => !excluded.has(ex.name));
  }

  function isPartnerExercise(exercise) {
    return /partner/i.test(`${exercise?.name || ""} ${exercise?.phase || ""} ${exercise?.howTo || ""}`);
  }

  function isWorkoutAllowedForCheckIn(splitKey, context = checkInState) {
    const preset = SPECIAL_WORKOUTS[splitKey];
    return !preset?.defaultCheckIn?.partner || Boolean(context.partner);
  }

  function isFinisherExercise(exercise) {
    return /^finisher:/i.test(exercise?.name || "");
  }

  function targetExerciseCount({ minutes, energy }) {
    const base = TIME_TO_COUNT[minutes] ?? 4;
    if (energy === "low") return Math.max(2, base - 1);
    if (energy === "high") return Math.min(6, base + 1);
    return base;
  }

  function chestBackPlanSize(checkIn, hasFinisher) {
    const requested = targetExerciseCount(checkIn);
    let regular = Math.max(2, requested - (hasFinisher ? 1 : 0));
    // A push/pull workout should contain complete pairs. For low energy we
    // trim an orphaned movement; otherwise we add its counterpart so a
    // 30-minute selection never becomes "two presses and one pulldown."
    if (regular % 2 !== 0) regular += checkIn.energy === "low" ? -1 : 1;
    return { regular, total: regular + (hasFinisher ? 1 : 0) };
  }

  // A bigger exercise pool doesn't reduce repetition on its own — slicing
  // the same fixed prefix every time would still show the same first N
  // exercises forever. This ranks the pool by how recently each one was
  // actually used for this split and prefers the ones sitting out, so a
  // larger library actually gets seen instead of most of it going unused.
  // Superset pairs are grouped into one unit first so ranking never splits
  // a pair apart — a unit's recency is whichever of its exercises was used
  // more recently, and the final selection is restored to catalog order.
  function pickVariedExercises(user, splitKey, base, count) {
    if (base.length <= count) return base.slice(0, count);

    const lastUsedIndex = new Map();
    getHistory(user)
      .filter((entry) => entry.splitKey === splitKey)
      .slice(-6)
      .forEach((entry, sessionIdx) => {
        getEntryExercises(user, entry).forEach((ex) => lastUsedIndex.set(ex.name, sessionIdx));
      });

    const units = [];
    base.forEach((ex, i) => {
      const last = units[units.length - 1];
      if (ex.superset && last && last.exercises[0].superset === ex.superset) {
        last.exercises.push(ex);
      } else {
        units.push({ exercises: [ex], firstIndex: i });
      }
    });
    units.forEach((unit) => {
      unit.recency = Math.max(-1, ...unit.exercises.map((ex) => lastUsedIndex.get(ex.name) ?? -1));
    });

    const selected = [];
    let total = 0;
    for (const unit of [...units].sort((a, b) => a.recency - b.recency)) {
      if (total >= count) break;
      selected.push(unit);
      total += unit.exercises.length;
    }

    return selected
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .flatMap((unit) => unit.exercises);
  }

  // Turns a base exercise list into today's actual plan based on the
  // amount of time available, energy level, and whether a partner is along.
  function buildWorkoutPlan(user, splitKey, { minutes, energy, partner }) {
    const base = getAvailableExercises(user, splitKey);
    const desiredTotal = targetExerciseCount({ minutes, energy });
    const finisher = energy === "high" && minutes >= 45 ? FINISHERS[splitKey]?.[user] : null;
    const baseCount = Math.max(1, desiredTotal - (finisher ? 1 : 0));
    let list = pickVariedExercises(user, splitKey, base, Math.min(baseCount, base.length));
    if (list.length > baseCount) list = list.slice(0, baseCount);
    if (finisher) list = [...list, finisher];
    if (partner) {
      const extra = PARTNER_EXTRAS[splitKey][user];
      if (extra) list = [...list, extra];
    }

    // An explicitly requested cross-category finisher ("ab finish" on leg
    // day) always gets included here — it was asked for by name, so it
    // shouldn't depend on the energy/duration heuristic above the way the
    // split's own default finisher does.
    const finisherOverride = checkInState.finisherOverride;
    if (finisherOverride && finisherOverride !== splitKey) {
      const crossFinisher = FINISHERS[finisherOverride]?.[user];
      if (crossFinisher && !list.some((ex) => ex.name === crossFinisher.name)) {
        list = [...list, crossFinisher];
      }
    }
    return list;
  }

  function mergeCanonicalExercises(exercises, pool) {
    const byName = new Map(pool.map((exercise) => [exercise.name, exercise]));
    const seen = new Set();
    return (exercises || [])
      .map((exercise) => byName.get(exercise?.name))
      .filter((exercise) => exercise && !seen.has(exercise.name) && seen.add(exercise.name));
  }

  function balanceChestBackPlan(user, exercises, checkIn) {
    const pool = buildCandidatePool(user, "chest-back", checkIn);
    const canonical = mergeCanonicalExercises(exercises, pool);
    const regularPool = pool.filter((exercise) => !isFinisherExercise(exercise) && (checkIn.partner || !isPartnerExercise(exercise)));
    const regularChosen = canonical.filter((exercise) => !isFinisherExercise(exercise) && (checkIn.partner || !isPartnerExercise(exercise)));
    const finisher = checkIn.energy === "high" && checkIn.minutes >= 45 ? pool.find(isFinisherExercise) : null;
    const { regular: desiredRegular, total: desiredTotal } = chestBackPlanSize(checkIn, Boolean(finisher));
    const focus = getCoachFocus(checkIn.note);
    const isChest = (exercise) => getExerciseTraits(exercise).has("horizontalPush");
    const isBack = (exercise) => {
      const traits = getExerciseTraits(exercise);
      return traits.has("horizontalPull") || traits.has("verticalPull");
    };
    const priority = (key) => ({ A: 0, B: 1, C: 2 }[key] ?? 10);
    const pairMap = new Map();
    regularPool.forEach((exercise) => {
      if (!exercise.superset) return;
      if (!pairMap.has(exercise.superset)) pairMap.set(exercise.superset, []);
      pairMap.get(exercise.superset).push(exercise);
    });
    const completePairs = Array.from(pairMap, ([key, items]) => ({ key, items }))
      .filter(({ items }) => items.some(isChest) && items.some(isBack))
      .sort((a, b) => priority(a.key) - priority(b.key));

    let chestTarget = Math.ceil(desiredRegular / 2);
    if (focus === "back") chestTarget = Math.floor(desiredRegular / 2);
    const backTarget = desiredRegular - chestTarget;
    const result = [];
    const push = (exercise) => {
      if (exercise && !result.some((item) => item.name === exercise.name)) result.push(exercise);
    };
    // Fill the plan with complete, intentionally programmed push/pull
    // supersets first. A weak AI response can influence the explanation,
    // but it cannot replace the primary compound pairs with accessories.
    completePairs.forEach(({ items }) => {
      if (result.length + 2 > desiredRegular) return;
      push(items.find(isChest));
      push(items.find(isBack));
    });

    const chosenAndPool = [...regularChosen, ...regularPool];
    const chest = chosenAndPool.filter(isChest);
    const back = chosenAndPool.filter(isBack);
    for (let index = 0; result.length < desiredRegular && index < Math.max(chest.length, back.length); index++) {
      const currentChest = result.filter(isChest).length;
      const currentBack = result.filter(isBack).length;
      if (focus === "back" || currentBack < currentChest) {
        if (currentBack < backTarget) push(back.find((exercise) => !result.some((item) => item.name === exercise.name)));
        if (currentChest < chestTarget && result.length < desiredRegular) push(chest.find((exercise) => !result.some((item) => item.name === exercise.name)));
      } else {
        if (currentChest < chestTarget) push(chest.find((exercise) => !result.some((item) => item.name === exercise.name)));
        if (currentBack < backTarget && result.length < desiredRegular) push(back.find((exercise) => !result.some((item) => item.name === exercise.name)));
      }
    }
    chosenAndPool.forEach((exercise) => {
      if (result.length < desiredRegular) push(exercise);
    });
    if (finisher) push(finisher);
    return result.slice(0, desiredTotal);
  }

  function enforcePlanConstraints(user, splitKey, exercises, checkIn) {
    if (SPECIAL_WORKOUTS[splitKey]) return exercises;
    if (splitKey === "chest-back") return balanceChestBackPlan(user, exercises, checkIn);
    const pool = buildCandidatePool(user, splitKey, checkIn);
    const desired = targetExerciseCount(checkIn) + (checkIn.partner ? 1 : 0);
    const canonical = mergeCanonicalExercises(exercises, pool).filter((exercise) => checkIn.partner || !isPartnerExercise(exercise));
    const fallback = buildWorkoutPlan(user, splitKey, checkIn).filter((exercise) => checkIn.partner || !isPartnerExercise(exercise));
    const result = [];
    [...canonical, ...fallback, ...pool].forEach((exercise) => {
      if (result.length < desired && !result.some((item) => item.name === exercise.name)) result.push(exercise);
    });
    return result;
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

  // "Leg day, ab finish" asks for a finisher from a DIFFERENT category than
  // the split being trained — the candidate pool is normally scoped to one
  // split only, so without this the AI/local fallback structurally can't
  // pick a core move during a legs session no matter how clearly it's
  // asked for. Returns which split's finisher to pull in as an extra
  // candidate, e.g. "core-mobility" for an ab/core finisher.
  function detectFinisherRequest(text) {
    const value = String(text || "").toLowerCase();
    if (/\b(ab|abs|core)\s*(finish|finisher)\b|\bfinish(ing)?\s*(with|on)\s*(abs?|core)\b/.test(value)) return "core-mobility";
    if (/\bcardio\s*(finish|finisher)\b|\bfinish(ing)?\s*(with|on)\s*cardio\b/.test(value)) return "cardio";
    if (/\bleg\s*(finish|finisher)\b|\bfinish(ing)?\s*(with|on)\s*legs\b/.test(value)) return "legs";
    if (/\b(chest|back|upper.?body)\s*(finish|finisher)\b/.test(value)) return "chest-back";
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

  function inferSplitFromChat(text, user) {
    const value = String(text || "").toLowerCase();
    // Jessica's purpose-built pre-game partner session (SPECIAL_WORKOUTS
    // "jess-game-day-core") is a real, deliberately-designed session —
    // trunk stability + hip mobility across 5 phases — not the generic
    // 3-4 exercise Core & Mobility split. Mentioning the actual scenario
    // it was built for should reach it instead of silently falling back
    // to the thin generic default.
    if (user === "jessica" && /\b(game|basketball|hoops?|pickup)\b/.test(value)) return "jess-game-day-core";
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
  function applyCoachFocus(user, splitKey, exercises, note, context = checkInState) {
    const focus = getCoachFocus(note);
    const pool = buildCandidatePool(user, splitKey, context);
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

    // A same-message focus request ("focus on quads... ab finish") makes the
    // slicing above re-rank around the quads trait, which can silently cut
    // the explicitly-requested cross-category finisher back out even though
    // buildWorkoutPlan/the AI already included it. That finisher was asked
    // for by name, not inferred from trait overlap, so it's never subject to
    // the trim above either.
    const finisherOverride = context.finisherOverride;
    if (finisherOverride && finisherOverride !== splitKey) {
      const crossFinisher = FINISHERS[finisherOverride]?.[user];
      if (crossFinisher && !result.some((exercise) => exercise.name === crossFinisher.name)) {
        result = [...result, crossFinisher];
      }
    }
    return result;
  }

  function getEntryExercises(user, entry) {
    if (Array.isArray(entry.exercises)) return entry.exercises;
    return buildWorkoutPlan(user, entry.splitKey, entry); // backward-compat for older logged entries
  }

  function buildTags({ minutes, energy, partner }, extraTags = []) {
    const tags = [`${minutes} MIN`, ENERGY_LABEL[energy].toUpperCase(), partner ? "W/ PARTNER" : "SOLO"];
    return [...tags, ...extraTags];
  }

  // Everything the AI (or the local fallback) is allowed to choose from —
  // the base list plus the finisher/partner bonus moves, all up for grabs
  // based on today's actual context instead of always-on rules.
  function buildCandidatePool(user, splitKey, context = checkInState) {
    if (SPECIAL_WORKOUTS[splitKey]) {
      const excluded = new Set(getPersonaProfile(user).excludedExercises);
      return SPECIAL_WORKOUTS[splitKey].exercises.filter((exercise) => !excluded.has(exercise.name));
    }
    const excluded = new Set(getPersonaProfile(user).excludedExercises);
    const pool = getAvailableExercises(user, splitKey);
    const finisher = FINISHERS[splitKey]?.[user];
    const partnerExtra = PARTNER_EXTRAS[splitKey]?.[user];
    if (finisher && context.energy === "high" && context.minutes >= 45 && !excluded.has(finisher.name)) pool.push(finisher);
    if (partnerExtra && context.partner && !excluded.has(partnerExtra.name)) pool.push(partnerExtra);

    // "Leg day, ab finish" — the athlete asked for a finisher from a split
    // that isn't the one being trained today. The candidate list is
    // normally scoped to just this split, so without pulling that other
    // split's finisher in as an extra option, the AI has no way to honor
    // this no matter how clearly it's stated (it can only choose from
    // what's actually in `candidates`).
    const finisherOverride = checkInState.finisherOverride;
    if (finisherOverride && finisherOverride !== splitKey) {
      const crossFinisher = FINISHERS[finisherOverride]?.[user];
      if (crossFinisher && !excluded.has(crossFinisher.name) && !pool.some((ex) => ex.name === crossFinisher.name)) {
        pool.push(crossFinisher);
      }
    }
    return pool;
  }

  // Asks the Cloudflare Worker (which holds the OpenAI key) to pick today's
  // exercises from the real candidate pool. Falls back to the local
  // rule-based planner on any failure, timeout, or if no endpoint is set.
  async function computePlan(user, splitKey, checkIn) {
    if (SPECIAL_WORKOUTS[splitKey]) {
      const preset = SPECIAL_WORKOUTS[splitKey];
      const exercises = applyCoachFocus(user, splitKey, buildCandidatePool(user, splitKey, checkIn), checkIn.note, checkIn);
      return { exercises, reason: preset.reason, source: "preset", suggestedWeights: new Map() };
    }
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
            candidates: buildCandidatePool(user, splitKey, checkIn),
            // What this split actually looked like the last couple of
            // times, so the model can favor variety from a candidate pool
            // that's grown well past what a single session needs, instead
            // of gravitating to the same "best" few every time.
            recentExercises: getHistory(user)
              .filter((entry) => entry.splitKey === splitKey)
              .slice(-2)
              .flatMap((entry) => getEntryExercises(user, entry).map((ex) => ex.name)),
            libraryContext: getLibraryContext(`${meta.name} ${checkIn.note || ""} ${(persona.focusAreas || []).join(" ")}`),
            libraryRoutines: getLibraryRoutinesContext(),
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
            const focused = applyCoachFocus(user, splitKey, data.exercises, checkIn.note, checkIn);
            return {
              exercises: enforcePlanConstraints(user, splitKey, focused, checkIn),
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
      exercises: enforcePlanConstraints(
        user,
        splitKey,
        applyCoachFocus(user, splitKey, buildWorkoutPlan(user, splitKey, checkIn), checkIn.note, checkIn),
        checkIn
      ),
      reason: null,
      source: "local",
      suggestedWeights: new Map(),
    };
  }

  // ---------- state ----------

  let currentUser = null;
  let checkInState = { minutes: 30, energy: "medium", partner: false, note: "", weightOverrides: {}, weightDirection: null, finisherOverride: null };
  let chatMessages = []; // [{ role: "coach" | "user", text }] for the check-in chat
  let chatBusy = false;
  let coachContextTarget = null;
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

  // ---------- active-workout persistence ----------
  // activeWorkout used to live only in memory — closing the tab, backgrounding
  // the PWA long enough for iOS to reclaim it, or just reloading mid-workout
  // silently lost every logged set with no way back in, since "Resume
  // Workout" only ever checked the in-memory variable. Persisting it means a
  // reload genuinely resumes instead of just discarding progress.
  const ACTIVE_WORKOUT_KEY = "liftr_active_workout_v1";
  let persistActiveWorkoutTimer = null;

  function persistActiveWorkout() {
    if (!activeWorkout || !currentUser) {
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({ user: currentUser, checkInState, workout: activeWorkout }));
  }

  // Rapid-fire mutations (holding a stepper, typing a weight) debounce
  // through here instead of writing to localStorage on every tick; discrete
  // one-off events (starting, finishing, swapping) call persistActiveWorkout
  // directly so they're never lost to a debounce window getting interrupted.
  function schedulePersistActiveWorkout() {
    clearTimeout(persistActiveWorkoutTimer);
    persistActiveWorkoutTimer = setTimeout(persistActiveWorkout, 400);
  }

  // Restores a persisted in-progress workout for this user, if any — called
  // right after login, before deciding which screen to land on.
  function loadActiveWorkout(user) {
    try {
      const raw = JSON.parse(localStorage.getItem(ACTIVE_WORKOUT_KEY));
      if (raw && raw.user === user && raw.workout) {
        activeWorkout = raw.workout;
        if (raw.checkInState) checkInState = { ...checkInState, ...raw.checkInState };
      }
    } catch {
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
    }
  }

  // ---------- screen helpers ----------

  const SCREEN_IDS = [
    "login-screen",
    "welcome-screen",
    "checkin-screen",
    "settings-screen",
    "history-screen",
    "trainer-screen",
    "library-doc-screen",
    "graph-screen",
    "library-screen",
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
  const EFFORT_ICON = { easy: "😌", right: "👍", hard: "😤" };

  function formatPerformanceSummary(perf) {
    if (perf?.skipped) return "⏭ Skipped";
    const touched = (perf?.sets || []).filter((s) => s.actual != null || s.weight != null);
    if (touched.length === 0) return perf?.effort ? EFFORT_ICON[perf.effort] ?? null : null;
    const setsText = touched
      .map((s) => {
        const reps = s.target != null ? String(s.actual ?? "-") : s.actual ? "✓" : "-";
        return s.weight != null ? `${s.weight}×${reps}` : reps;
      })
      .join(", ");
    return perf.effort && EFFORT_ICON[perf.effort] ? `${setsText} ${EFFORT_ICON[perf.effort]}` : setsText;
  }

  function renderExerciseList(exercises, performance) {
    const list = document.getElementById("session-exercises");
    list.innerHTML = "";
    let currentPhase = null;
    exercises.forEach((ex) => {
      if (ex.phase && ex.phase !== currentPhase) {
        currentPhase = ex.phase;
        const heading = document.createElement("li");
        heading.className = "session-phase-heading";
        heading.textContent = ex.phase;
        list.appendChild(heading);
      }
      const loggedSummary = performance ? formatPerformanceSummary(performance[ex.name]) : null;
      const li = document.createElement("li");
      if (performance?.[ex.name]?.skipped) li.classList.add("ex-skipped");
      else if (loggedSummary) li.classList.add("ex-logged");
      li.innerHTML = `<span>${escapeHtml(ex.name)}</span><span class="ex-detail">${escapeHtml(loggedSummary || ex.detail)}</span>`;
      list.appendChild(li);
    });
  }

  function getExerciseRoleLabel(exercise) {
    if (isFinisherExercise(exercise)) return "FINISHER";
    if (isPartnerExercise(exercise)) return "PARTNER";
    const traits = getExerciseTraits(exercise);
    if (traits.has("horizontalPush")) return "CHEST";
    if (traits.has("horizontalPull") || traits.has("verticalPull")) return "BACK";
    if (traits.has("quads")) return "QUADS";
    if (traits.has("hamstrings")) return "HAMSTRINGS";
    if (traits.has("glutes")) return "GLUTES";
    if (traits.has("core")) return "CORE";
    if (traits.has("conditioning")) return "CONDITIONING";
    if (traits.has("mobility")) return "MOBILITY";
    return "EXERCISE";
  }

  function renderPreviewPlanSummary(exercises, context) {
    const summary = document.getElementById("preview-plan-summary");
    if (!summary) return;
    const counts = new Map();
    exercises.forEach((exercise) => {
      const role = getExerciseRoleLabel(exercise);
      counts.set(role, (counts.get(role) || 0) + 1);
    });
    const order = ["CHEST", "BACK", "QUADS", "HAMSTRINGS", "GLUTES", "CORE", "CONDITIONING", "MOBILITY", "FINISHER", "PARTNER", "EXERCISE"];
    const mix = order.filter((role) => counts.has(role)).map((role) => `${counts.get(role)} ${role.toLowerCase()}`).join(" · ");
    const mode = context.partner ? "with partner" : "solo";
    const energy = ENERGY_LABEL[context.energy] || "energy not logged";
    summary.innerHTML = `<strong>PLAN CHECK</strong><span>${escapeHtml(mix)} · ${escapeHtml(mode)} · ${context.minutes} min · ${escapeHtml(energy)}</span>`;
    summary.classList.remove("hidden");
  }

  // Live-editable version of the preview list — lets the athlete drop or
  // add exercises right on the preview card instead of leaving for the
  // full cross-category builder (still available via "Edit Exercises" for
  // bigger changes). Mutates previewPlan.exercises in place so Start
  // Workout's onclick (which reads previewPlan.exercises fresh) always
  // reflects whatever's currently in the list.
  function renderPreviewExerciseList(exercises, splitKey) {
    const list = document.getElementById("session-exercises");
    list.innerHTML = "";
    renderPreviewPlanSummary(exercises, checkInState);
    let currentPhase = null;
    let currentSuperset = null;
    exercises.forEach((ex, idx) => {
      if (ex.phase && ex.phase !== currentPhase) {
        currentPhase = ex.phase;
        currentSuperset = null;
        const heading = document.createElement("li");
        heading.className = "session-phase-heading";
        heading.textContent = ex.phase;
        list.appendChild(heading);
      }
      const hasCompleteSuperset = ex.superset && exercises.filter((item) => item.superset === ex.superset).length > 1;
      if (hasCompleteSuperset && ex.superset !== currentSuperset) {
        currentSuperset = ex.superset;
        const heading = document.createElement("li");
        heading.className = "session-superset-heading";
        heading.textContent = `SUPERSET ${ex.superset} · ALTERNATE THE NEXT TWO LIFTS`;
        list.appendChild(heading);
      } else if (!hasCompleteSuperset) {
        currentSuperset = null;
      }
      const li = document.createElement("li");
      li.className = "session-ex-editable";
      const imageCandidates = getExerciseImageCandidates(ex.name);
      li.innerHTML = `
        <span class="session-ex-number">${idx + 1}</span>
        <span class="session-ex-image"><img src="${imageCandidates[0]}" alt="" /><span>${getSplitMeta(splitKey).icon}</span></span>
        <span class="session-ex-info">
          <span class="session-ex-title"><strong>${escapeHtml(ex.name)}</strong><em>${escapeHtml(getExerciseRoleLabel(ex))}</em></span>
          <span class="ex-detail">${escapeHtml(ex.detail)}</span>
          ${ex.howTo ? `<span class="session-ex-howto">${escapeHtml(ex.howTo)}</span>` : ""}
        </span>
        <button type="button" class="session-ex-remove" data-idx="${idx}" title="Remove ${escapeHtml(ex.name)}" aria-label="Remove ${escapeHtml(ex.name)}">✕</button>
      `;
      const image = li.querySelector("img");
      let imageIndex = 0;
      image.addEventListener("error", () => {
        imageIndex++;
        if (imageIndex < imageCandidates.length) image.src = imageCandidates[imageIndex];
        else image.style.display = "none";
      });
      list.appendChild(li);
    });

    const candidates = buildCandidatePool(currentUser, splitKey, checkInState).filter(
      (candidate) => !exercises.some((ex) => ex.name === candidate.name)
    );
    const addLi = document.createElement("li");
    addLi.className = "session-ex-add-row";
    addLi.innerHTML =
      candidates.length > 0
        ? `<select class="session-ex-add-select">
             <option value="">+ Add an exercise…</option>
             ${candidates.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${escapeHtml(c.detail)})</option>`).join("")}
           </select>`
        : `<span class="session-ex-add-empty">No more exercises to add from this workout's pool — try Edit Exercises for the full library.</span>`;
    list.appendChild(addLi);

    list.querySelectorAll(".session-ex-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        previewPlan.exercises.splice(Number(btn.dataset.idx), 1);
        renderPreviewExerciseList(previewPlan.exercises, splitKey);
      });
    });

    const addSelect = list.querySelector(".session-ex-add-select");
    addSelect?.addEventListener("change", () => {
      const chosen = candidates.find((c) => c.name === addSelect.value);
      if (!chosen) return;
      previewPlan.exercises.push({ ...chosen, splitKey });
      renderPreviewExerciseList(previewPlan.exercises, splitKey);
    });

    // At least one exercise is required to start — removing down to zero
    // disables Start Workout rather than silently letting it log nothing.
    const startBtn = document.getElementById("log-session-btn");
    if (startBtn) startBtn.disabled = exercises.length === 0;
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

  // How many exercises the real plan is actually going to land on, so the
  // loading skeleton below can match it — a fixed 3-row skeleton used to
  // show regardless of check-in settings, so a short/low-energy session
  // (whose real target is 2) visibly "lost" a row the moment the real plan
  // rendered, reading like the workout had just been shrunk.
  function estimatedExerciseCount(splitKey, checkIn) {
    if (SPECIAL_WORKOUTS[splitKey]) return buildCandidatePool(currentUser, splitKey, checkIn).length;
    if (splitKey === "chest-back") {
      const hasFinisher = checkIn.energy === "high" && checkIn.minutes >= 45;
      return chestBackPlanSize(checkIn, hasFinisher).total;
    }
    return targetExerciseCount(checkIn) + (checkIn.partner ? 1 : 0);
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
    document.getElementById("preview-plan-summary").classList.add("hidden");

    const list = document.getElementById("session-exercises");
    const rowCount = Math.max(1, Math.min(8, estimatedExerciseCount(splitKey, checkInState)));
    list.innerHTML = '<li class="skeleton-row"></li>'.repeat(rowCount);

    const btn = document.getElementById("log-session-btn");
    document.getElementById("preview-coach-section").classList.remove("hidden");
    document.getElementById("preview-actions").classList.remove("hidden");
    document.getElementById("save-workout-btn").classList.add("hidden");
    document.getElementById("edit-preview-btn").disabled = true;
    placeTerminalPanel("preview");
    btn.textContent = "Loading…";
    btn.disabled = true;
    btn.onclick = null;
    document.getElementById("back-to-options").classList.remove("hidden");
    document.getElementById("session-done-note").classList.add("hidden");
  }

  // Two lightweight, one-tap post-workout signals — separate from the
  // per-exercise effort chips, which cover how the exercises felt, not
  // whether today's session was the right call or a rough day overall.
  // Patches the already-logged entry in place (logSession already ran by
  // the time this screen shows), and re-renders on every tap so the
  // selected chip stays in sync with what's actually stored.
  function renderSessionFeedbackRows(user, entry) {
    const ratingRow = document.getElementById("session-rating-row");
    const recRow = document.getElementById("session-rec-feedback-row");
    ratingRow.classList.remove("hidden");
    recRow.classList.remove("hidden");

    ratingRow.querySelectorAll(".session-feedback-chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.rating === entry.overallRating);
      chip.onclick = () => {
        entry.overallRating = entry.overallRating === chip.dataset.rating ? null : chip.dataset.rating;
        patchLastSession(user, { overallRating: entry.overallRating });
        renderSessionFeedbackRows(user, entry);
      };
    });

    recRow.querySelectorAll(".session-feedback-chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.rec === entry.recFeedback);
      chip.onclick = () => {
        entry.recFeedback = entry.recFeedback === chip.dataset.rec ? null : chip.dataset.rec;
        patchLastSession(user, { recFeedback: entry.recFeedback });
        renderSessionFeedbackRows(user, entry);
      };
    });
  }

  function renderSessionScreen(user, history) {
    // loggedToday alone isn't enough: it stays true for the rest of the day
    // once ANY session is logged, so it can't distinguish "just landed here,
    // show today's completed session" from "explicitly picked a new/second
    // workout to preview" (selectSplitAndPreview et al. always set
    // selectedSplitKey before rendering here). Without the second half of
    // this check, every attempt to start another session after finishing
    // one — a deliberate second workout, or just re-picking from the select
    // screen — silently showed the stale "Done" card instead, with no way
    // out. Same combined condition already used by the coach-chat live
    // preview refresh above.
    const done = loggedToday(history) && !selectedSplitKey;
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
      document.getElementById("preview-plan-summary").classList.add("hidden");
      document.getElementById("preview-coach-section").classList.add("hidden");
      document.getElementById("preview-actions").classList.add("hidden");
      document.getElementById("save-workout-btn").classList.add("hidden");
      renderExerciseList(getEntryExercises(user, entry), entry.performance);
      renderTags(buildTags(entry, meta.sourceTags || []));
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
      renderSessionFeedbackRows(user, entry);
      // "Not feeling it? Back to options" (backLink, above) doesn't make
      // sense once a session is already logged — it stays hidden — but that
      // left this screen with no obvious way out beyond the small fixed
      // home icon in the corner, easy to miss on a screen that's otherwise
      // all cards. A real, visible button here is the actual fix.
      document.getElementById("session-done-home-btn").classList.remove("hidden");
      return;
    }
    document.getElementById("session-done-note").classList.add("hidden");
    document.getElementById("session-rating-row").classList.add("hidden");
    document.getElementById("session-rec-feedback-row").classList.add("hidden");
    document.getElementById("session-done-home-btn").classList.add("hidden");
    document.getElementById("preview-coach-section").classList.remove("hidden");
    document.getElementById("preview-actions").classList.remove("hidden");
    placeTerminalPanel("preview");

    if (!previewPlan) {
      renderSessionLoading(splitKey);
      return;
    }

    document.getElementById("save-workout-btn").classList.remove("hidden");
    renderPreviewExerciseList(previewPlan.exercises, splitKey);
    renderTags(buildTags(checkInState, meta.sourceTags || []));
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
    if (/bodyweight|push-up|pushup|plank|dead bug|mobility|stretch|flow|cat-cow|jump squat|mountain climber|burpee|\bjog|\brun|sprint|jump rope|high knee|butt kick|\bwalk|march|dead hang/i.test(ex.name)) return false;
    if (ex.splitKey === "chest-back" || ex.splitKey === "legs") return true;
    // Name-based catch-all for loaded movements outside those two splits —
    // e.g. Shortcut to Shred's barbell/cable/machine work, which previously
    // got no weight field at all just for living in a different splitKey.
    return /weighted|\bdb\b|dumbbell|goblet|suitcase|barbell|kettlebell|\bcable|machine|\bplate|pulldown|\bpress\b|squat|deadlift|\brow\b|curl|extension|\bfly\b|flye|raise|thrust|shrug|\bdip\b/i.test(ex.name);
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
      // The last SET's weight is the top of the ramp (sets ascend toward
      // the working weight), so this is already the right reference point
      // to progress from, not just the most recently touched value.
      const lastWeight = weightedSets[weightedSets.length - 1].weight;
      const previous = exactHistory[exactHistory.length - 2];
      const latestSkipped = Boolean(latest.performance.skipped);
      const repeatedSuccess = !latestSkipped && completedTarget(latest.performance) && previous && completedTarget(previous.performance);
      const missed =
        !latestSkipped &&
        latest.performance.sets.some((set) => set.target != null && set.actual != null && Number(set.actual) < Number(set.target) * 0.8);
      // Closes the loop on the effort chip captured last session — completing
      // the target says WHAT happened, effort says how much was left in the
      // tank, and progression should move faster or slower accordingly
      // instead of always bumping by the same fixed 5 lb regardless.
      const latestEffort = latest.performance.effort;
      let change = 0;
      let reason = "flat";
      if (latestSkipped) {
        reason = "skipped";
      } else if (missed) {
        change = -5;
        reason = "missed";
      } else if (repeatedSuccess) {
        change = latestEffort === "easy" ? 10 : latestEffort === "hard" ? 0 : 5;
        reason = latestEffort === "easy" ? "repeated-easy" : latestEffort === "hard" ? "repeated-hard" : "repeated";
      } else if (latestEffort === "easy") {
        change = 5;
        reason = "single-easy";
      } else if (latestEffort === "hard") {
        reason = "single-hard";
      }
      const weight = roundTrainingWeight(Math.max(5, lastWeight + change));
      const EXPLAIN = {
        skipped: `You skipped ${ex.name} last time, so the coach kept today's weight where it was.`,
        missed: `Your last logged reps fell short at ${lastWeight} lb, so the coach reduced the starting load slightly.`,
        "repeated-easy": `${lastWeight} lb felt easy while hitting the target the last two sessions, so the coach added 10 lb.`,
        "repeated-hard": `You hit the target the last two sessions, but ${lastWeight} lb felt hard both times — the coach held steady instead of pushing further.`,
        repeated: `You completed the target at ${lastWeight} lb in your last two sessions, so the coach added 5 lb.`,
        "single-easy": `${lastWeight} lb felt easy last time, so the coach added 5 lb.`,
        "single-hard": `${lastWeight} lb felt hard last time — the coach held the weight rather than adding more.`,
        flat: `Starts from your most recent ${ex.name} working weight.`,
      };
      return { weight, source: "history", explanation: EXPLAIN[reason] };
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
        sets: Array.from({ length: setCount }, () => ({
          target,
          actual: target,
          weight: seedWeight,
          touched: false,
        })),
        workingWeight: seedWeight,
        flag: "",
        effort: null,
        skipped: false,
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
          const group = { items: [ex], superset: ex.superset };
          bySupersetKey.set(key, group);
          groups.push(group);
        }
      } else {
        groups.push({ items: [ex] });
      }
    });
    return groups;
  }

  function getWorkoutGroupLabel(group, phaseName) {
    const partnerWork = checkInState.partner || /partner/i.test(phaseName || "") || group.items.some(isPartnerExercise);
    if (partnerWork) return "PARTNER SET · MOVE TOGETHER, THEN SWITCH";
    return `SUPERSET${group.superset ? ` ${group.superset}` : ""} · ALTERNATE EXERCISES`;
  }

  function updateWorkoutProgress() {
    if (!activeWorkout) return;
    const logs = activeWorkout.exercises.map((exercise) => activeWorkout.logs[exercise.name]).filter(Boolean);
    const totalSets = logs.reduce((sum, log) => sum + log.sets.length, 0);
    const completedSets = logs.reduce((sum, log) => sum + log.sets.filter((set) => set.touched).length, 0);
    const completedExercises = logs.filter((log) => log.sets.length > 0 && log.sets.every((set) => set.touched)).length;
    const percent = totalSets ? Math.round((completedSets / totalSets) * 100) : 0;
    document.getElementById("workout-progress-title").textContent = `${completedExercises} of ${logs.length} exercises logged`;
    document.getElementById("workout-progress-detail").textContent = `${completedSets} of ${totalSets} sets · ${percent}%`;
    document.getElementById("workout-progress-bar").style.width = `${percent}%`;
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
      horizontalPush: /bench press|chest press|incline dumbbell press|push.?up|chest pass|cable fly/,
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
    persistActiveWorkout();
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

    const imgCandidates = getExerciseImageCandidates(ex.name);
    const fallbackIcon = getSplitMeta(ex.splitKey).icon;
    const log = activeWorkout.logs[ex.name];

    const headRow = document.createElement("div");
    headRow.className = "wex-head-row";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "wex-head";
    head.innerHTML = `
      <span class="wex-image">
        <img src="${imgCandidates[0]}" alt="" class="wex-img" />
        <span class="wex-img-fallback">${fallbackIcon}</span>
      </span>
      <span class="wex-head-copy">
        <span class="wex-name">${escapeHtml(ex.name)}</span>
        <span class="wex-detail">${escapeHtml(ex.detail)}</span>
      </span>
      <span class="wex-chevron">▾</span>
    `;

    // One tap logs the whole exercise as done at its planned sets/reps/weight
    // — the common case where nothing needs adjusting shouldn't require
    // opening the card and touching every set individually. A second tap
    // marks it explicitly skipped (recorded as skipped, not silently
    // dropped or mistaken for "done"); a third resets it. Sits outside the
    // expand button (not nested inside it — buttons can't nest) so it
    // works with the card collapsed.
    const quickDoneBtn = document.createElement("button");
    quickDoneBtn.type = "button";
    quickDoneBtn.className = "wex-quickdone";
    const allTouched = () => log.sets.length > 0 && log.sets.every((s) => s.touched);
    const quickState = () => (log.skipped ? "skipped" : allTouched() ? "done" : "none");
    const syncQuickDoneBtn = () => {
      const state = quickState();
      quickDoneBtn.textContent = state === "done" ? "✓" : state === "skipped" ? "✕" : "○";
      quickDoneBtn.classList.toggle("done", state === "done");
      quickDoneBtn.classList.toggle("skipped", state === "skipped");
      quickDoneBtn.title =
        state === "done" ? "Done as planned — tap to mark skipped" : state === "skipped" ? "Marked skipped — tap to reset" : "Mark done as planned";
    };
    syncQuickDoneBtn();
    // Any direct interaction with a specific set (typed weight, stepper,
    // per-set toggle) clearly means the athlete IS doing this exercise —
    // clears a stale "skipped" state so the quick-done icon doesn't keep
    // showing skipped while sets are actively being logged underneath it.
    const clearSkip = () => {
      if (!log.skipped) return;
      log.skipped = false;
      syncQuickDoneBtn();
      card.classList.remove("skipped");
    };
    // Steps through the remaining body-part folders on each 404 before
    // giving up and showing the icon tile — the exercise's real photo could
    // be filed under any of them regardless of which split/program/library
    // routine this session's exercise list actually came from.
    let candidateIndex = 0;
    head.querySelector(".wex-img").addEventListener("error", (e) => {
      candidateIndex++;
      if (candidateIndex < imgCandidates.length) {
        e.target.src = imgCandidates[candidateIndex];
        return;
      }
      e.target.style.display = "none";
      e.target.nextElementSibling.style.display = "flex";
    });

    const body = document.createElement("div");
    body.className = "wex-body hidden";

    const showWeight = usesWeight(ex);
    const weightRecommendation = log.weightRecommendation;

    if (showWeight && log.workingWeight == null) {
      log.workingWeight = log.sets.find((set) => !set.touched && set.weight != null)?.weight
        ?? log.sets.find((set) => set.weight != null)?.weight
        ?? weightRecommendation?.weight
        ?? null;
    }

    const setsHtml = log.sets
      .map((s, i) => {
        const weightControl = showWeight
          ? `<span class="wex-set-weight">${s.weight != null ? `${s.weight} lb` : "weight not set"}</span>`
          : "";
        const repsControl =
          s.target != null
            ? `<div class="wex-mini-stepper" data-role="reps">
                 <button type="button" class="wex-mini-btn" data-dir="-1">−</button>
                 <span class="wex-mini-value">${s.actual}</span>
                 <span class="wex-mini-unit">reps</span>
                 <button type="button" class="wex-mini-btn" data-dir="1">+</button>
               </div>
               <button type="button" class="wex-set-done${s.touched ? " done" : ""}" aria-label="Mark set ${i + 1} complete">${s.touched ? "✓" : "○"}</button>`
            : `<button type="button" class="wex-toggle-btn">Mark Done</button>`;
        const label =
          s.target != null
            ? `Set ${i + 1} <span class="wex-set-target">· target ${s.target}</span>`
            : log.sets.length > 1
              ? `Round ${i + 1}`
              : "This one";

        return `
          <div class="wex-set-row${s.touched ? " touched" : ""}" data-set-index="${i}">
            <span class="wex-set-label">${label}</span>
            <div class="wex-set-controls">${weightControl}${repsControl}</div>
          </div>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="wex-body-image">
        <img src="${imgCandidates[0]}" alt="" class="wex-img-large" />
        <span class="wex-img-large-fallback">${fallbackIcon}</span>
      </div>
      ${ex.howTo ? `<p class="wex-howto">${escapeHtml(ex.howTo)}</p>` : ""}
      ${ex.tip ? `<p class="wex-tip">💡 ${escapeHtml(ex.tip)}</p>` : ""}
      ${showWeight ? `
        <div class="wex-working-load">
          <div class="wex-working-load-copy">
            <span>WORKING WEIGHT</span>
            <strong>${weightRecommendation ? `Coach start: ${weightRecommendation.weight} lb` : "Set today’s load"}</strong>
          </div>
          <div class="wex-working-load-controls">
            <button type="button" data-delta="-5" aria-label="Decrease working weight by 5 pounds">−5</button>
            <label><input type="number" inputmode="decimal" step="any" class="wex-working-load-input" aria-label="Working weight in pounds" placeholder="—" value="${log.workingWeight ?? ""}" /><span>lb</span></label>
            <button type="button" data-delta="5" aria-label="Increase working weight by 5 pounds">+5</button>
          </div>
          <p>Change this once between sets. It updates unfinished sets; completed sets keep the load you used.</p>
        </div>
      ` : ""}
      <div class="wex-sets">${setsHtml}</div>
      <div class="wex-effort-row">
        <span class="wex-effort-label">How did it feel?</span>
        <div class="wex-effort-chips">
          <button type="button" class="wex-effort-chip${log.effort === "easy" ? " selected" : ""}" data-effort="easy">😌 Easy</button>
          <button type="button" class="wex-effort-chip${log.effort === "right" ? " selected" : ""}" data-effort="right">👍 Just Right</button>
          <button type="button" class="wex-effort-chip${log.effort === "hard" ? " selected" : ""}" data-effort="hard">😤 Hard</button>
        </div>
      </div>
      <input type="text" class="wex-flag-input" placeholder="Anything to flag on this one? (optional)" maxlength="140" />
      <div class="wex-swap-row">
        <input type="text" class="wex-swap-input" placeholder="Want to swap this? e.g. 'replace flies, shoulder is sore'" maxlength="140" />
        <button type="button" class="wex-swap-btn">🔁 Swap</button>
      </div>
      <p class="wex-swap-status hidden" aria-live="polite"></p>
    `;
    // Same chained-candidate fallback as the collapsed card's thumbnail above.
    let largeCandidateIndex = 0;
    body.querySelector(".wex-img-large").addEventListener("error", (e) => {
      largeCandidateIndex++;
      if (largeCandidateIndex < imgCandidates.length) {
        e.target.src = imgCandidates[largeCandidateIndex];
        return;
      }
      e.target.style.display = "none";
      e.target.nextElementSibling.style.display = "flex";
    });

    body.querySelectorAll(".wex-set-row").forEach((row) => {
      const idx = Number(row.dataset.setIndex);
      const set = log.sets[idx];

      const repsStepper = row.querySelector('.wex-mini-stepper[data-role="reps"]');
      if (repsStepper) {
        const valueEl = repsStepper.querySelector(".wex-mini-value");
        const doneButton = row.querySelector(".wex-set-done");
        repsStepper.querySelectorAll(".wex-mini-btn").forEach((btn) => {
          const dir = Number(btn.dataset.dir);
          attachHoldStepper(btn, () => {
            set.actual = Math.max(0, (set.actual ?? 0) + dir);
            set.touched = true;
            valueEl.textContent = set.actual;
            row.classList.add("touched");
            doneButton?.classList.add("done");
            if (doneButton) doneButton.textContent = "✓";
            clearSkip();
            updateWorkoutProgress();
            schedulePersistActiveWorkout();
          });
        });
        doneButton?.addEventListener("click", () => {
          set.touched = !set.touched;
          row.classList.toggle("touched", set.touched);
          doneButton.classList.toggle("done", set.touched);
          doneButton.textContent = set.touched ? "✓" : "○";
          clearSkip();
          updateWorkoutProgress();
          schedulePersistActiveWorkout();
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
          clearSkip();
          updateWorkoutProgress();
          schedulePersistActiveWorkout();
        });
      }
    });

    const workingLoadInput = body.querySelector(".wex-working-load-input");
    if (workingLoadInput) {
      const applyWorkingWeight = (value) => {
        const next = Number.isFinite(value) && value > 0 ? value : null;
        log.workingWeight = next;
        workingLoadInput.value = next ?? "";
        log.sets.forEach((set, index) => {
          if (set.touched) return;
          set.weight = next;
          const label = body.querySelector(`.wex-set-row[data-set-index="${index}"] .wex-set-weight`);
          if (label) label.textContent = next == null ? "weight not set" : `${next} lb`;
        });
        clearSkip();
        schedulePersistActiveWorkout();
      };
      workingLoadInput.addEventListener("input", (event) => {
        const value = event.target.value === "" ? null : Number(event.target.value);
        applyWorkingWeight(value);
      });
      body.querySelectorAll(".wex-working-load-controls button").forEach((button) => {
        const delta = Number(button.dataset.delta);
        attachHoldStepper(button, () => applyWorkingWeight(Math.max(0, (log.workingWeight ?? 0) + delta)));
      });
    }

    body.querySelectorAll(".wex-effort-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const value = chip.dataset.effort;
        log.effort = log.effort === value ? null : value;
        body.querySelectorAll(".wex-effort-chip").forEach((c) => {
          c.classList.toggle("selected", c.dataset.effort === log.effort);
        });
        schedulePersistActiveWorkout();
      });
    });

    body.querySelector(".wex-flag-input").addEventListener("input", (e) => {
      log.flag = e.target.value;
      schedulePersistActiveWorkout();
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

    quickDoneBtn.addEventListener("click", () => {
      const current = quickState();
      // none -> done -> skipped -> none. Skipped still marks every set
      // touched (recorded on purpose as "didn't do this"), not untouched
      // (which would just look unrecorded again).
      const next = current === "none" ? "done" : current === "done" ? "skipped" : "none";
      log.skipped = next === "skipped";
      log.sets.forEach((s) => {
        s.touched = next !== "none";
        if (next === "skipped") {
          // An explicit skip always means zero, overriding any target
          // default or prior manual edit — the other two transitions
          // never touch actual for a rep-based set, so a value the
          // athlete already typed in isn't clobbered by a later tap here.
          s.actual = 0;
        } else if (s.target == null) {
          s.actual = next === "done" ? 1 : null;
        }
      });
      syncQuickDoneBtn();
      card.classList.toggle("skipped", next === "skipped");
      body.querySelectorAll(".wex-set-row").forEach((row) => {
        row.classList.toggle("touched", next !== "none");
        const setDone = row.querySelector(".wex-set-done");
        if (setDone) {
          setDone.classList.toggle("done", next !== "none");
          setDone.textContent = next !== "none" ? "✓" : "○";
        }
        const toggleBtn = row.querySelector(".wex-toggle-btn");
        if (toggleBtn) {
          toggleBtn.classList.toggle("done", next !== "none");
          toggleBtn.textContent = next !== "none" ? "✓ Done" : "Mark Done";
        }
        const valueEl = row.querySelector(".wex-mini-value");
        if (valueEl) valueEl.textContent = log.sets[Number(row.dataset.setIndex)].actual;
      });
      updateWorkoutProgress();
      schedulePersistActiveWorkout();
    });

    headRow.appendChild(head);
    headRow.appendChild(quickDoneBtn);
    card.appendChild(headRow);
    card.appendChild(body);
    return card;
  }

  function renderWorkoutExercises() {
    const container = document.getElementById("workout-exercise-list");
    container.innerHTML = "";
    const phases = [];
    activeWorkout.exercises.forEach((exercise) => {
      const phaseName = exercise.phase || "";
      let phase = phases[phases.length - 1];
      if (!phase || phase.name !== phaseName) {
        phase = { name: phaseName, exercises: [] };
        phases.push(phase);
      }
      phase.exercises.push(exercise);
    });

    phases.forEach((phase) => {
      const phaseWrap = document.createElement("section");
      phaseWrap.className = phase.name ? "workout-phase" : "workout-phase workout-phase-plain";
      if (phase.name) phaseWrap.innerHTML = `<h3 class="workout-phase-title">${escapeHtml(phase.name)}</h3>`;
      groupExercisesForDisplay(phase.exercises).forEach((group) => {
        if (group.items.length > 1) {
          const wrap = document.createElement("div");
          wrap.className = "superset-group";
          wrap.innerHTML = `<span class="superset-label">${escapeHtml(getWorkoutGroupLabel(group, phase.name))}</span>`;
          group.items.forEach((ex) => wrap.appendChild(renderExerciseCard(ex)));
          phaseWrap.appendChild(wrap);
        } else {
          phaseWrap.appendChild(renderExerciseCard(group.items[0]));
        }
      });
      container.appendChild(phaseWrap);
    });
    updateWorkoutProgress();
  }

  // Compiles whatever the athlete actually logged (touched sets, flags) into
  // a compact free-text summary — feeds straight into the persistent notes
  // log so future AI recommendations can reference it. Empty if they
  // engaged with none of it, since feedback here is entirely optional.
  const EFFORT_LABEL = { easy: "felt easy", right: "felt just right", hard: "felt hard" };

  // Called once, right when the athlete hits Finish: any set they never
  // touched (no rep/weight adjustment, no quick-done tap) gets marked done
  // at its planned value. Every other capture control here is opt-out, not
  // opt-in, for exactly this reason — requiring a tap on every single set
  // just to log "went as planned" meant real sessions were finishing with
  // an empty performance record. Live in-workout styling reads .touched
  // too, but this only runs at Finish, after that UI is torn down.
  function autoConfirmRemainingSets(logs) {
    Object.values(logs).forEach((log) => {
      log.sets.forEach((s) => {
        if (s.touched) return;
        s.touched = true;
        if (s.target == null) s.actual = 1;
      });
    });
  }

  function summarizeWorkoutLog(logs) {
    const lines = [];
    Object.entries(logs).forEach(([name, log]) => {
      const exerciseParts = [];
      if (log.skipped) {
        exerciseParts.push("skipped");
      } else {
        const touchedSets = log.sets.filter((s) => s.touched);
        if (touchedSets.length > 0) {
          exerciseParts.push(
            touchedSets
              .map((s) => {
                const reps = s.target != null ? `${s.actual}/${s.target}` : s.actual ? "done" : "not done";
                return s.weight != null ? `${s.weight}lb×${reps}` : reps;
              })
              .join(", ")
          );
        }
      }
      if (log.effort && EFFORT_LABEL[log.effort]) exerciseParts.push(EFFORT_LABEL[log.effort]);
      if (exerciseParts.length > 0) lines.push(`${name}: ${exerciseParts.join(", ")}`);
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
      if (log.sets.some((s) => s.touched) || log.effort || log.skipped) {
        performance[name] = {
          sets: log.sets.map((s) => ({ target: s.target, actual: s.actual, weight: s.weight })),
          effort: log.effort || null,
          skipped: Boolean(log.skipped),
        };
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
    persistActiveWorkout();
    renderActiveWorkoutScreen();
  }

  // Draws workout-screen from whatever's already in activeWorkout — shared
  // by starting a fresh workout (showWorkout, above) and resuming one
  // restored from storage on login, which never re-initializes activeWorkout
  // itself since that would wipe the sets already logged.
  function renderActiveWorkoutScreen() {
    showScreen("workout-screen");
    renderWorkoutHeader(activeWorkout.sessionSplitKey);
    renderWarmup(activeWorkout.sessionSplitKey);
    renderWorkoutExercises();
  }

  function initWorkoutScreen() {
    document.getElementById("workout-switch").addEventListener("click", () => {
      activeWorkout = null;
      persistActiveWorkout();
      showLogin();
    });

    document.getElementById("workout-abandon").addEventListener("click", () => {
      activeWorkout = null;
      persistActiveWorkout();
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
      persistActiveWorkout();
      renderWorkoutExercises();
      btn.disabled = false;
    });

    document.getElementById("finish-workout-btn").addEventListener("click", () => {
      if (!activeWorkout) return;
      autoConfirmRemainingSets(activeWorkout.logs);
      const summary = summarizeWorkoutLog(activeWorkout.logs);
      const combinedNote = [checkInState.note?.trim(), summary].filter(Boolean).join(" | ") || null;

      logSession(currentUser, activeWorkout.sessionSplitKey, {
        ...checkInState,
        exercises: activeWorkout.exercises.map(({ name, detail, tip, howTo, superset, phase }) => ({ name, detail, tip, howTo, superset, phase })),
        reason: activeWorkout.reason,
        source: activeWorkout.source,
        note: combinedNote,
        performance: extractPerformance(activeWorkout.logs),
      });

      if (summary) logNote(currentUser, summary);

      activeWorkout = null;
      persistActiveWorkout();
      // Clears the just-finished split's selection so renderSessionScreen's
      // done check (loggedToday && !selectedSplitKey) correctly shows the
      // completed-session card immediately, instead of still treating this
      // as an in-progress preview of the split that was just logged.
      selectedSplitKey = null;
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
    checkInState = { minutes: 30, energy: "medium", partner: false, note: "", weightOverrides: {}, weightDirection: null, finisherOverride: null };
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
  const COACH_SCREEN_CONTEXT = {
    checkin: { label: "OPEN CONVERSATION · TELL ME WHAT MATTERS TODAY", prompt: "Ask your coach anything…", suggestions: ["Low energy today", "I have 30 minutes", "No machines available"] },
    select: { label: "LIVE RECOMMENDATION · YOUR NOTES UPDATE THE PLAN", prompt: "Change focus, time, or equipment…", suggestions: ["Focus on quads", "Make it shorter", "Bodyweight only"] },
    preview: { label: "WORKOUT DRAFT · REVIEW BEFORE YOU START", prompt: "Ask for a change to this workout…", suggestions: ["Swap an exercise", "Use fewer exercises", "Change the equipment"] },
  };

  function updateCoachContext(target) {
    const context = COACH_SCREEN_CONTEXT[target] || COACH_SCREEN_CONTEXT.checkin;
    coachContextTarget = target;
    document.getElementById("chat-context").textContent = context.label;
    document.getElementById("chat-input").placeholder = context.prompt;
    document.getElementById("chat-quick-actions").innerHTML = context.suggestions
      .map((suggestion) => `<button type="button" data-prompt="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`)
      .join("");
  }

  function placeTerminalPanel(target) {
    const panel = document.getElementById("terminal-panel");
    const slotId = target === "select" ? "select-chat-slot" : target === "preview" ? "preview-chat-slot" : "checkin-chat-slot";
    const slot = document.getElementById(slotId);
    if (panel && slot) slot.appendChild(panel);
    const changed = coachContextTarget !== target;
    if (panel && changed) {
      const collapsed = target === "preview";
      panel.classList.toggle("collapsed", collapsed);
      const toggle = document.getElementById("chat-panel-toggle");
      toggle.textContent = collapsed ? "Open" : "Hide";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    }
    updateCoachContext(target);
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
    coachContextTarget = null;
    renderChatThread();
    updateCoachContext("checkin");
    setChatBusy(false);
    upgradeCoachOpening(user);
  }

  let chatOpeningRequestId = 0;

  // The local greeting above matches against a fixed ~9-keyword topic list
  // and otherwise just quotes the last note back with the same trailing
  // question every time — it renders instantly (and works offline), but it
  // isn't actually intelligent. This swaps it for one the AI wrote after
  // reading the real recent notes, once it lands.
  async function upgradeCoachOpening(user) {
    if (!AI_ENDPOINT) return;
    const requestId = ++chatOpeningRequestId;
    try {
      const persona = getPersonaProfile(user);
      const recentNotes = getPastNotes(user, 5).map((n) => ({ date: n.date, text: n.text }));
      const res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "opening",
          persona: {
            name: persona.name,
            goal: persona.goal,
            heightIn: persona.heightIn,
            weightLb: persona.weightLb,
            focusAreas: persona.focusAreas,
          },
          recentNotes,
          lastGreeting: persona.lastGreetingText,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.greeting !== "string" || !data.greeting.trim()) return;
      // A newer reset (switched users, or came back to check-in again)
      // already superseded this request — drop it.
      if (requestId !== chatOpeningRequestId) return;
      const greeting = data.greeting.trim();
      // Patch just the opening slot rather than replacing the whole thread,
      // in case the athlete already started typing while this was in flight.
      if (chatMessages[0]?.role === "coach") {
        chatMessages[0] = { role: "coach", text: greeting };
        renderChatThread();
      }
      saveProfile(user, { ...getPersonaProfile(user), lastGreetingText: greeting });
    } catch {
      // offline or timed out — the local greeting already rendered, that's fine
    }
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
      inferSplitFromChat(value, currentUser) ||
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
    const inferredSplit = inferSplitFromChat(text, currentUser);
    const localSuggestedSplit = inferredSplit && isWorkoutAllowedForCheckIn(inferredSplit) ? inferredSplit : null;
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
    const finisherRequest = detectFinisherRequest(text);
    if (finisherRequest) {
      checkInState.finisherOverride = finisherRequest;
      localAcks.push(`closing with a ${SPLIT_LIBRARY[finisherRequest].name} finisher`);
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
            libraryContext: getLibraryContext(text),
            libraryRoutines: getLibraryRoutinesContext(),
            context: {
              screen: coachContextTarget || "checkin",
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
          const suggestedIsValid =
            (SPLIT_ORDER.includes(data.suggestedSplit) ||
              SPECIAL_WORKOUTS[data.suggestedSplit]?.user === currentUser) &&
            isWorkoutAllowedForCheckIn(data.suggestedSplit);
          if (!localSuggestedSplit && suggestedIsValid) {
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
    document.getElementById("chat-quick-actions").addEventListener("click", (e) => {
      const suggestion = e.target.closest("button[data-prompt]");
      if (!suggestion || chatBusy) return;
      const input = document.getElementById("chat-input");
      input.value = suggestion.dataset.prompt;
      updateChatCursor();
      sendChatMessage();
    });
    document.getElementById("chat-panel-toggle").addEventListener("click", () => {
      const panel = document.getElementById("terminal-panel");
      const collapsed = panel.classList.toggle("collapsed");
      const toggle = document.getElementById("chat-panel-toggle");
      toggle.textContent = collapsed ? "Open" : "Hide";
      toggle.setAttribute("aria-expanded", String(!collapsed));
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
    document.getElementById("hub-trainer-btn").addEventListener("click", () => showTrainer());
    document.getElementById("hub-cheer-btn").addEventListener("click", () => showCheerModal(currentUser));
    document.getElementById("hub-library-btn").addEventListener("click", () => showLibrary(currentUser));
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

    list.innerHTML = groupExercisesForDisplay(exercises)
      .map((group) => {
        const label = group.items.length > 1
          ? `<li class="rec-superset-label">SUPERSET ${escapeHtml(group.superset || "")} · PUSH / PULL</li>`
          : "";
        const rows = group.items
          .map((exercise) => `<li><span>${escapeHtml(exercise.name)}</span><strong>${escapeHtml(exercise.detail)}</strong></li>`)
          .join("");
        return label + rows;
      })
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

  function openSpecialWorkoutPreview(user, splitKey) {
    const preset = SPECIAL_WORKOUTS[splitKey];
    if (!preset || preset.user !== user) return;
    if (preset.defaultCheckIn?.partner && !checkInState.partner) return;
    // Presets set their own realistic check-in defaults (Jessica's game-day
    // core session is a short partner workout; Shortcut to Shred is a long
    // solo one) — falls back to the original jess-game-day-core defaults
    // for any preset that doesn't specify its own.
    checkInState = { ...checkInState, ...(preset.defaultCheckIn || { minutes: 30, energy: "medium", partner: true }) };
    chatSuggestedSplit = null;
    selectedSplitKey = splitKey;
    previewPlan = {
      exercises: buildCandidatePool(user, splitKey, checkInState).map((exercise) => ({ ...exercise, splitKey })),
      reason: preset.reason,
      source: "preset",
      suggestedWeights: new Map(),
    };
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
    const allowedSuggestedSplit = chatSuggestedSplit && isWorkoutAllowedForCheckIn(chatSuggestedSplit)
      ? chatSuggestedSplit
      : null;
    if (chatSuggestedSplit && !allowedSuggestedSplit) chatSuggestedSplit = null;
    const rec = allowedSuggestedSplit
      ? { key: chatSuggestedSplit, reason: "Based on what you told your coach — let's do it." }
      : recommendSplit(history, checkInState);
    const recMeta = getSplitMeta(rec.key);

    document.getElementById("rec-icon").textContent = recMeta.icon;
    document.getElementById("rec-name").textContent = recMeta.name;
    document.getElementById("rec-tagline").textContent = recMeta.tagline;
    document.getElementById("rec-reason").textContent = rec.reason;
    // A chat-suggested rec.key can now be a persona preset (e.g.
    // "jess-game-day-core"), not just one of the four generic splits —
    // buildWorkoutPlan only knows the generic SPLIT_LIBRARY ones, so mirror
    // computePlan's branch here for the immediate synchronous draft too.
    const localExercises = SPECIAL_WORKOUTS[rec.key]
      ? applyCoachFocus(user, rec.key, buildCandidatePool(user, rec.key, checkInState), checkInState.note, checkInState)
      : enforcePlanConstraints(
          user,
          rec.key,
          applyCoachFocus(user, rec.key, buildWorkoutPlan(user, rec.key, checkInState), checkInState.note, checkInState),
          checkInState
        );
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

    renderMoreWorkoutsList(user);
  }

  // A single browsable list of every other way to start a workout today —
  // this persona's special programs (each Shortcut to Shred day individually,
  // not just whichever one is "next") plus anything saved to the shared
  // library — sitting alongside the coach's recommendation rather than
  // auto-picking one via a single dedicated button.
  function renderMoreWorkoutsList(user) {
    const list = document.getElementById("more-workouts-list");
    const empty = document.getElementById("more-workouts-empty");
    if (!list) return;

    const nextKey = user === "jake" ? nextShortcutToShredKey(user) : null;
    const presetEntries = Object.entries(SPECIAL_WORKOUTS).filter(([, preset]) => {
      if (preset.user !== user) return false;
      return checkInState.partner || !preset.defaultCheckIn?.partner;
    });
    const routines = loadLibrary().routines.filter((routine) => checkInState.partner || !routine.exercises.some(isPartnerExercise));

    // Same-program entries (Shortcut to Shred's 6 days) collapse into one
    // compact row with a day picker instead of a full-detail row repeated
    // per day — a 6-day program shouldn't take 6x the scroll of everything
    // else in this list. A preset with no "program" field (Jessica's
    // game-day workout) is its own group of one and keeps the full row.
    const groups = new Map();
    presetEntries.forEach(([key, preset]) => {
      const groupId = preset.program || key;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push({ key, preset });
    });

    const presetHtml = Array.from(groups.values())
      .map((entries) => {
        if (entries.length === 1) {
          const { key, preset } = entries[0];
          return `
        <li class="library-item more-workout-item" data-kind="preset" data-key="${escapeHtml(key)}">
          <div class="library-item-info">
            <span class="library-item-title">${preset.icon} ${escapeHtml(preset.name)}</span>
            <span class="library-item-meta">${escapeHtml(preset.tagline)}</span>
          </div>
          <span class="library-item-start">▶</span>
        </li>
      `;
        }
        entries.sort((a, b) => (a.preset.dayNumber || 0) - (b.preset.dayNumber || 0));
        const { preset: first } = entries[0];
        const dayChips = entries
          .map(
            ({ key, preset }) => `
          <button type="button" class="day-chip more-workout-item${key === nextKey ? " is-next" : ""}" data-kind="preset" data-key="${escapeHtml(key)}">
            Day ${preset.dayNumber}
          </button>
        `
          )
          .join("");
        return `
      <li class="library-item more-workout-program">
        <div class="library-item-info">
          <span class="library-item-title">${first.icon} ${escapeHtml(first.programLabel || first.name)}</span>
          <span class="library-item-meta">${entries.length}-day rotation · tap a day to start${nextKey && entries.some((e) => e.key === nextKey) ? " (next up highlighted)" : ""}</span>
          <div class="day-chip-row">${dayChips}</div>
        </div>
      </li>
    `;
      })
      .join("");

    const routineHtml = routines
      .map(
        (r) => `
      <li class="library-item more-workout-item" data-kind="routine" data-id="${escapeHtml(r.id)}">
        <div class="library-item-info">
          <span class="library-item-title">💪 ${escapeHtml(r.name)}</span>
          <span class="library-item-meta">${r.exercises.length} exercise${r.exercises.length === 1 ? "" : "s"} · your saved workout</span>
        </div>
        <span class="library-item-start">▶</span>
      </li>
    `
      )
      .join("");

    list.innerHTML = presetHtml + routineHtml;
    if (empty) empty.classList.toggle("hidden", presetEntries.length + routines.length > 0);
  }

  function initSelectScreen() {
    document.getElementById("select-switch").addEventListener("click", showLogin);
    document.getElementById("custom-workout-btn").addEventListener("click", () => showCustom(currentUser));
    document.getElementById("back-to-options").addEventListener("click", () => showSelect(currentUser));
    document.getElementById("session-done-home-btn").addEventListener("click", () => showHome());
    document.getElementById("edit-preview-btn").addEventListener("click", () => {
      if (previewPlan) showCustom(currentUser, previewPlan.exercises);
    });
    const saveBtn = document.getElementById("save-workout-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (!previewPlan || previewPlan.exercises.length === 0) return;
        const name = window.prompt("Name this workout to save it to your library:", getSplitMeta(selectedSplitKey)?.name || "My Workout");
        if (!name || !name.trim()) return;
        saveWorkoutToLibrary(name.trim().slice(0, 60), selectedSplitKey, previewPlan.exercises);
        saveBtn.textContent = "💾 Saved!";
        setTimeout(() => {
          saveBtn.textContent = "💾 Save this workout to your library";
        }, 1800);
      });
    }

    document.getElementById("more-workouts-list")?.addEventListener("click", (e) => {
      const item = e.target.closest(".more-workout-item");
      if (!item) return;
      if (item.dataset.kind === "preset") {
        openSpecialWorkoutPreview(currentUser, item.dataset.key);
      } else {
        const routine = loadLibrary().routines.find((r) => r.id === item.dataset.id);
        if (routine) startSavedRoutine(currentUser, routine);
      }
    });
  }

  // ---------- rendering: custom builder screen ----------

  function renderCustomScreen(user, seedExercises = []) {
    customSelection = new Map();
    const seededNames = new Set(seedExercises.map((exercise) => exercise.name));
    const standardNames = new Set(SPLIT_ORDER.flatMap((key) => SPLIT_LIBRARY[key].exercises[user].map((exercise) => exercise.name)));
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

    const presetOnly = seedExercises.filter((exercise) => !standardNames.has(exercise.name));
    if (presetOnly.length > 0) {
      const group = document.createElement("div");
      group.className = "custom-group";
      group.innerHTML = '<span class="custom-group-heading">🏀 Current Preset Exercises</span>';
      const list = document.createElement("div");
      list.className = "custom-ex-list";
      presetOnly.forEach((exercise, index) => {
        const id = `preset:${index}`;
        customSelection.set(id, { ...exercise });
        const row = document.createElement("label");
        row.className = "custom-ex-row";
        row.innerHTML = `
          <input type="checkbox" checked data-id="${id}" data-name="${escapeHtml(exercise.name)}" data-detail="${escapeHtml(exercise.detail)}"
                 data-split="${escapeHtml(exercise.splitKey || "custom")}" data-tip="${escapeHtml(exercise.tip || "")}" data-how-to="${escapeHtml(exercise.howTo || "")}" data-superset="${escapeHtml(exercise.superset || "")}" data-phase="${escapeHtml(exercise.phase || "")}" />
          <span class="custom-ex-name">${escapeHtml(exercise.name)}</span>
          <span class="custom-ex-detail">${escapeHtml(exercise.detail)}</span>
        `;
        list.appendChild(row);
      });
      group.appendChild(list);
      container.prepend(group);
    }

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
      const { id, name, detail, split, tip, superset, phase, howTo } = input.dataset;
      if (input.checked) {
        customSelection.set(id, {
          name,
          detail,
          splitKey: split,
          tip: tip || undefined,
          howTo: howTo || undefined,
          superset: superset || undefined,
          phase: phase || undefined,
        });
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
    // Landing on the hub means no split is actively being previewed —
    // clears any leftover selection so a later, unrelated visit to
    // session-screen can't misread it as "still previewing this."
    selectedSplitKey = null;
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
      loadActiveWorkout(user);
      await Promise.all([pullFromCloud(user), pullLibraryFromCloud()]);
      // A workout still in progress (reload, backgrounded PWA, closed tab
      // mid-set) always wins — resuming exactly where it left off beats
      // routing through the hub and making them notice/tap "Resume Workout."
      if (activeWorkout) {
        renderActiveWorkoutScreen();
        return;
      }
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

  // ---------- master trainer screen ----------
  // A single view across BOTH athletes — not scoped to whoever is currently
  // logged in — so a shared trainer/partner can see what each of them
  // actually did, what they told the coach, and what's worth adjusting,
  // without switching accounts back and forth. Reads only what's already
  // captured (history, performance, notes) — no new data collection.

  const SORENESS_PATTERN = /\b(sore|soreness|pain|hurt|injury|tight|ache)\b/i;
  const SESSION_RATING_ICON = { rough: "😞", solid: "🙂", great: "🔥" };
  const SESSION_REC_ICON = { up: "👍", down: "👎" };

  function daysSince(dateStr) {
    const then = new Date(dateStr).getTime();
    if (!Number.isFinite(then)) return null;
    return Math.max(0, Math.round((Date.now() - then) / 86400000));
  }

  // Cheap heuristics over data the app already has — a starting point for
  // "how do we fine-tune this for them," not a diagnosis. Each one names a
  // concrete number or quote so it's checkable, not just a vibe.
  function computeTrainerInsights(user) {
    const history = getHistory(user);
    const notes = getNotes(user);
    const insights = [];

    if (history.length === 0) {
      insights.push("🎬 No sessions logged yet.");
      return insights;
    }

    const gap = daysSince(history[history.length - 1].date);
    if (gap != null && gap >= 3) {
      insights.push(`⏸ No session logged in ${gap} days — worth a check-in.`);
    }

    const effortCounts = { easy: 0, right: 0, hard: 0 };
    history.slice(-10).forEach((entry) => {
      Object.values(entry.performance || {}).forEach((perf) => {
        if (perf.effort && effortCounts[perf.effort] != null) effortCounts[perf.effort]++;
      });
    });
    const totalEffort = effortCounts.easy + effortCounts.right + effortCounts.hard;
    if (totalEffort >= 3 && effortCounts.easy / totalEffort > 0.5) {
      insights.push(`📈 Rating sessions "Easy" often lately (${effortCounts.easy}/${totalEffort} tagged) — may be ready to progress weight or reps.`);
    } else if (totalEffort >= 3 && effortCounts.hard / totalEffort > 0.4) {
      insights.push(`⚠️ Rating sessions "Hard" often lately (${effortCounts.hard}/${totalEffort} tagged) — consider easing volume or adding rest.`);
    } else if (totalEffort === 0) {
      insights.push("📭 No effort feedback tagged yet — the Easy / Just Right / Hard chips mid-workout build this signal over time.");
    }

    const recentSoreness = notes.slice(-10).filter((n) => SORENESS_PATTERN.test(n.text));
    if (recentSoreness.length > 0) {
      const latest = recentSoreness[recentSoreness.length - 1];
      insights.push(`🩹 Recent mention: "${latest.text}" (${formatShortDate(latest.date)}) — worth following up before pushing that area.`);
    }

    const recent10 = history.slice(-10);
    const roughCount = recent10.filter((e) => e.overallRating === "rough").length;
    if (roughCount >= 2) {
      insights.push(`😞 Rated "Rough" ${roughCount} of the last ${recent10.length} sessions — worth checking what's making it hard.`);
    }

    const recDownCount = recent10.filter((e) => e.recFeedback === "down").length;
    if (recDownCount >= 2) {
      insights.push(`👎 Said "not really" to the workout choice ${recDownCount} of the last ${recent10.length} times — the recommendation isn't landing.`);
    }

    const skippedCount = recent10.reduce(
      (sum, e) => sum + Object.values(e.performance || {}).filter((p) => p.skipped).length,
      0
    );
    if (skippedCount > 0) {
      insights.push(`⏭ ${skippedCount} exercise${skippedCount === 1 ? "" : "s"} marked skipped in the last ${recent10.length} sessions.`);
    }

    if (insights.length === 0) {
      insights.push("✅ Nothing flagged — logging consistently with balanced effort feedback.");
    }
    return insights;
  }

  function renderTrainerPersonaSection(user) {
    const persona = getPersonaProfile(user);
    const history = getHistory(user);
    const notes = getNotes(user);
    const streak = currentStreak(history);
    const insights = computeTrainerInsights(user);

    const sessionsHtml =
      [...history]
        .reverse()
        .slice(0, 8)
        .map((entry) => {
          const meta = getSplitMeta(entry.splitKey);
          const badges = [
            entry.minutes ? `${entry.minutes} min · ${ENERGY_LABEL[entry.energy]}${entry.partner ? " · w/ partner" : ""}` : "",
            SESSION_RATING_ICON[entry.overallRating] ? `${SESSION_RATING_ICON[entry.overallRating]} ${entry.overallRating}` : "",
            SESSION_REC_ICON[entry.recFeedback] ? `${SESSION_REC_ICON[entry.recFeedback]} workout fit` : "",
          ].filter(Boolean).join(" · ");
          return `
        <li class="trainer-session">
          <div class="trainer-session-head">
            <span>${meta.icon} ${escapeHtml(meta.name)}</span>
            <span class="trainer-session-date">${formatShortDate(entry.date)}</span>
          </div>
          ${badges ? `<span class="trainer-session-meta">${escapeHtml(badges)}</span>` : ""}
          ${entry.note ? `<p class="trainer-session-note">${escapeHtml(entry.note)}</p>` : ""}
        </li>
      `;
        })
        .join("") || `<li class="empty-note">No sessions logged yet.</li>`;

    const notesHtml =
      [...notes]
        .reverse()
        .slice(0, 6)
        .map((n) => `<li class="trainer-note-row"><span class="trainer-note-date">${formatShortDate(n.date)}</span><span>${escapeHtml(n.text)}</span></li>`)
        .join("") || `<li class="empty-note">No feedback captured yet.</li>`;

    const insightsHtml = insights.map((line) => `<li>${escapeHtml(line)}</li>`).join("");

    return `
      <section class="trainer-persona" style="--accent:${persona.accent}">
        <div class="trainer-persona-head">
          <span class="trainer-avatar">${escapeHtml(persona.name[0])}</span>
          <div class="trainer-persona-copy">
            <span class="trainer-persona-name">${escapeHtml(persona.name)}</span>
            <span class="trainer-persona-goal">🎯 ${escapeHtml(persona.goal)}</span>
          </div>
        </div>
        <div class="recap-stats">
          <span class="recap-stat">📈 ${history.length} session${history.length === 1 ? "" : "s"}</span>
          <span class="recap-stat">🔥 ${streak} day streak</span>
          <span class="recap-stat">${loggedToday(history) ? "✅ Logged today" : "⏳ Not logged today"}</span>
        </div>
        <div class="trainer-block">
          <span class="trainer-block-title">Coaching Signals</span>
          <ul class="trainer-insights-list">${insightsHtml}</ul>
        </div>
        <div class="trainer-block">
          <span class="trainer-block-title">Recent Feedback</span>
          <ul class="trainer-notes-list">${notesHtml}</ul>
        </div>
        <div class="trainer-block">
          <span class="trainer-block-title">Recent Sessions</span>
          <ul class="trainer-sessions-list">${sessionsHtml}</ul>
        </div>
      </section>
    `;
  }

  function renderTrainerScreen() {
    document.getElementById("trainer-content").innerHTML = Object.keys(PERSONAS)
      .map((user) => renderTrainerPersonaSection(user))
      .join("");
  }

  function showTrainer() {
    showScreen("trainer-screen");
    renderTrainerScreen();
  }

  function initTrainerScreen() {
    document.getElementById("trainer-back").addEventListener("click", () => {
      if (currentUser) returnToCheckIn(currentUser);
      else showLogin();
    });
  }

  // ---------- exercise library screen ----------

  function renderLibraryList() {
    const docList = document.getElementById("library-list");
    const docEmpty = document.getElementById("library-empty");
    const { docs, routines } = loadLibrary();

    docList.innerHTML = docs
      .map(
        (doc) => `
      <li class="library-item">
        <div class="library-item-info library-doc-open" data-id="${escapeHtml(doc.id)}" role="button" tabindex="0" title="View this workout">
          <span class="library-item-title">📄 ${escapeHtml(doc.title)}</span>
          <span class="library-item-meta">
            ${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"} · added ${formatShortDate(doc.addedAt)}
            <span class="library-tag-chip">PDF</span>
            ${doc.parsedWorkouts ? `<span class="library-tag-chip library-tag-parsed">VIEW WORKOUT ›</span>` : ""}
          </span>
        </div>
        <button type="button" class="library-item-rename" data-id="${escapeHtml(doc.id)}" title="Rename">✏️</button>
        <button type="button" class="library-item-remove" data-id="${escapeHtml(doc.id)}" title="Remove">✕</button>
      </li>
    `
      )
      .join("");
    docEmpty.classList.toggle("hidden", docs.length > 0);

    const routineList = document.getElementById("library-routines-list");
    const routineEmpty = document.getElementById("library-routines-empty");
    if (routineList) {
      routineList.innerHTML = routines
        .map(
          (r) => `
        <li class="library-item">
          <div class="library-item-info">
            <span class="library-item-title">💪 ${escapeHtml(r.name)}</span>
            <span class="library-item-meta">
              ${r.exercises.length} exercise${r.exercises.length === 1 ? "" : "s"} · added ${formatShortDate(r.addedAt)}
            </span>
          </div>
          <button type="button" class="library-item-start" data-id="${escapeHtml(r.id)}" title="Start this workout">▶</button>
          <button type="button" class="library-item-remove" data-id="${escapeHtml(r.id)}" title="Remove">✕</button>
        </li>
      `
        )
        .join("");
      routineEmpty.classList.toggle("hidden", routines.length > 0);
    }
  }

  function showLibrary(user) {
    currentUser = user;
    showScreen("library-screen");
    renderLibraryList();
  }

  // Sends an uploaded doc's raw extracted text to the AI to turn into the
  // app's own exercise shape (name/detail/howTo/tip, grouped into named
  // workout days) — the same structure every other workout in the app
  // uses, so the result renders with the exact same components instead of
  // being a wall of PDF text. Cached onto the doc so this only runs once
  // per upload, not every time the athlete opens it.
  async function parseLibraryDocument(doc) {
    if (!AI_ENDPOINT) return { error: "offline" };
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "parseLibraryDoc", title: doc.title, text: doc.text }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS * 2),
      });
      if (!res.ok) return { error: "request-failed" };
      const data = await res.json();
      if (typeof data.summary !== "string" || !Array.isArray(data.workouts)) return { error: "malformed" };

      const library = loadLibrary();
      const freshDoc = library.docs.find((d) => d.id === doc.id);
      if (freshDoc) {
        freshDoc.summary = data.summary;
        freshDoc.parsedWorkouts = data.workouts;
        saveLibrary(library);
        pushLibraryToCloud();
      }
      return { summary: data.summary, workouts: data.workouts };
    } catch {
      return { error: "request-failed" };
    }
  }

  // Jumps straight into the session screen with one of a parsed library
  // doc's workouts — same shortcut saved routines and SPECIAL_WORKOUTS
  // presets use, just sourced from an uploaded PDF instead.
  function startLibraryDocWorkout(user, docTitle, workout) {
    currentUser = user;
    checkInState = { ...checkInState, minutes: 30, energy: "medium", partner: false };
    chatSuggestedSplit = null;
    selectedSplitKey = "custom";
    previewPlan = {
      exercises: workout.exercises.map((ex) => ({ ...ex, splitKey: "custom" })),
      reason: `From your uploaded "${docTitle}": ${workout.name}.`,
      source: "preset",
      suggestedWeights: new Map(),
    };
    showScreen("session-screen");
    renderSessionFull(user);
  }

  function renderLibraryDocBody(doc, state) {
    const container = document.getElementById("library-doc-body");
    if (state === "loading") {
      container.innerHTML = `<p class="panel-subtext">🤖 Reading through "${escapeHtml(doc.title)}" and pulling out the actual workout…</p>`;
      return;
    }
    if (state === "offline") {
      container.innerHTML = `<p class="panel-subtext">This needs the AI coach to read the document, which isn't reachable right now. The raw text is still being referenced in chat and workout planning — try viewing this again later.</p>`;
      return;
    }
    if (state === "error") {
      container.innerHTML = `
        <p class="panel-subtext">Couldn't parse this one right now.</p>
        <button type="button" id="library-doc-retry" class="ghost-btn">Try Again</button>
      `;
      document.getElementById("library-doc-retry").addEventListener("click", () => showLibraryDoc(doc, true));
      return;
    }

    const workouts = doc.parsedWorkouts || [];
    if (workouts.length === 0) {
      container.innerHTML = `
        <p class="panel-subtext">${escapeHtml(doc.summary || "No structured workout was found in this document.")}</p>
      `;
      return;
    }

    container.innerHTML = `
      <p class="panel-subtext">${escapeHtml(doc.summary || "")}</p>
      ${workouts
        .map(
          (workout, wIdx) => `
        <div class="library-doc-workout">
          <div class="library-doc-workout-head">
            <span class="library-doc-workout-name">${escapeHtml(workout.name)}</span>
            <button type="button" class="ghost-btn library-doc-start-btn" data-workout-index="${wIdx}">▶ Start This Workout</button>
          </div>
          <ul class="session-exercises">
            ${workout.exercises
              .map((ex) => `<li><span>${escapeHtml(ex.name)}</span><span class="ex-detail">${escapeHtml(ex.detail)}</span></li>`)
              .join("")}
          </ul>
        </div>
      `
        )
        .join("")}
    `;

    container.querySelectorAll(".library-doc-start-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const workout = workouts[Number(btn.dataset.workoutIndex)];
        startLibraryDocWorkout(currentUser, doc.title, workout);
      });
    });
  }

  async function showLibraryDoc(doc, forceReparse = false) {
    const screenEl = document.getElementById("library-doc-screen");
    showScreen("library-doc-screen");
    document.getElementById("library-doc-title").textContent = doc.title;
    screenEl.dataset.docId = doc.id;

    if (doc.parsedWorkouts && !forceReparse) {
      renderLibraryDocBody(doc, "ready");
      return;
    }
    if (!AI_ENDPOINT) {
      renderLibraryDocBody(doc, "offline");
      return;
    }

    renderLibraryDocBody(doc, "loading");
    const result = await parseLibraryDocument(doc);
    // The athlete may have navigated to a different screen, or a different
    // library doc, while this was in flight.
    if (screenEl.classList.contains("hidden") || screenEl.dataset.docId !== doc.id) return;

    if (result.error) {
      renderLibraryDocBody(doc, "error");
      return;
    }
    renderLibraryDocBody({ ...doc, summary: result.summary, parsedWorkouts: result.workouts }, "ready");
  }

  // Jumps straight into the session screen with a saved routine's exercises
  // — same shortcut SPECIAL_WORKOUTS presets use, just sourced from the
  // athlete's own saved library instead of a hardcoded program.
  function startSavedRoutine(user, routine) {
    currentUser = user;
    checkInState = { ...checkInState, minutes: 30, energy: "medium", partner: false };
    chatSuggestedSplit = null;
    selectedSplitKey = routine.splitKey || "custom";
    previewPlan = {
      exercises: routine.exercises.map((ex) => ({ ...ex, splitKey: selectedSplitKey })),
      reason: `Your saved workout: ${routine.name}.`,
      source: "preset",
      suggestedWeights: new Map(),
    };
    showScreen("session-screen");
    renderSessionFull(user);
  }

  // Uploaded filenames are often export/download garbage — a CMS
  // timestamp, an underscore-joined slug — rather than something a human
  // named, e.g. "2018020221190401_arnoldblueprint_mass_phase_1.pdf". This
  // strips the leading ID, turns separators into spaces, and title-cases
  // what's left. It can't recover word boundaries inside a squashed word
  // like "arnoldblueprint" (no dictionary to split on), so it's a best
  // guess — the rename control next to each title is the real fix for
  // whatever this doesn't get right.
  function cleanUploadedTitle(filename) {
    let name = filename.replace(/\.pdf$/i, "");
    name = name.replace(/^\d{4,}[-_\s]*/, "");
    name = name.replace(/[_\-.]+/g, " ").trim().replace(/\s+/g, " ");
    if (!name) return filename.replace(/\.pdf$/i, "");
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Swaps a library item's title for an inline input so a bad auto-cleaned
  // name (or any name) can be fixed by hand — the auto-cleanup can't
  // recover word boundaries lost inside a squashed filename, so this is
  // the actual fix for whatever it guesses wrong.
  function startRenameLibraryDoc(id) {
    const item = Array.from(document.querySelectorAll(".library-item-rename")).find((b) => b.dataset.id === id)?.closest(".library-item");
    const titleEl = item?.querySelector(".library-item-title");
    const doc = loadLibrary().docs.find((d) => d.id === id);
    if (!item || !titleEl || !doc) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "library-item-rename-input";
    input.value = doc.title;
    input.maxLength = 80;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (value && value !== doc.title) {
        const fresh = loadLibrary();
        const freshDoc = fresh.docs.find((d) => d.id === id);
        if (freshDoc) {
          freshDoc.title = value.slice(0, 80);
          saveLibrary(fresh);
          pushLibraryToCloud();
        }
      }
      renderLibraryList();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = doc.title;
        input.blur();
      }
    });
  }

  function initLibrary() {
    document.getElementById("library-back").addEventListener("click", () => returnToCheckIn(currentUser));
    document.getElementById("library-doc-back").addEventListener("click", () => showLibrary(currentUser));

    const fileInput = document.getElementById("library-file-input");
    const status = document.getElementById("library-status");
    document.getElementById("library-upload-btn").addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = "";
      if (files.length === 0) return;

      for (const file of files) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          status.textContent = `Skipped "${file.name}" — only PDF files are supported.`;
          continue;
        }
        // A huge file would take a long time to parse client-side (and
        // exceed MAX_LIBRARY_DOC_CHARS anyway) — cap before even trying.
        if (file.size > 25 * 1024 * 1024) {
          status.textContent = `Skipped "${file.name}" — that's over the 25MB limit.`;
          continue;
        }
        status.textContent = `Reading "${file.name}"…`;
        try {
          const { text, pageCount } = await extractPdfText(file);
          if (!text) {
            status.textContent = `Couldn't find any readable text in "${file.name}" — skipped.`;
            continue;
          }
          const library = loadLibrary();
          library.docs.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: cleanUploadedTitle(file.name),
            addedAt: todayStr(),
            pageCount,
            text,
            // Every doc in this library comes from an uploaded PDF today —
            // tagged explicitly (rather than left implicit) so any future
            // non-PDF source is visually distinct instead of assumed PDF.
            tags: ["pdf"],
          });
          saveLibrary(library);
          renderLibraryList();
          status.textContent = `Added "${file.name}".`;
        } catch (err) {
          console.error("PDF extraction failed", err);
          status.textContent = `Couldn't read "${file.name}" — it may be scanned/image-only or corrupted.`;
        }
      }
      pushLibraryToCloud();
    });

    document.getElementById("library-list").addEventListener("click", (e) => {
      const openBtn = e.target.closest(".library-doc-open");
      if (openBtn) {
        const doc = loadLibrary().docs.find((d) => d.id === openBtn.dataset.id);
        if (doc) showLibraryDoc(doc);
        return;
      }
      const renameBtn = e.target.closest(".library-item-rename");
      if (renameBtn) {
        startRenameLibraryDoc(renameBtn.dataset.id);
        return;
      }
      const btn = e.target.closest(".library-item-remove");
      if (!btn) return;
      const library = loadLibrary();
      const doc = library.docs.find((d) => d.id === btn.dataset.id);
      // Removing is permanent — the original PDF isn't stored anywhere to
      // recover it from, only its extracted text, so a stray tap here
      // (especially now that a second small icon button, rename, sits
      // right next to this one) shouldn't be able to silently delete an
      // upload with no way back.
      if (doc && !window.confirm(`Remove "${doc.title}" from your library? This can't be undone — you'd need to re-upload the PDF.`)) return;
      library.docs = library.docs.filter((d) => d.id !== btn.dataset.id);
      saveLibrary(library);
      renderLibraryList();
      pushLibraryToCloud();
    });

    document.getElementById("library-list").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const openBtn = e.target.closest(".library-doc-open");
      if (!openBtn) return;
      e.preventDefault();
      const doc = loadLibrary().docs.find((d) => d.id === openBtn.dataset.id);
      if (doc) showLibraryDoc(doc);
    });

    const routinesList = document.getElementById("library-routines-list");
    if (routinesList) {
      routinesList.addEventListener("click", (e) => {
        const startBtn = e.target.closest(".library-item-start");
        if (startBtn) {
          const routine = loadLibrary().routines.find((r) => r.id === startBtn.dataset.id);
          if (routine) startSavedRoutine(currentUser, routine);
          return;
        }
        const removeBtn = e.target.closest(".library-item-remove");
        if (removeBtn) {
          const library = loadLibrary();
          library.routines = library.routines.filter((r) => r.id !== removeBtn.dataset.id);
          saveLibrary(library);
          renderLibraryList();
          pushLibraryToCloud();
        }
      });
    }
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
      renderWeighInTable(user);
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
      // Room for the date labels along the bottom (was 10 — too tight to
      // fit any text, which is why the axis had no dates at all before).
      PAD_B = 26;
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

    // X-axis date labels — a small, evenly-spaced subset (not one per
    // point) so a long history doesn't overlap into an unreadable smear on
    // a narrow mobile chart. First/last anchor inward so they can't clip
    // past the SVG edge.
    const uniqueDates = Array.from(new Set(allPoints.map((p) => p.date))).sort((a, b) => new Date(a) - new Date(b));
    const maxLabels = 5;
    const step = Math.max(1, Math.ceil(uniqueDates.length / maxLabels));
    const labelDates = uniqueDates.filter((_, i) => i % step === 0 || i === uniqueDates.length - 1);
    labelDates.forEach((dateStr, i) => {
      const x = xFor(new Date(dateStr).getTime());
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", x);
      label.setAttribute("y", H - PAD_B + 16);
      label.setAttribute("class", "graph-axis-label");
      label.setAttribute("text-anchor", i === 0 ? "start" : i === labelDates.length - 1 ? "end" : "middle");
      label.textContent = formatShortDate(dateStr);
      svg.appendChild(label);
    });

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
    renderWeighInTable(user);
  }

  // Every logged weigh-in, most recent first — the graph shows the trend,
  // this shows (and lets you fix) the actual entries behind it. Double-tap
  // the weight to edit it in place; logWeighIn already upserts by date, so
  // editing is just re-logging the same date with a corrected number.
  function renderWeighInTable(user) {
    const tbody = document.getElementById("weighin-table-body");
    const empty = document.getElementById("weighin-table-empty");
    const entries = [...getWeighIns(user)].reverse();
    empty.classList.toggle("hidden", entries.length > 0);

    tbody.innerHTML = entries
      .map(
        (w) => `
      <tr data-date="${escapeHtml(w.date)}">
        <td>${escapeHtml(formatShortDate(w.date))}</td>
        <td class="weighin-weight-cell" title="Double-tap to edit">${w.weight} lb</td>
        <td><button type="button" class="weighin-remove" data-date="${escapeHtml(w.date)}" title="Remove">✕</button></td>
      </tr>
    `
      )
      .join("");

    tbody.querySelectorAll(".weighin-weight-cell").forEach((cell) => {
      cell.addEventListener("dblclick", () => startEditWeighIn(user, cell));
    });
    tbody.querySelectorAll(".weighin-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!window.confirm(`Remove the ${formatShortDate(btn.dataset.date)} weigh-in?`)) return;
        removeWeighIn(user, btn.dataset.date);
        renderGraph(user);
      });
    });
  }

  function startEditWeighIn(user, cell) {
    const date = cell.closest("tr")?.dataset.date;
    const entry = getWeighIns(user).find((w) => w.date === date);
    if (!date || !entry) return;

    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.step = "any";
    input.className = "weighin-edit-input";
    input.value = entry.weight;
    cell.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const value = Number(input.value);
      if (Number.isFinite(value) && value > 0 && value !== entry.weight) {
        logWeighIn(user, date, value);
      }
      renderGraph(user);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = entry.weight;
        input.blur();
      }
    });
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

  seedLibraryIfNeeded();

  initCheckIn();
  initSettings();
  initHistory();
  initTrainerScreen();
  initLibrary();
  initGraphScreen();
  initCheerModal();
  initSelectScreen();
  initCustomScreen();
  initWorkoutScreen();
  initTerminalCursor();

  renderClock();
  setInterval(renderClock, 1000);

  // Flushes any debounced-but-not-yet-written active-workout changes right
  // before the tab/PWA is backgrounded or closed — the exact moment iOS is
  // most likely to reclaim the page, so the 400ms debounce window shouldn't
  // be the thing standing between a logged set and actually saving it.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistActiveWorkout();
  });
  window.addEventListener("pagehide", persistActiveWorkout);

  showLogin();
})();
