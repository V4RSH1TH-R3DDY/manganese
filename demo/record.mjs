// Records the Slide-4 prototype demo (0:50–2:00) as a frame-perfect 60 fps video.
//
// How it works: Playwright's fake clock owns requestAnimationFrame / performance.now / timers, so
// MapLibre and ECharts animate on *virtual* time. Each output frame we advance the clock exactly
// 1/60 s, step any CSS transitions by the same amount, and screenshot. Render speed never affects
// smoothness. Camera zoom is a CSS transform on #root; the cursor and spotlight are overlays.
//
// Beat times + VO lines come from DEMO_SCRIPT.md (section 3), which is the single source of truth.
//
//   node record.mjs            full render → out/moil_demo_1080p60.mp4
//   node record.mjs --preview  1× DPR, 30 fps, quick check

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const PREVIEW = process.argv.includes("--preview");
const URL = process.env.DEMO_URL ?? "http://localhost:5173/";
const VW = 1600, VH = 900;
const DPR = PREVIEW ? 1 : 2;
const FPS = PREVIEW ? 30 : 60;
const T0 = 50;                                   // demo starts at 0:50 in the final cut

// ── beat sheet from the markdown ────────────────────────────────────────────
const beats = {};
for (const line of fs.readFileSync(path.join(HERE, "DEMO_SCRIPT.md"), "utf8").split("\n")) {
  const m = line.match(/^\|\s*([A-Z]+\d*)\s*\|\s*(\d+):(\d+(?:\.\d+)?)\s*\|(.*)\|\s*$/);
  if (!m) continue;
  const cells = m[4].split("|").map((c) => c.trim());
  beats[m[1]] = { t: +m[2] * 60 + +m[3] - T0, vo: cells.at(-1).replace(/^"|"$/g, "").replace(/^—$/, "") };
}
const B = (id) => { if (!(id in beats)) throw new Error(`beat ${id} missing from DEMO_SCRIPT.md`); return beats[id].t; };

// ── easing / math ───────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const easeIO = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u) => 1 - Math.pow(1 - u, 3);

// ── scene state (world = untransformed page CSS px) ─────────────────────────
const cam = { cx: VW / 2, cy: VH / 2, s: 1 };
const cur = { x: 800, y: 760, o: 0, press: 0 };
const spot = { x: 0, y: 0, w: 0, h: 0, o: 0 };
const ripples = [];
let worldH = VH;
let applied = { tx: 0, ty: 0, s: 1 };

function camTransform() {
  const s = cam.s;
  let tx = VW / 2 - cam.cx * s, ty = VH / 2 - cam.cy * s;
  tx = clamp(tx, VW - VW * s, 0);
  ty = worldH * s <= VH ? 0 : clamp(ty, VH - worldH * s, 0);
  return { tx, ty, s };
}
const toScreen = (x, y, t = applied) => ({ x: x * t.s + t.tx, y: y * t.s + t.ty });

// ── timeline ────────────────────────────────────────────────────────────────
let frame = 0;
const now = () => frame / FPS;
const tweens = new Set();
const hooks = new Set();
// Fire-and-forget runs alongside whatever comes next; `await tween(...)` renders frames until it ends.
function tween(dur, fn, ease = easeIO) {
  const tw = { start: now(), dur: Math.max(dur, 1e-6), fn, ease, resolve: () => {} };
  tweens.add(tw);
  return { then: (res, rej) => until(tw.start + tw.dur).then(res, rej) };
}

let page, cdp, ffmpeg;
const guard = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`stuck: ${what} @frame ${frame}`)), 8000))]);
const cues = [];

