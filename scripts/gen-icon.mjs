// Home screen icons: a neon pixel football, outline only, lit in the
// league's gradient, white laces, faint scanlines, nothing else.
//
//   node scripts/gen-icon.mjs cfb   writes icons/*
//   node scripts/gen-icon.mjs nfl   writes icons/nfl/*
//
// Writes the SVGs, then renders every PNG size with Playwright's Chromium
// (a local install, or the global one).
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PAL = {
  // The app's sunset: gold through orange and hot pink to violet.
  cfb: { bg0: "#08000f", bg1: "#1c0435", grad: ["#ffe45e", "#ff9d3d", "#ff2079", "#c13cff"], lace: "#ffffff" },
  // Ice to royal blue, so the two sit apart on a home screen.
  nfl: { bg0: "#000612", bg1: "#061a40", grad: ["#ffffff", "#8fd3ff", "#2f7bff", "#3b2fd6"], lace: "#ffffff" },
};

// One football on a grid of square cells. The ball is a lens (two circles
// overlapping), so its ends come to real points instead of an egg.
// (cx, cy) is the ball's centre in cells; a, b its half width and height.
function icon(p, { grid, cx, cy, a, b, laces, glow, scan, round }) {
  const C = 1024 / grid;
  const R = (a * a / b + b) / 2, d = R - b;
  const inside = (x, y) => { const u = x + 0.5 - cx, v = y + 0.5 - cy; return u * u + (v - d) ** 2 <= R * R && u * u + (v + d) ** 2 <= R * R; };
  const edge = [];
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    if (inside(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => !inside(x + i, y + j))) edge.push([x, y]);
  }
  const px = ([x, y], f) => `<rect x="${+(x * C).toFixed(2)}" y="${+(y * C).toFixed(2)}" width="${+C.toFixed(2)}" height="${+C.toFixed(2)}" fill="${f}"/>`;
  const line = edge.map((c) => px(c, "url(#g)")).join("");
  const top = Math.floor(cy - b), bot = Math.ceil(cy + b);
  const stops = p.grad.map((c, i) => `<stop offset="${(i / (p.grad.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
  const lines = [];
  for (let y = 0; y < 1024; y += 8) lines.push(`<rect y="${y + 4}" width="1024" height="4"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" shape-rendering="crispEdges">
<defs>
<radialGradient id="bg" cx="50%" cy="46%" r="72%"><stop offset="0%" stop-color="${p.bg1}"/><stop offset="100%" stop-color="${p.bg0}"/></radialGradient>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="${top * C}" x2="0" y2="${bot * C}">${stops}</linearGradient>
<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${glow}"/></filter>
</defs>
<rect width="1024" height="1024"${round ? ` rx="${round}"` : ""} fill="url(#bg)"/>
${glow ? `<g filter="url(#glow)" opacity=".95">${line}</g>` : ""}
${line}
${laces.map((c) => px(c, p.lace)).join("")}
${scan ? `<g fill="#000" opacity="${scan}">${lines.join("")}</g>` : ""}
</svg>
`;
}

// Home screen: 25 cells, the ball 19 by 13 centred on the middle cell, its
// points inside Android's round crop (the middle 80%). Laces: a seam of
// seven with four stitches, symmetric about the centre.
const lacesBig = [];
for (let x = 9; x <= 15; x++) lacesBig.push([x, 12]);
for (const x of [9, 11, 13, 15]) lacesBig.push([x, 11], [x, 13]);
const BIG = { grid: 25, cx: 12.5, cy: 12.5, a: 9.5, b: 6.5, laces: lacesBig, glow: 26, scan: 0.1 };

// Favicons: drawn by hand on 16 pixels, since the outline ball shrunk to a
// browser tab blurs into a blob. A solid ball in the gradient fills the
// tile, with a white seam and stitches; at 32px each pixel is doubled.
function favicon(p) {
  const C = 64; // 1024 / 16
  const rows = { 4: [6, 9], 5: [3, 12], 6: [2, 13], 7: [1, 14], 8: [1, 14], 9: [2, 13], 10: [3, 12], 11: [6, 9] };
  const lace = new Set();
  for (let x = 4; x <= 11; x++) lace.add(`${x},7`);
  for (const x of [5, 7, 8, 10]) lace.add(`${x},6`), lace.add(`${x},8`);
  let ball = "", laces = "";
  for (const [y, [x0, x1]] of Object.entries(rows)) for (let x = x0; x <= x1; x++) {
    const cell = `<rect x="${x * C}" y="${y * C}" width="${C}" height="${C}" fill="${lace.has(`${x},${y}`) ? p.lace : "url(#g)"}"/>`;
    if (lace.has(`${x},${y}`)) laces += cell; else ball += cell;
  }
  const stops = p.grad.map((c, i) => `<stop offset="${(i / (p.grad.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" shape-rendering="crispEdges">
<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="${4 * C}" x2="0" y2="${12 * C}">${stops}</linearGradient></defs>
<rect width="1024" height="1024" rx="192" fill="${p.bg1}"/>
${ball}${laces}
</svg>
`;
}

const sport = process.argv[2] === "nfl" ? "nfl" : "cfb";
const dir = sport === "nfl" ? "icons/nfl" : "icons";
fs.mkdirSync(dir, { recursive: true });
const big = icon(PAL[sport], BIG), small = favicon(PAL[sport]);
fs.writeFileSync(`${dir}/icon.svg`, big);
fs.writeFileSync(`${dir}/icon-small.svg`, small);

let pw;
try { pw = await import("playwright"); } catch {
  pw = await import(path.join(execSync("npm root -g").toString().trim(), "playwright/index.mjs"));
}
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((f) => fs.existsSync(f));
const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const [s, f] of [[1024, "icon-1024.png"], [512, "icon-512.png"], [192, "icon-192.png"], [180, "apple-touch-icon.png"]]) await render(big, s, `${dir}/${f}`);
for (const [s, f] of [[32, "favicon-32.png"], [16, "favicon-16.png"]]) await render(small, s, `${dir}/${f}`);
await browser.close();
console.log(`${sport}: icons written to ${dir}/`);
