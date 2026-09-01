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
  return {
    generatedAt: new Date().toISOString(),
    source: "app.js",
    summary: { distinctExercises: exercises.length, ready: exercises.length - issues.length, issues: issues.length },
    issues,
  };
}

function toMarkdown(report) {
  const { distinctExercises, ready, issues } = report.summary;
  const lines = [
    "# Exercise image audit",
    "",
    `Generated from \`${report.source}\` at ${report.generatedAt}.`,
    "",
    `- Distinct exercises: **${distinctExercises}**`,
    `- Ready images: **${ready}**`,
    `- Missing or invalid images: **${issues}**`,
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
  lines.push("", "The app checks every configured body-part folder, so a ready image may live in any of them.", "");
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