async function renderFrame() {
  for (const tw of [...tweens]) {
    const u = clamp((now() - tw.start) / tw.dur, 0, 1);
    tw.fn(tw.ease(u));
    if (u >= 1) { tweens.delete(tw); tw.resolve(); }
  }
  for (const h of hooks) await h();
  for (let i = ripples.length - 1; i >= 0; i--) if (now() - ripples[i].t0 > 0.5) ripples.splice(i, 1);

  applied = camTransform();
  const sc = toScreen(cur.x, cur.y);
  const sp = toScreen(spot.x, spot.y);
  worldH = await guard(page.evaluate((st) => window.__apply(st), {
    t: applied, cursor: { x: sc.x, y: sc.y, o: cur.o, press: cur.press, zoom: 1 + (applied.s - 1) * 0.35 },
    spot: { x: sp.x, y: sp.y, w: spot.w * applied.s, h: spot.h * applied.s, o: spot.o },
    ripples: ripples.map((r) => { const p = toScreen(r.x, r.y); const u = (now() - r.t0) / 0.5; return { x: p.x, y: p.y, u }; }),
    dt: 1000 / FPS,
  }), "apply");
  if (cur.o > 0.01) await guard(page.mouse.move(sc.x, sc.y), "mouse.move");

  const target = Math.round(((frame + 1) * 1000) / FPS) - Math.round((frame * 1000) / FPS);
  await guard(page.clock.runFor(target), "runFor");
  const shot = await guard(cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true }), "screenshot");
  const buf = Buffer.from(shot.data, "base64");
  if (!ffmpeg.stdin.write(buf)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (pendingCue) { fs.writeFileSync(path.join(OUT, "cues", `${pendingCue}.jpg`), buf); pendingCue = null; }
  frame++;
}
let pendingCue = null;
async function until(t) { while (now() < t - 1e-6) await renderFrame(); }
async function beat(id) {
  await until(B(id));
  cues.push({ id, planned: B(id), actual: now(), vo: beats[id].vo });
  pendingCue = id;
}
const wait = (s) => until(now() + s);

// ── page queries (return WORLD rects) ───────────────────────────────────────
async function rect(xpath) {
  const r = await page.evaluate((xp) => {
    const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!el) return null;
    const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, xpath);
  if (!r) throw new Error(`not found: ${xpath}`);
  const t = applied;
  return { x: (r.x - t.tx) / t.s, y: (r.y - t.ty) / t.s, w: r.w / t.s, h: r.h / t.s };
}
const union = (...rs) => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const center = (r, fx = 0.5, fy = 0.5) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });

const X = {
  banner: "//div[contains(., 'High shortfall risk') and contains(@class,'rounded-xl')]",
  map: "//div[contains(@class,'maplibregl-map')]",
  kpiGrid: "//div[contains(@class,'uppercase') and normalize-space()='Expected shortfall']/ancestor::div[contains(@class,'grid-cols-2')][1]",
  kpi: (label) => `//div[contains(@class,'uppercase') and normalize-space()='${label}']/..`,
  kpiValue: (label) => `//div[contains(@class,'uppercase') and normalize-space()='${label}']/following-sibling::div[1]`,
  kpiSub: (label) => `//div[contains(@class,'uppercase') and normalize-space()='${label}']/following-sibling::div[2]`,
  lossSplit: "//div[normalize-space()='Why output drops']/..",
  weatherBar: "//div[normalize-space()='Why output drops']/following-sibling::div[1]",
  drivers: "//div[normalize-space()='Top drags on output']/..",
  driverRows: "//div[normalize-space()='Top drags on output']/following-sibling::div",
  forecast: "//h3[normalize-space()='Production forecast']/ancestor::section[1]",
  chart: "//h3[normalize-space()='Production forecast']/ancestor::section[1]//div[contains(@class,'echarts-for-react')]",
  actions: "//h3[normalize-space()='Recommended actions']/ancestor::section[1]",
  card: (n) => `(//h3[normalize-space()='Recommended actions']/ancestor::section[1]//article)[${n}]`,
  cardTitle: (n) => `(//h3[normalize-space()='Recommended actions']/ancestor::section[1]//article)[${n}]//h4`,
  cardSteps: (n) => `(//h3[normalize-space()='Recommended actions']/ancestor::section[1]//article)[${n}]//li`,
  simulate: (n) => `(//h3[normalize-space()='Recommended actions']/ancestor::section[1]//article)[${n}]//button[contains(., 'Simulate')]`,
  whatIf: "//div[contains(., 'What-if active') and contains(@class,'text-emerald-300')]",
  chip: (name) => `//button[normalize-space()='${name}']`,
};
async function rects(xpath) {
  const n = await page.evaluate((xp) => document.evaluate(`count(${xp})`, document, null, XPathResult.NUMBER_TYPE, null).numberValue, xpath);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await rect(`(${xpath})[${i}]`));
  return out;
}

