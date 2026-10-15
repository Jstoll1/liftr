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
// Paths whose key mentions pick or expert, with a short sample of each.
const hits = [];
const walk = (o, path, depth) => {
  if (!o || typeof o !== "object" || depth > 12 || hits.length > 40) return;
  for (const [k, v] of Object.entries(o)) {
    const pth = `${path}.${k}`;
    if (/pick|expert|predict/i.test(k)) hits.push(`${pth} :: ${JSON.stringify(v).slice(0, 400)}`);
    walk(v, pth, depth + 1);
  }
};
walk(data, "fitt", 0);
console.log(hits.join("\n"));
console.log("top keys:", Object.keys(data.page?.content || data.page || data).join(","));
await b.close();
