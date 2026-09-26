// Renders a timeline-driven HTML segment frame-perfect at 60 fps.
//
//   node record_segment.mjs intro      0:00-0:20 problem statement -> out/intro_1080p60.mp4
//   node record_segment.mjs solution   0:20-0:50 solution          -> out/solution_1080p60.mp4
//                                      (run capture_assets.mjs first, with `make run` up)
//   node record_segment.mjs outro      2:02-2:18 impact, roadmap   -> out/outro_1080p60.mp4
//
// The page exposes __render(t) and optionally __ready(), __seek(t) (video clips), __warm() (one-off
// prep such as caching map tiles) and __cues = [{ t, run }] (actions fired once at time t).
// Clips go in <segment>/clips/ as <id>.<ext>; missing ones render as labelled placeholders.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEGMENTS = {
  // stretch: the page timeline is authored at 1x and played back `stretch` times slower
  intro:    { page: "intro/intro.html", dur: 24, stretch: 1.2, clips: ["s1", "s4"] },          // 0:00-0:24
  solution: { page: "solution/solution.html", dur: 40, stretch: 4 / 3, clips: [] },          // 0:24-1:04
  outro:    { page: "outro/outro.html", dur: 32, stretch: 1, clips: [] },                    // 2:58-3:30
};
const NAME = process.argv[2] ?? "intro";
const SEG = SEGMENTS[NAME];
if (!SEG) throw new Error(`unknown segment "${NAME}"; one of ${Object.keys(SEGMENTS).join(", ")}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, SEG.page);
const CLIPS = path.join(path.dirname(PAGE), "clips");
const OUT = path.join(HERE, "out");
const FPS = 60, DUR = SEG.dur, STRETCH = SEG.stretch ?? 1, VW = 1600, VH = 900;

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
for (const id of SEG.clips) {
  const src = (fs.existsSync(CLIPS) ? fs.readdirSync(CLIPS) : []).find((f) => f.startsWith(id + ".") && !f.startsWith("_"));
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
const outFile = path.join(OUT, `${NAME}_1080p60.mp4`);
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
await ctx.addInitScript(([c, k]) => { window.CLIPS = c; window.__STRETCH = k; }, [clips, STRETCH]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.clock.install();                                   // rAF / timers run on virtual time
await page.goto(pathToFileURL(PAGE).href);
await page.evaluate(async () => { await window.__ready?.(); await window.__warm?.(); window.__render(0); });
await page.clock.pauseAt(Date.now() + 1000);
const cdp = await ctx.newCDPSession(page);

const cueTimes = await page.evaluate(() => (window.__cues ?? []).map((c) => c.t));
const fired = new Set();
const started = Date.now();
for (let f = 0; f < DUR * FPS; f++) {
  const t = f / FPS;
  for (const [i, ct] of cueTimes.entries())
    if (!fired.has(i) && t / STRETCH >= ct) { await page.evaluate((k) => window.__cues[k].run(), i); fired.add(i); }
  await page.evaluate(async (tt) => { window.__render(tt); await window.__seek?.(tt); }, t / STRETCH);
  await page.clock.runFor(Math.round(((f + 1) * 1000) / FPS) - Math.round((f * 1000) / FPS));
  const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true });
  if (!ffmpeg.stdin.write(Buffer.from(shot.data, "base64"))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (f % 60 === 0) process.stdout.write(`\r  ${t.toFixed(0)} s / ${DUR} s   `);
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));
await browser.close();
console.log(`\n  ${DUR * FPS} frames -> ${outFile} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