// ── directing verbs ─────────────────────────────────────────────────────────
function camTo(r, { max = 1.8, pad = 48, scale, dur = 1.6, fy = 0.5 } = {}) {
  const s1 = scale ?? clamp(Math.min(VW / (r.w + 2 * pad), VH / (r.h + 2 * pad)), 1, max);
  const c1 = center(r, 0.5, fy);
  // start from where the camera *visibly* is (post-clamp), so there is no jump
  const a = camTransform();
  const s0 = a.s, cx0 = (VW / 2 - a.tx) / s0, cy0 = (VH / 2 - a.ty) / s0;
  return tween(dur, (u) => {
    cam.s = Math.exp(lerp(Math.log(s0), Math.log(s1), u));
    cam.cx = lerp(cx0, c1.x, u); cam.cy = lerp(cy0, c1.y, u);
  });
}
const camWide = (dur = 1.8) => camTo({ x: 0, y: 0, w: VW, h: VH }, { scale: 1, dur, pad: 0 });

let bow = 1;
function moveTo(p, dur) {
  const x0 = cur.x, y0 = cur.y, dx = p.x - x0, dy = p.y - y0, d = Math.hypot(dx, dy);
  dur ??= clamp(0.55 + d / 900, 0.8, 1.5);
  bow = -bow;
  const kx = x0 + dx / 2 - (dy / (d || 1)) * d * 0.12 * bow, ky = y0 + dy / 2 + (dx / (d || 1)) * d * 0.12 * bow;
  return tween(dur, (u) => {
    cur.x = (1 - u) ** 2 * x0 + 2 * (1 - u) * u * kx + u * u * p.x;
    cur.y = (1 - u) ** 2 * y0 + 2 * (1 - u) * u * ky + u * u * p.y;
  });
}
async function click() {
  ripples.push({ x: cur.x, y: cur.y, t0: now() });
  tween(0.25, (u) => { cur.press = Math.sin(u * Math.PI); }, (u) => u);
  const p = toScreen(cur.x, cur.y);
  await page.mouse.click(p.x, p.y);
}
function spotOn(r, { pad = 10, dur = 0.6 } = {}) {
  const from = { ...spot }, to = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
  const fresh = spot.o < 0.05;
  return tween(dur, (u) => {
    for (const k of ["x", "y", "w", "h"]) spot[k] = fresh ? to[k] : lerp(from[k], to[k], u);
    spot.o = lerp(from.o, 1, u);
  });
}
const spotOff = (dur = 0.5) => { const o0 = spot.o; return tween(dur, (u) => { spot.o = lerp(o0, 0, u); }); };

// ── overlay injected into the page ──────────────────────────────────────────
const OVERLAY = () => {
  const css = `
    html, body { overflow: hidden !important; scrollbar-width: none; }
    *, *::before, *::after { cursor: none !important; }
    #root { transform-origin: 0 0; }
    #__spot { position: fixed; z-index: 2147483600; pointer-events: none; border-radius: 16px;
      box-shadow: 0 0 0 200vmax rgba(2, 6, 23, 0.58), 0 0 0 1.5px rgba(56, 189, 248, 0.55), 0 0 32px rgba(56, 189, 248, 0.25); }
    #__cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 26px; height: 26px;
      transform-origin: 3px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    .__ripple { position: fixed; z-index: 2147483646; pointer-events: none; border-radius: 50%;
      border: 2px solid rgba(56, 189, 248, 0.9); background: rgba(56, 189, 248, 0.18); }`;
  const init = () => {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const spot = document.createElement("div"); spot.id = "__spot"; spot.style.opacity = "0"; document.body.appendChild(spot);
    const c = document.createElement("div"); c.id = "__cursor";
    c.innerHTML = `<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2 L3 20.5 L7.8 16.1 L11.1 23.4 L14.3 22 L11.1 14.9 L17.6 14.9 Z"
      fill="#0b1220" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    c.style.opacity = "0"; document.body.appendChild(c);
    const seen = new WeakSet();
    window.__apply = ({ t, cursor, spot: sp, ripples, dt }) => {
      const root = document.getElementById("root");
      root.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`;
      c.style.opacity = cursor.o;
      c.style.transform = `translate(${cursor.x - 3}px, ${cursor.y - 2}px) scale(${cursor.zoom * (1 - 0.15 * cursor.press)})`;
      spot.style.opacity = sp.o;
      Object.assign(spot.style, { left: `${sp.x}px`, top: `${sp.y}px`, width: `${sp.w}px`, height: `${sp.h}px` });
      document.querySelectorAll(".__ripple").forEach((n) => n.remove());
      for (const r of ripples) {
        const d = 8 + 44 * (1 - Math.pow(1 - r.u, 3)), n = document.createElement("div");
        n.className = "__ripple";
        Object.assign(n.style, { left: `${r.x - d / 2}px`, top: `${r.y - d / 2}px`, width: `${d}px`, height: `${d}px`, opacity: String(1 - r.u) });
        document.body.appendChild(n);
      }
      // CSS transitions/animations run on wall time; step them on our virtual clock instead
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = 0; }
        const end = a.effect?.getComputedTiming().endTime;
        const next = (a.currentTime ?? 0) + dt;
        if (end !== Infinity && next >= end) a.finish(); else a.currentTime = next;
      }
      return root.offsetHeight;
    };
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
};

