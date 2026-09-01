#!/usr/bin/env node
// Scans app.js for every exercise the app can show, and reports which ones
// have no matching photo in images/*/ — the same lookup app.js itself does
// at runtime (see getExerciseImageCandidates), just run ahead of time so
// gaps are visible without having to click through every workout by hand.
//
// Usage: node scripts/audit-exercise-images.js [--json]
//
// This repo's image pipeline is Codex's responsibility (see
// COLLABORATION.md) — Claude builds the interface, Codex generates and
// delivers the actual photos. This script only finds the gaps; it doesn't
// create anything. Run with --json to get a plain list of {name, folder}
// suitable for feeding into an image-generation request.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "app.js");
const IMAGES_DIR = path.join(ROOT, "images");

// Folders app.js actually checks at runtime (see IMAGE_BODY_PARTS in
// app.js) — keep this list in sync with that one.
const IMAGE_BODY_PARTS = ["chest", "back", "legs", "shoulders", "arms", "core"];

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Best-effort body-part guess for a NEW exercise with no photo yet, so a
// generation request can suggest a target folder. Order matters — more
// specific patterns are checked before the generic ones they could
// otherwise be swallowed by (e.g. "leg curl" before the bare "curl", or
// "upright row" before the bare "row").
const FOLDER_RULES = [
  ["legs", /squat|lunge|deadlift|leg press|leg extension|leg curl|calf raise|hip thrust|glute bridge|step-?ups?/i],
  ["shoulders", /shoulder|lateral raise|front raise|rear delt|face pull|shrug|overhead press|military press|upright row/i],
  ["chest", /bench press|\bchest\b|push-?up|\bdips?\b|\bflys?\b|\bflyes?\b|crossover/i],
  ["back", /\brows?\b|pulldown|pull-?ups?|back extension/i],
  ["arms", /curl|triceps|wrist|kickback/i],
  ["core", /crunch|plank|dead bug|sit-?up|ab wheel|woodchopper|russian twist/i],
];

function guessFolder(name) {
  for (const [folder, pattern] of FOLDER_RULES) {
    if (pattern.test(name)) return folder;
  }
  return null; // no confident guess — flag for a human to assign
}

function extractExerciseNames(src) {
  // Every exercise object in app.js follows the same shape: a `name:`
  // and a `detail:` field on the same object literal. Matching both on
  // one line (this codebase writes exercise objects on a single line)
  // avoids false positives from unrelated `name:` fields elsewhere
  // (personas, split metadata, etc).
  const lines = src.split("\n");
  const names = new Set();
  for (const line of lines) {
    if (!line.includes("detail:")) continue;
    const m = line.match(/name:\s*"([^"]+)"/);
    if (m) names.add(m[1]);
  }
  return Array.from(names).sort();
}

function main() {
  const src = fs.readFileSync(APP_JS, "utf8");
  const names = extractExerciseNames(src);

  const filesByFolder = {};
  for (const folder of IMAGE_BODY_PARTS) {
    const dir = path.join(IMAGES_DIR, folder);
    filesByFolder[folder] = fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set();
  }

  const missing = [];
  const found = [];
  for (const name of names) {
    const slug = slugify(name) + ".jpg";
    const hitFolder = IMAGE_BODY_PARTS.find((folder) => filesByFolder[folder].has(slug));
    if (hitFolder) {
      found.push({ name, folder: hitFolder });
    } else {
      missing.push({ name, slug: slugify(name), suggestedFolder: guessFolder(name) });
    }
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ total: names.length, foundCount: found.length, missing }, null, 2));
    return;
  }

  console.log(`Exercise images audit — ${names.length} distinct exercise names found in app.js`);
  console.log(`  ${found.length} already have a photo`);
  console.log(`  ${missing.length} missing\n`);

  if (missing.length > 0) {
    console.log("Missing (name -> slug -> suggested folder):");
    missing.forEach(({ name, slug, suggestedFolder }) => {
      console.log(`  ${name}  ->  ${slug}.jpg  ->  ${suggestedFolder || "(unclear — assign by hand)"}`);
    });
  }
}

main();
