// Retro guard: run before pushing style changes (node scripts/check-retro.mjs).
// Fails on the regressions that have bitten us:
//   1. a bare .rx rule (the old reaction-chip class greyed the replay cards)
//   2. Retro-only rules (html:not(.pro)) using raw palette hex/rgb instead of tokens
//   3. more than one Retro replay colour block (stacked layers undo each other)
import { readFileSync } from "node:fs";
const css = readFileSync("styles.css", "utf8");
const fails = [];
css.split("\n").forEach((l, i) => {
  if (/^\.rx(\s|\.|:|\{)/.test(l)) fails.push(`styles.css:${i + 1} bare .rx rule (collides with the replay cards)`);
  if (l.startsWith("html:not(.pro)") && /#(ff2079|05d9e8|c13cff|ffe45e|39ff88|ffd23f)\b|rgba\(\s*(255,\s*32,\s*121|5,\s*217,\s*232|193,\s*60,\s*255|57,\s*255,\s*136|255,\s*210,\s*63)\s*,/i.test(l))
    fails.push(`styles.css:${i + 1} raw palette colour in a Retro rule; use var(--neon-*) / rgba(var(--*-rgb), a)`);
});
const rxc = (css.match(/\.recap-card\.rx\.hit \{ --rxc:/g) || []).length;
if (rxc !== 1) fails.push(`replay colour block defined ${rxc} times (want 1)`);
if (fails.length) { console.error("Retro check failed:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("Retro check OK");