// ── pre-roll: regional map view + locate the Dongri Buzurg marker ───────────
// Rehearsal on a throwaway page (real clock, same HTTP cache): walk the map path once so every
// satellite tile is cached, so the recorded fly-to and zoom never show a black or blurry frame.
async function rehearse(ctx) {
  const rec = page;
  page = await ctx.newPage();
  await page.goto(URL);
  const r = await position();
  await page.mouse.click(r.dbz.x, r.dbz.y);
  await page.waitForTimeout(2000);
  await page.mouse.move(r.mapCenter.x, r.mapCenter.y);
  for (let i = 0; i < 140; i++) { await page.mouse.wheel(0, -2.6); await page.waitForTimeout(16); }
  await page.waitForTimeout(2500);
  await page.click("xpath=" + X.chip("Mansar"));
  await page.waitForTimeout(2500);
  await page.close();
  page = rec;
}

async function preroll() {
  await page.goto(URL);
  return position();
}

async function position() {
  await page.waitForSelector("text=Recommended actions");
  await page.waitForTimeout(2500);                              // Balaghat auto-selected + fly-to done
  const m = await rect(X.map);
  const mc = center(m);
  // Balaghat is centred at z9.5. Drag so the view centres on the mine cluster (79.74E, 21.675N),
  // then one zoom-out step → z8.5, where all five mines fit.
  const pxPerDeg = (512 * 2 ** 9.5) / 360;
  const dx = (80.233 - 79.74) * pxPerDeg;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const dy = ((merc(21.966) - merc(21.675)) * 512 * 2 ** 9.5) / (2 * Math.PI);
  await page.mouse.move(mc.x - dx / 2, mc.y + dy / 2);
  await page.mouse.down();
  await page.mouse.move(mc.x + dx / 2, mc.y - dy / 2, { steps: 30 });
  await page.waitForTimeout(400);                               // kill inertia
  await page.mouse.up();
  await page.click(".maplibregl-ctrl-zoom-out");
  await page.waitForTimeout(2500);                              // tiles

  // Predicted DBZ pixel at z8.5, then refine by hit-testing MapLibre's pointer cursor.
  const pz = (512 * 2 ** 8.5) / 360;
  const guess = { x: mc.x + (79.682 - 79.74) * pz, y: mc.y + ((merc(21.675) - merc(21.548)) * 512 * 2 ** 8.5) / (2 * Math.PI) };
  const hits = [];
  for (let oy = -14; oy <= 14; oy += 2) for (let ox = -14; ox <= 14; ox += 2) {
    await page.mouse.move(guess.x + ox, guess.y + oy);
    if (await page.evaluate(() => document.querySelector(".maplibregl-canvas").style.cursor === "pointer")) hits.push([ox, oy]);
  }
  if (!hits.length) throw new Error("could not locate Dongri Buzurg marker on the map");
  const dbz = { x: guess.x + hits.reduce((a, h) => a + h[0], 0) / hits.length, y: guess.y + hits.reduce((a, h) => a + h[1], 0) / hits.length };
  await page.mouse.move(VW / 2, VH - 20);
  return { dbz, mapCenter: mc };
}

