#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "app.js");
const IMAGES_DIR = path.join(ROOT, "images");
const REPORTS_DIR = path.join(ROOT, "reports");
const IMAGE_BODY_PARTS = ["chest", "back", "legs", "shoulders", "arms", "core"];

const FOLDER_RULES = [
  ["legs", /squat|lunge|deadlift|leg press|leg extension|leg curl|calf raise|hip thrust|glute bridge|step-?ups?/i],
  ["shoulders", /shoulder|lateral raise|front raise|rear delt|face pull|shrug|overhead press|military press|upright row/i],
  ["chest", /bench press|\bchest\b|push-?up|\bdips?\b|\bflys?\b|\bflyes?\b|crossover/i],
  ["back", /\brows?\b|pulldown|pull-?ups?|back extension/i],
  ["arms", /curl|triceps|wrist|kickback/i],
  ["core", /crunch|plank|dead bug|sit-?up|ab wheel|woodchopper|russian twist/i],
];

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function guessFolder(name) {
  return FOLDER_RULES.find(([, pattern]) => pattern.test(name))?.[0] || null;
}

function extractExerciseNames(source) {
  const names = new Set();
  for (const line of source.split("\n")) {
    if (!line.includes("detail:")) continue;
    const match = line.match(/name:\s*"([^"]+)"/);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

function inspectJpeg(filePath) {
  if (!fs.existsSync(filePath)) return "missing";
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return "not-a-file";
  if (stat.size === 0) return "empty";
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return "invalid-jpeg";
  return "ready";
}

// Cheap Levenshtein distance — good enough to catch "off by a typo or an
// extra/missing s" naming drift between what a delivered file is called and
// what the app actually looks for, without pulling in a dependency.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// The other half of the audit: files that exist on disk but don't match any
// current exercise's expected slug at all. The app-side lookup only ever
// tries the exact slugified name, so a delivered file named even slightly
// differently than app.js's exercise name (a typo, a leftover from a
// renamed exercise, a stray "-v2") sits there doing nothing forever with no
// error anywhere — this is the case a "missing images" report alone can't
// catch, since from that report's point of view the exercise still looks
// unaddressed even though someone already delivered art for it.
function findOrphanFiles(expectedSlugs) {
  const orphans = [];
  for (const folder of IMAGE_BODY_PARTS) {
    const dir = path.join(IMAGES_DIR, folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".jpg")) continue;
      const slug = file.slice(0, -4);
      if (expectedSlugs.has(slug)) continue;
      let closest = null;
      let closestDistance = Infinity;
      for (const candidate of expectedSlugs) {
        const distance = editDistance(slug, candidate);
        if (distance < closestDistance) {
          closest = candidate;
          closestDistance = distance;
        }
      }
      orphans.push({
        path: path.posix.join("images", folder, file),
        slug,
        possibleTypoOf: closestDistance <= 3 ? closest : null,
      });
    }
  }
  return orphans;
}

function buildReport() {
  const names = extractExerciseNames(fs.readFileSync(APP_JS, "utf8"));
  const exercises = names.map((name) => {
    const filename = `${slugify(name)}.jpg`;
    const candidates = IMAGE_BODY_PARTS.map((folder) => {
      const relativePath = path.posix.join("images", folder, filename);
      return { folder, path: relativePath, status: inspectJpeg(path.join(ROOT, relativePath)) };
    });
    const ready = candidates.find((candidate) => candidate.status === "ready");
    const invalid = candidates.find((candidate) => candidate.status !== "missing");
    return {
      name,
      slug: slugify(name),
      status: ready ? "ready" : invalid?.status || "missing",
      imagePath: ready?.path || invalid?.path || null,
      suggestedFolder: ready?.folder || invalid?.folder || guessFolder(name),
      checkedPaths: candidates.map((candidate) => candidate.path),
    };
  });
  const issues = exercises.filter((exercise) => exercise.status !== "ready");
  const orphans = findOrphanFiles(new Set(exercises.map((exercise) => exercise.slug)));
  return {
    generatedAt: new Date().toISOString(),
    source: "app.js",
    summary: { distinctExercises: exercises.length, ready: exercises.length - issues.length, issues: issues.length, orphans: orphans.length },
    issues,
    orphans,
  };
}

function toMarkdown(report) {
  const { distinctExercises, ready, issues, orphans } = report.summary;
  const lines = [
    "# Exercise image audit",
    "",
    `Generated from \`${report.source}\` at ${report.generatedAt}.`,
    "",
    `- Distinct exercises: **${distinctExercises}**`,
    `- Ready images: **${ready}**`,
    `- Missing or invalid images: **${issues}**`,
    `- Unmatched files on disk: **${orphans}**`,
    "",
    "## Images needing attention",
    "",
    "| Exercise | Status | Expected filename | Suggested folder |",
    "| --- | --- | --- | --- |",
  ];
  for (const issue of report.issues) {
    const folder = issue.suggestedFolder ? `\`images/${issue.suggestedFolder}/\`` : "Needs review";
    lines.push(`| ${issue.name.replaceAll("|", "\\|")} | ${issue.status} | \`${issue.slug}.jpg\` | ${folder} |`);
  }
  if (!report.issues.length) lines.push("| None | — | — | — |");
  lines.push(
    "",
    "The app checks every configured body-part folder, so a ready image may live in any of them.",
    "",
    "## Unmatched files on disk",
    "",
    "Files that exist but don't match any current exercise's expected slug —",
    "a naming mismatch this app-side lookup can't recover from on its own",
    "(the app only ever tries the exact slugified exercise name). Usually a",
    "typo, a leftover from a renamed/removed exercise, or a delivery that",
    "used a slightly different filename than requested.",
    "",
    "| File | Closest exercise slug (if any, within edit distance 3) |",
    "| --- | --- |",
  );
  for (const orphan of report.orphans) {
    lines.push(`| \`${orphan.path}\` | ${orphan.possibleTypoOf ? `\`${orphan.possibleTypoOf}\`` : "no close match — may be intentional"} |`);
  }
  if (!report.orphans.length) lines.push("| None | — |");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const report = buildReport();
  const markdown = toMarkdown(report);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, "exercise-image-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(REPORTS_DIR, "exercise-image-audit.md"), markdown);
  }
  console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : markdown);
  if (process.argv.includes("--fail-on-missing") && report.summary.issues > 0) process.exitCode = 1;
}

main();
