// Cache stamps per file: each ?v= is a 12 digit hash of that file's own
// content, so a deploy only makes phones download the files that changed.
// version.json and the build meta in index.html carry one hash of all the
// stamps together: phones reload only when something they load changed.
//   node scripts/stamp.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const h12 = (buf) => String(BigInt("0x" + createHash("sha256").update(buf).digest("hex").slice(0, 15)) % 10n ** 12n).padStart(12, "0");
const REF = /([A-Za-z0-9_./-]+)\?v=\d{12}/g;
const restamp = (text) => text.replace(REF, (m, path) => existsSync(path) ? `${path}?v=${h12(readFileSync(path))}` : m);
let changed = 0;
const write = (file, text) => { if (readFileSync(file, "utf8") !== text) { writeFileSync(file, text); changed += 1; } };
// app.js names admin.js and console.js, so stamp inside it first, then
// stamp index.html (which names app.js) with app.js's final content.
write("app.js", restamp(readFileSync("app.js", "utf8")));
let html = restamp(readFileSync("index.html", "utf8"));
const stamps = [...html.matchAll(/\?v=(\d{12})/g)].map((m) => m[1]).concat([...readFileSync("app.js", "utf8").matchAll(/\?v=(\d{12})/g)].map((m) => m[1]));
const build = h12(stamps.join(","));
html = html.replace(/<meta name="build" content="\d{12}" \/>/, `<meta name="build" content="${build}" />`);
write("index.html", html);
write("version.json", readFileSync("version.json", "utf8").replace(/"v":\s*"\d{12}"/, `"v": "${build}"`));
console.log(`build ${build}, ${changed} file(s) written`);
