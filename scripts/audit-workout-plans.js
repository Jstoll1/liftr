#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
// The Liftr workout app now lives in liftr-app/ — the repo root serves
// the Brochiefs pick'em app instead.
let source = fs.readFileSync(path.join(root, "liftr-app", "app.js"), "utf8");
const initMarker = "  // ---------- init ----------";
const initIndex = source.indexOf(initMarker);
if (initIndex < 0) throw new Error("Could not locate Liftr init marker");

source = `${source.slice(0, initIndex)}
  globalThis.__workoutAudit = {
    buildCandidatePool,
    enforcePlanConstraints,
    getExerciseTraits,
    isPartnerExercise,
    parseSetCount,
    parseTargetReps,
    setCheckIn(value) { checkInState = value; },
  };
})();`;

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  window: {},
  document: {},
  navigator: {},
  location: {},
  fetch: async () => { throw new Error("Network is disabled during the audit"); },
  AbortSignal,
  Blob,
  URL,
  FileReader: function FileReader() {},
  setTimeout,
  clearTimeout,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const app = context.__workoutAudit;
const scenarios = [
  { user: "jake", minutes: 45, energy: "high", expectedCount: 5, expectedPairs: ["A", "B"] },
  { user: "jessica", minutes: 45, energy: "high", expectedCount: 5, expectedPairs: ["A", "B"] },
  { user: "jake", minutes: 30, energy: "medium", expectedCount: 4, expectedPairs: ["A", "B"] },
  { user: "jessica", minutes: 30, energy: "low", expectedCount: 2, expectedPairs: ["A"] },
];

const rows = scenarios.map((scenario) => {
  const checkIn = {
    minutes: scenario.minutes,
    energy: scenario.energy,
    partner: false,
    note: "",
    weightOverrides: {},
    weightDirection: null,
    finisherOverride: null,
  };
  app.setCheckIn(checkIn);
  const pool = app.buildCandidatePool(scenario.user, "chest-back", checkIn);
  // Deliberately simulate a low-quality model response by feeding the
  // least-structured candidates back first. The deterministic planner must
  // still restore the primary A/B supersets.
  const hostileDraft = pool.filter((exercise) => !exercise.superset).reverse().slice(0, 4);
  const plan = app.enforcePlanConstraints(scenario.user, "chest-back", hostileDraft, checkIn);
  const roles = plan.map((exercise) => {
    if (/^finisher:/i.test(exercise.name)) return "finisher";
    const traits = app.getExerciseTraits(exercise);
    if (traits.has("horizontalPush")) return "chest";
    if (traits.has("horizontalPull") || traits.has("verticalPull")) return "back";
    return "other";
  });
  const pairCounts = new Map();
  plan.forEach((exercise) => {
    if (exercise.superset) pairCounts.set(exercise.superset, (pairCounts.get(exercise.superset) || 0) + 1);
  });
  const failures = [];
  if (plan.length !== scenario.expectedCount) failures.push(`expected ${scenario.expectedCount} exercises, got ${plan.length}`);
  if (plan.some(app.isPartnerExercise)) failures.push("solo plan contains a partner exercise");
  scenario.expectedPairs.forEach((pair) => {
    if (pairCounts.get(pair) !== 2) failures.push(`superset ${pair} is incomplete`);
  });
  const regularRoles = roles.filter((role) => role === "chest" || role === "back");
  const chest = regularRoles.filter((role) => role === "chest").length;
  const back = regularRoles.filter((role) => role === "back").length;
  if (chest !== back) failures.push(`push/pull imbalance: ${chest} chest vs ${back} back`);
  const firstPair = plan.slice(0, 2).map((exercise) => exercise.name).join(" + ");
  if (/push-up ladder|incline push-up|cable (chest )?fly/i.test(firstPair)) failures.push("primary pair starts with accessory/bodyweight work");
  plan.forEach((exercise) => {
    if (/^\d+\s*x\s*\d+/i.test(exercise.detail) && app.parseTargetReps(exercise.detail) == null) {
      failures.push(`${exercise.name} has an unparseable rep target: ${exercise.detail}`);
    }
    if (app.parseSetCount(exercise.detail) < 1) failures.push(`${exercise.name} has no usable set count`);
  });
  return { ...scenario, plan: plan.map((exercise) => exercise.name), roles, failures };
});

const failed = rows.filter((row) => row.failures.length > 0);
const report = [
  "# Workout plan audit",
  "",
  "The audit feeds intentionally weak AI drafts into the production planner and verifies that deterministic safeguards rebuild a useful session.",
  "",
  "| Athlete | Check-in | Result | Planned workout |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.user} | ${row.minutes} min · ${row.energy} · solo | ${row.failures.length ? `FAIL: ${row.failures.join("; ")}` : "PASS"} | ${row.plan.join(" → ")} |`),
  "",
  failed.length ? `**${failed.length} scenario(s) failed.**` : `**All ${rows.length} scenarios passed.**`,
  "",
].join("\n");

if (process.argv.includes("--write")) {
  fs.writeFileSync(path.join(root, "reports", "workout-plan-audit.md"), report);
  fs.writeFileSync(path.join(root, "reports", "workout-plan-audit.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
}

process.stdout.write(report);
if (failed.length) process.exitCode = 1;
