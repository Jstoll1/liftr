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

// Favicons: 16 cells, one cell a pixel at 16px and two at 32px, so the
// edges stay sharp. No glow or scanlines; they would only blur.
const lacesSmall = [];
for (let x = 6; x <= 9; x++) lacesSmall.push([x, 8]);
for (const x of [6, 9]) lacesSmall.push([x, 7], [x, 9]);
const SMALL = { grid: 16, cx: 8, cy: 8.5, a: 7, b: 4.5, laces: lacesSmall, glow: 0, scan: 0, round: 160 };

const sport = process.argv[2] === "nfl" ? "nfl" : "cfb";
const dir = sport === "nfl" ? "icons/nfl" : "icons";
fs.mkdirSync(dir, { recursive: true });
const big = icon(PAL[sport], BIG), small = icon(PAL[sport], SMALL);
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
