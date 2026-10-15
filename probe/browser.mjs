// Probe only: open a page in headless Chrome on the runner and report
// where ESPN keeps NFL expert picks in its page data. Read only.
import { chromium } from "playwright";
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", viewport: { width: 1280, height: 900 } });
await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(5000);
const data = await p.evaluate(() => window.__espnfitt__ || null);
if (!data) { console.log("no __espnfitt__"); await b.close(); process.exit(0); }
const pd = data.page?.content?.picksData;
const shape = (o, d = 0) => {
  if (Array.isArray(o)) return `[${o.length}] ` + (o.length ? shape(o[0], d + 1) : "");
  if (o && typeof o === "object") return d > 3 ? "{...}" : "{" + Object.entries(o).slice(0, 25).map(([k, v]) => `${k}: ${shape(v, d + 1)}`).join(", ") + "}";
  return JSON.stringify(o)?.slice(0, 60);
};
console.log("SHAPE", shape(pd));
console.log("SAMPLE", JSON.stringify(pd).slice(0, 6000));
await b.close();