// ── the show ────────────────────────────────────────────────────────────────
async function show({ dbz, mapCenter }) {
  // A — GIS map
  await beat("A1");
  tween(0.6, (u) => { cur.o = u; });
  await wait(0.8);
  const banner = await rect(X.banner);
  await moveTo({ x: banner.x + 330, y: center(banner).y + 3 }, 1.1);

  await beat("A2");
  camTo(await rect(X.map), { max: 1.55, dur: 1.6 });
  await wait(0.35);
  await moveTo(dbz, 1.5);

  await beat("A3");
  await click();

  await beat("A4");
  await moveTo(mapCenter, 0.6);                                 // fly-to has centred DBZ; follow it
  const wheelEnd = B("A5");                                     // ~2 zoom levels of smooth trackpad-style scroll
  hooks.add(async () => { if (now() < wheelEnd) await page.mouse.wheel(0, -2.6 * (60 / FPS)); });

  await beat("A5");
  hooks.clear();
  moveTo({ x: mapCenter.x + 14, y: mapCenter.y + 8 }, 1.8);

  await beat("A6");
  const kpis = await rect(X.kpiGrid);
  camTo(kpis, { max: 1.8, dur: 1.5 });
  await wait(0.2);
  await moveTo(center(await rect(X.kpiSub("Reserve P50")), 0.55, 1.6), 1.3);

  await beat("A7");
  await spotOn(await rect(X.kpi("Reserve P50")));

  // B — shortfall engine
  await beat("B1");
  spotOn(await rect(X.kpi("Expected shortfall")), { dur: 0.7 });
  await moveTo(center(await rect(X.kpiValue("Expected shortfall")), 0.9, 0.95), 1.0);

  await beat("B2");
  spotOn(await rect(X.kpi("P(shortfall > 10%)")), { dur: 0.7 });
  await moveTo(center(await rect(X.kpiValue("P(shortfall > 10%)")), 0.75, 0.95), 1.0);

  await beat("B3");
  spotOff();
  camTo(await rect(X.forecast), { max: 1.4, dur: 1.7 });
  await wait(0.5);
  let ch = await rect(X.chart);
  const dayX = async (i) => {                                   // echarts grid: left 52, right 44, 7 categories
    ch = await rect(X.chart);
    return ch.x + 52 + ((i + 0.5) * (ch.w - 96)) / 7;
  };
  await moveTo({ x: await dayX(0), y: ch.y + ch.h * 0.62 }, 1.2);

  await beat("B4");
  const dwell = [0.5, 0.5, 1.3, 1.3, 1.0, 0.5];           // linger on the storm days
  for (let i = 1; i < 7; i++) {
    await wait(dwell[i - 1]);
    await moveTo({ x: await dayX(i), y: ch.y + ch.h * (i >= 3 && i <= 5 ? 0.72 : 0.62) }, 0.55);
  }

  await beat("B5");
  const ls = await rect(X.lossSplit), dr = await rect(X.drivers);
  camTo(union(ls, dr), { max: 1.6, dur: 1.5 });
  await wait(0.2);
  spotOn(ls, { dur: 0.6 });
  const wb = await rect(X.weatherBar);
  await moveTo({ x: wb.x + wb.w * 0.4, y: wb.y + wb.h + 6 }, 1.2);

  await beat("B6");
  spotOn(dr, { dur: 0.7 });
  const rows = await rects(X.driverRows);
  for (const r of rows) { await moveTo({ x: r.x + r.w * 0.55, y: r.y + r.h * 0.45 }, 0.8); await wait(0.7); }

  // C — action optimizer
  await beat("C1");
  spotOff();
  camTo(await rect(X.card(1)), { max: 1.45, dur: 1.6, pad: 40 });
  await wait(0.3);
  const t1 = await rect(X.cardTitle(1));
  await moveTo({ x: t1.x + t1.w * 0.45, y: t1.y + t1.h + 4 }, 1.2);
  for (const s of await rects(X.cardSteps(1))) { await wait(0.25); await moveTo({ x: s.x + Math.min(s.w, 330) * 0.9, y: s.y + s.h * 0.6 }, 0.6); }

  await beat("C2");
  await moveTo(center(await rect(X.simulate(1))), 0.8);
  await until(B("C2") + 0.8);
  await click();

  await beat("C3");
  camTo(union(await rect(X.forecast), await rect(X.actions)), { max: 1.0, dur: 1.5 });
  await moveTo({ x: cur.x - 40, y: cur.y + 30 }, 1.0);

  await beat("C4");
  const wi = await rect(X.whatIf);
  camTo(wi, { max: 1.8, dur: 1.4, pad: 180 });
  await wait(0.4);
  spotOn(wi, { pad: 12 });
  await moveTo({ x: wi.x - 30, y: wi.y + wi.h + 18 }, 1.0);

  await beat("C5");
  spotOff();
  camTo(union(await rect(X.chip("Balaghat")), await rect(X.chip("Mansar"))), { max: 1.5, dur: 1.4, pad: 120 });
  await wait(0.3);
  await moveTo(center(await rect(X.chip("Mansar"))), 1.0);
  await until(B("C5") + 1.4);
  await click();

  await beat("C6");
  await until(B("C6"));
  camTo(await rect(X.card(1)), { max: 1.45, dur: 1.5, pad: 40 });
  await wait(0.5);
  spotOn(await rect(X.card(1)), { pad: 8 });
  const steps = await rects(X.cardSteps(1));
  for (const s of steps.slice(0, 3)) { await moveTo({ x: s.x + Math.min(s.w, 300) * 0.85, y: s.y + s.h * 0.6 }, 0.55); await wait(0.1); }

  await beat("C7");
  spotOff(0.3);
  await moveTo(center(await rect(X.simulate(1))), 0.5);
  await wait(0.1);
  await click();

  await beat("C8");
  camTo(await rect(X.kpiGrid), { max: 1.8, dur: 1.5 });
  await wait(0.9);
  spotOn(await rect(X.kpi("Expected shortfall")));
  await moveTo(center(await rect(X.kpiValue("Expected shortfall")), 0.95, 0.95), 1.1);

  await beat("C9");
  spotOff(0.6);
  camWide(2.0);
  await wait(1.2);
  tween(0.8, (u) => { cur.o = 1 - u; });

  await beat("END");
}

