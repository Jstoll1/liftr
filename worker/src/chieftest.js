// The Chief pressure test's question set and its run history, kept in KV so
// the set grows from real misses and fixes instead of living in app code.
// Pure helpers here; the route is in index.js.

export const CASES_KEY = "chieftest:cases";
export const RUNS_KEY = "chieftest:runs";
export const RETIRE_AFTER = 5; // passes in a row before a non-regression test rests

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "") || "case";

// A clean case from whatever was sent: one to three turns of text, a screen,
// where it came from, and the checks a good answer must pass.
export function cleanCase(c, now = Date.now()) {
  const turns = (Array.isArray(c?.turns) ? c.turns : [c?.q, c?.followUp]).map((t) => String(t || "").trim().slice(0, 300)).filter(Boolean).slice(0, 3);
  if (!turns.length) return null;
  const ck = c?.checks || {};
  const list = (a) => (Array.isArray(a) ? a.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 6) : []);
  return {
    id: slug(c?.id || turns[0]),
    screen: c?.screen === "fantasy" ? "fantasy" : "pickem",
    turns,
    checks: { tools: list(ck.tools), must: list(ck.must), mustNot: list(ck.mustNot), noAsk: !!ck.noAsk },
    source: ["seed", "miss", "fix", "feature"].includes(c?.source) ? c.source : "seed",
    regression: !!c?.regression,
    note: String(c?.note || "").slice(0, 200),
    added: Number(c?.added) || now,
    streak: Number(c?.streak) || 0,
    runs: Number(c?.runs) || 0,
    fails: Number(c?.fails) || 0,
    lastFail: Number(c?.lastFail) || null,
    retired: !!c?.retired,
  };
}

// Add a case; an id already used gets a number on the end.
export function addCase(cases, c, now = Date.now()) {
  const x = cleanCase({ ...c, added: now, streak: 0, runs: 0, fails: 0, retired: false }, now);
  if (!x) return { cases, added: null };
  const ids = new Set(cases.map((y) => y.id));
  const base = x.id.slice(0, 34).replace(/-$/, "");
  let id = x.id, n = 2; while (ids.has(id)) id = `${base}-${n++}`;
  x.id = id;
  return { cases: [...cases, x], added: x };
}

// Fold one run's results in: a pass adds to the streak, a fail resets it;
// a non-regression test that passes RETIRE_AFTER in a row is retired (run
// again only with "include retired"). Regression tests never retire.
export function mergeRun(cases, results, now = Date.now()) {
  return cases.map((c) => {
    if (!(c.id in results)) return c;
    const pass = !!results[c.id];
    const streak = pass ? c.streak + 1 : 0;
    return { ...c, runs: c.runs + 1, fails: c.fails + (pass ? 0 : 1), lastFail: pass ? c.lastFail : now, streak, retired: c.retired ? pass : (!c.regression && streak >= RETIRE_AFTER) };
  });
}

// One line per run for the trend: when, which build, the game state, the score.
// Which tests turned: passing before and failing now (regressed), or
// failing on their last run and passing now (fixed).
export function turned(cases, results) {
  const regressed = [], fixed = [];
  for (const c of cases) { if (!(c.id in results) || !c.runs) continue; const was = c.streak > 0, now = !!results[c.id]; if (was && !now) regressed.push(c.id); if (!was && now) fixed.push(c.id); }
  return { regressed, fixed };
}
export function runRecord(r, now = Date.now()) {
  const failed = (Array.isArray(r?.failed) ? r.failed : []).map(slug).slice(0, 40);
  const ids = (a) => (Array.isArray(a) ? a.map(slug).slice(0, 40) : []);
  return { at: now, build: String(r?.build || "").replace(/\D/g, "").slice(0, 14), state: String(r?.state || "").slice(0, 40), passed: Math.max(0, Number(r?.passed) || 0), total: Math.max(0, Number(r?.total) || 0), failed, regressed: ids(r?.regressed), fixed: ids(r?.fixed) };
}

// Two tests with one id (an older bug cut the "-2" off a long id): the
// later one gets a number so each keeps its own record.
export function uniqueIds(cases) {
  const seen = new Set();
  return cases.map((c) => { let id = c.id, n = 2; while (seen.has(id)) id = `${c.id.slice(0, 34).replace(/-$/, "")}-${n++}`; seen.add(id); return id === c.id ? c : { ...c, id }; });
}

