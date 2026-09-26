// Screenshots of the running app for the solution section (needs `make run`).
//   node capture_assets.mjs  -> solution/assets/{dashboard,map,reserves,forecast}.png

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "solution", "assets");
const URL = process.env.DEMO_URL ?? "http://localhost:5173";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium", args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl-egl", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const shot = (name, loc) => loc.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled" });

// Dashboard (backdrop for the title card)
await page.goto(URL + "/");
await page.waitForSelector("text=Recommended actions");
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, "dashboard.png") });

// 01 Where to look: regional view, satellite + prospectivity heat-map + MRDS deposits
await page.click(".maplibregl-ctrl-zoom-out");
await page.click("xpath=//button[normalize-space()='Satellite']");
await page.waitForTimeout(1000);
await page.evaluate(() => new Promise((r) => setTimeout(r, 5000)));     // satellite tiles
await shot("map", page.locator(".maplibregl-map"));

// 03 Will we hit the plan: Dongri Buzurg forecast with the what-if applied
await page.getByRole("button", { name: "Dongri Buzurg", exact: true }).click();
await page.waitForTimeout(2500);
await page.locator("button", { hasText: "Simulate impact" }).first().click();
await page.waitForTimeout(2500);
await shot("forecast", page.locator("xpath=//h3[normalize-space()='Production forecast']/ancestor::section[1]"));

// 02 How much is there: P10/P50/P90 by mine from the Reserves page
await page.goto(URL + "/reserves");
await page.waitForTimeout(3500);
await shot("reserves", page.locator(".echarts-for-react").first().locator("xpath=.."));

await browser.close();
console.log("assets ->", OUT, fs.readdirSync(OUT).join(", "));