// ── main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "cues"), { recursive: true });
const outFile = path.join(OUT, PREVIEW ? "moil_demo_preview.mp4" : "moil_demo_1080p60.mp4");
ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-filter_complex", "scale=1920:1080:flags=lanczos,format=yuv420p,split=2[h264][av1]",
  // H.264 for Premiere / Final Cut / CapCut / web …
  "-map", "[h264]", "-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "16", "-b:v", "0",
  "-profile:v", "high", "-movflags", "+faststart", outFile,
  // … and AV1 for Linux editors whose ffmpeg has no H.264 decoder (Fedora ffmpeg-free, Resolve free on Linux)
  "-map", "[av1]", "-c:v", "libsvtav1", "-preset", "6", "-crf", "20", "-g", "120", "-movflags", "+faststart",
  outFile.replace(/\.mp4$/, "_av1.mp4")], { stdio: ["pipe", "inherit", "inherit"] });

const browser = await chromium.launch({
  channel: "chromium",                                          // full Chromium: real GPU in new headless
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl-egl", "--hide-scrollbars"],
});
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, colorScheme: "dark" });
await ctx.addInitScript(OVERLAY);
await rehearse(ctx);
page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.clock.install();                                     // virtual clock; flows naturally until paused
const anchors = await preroll();
await page.clock.pauseAt(Date.now() + 1000);
cdp = await ctx.newCDPSession(page);

const started = Date.now();
const ticker = setInterval(() => process.stdout.write(`\r  frame ${frame}  (${now().toFixed(1)} s video)   `), 1000);
try {
  await show(anchors);
  await until(B("END") + 0.02);
} finally {
  clearInterval(ticker);
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on("close", r));
  await browser.close();
}

// beat report + voiceover guide
const fmt = (s) => { const t = s + T0, m = Math.floor(t / 60), r = t - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };
const srtT = (s) => { const ms = Math.round(s * 1000); const h = String(Math.floor(ms / 3.6e6)).padStart(2, "0");
  const m = String(Math.floor(ms / 6e4) % 60).padStart(2, "0"), sec = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, "0")}`; };
console.log(`\n\n  ${frame} frames → ${outFile}  (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
console.log("  beat   planned   actual");
for (const c of cues) console.log(`  ${c.id.padEnd(5)}  ${fmt(c.planned)}    ${fmt(c.actual)}${Math.abs(c.actual - c.planned) > 0.05 ? "   ⚠ late" : ""}`);
const spoken = cues.filter((c) => c.vo);
fs.writeFileSync(path.join(OUT, "voiceover_guide.srt"), spoken.map((c, i) => {
  const end = (spoken[i + 1]?.actual ?? B("END")) - 0.05;
  return `${i + 1}\n${srtT(c.actual)} --> ${srtT(end)}\n[${c.id}] ${c.vo}\n`;
}).join("\n"));
