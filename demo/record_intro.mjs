// Renders the 20 s problem-statement intro (0:00-0:20) from intro/intro.html, frame-perfect at 60 fps.
//
// Put AI clips in intro/clips/ as s1.<ext> (steel pour) and s4.<ext> (monsoon pit); any format
// ffmpeg reads. Missing clips render as labelled placeholders so the cut can be reviewed first.
//
//   node record_intro.mjs     -> out/intro_1080p60.mp4 (+ _av1.mp4)

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTRO = path.join(HERE, "intro");
const CLIPS = path.join(INTRO, "clips");
const OUT = path.join(HERE, "out");
const FPS = 60, DUR = 20, VW = 1600, VH = 900;

// ── clips: per-shot treatment, then all-keyframe VP9 so every per-frame seek is exact and fast ──
const FILL = `scale=${VW}:${VH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${VW}:${VH}`;
const FX = {
  // Vertical 360x640 phone clip: a sharp portrait panel on the right over a blurred, darkened copy
  // of itself (fills 16:9 with the furnace glow without upscaling the subject 4x). Uses 0-4.6 s.
  s1: `[0:v]split=2[a][b];[a]${FILL},gblur=sigma=38,eq=brightness=-0.16:saturation=1.25[bg];` +
      `[b]scale=-2:780:flags=lanczos,unsharp=5:5:0.7,pad=iw+2:ih+2:1:1:color=0x404040[fg];` +
      `[bg][fg]overlay=x=W-w-150:y=(H-h)/2,fps=30[out]`,
  // Flow/Veo clip: crop away the bottom-right sparkle watermark (~x1140-1180, y580-620 of 1280x720),
  // keeping 16:9; the 1.14x crop reads as part of the push-in.
  s4: `[0:v]crop=1120:630:10:0,${FILL},fps=30[out]`,
};
const clips = {};
for (const id of ["s1", "s4"]) {
  const src = fs.readdirSync(CLIPS).find((f) => f.startsWith(id + ".") && !f.startsWith("_"));
  if (!src) { console.log(`  ${id}: no clip, using placeholder`); continue; }
  const inp = path.join(CLIPS, src), out = path.join(CLIPS, `_${id}.webm`);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(inp).mtimeMs) {
    console.log(`  ${id}: transcoding ${src}`);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", inp, "-t", "4.6", "-an",
      "-filter_complex", FX[id] ?? `[0:v]${FILL},fps=30[out]`, "-map", "[out]",
      "-c:v", "libvpx-vp9", "-crf", "18", "-b:v", "0", "-g", "1", "-deadline", "good", "-cpu-used", "4", out], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed on ${src}`);
  }
  clips[id] = `clips/_${id}.webm`;
  console.log(`  ${id}: ${src}`);
}

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, "intro_1080p60.mp4");
const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-filter_complex", "scale=1920:1080:flags=lanczos,format=yuv420p,split=2[h264][av1]",
  "-map", "[h264]", "-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "16", "-b:v", "0",
  "-profile:v", "high", "-movflags", "+faststart", outFile,
  "-map", "[av1]", "-c:v", "libsvtav1", "-preset", "6", "-crf", "20", "-g", "120", "-movflags", "+faststart",
  outFile.replace(/\.mp4$/, "_av1.mp4")], { stdio: ["pipe", "inherit", "inherit"] });

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl-egl", "--hide-scrollbars",
    "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
await ctx.addInitScript((c) => { window.CLIPS = c; }, clips);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.clock.install();                                   // MapLibre flight runs on virtual time
await page.goto(pathToFileURL(path.join(INTRO, "intro.html")).href);
await page.evaluate(() => window.__ready());

// Rehearse the satellite flight once in real time so every tile is cached, then reset.
await page.evaluate(() => { window.__render(9); window.__fly(); });
await page.waitForTimeout(4500);
await page.evaluate(() => window.__mapIdle());
await page.evaluate(() => { window.__reset(); window.__render(0); });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__mapIdle());
await page.clock.pauseAt(Date.now() + 1000);
const cdp = await ctx.newCDPSession(page);

let flown = false;
const started = Date.now();
for (let f = 0; f < DUR * FPS; f++) {
  const t = f / FPS;
  if (!flown && t >= 8.0) { await page.evaluate(() => window.__fly()); flown = true; }
  await page.evaluate(async (tt) => { window.__render(tt); await window.__seek(tt); }, t);
  await page.clock.runFor(Math.round(((f + 1) * 1000) / FPS) - Math.round((f * 1000) / FPS));
  const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true });
  if (!ffmpeg.stdin.write(Buffer.from(shot.data, "base64"))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (f % 60 === 0) process.stdout.write(`\r  ${t.toFixed(0)} s / ${DUR} s   `);
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));
await browser.close();
console.log(`\n  ${DUR * FPS} frames -> ${outFile} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
