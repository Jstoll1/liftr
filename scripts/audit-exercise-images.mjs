#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const appPath = path.join(repoRoot, "app.js");
const reportDir = path.join(repoRoot, "reports");
const args = new Set(process.argv.slice(2));

function loadWorkoutCatalog() {
  const source = fs.readFileSync(appPath, "utf8");
  const marker = "  // ---------- init ----------";
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error(`Could not find the app initialization marker in ${appPath}`);

  const exposed = `${source.slice(0, markerIndex)}
  globalThis.__LIFTR_IMAGE_AUDIT__ = {
    SPLIT_LIBRARY,
    SPECIAL_WORKOUTS,
    FINISHERS,
    PARTNER_EXTRAS,
    getExerciseImagePath,
  };
})();`;
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(exposed, sandbox, { filename: appPath, timeout: 5000 });
  return sandbox.__LIFTR_IMAGE_AUDIT__;
}

function inspectJpeg(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return { status: "missing", bytes: 0 };
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) return { status: "not-a-file", bytes: 0 };
  if (stat.size === 0) return { status: "empty", bytes: 0 };
  const data = fs.readFileSync(absolutePath);
  const jpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  return { status: jpeg ? "ready" : "invalid-jpeg", bytes: stat.size };
}

function collectReferences(catalog) {
  const references = [];
  const add = (user, splitKey, source, exercise) => {
    if (!exercise?.name) return;
    const imagePath = catalog.getExerciseImagePath(splitKey, exercise.name);
    references.push({ user, splitKey, source, exercise: exercise.name, imagePath });
  };

  Object.entries(catalog.SPLIT_LIBRARY).forEach(([splitKey, split]) => {
    Object.entries(split.exercises || {}).forEach(([user, exercises]) => {
      exercises.forEach((exercise) => add(user, splitKey, "base", exercise));
    });
  });
  Object.entries(catalog.FINISHERS).forEach(([splitKey, users]) => {
    Object.entries(users).forEach(([user, exercise]) => add(user, splitKey, "finisher", exercise));
  });
  Object.entries(catalog.PARTNER_EXTRAS).forEach(([splitKey, users]) => {
    Object.entries(users).forEach(([user, exercise]) => add(user, splitKey, "partner", exercise));
  });
  Object.entries(catalog.SPECIAL_WORKOUTS).forEach(([splitKey, workout]) => {
    workout.exercises.forEach((exercise) => add(workout.user, splitKey, "special-preset", exercise));
  });
  return references;
}

function buildReport() {
  const catalog = loadWorkoutCatalog();
  const references = collectReferences(catalog).map((reference) => ({
    ...reference,
    ...inspectJpeg(reference.imagePath),
  }));
  const uniquePaths = new Map();
  references.forEach((reference) => {
    const existing = uniquePaths.get(reference.imagePath);
    if (existing) existing.references++;
    else uniquePaths.set(reference.imagePath, { imagePath: reference.imagePath, status: reference.status, bytes: reference.bytes, references: 1 });
  });
  const issues = references.filter((reference) => reference.status !== "ready");
  return {
    generatedAt: new Date().toISOString(),
    appFile: "app.js",
    summary: {
      exerciseReferences: references.length,
      uniqueExpectedImages: uniquePaths.size,
      readyReferences: references.length - issues.length,
      issueReferences: issues.length,
      uniqueIssueImages: new Set(issues.map((item) => item.imagePath)).size,
    },
    issues,
    references,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Exercise image audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Exercise references scanned: **${report.summary.exerciseReferences}**`,
    `- Unique image paths expected: **${report.summary.uniqueExpectedImages}**`,
    `- References with working JPEGs: **${report.summary.readyReferences}**`,
    `- References with missing, empty, or invalid images: **${report.summary.issueReferences}**`,
    `- Unique image files requiring attention: **${report.summary.uniqueIssueImages}**`,
    "",
  ];
  if (report.issues.length === 0) {
    lines.push("All referenced exercise images are present and valid JPEG files.", "");
    return lines.join("\n");
  }
  lines.push("## Images requiring attention", "", "| User | Workout | Exercise | Expected path | Problem |", "|---|---|---|---|---|");
  report.issues.forEach((issue) => {
    lines.push(`| ${issue.user} | ${issue.splitKey} | ${issue.exercise.replaceAll("|", "\\|")} | \`${issue.imagePath}\` | ${issue.status} |`);
  });
  lines.push("", "An exercise can appear more than once when it is used in base, partner, finisher, or preset workout definitions.", "");
  return lines.join("\n");
}

const report = buildReport();
const markdown = toMarkdown(report);

if (args.has("--write")) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "exercise-image-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "exercise-image-audit.md"), markdown);
}

process.stdout.write(`${markdown}\n`);
if (args.has("--fail-on-missing") && report.summary.issueReferences > 0) process.exitCode = 1;
