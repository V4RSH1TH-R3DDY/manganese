// Joins the five rendered segments into the full video and builds one voiceover subtitle file.
//
//   node assemble.mjs   -> out/full_1080p60.mp4 (+ _av1.mp4), out/full_voiceover.srt
//
// Segments are read from their AV1 renders (decodable by any ffmpeg build) and trimmed to their
// exact slot, so every VO line lands at the time written in the scripts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const SEGMENTS = [                                             // file, slot length (s)
  ["intro_1080p60_av1.mp4", 20],       // 0:00-0:20 problem
  ["solution_1080p60_av1.mp4", 30],    // 0:20-0:50 solution
  ["moil_demo_1080p60_av1.mp4", 60],   // 0:50-1:50 live prototype
  ["tour_1080p60_av1.mp4", 12],        // 1:50-2:02 Reserves / Actions / Data adapter
  ["outro_1080p60_av1.mp4", 16],       // 2:02-2:18 impact, roadmap, end card
];
const SCRIPTS = ["intro/INTRO_SCRIPT.md", "solution/SOLUTION_SCRIPT.md", "DEMO_SCRIPT.md", "outro/OUTRO_SCRIPT.md"];
const TOTAL = SEGMENTS.reduce((a, [, d]) => a + d, 0);

// ── video ──
const inputs = SEGMENTS.flatMap(([f, d]) => {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) throw new Error(`missing ${f}: render it first`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], { encoding: "utf8" });
  const got = parseFloat(probe.stdout);
  if (!(got >= d - 0.02)) throw new Error(`${f} is ${got.toFixed(2)} s, needs ${d} s: re-render it (an interrupted render?)`);
  return ["-i", p];
});
const trims = SEGMENTS.map(([, d], i) => `[${i}:v]trim=0:${d},setpts=PTS-STARTPTS,fps=60[v${i}]`).join(";");
const concat = SEGMENTS.map((_, i) => `[v${i}]`).join("") + `concat=n=${SEGMENTS.length}:v=1:a=0,format=yuv420p,split=2[h264][av1]`;
const outFile = path.join(OUT, "full_1080p60.mp4");
console.log(`joining ${SEGMENTS.length} segments (${TOTAL} s)…`);
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${trims};${concat}`,
  "-map", "[h264]", "-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "16", "-b:v", "0",
  "-profile:v", "high", "-movflags", "+faststart", outFile,
  "-map", "[av1]", "-c:v", "libsvtav1", "-preset", "6", "-crf", "20", "-g", "120", "-movflags", "+faststart",
  outFile.replace(/\.mp4$/, "_av1.mp4")], { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg failed");

// ── voiceover subtitles: every table row "| ID | m:ss… | … | "VO" |" across the scripts ──
const lines = [];
for (const f of SCRIPTS) {
  for (const row of fs.readFileSync(path.join(HERE, f), "utf8").split("\n")) {
    const m = row.match(/^\|\s*([A-Z]+\d*)\s*\|\s*(\d+):(\d+(?:\.\d+)?)[^|]*\|(.*)\|\s*$/);
    if (!m) continue;
    const vo = m[4].split("|").at(-1).trim().replace(/^"|"$/g, "");
    if (vo && vo !== "—") lines.push({ t: +m[2] * 60 + +m[3], vo, id: m[1] });
  }
}
lines.sort((a, b) => a.t - b.t);
const ts = (s) => {
  const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3.6e6))}:${p(Math.floor(ms / 6e4) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
fs.writeFileSync(path.join(OUT, "full_voiceover.srt"), lines.map((l, i) =>
  `${i + 1}\n${ts(l.t)} --> ${ts(Math.min(lines[i + 1]?.t ?? TOTAL, TOTAL) - 0.05)}\n[${l.id}] ${l.vo}\n`).join("\n"));
console.log(`${outFile}\n${lines.length} VO lines -> out/full_voiceover.srt`);
