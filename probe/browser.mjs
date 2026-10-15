// Probe only: open a page in headless Chrome on the runner and print what
// a reader would see, to learn whether ESPN serves its NFL picks page to a
// real browser. Read only.
import { chromium } from "playwright";
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", viewport: { width: 1280, height: 900 } });
const res = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => ({ status: () => String(e.message).slice(0, 80) }));
await p.waitForTimeout(6000);
console.log("status", res?.status?.(), "title", await p.title());
const text = await p.evaluate(() => document.body?.innerText || "");
console.log("chars", text.length);
console.log(text.slice(0, 3500));
const fitt = await p.evaluate(() => { const s = [...document.scripts].map((x) => x.textContent).find((t) => t.includes("__espnfitt__")); return s ? s.length : 0; });
console.log("espnfitt script chars", fitt);
await b.close();
