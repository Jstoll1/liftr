// Writes one cache-busting stamp everywhere the app reads it, so a deploy
// never ships with a phone still holding the old build.
//   node scripts/stamp.mjs            # now, UTC, as YYYYMMDDHHMM
//   node scripts/stamp.mjs 202609221330
import { readFileSync, writeFileSync } from "node:fs";
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
let stamp = process.argv[2] || `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
// Two deploys in the same minute must still get different stamps, or phones keep the old build.
const prev = (readFileSync("version.json", "utf8").match(/"v":\s*"(\d{12})"/) || [])[1];
if (!process.argv[2] && prev && stamp <= prev) stamp = String(Number(prev) + 1);
if (!/^\d{12}$/.test(stamp)) { console.error("stamp must be 12 digits"); process.exit(1); }
const files = { "index.html": /\?v=\d{12}/g, "app.js": /\?v=\d{12}/g, "version.json": /"v":\s*"\d{12}"/ };
let changed = 0;
for (const [file, re] of Object.entries(files)) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(re, (m) => m.replace(/\d{12}/, stamp));
  if (after !== before) { writeFileSync(file, after); changed += 1; }
}
console.log(`${stamp} written to ${changed} file(s)`);
