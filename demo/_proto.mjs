import { chromium } from "playwright";
import fs from "fs";
const S = process.env.S;
const b = await chromium.launch({ channel: "chromium", args: ["--enable-gpu","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=gl-egl"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.clock.install();
await p.goto("http://localhost:5173/"); await p.waitForTimeout(3000);
await p.getByRole("button", { name: "Dongri Buzurg" }).click(); await p.waitForTimeout(1500);
const map = await p.locator(".maplibregl-canvas").boundingBox();
console.log("map box", map);
const cx = map.x + map.width/2, cy = map.y + map.height/2;
for (let i = 0; i < 40; i++) { await p.mouse.move(cx, cy); await p.mouse.wheel(0, -25); await p.waitForTimeout(40); }
await p.waitForTimeout(1500);
await p.screenshot({ path: `${S}/dbz_deep.png` });
// per-frame cost under paused clock
await p.clock.pauseAt(Date.now() + 5000);
const cdp = await ctx.newCDPSession(p);
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  await p.clock.runFor(17);
  const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
  if (i === 0) fs.writeFileSync(`${S}/frame0.jpg`, Buffer.from(r.data, "base64"));
}
console.log("ms/frame", (Date.now() - t0) / 30);
await b.close();
