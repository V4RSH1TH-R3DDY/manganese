// Builds VOICEOVER.md: every VO line of the full video, in order, from the same script tables that
// drive the renders (so the read-along can't drift from the cut).
//
//   node voiceover.mjs   -> VOICEOVER.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECTIONS = [                                              // [start s, title, script]
  [0, "Problem statement", "intro/INTRO_SCRIPT.md"],
  [24, "Our solution", "solution/SOLUTION_SCRIPT.md"],
  [64, "Live prototype: Command center", "DEMO_SCRIPT.md"],
  [154, "Live prototype: Reserves, Actions, Data adapter", "outro/OUTRO_SCRIPT.md"],
  [178, "Impact, roadmap and team", "outro/OUTRO_SCRIPT.md"],
];
const END = 210;

const lines = [];
for (const f of new Set(SECTIONS.map((s) => s[2]))) {
  for (const row of fs.readFileSync(path.join(HERE, f), "utf8").split("\n")) {
    const m = row.match(/^\|\s*([A-Z]+\d*)\s*\|\s*(\d+):(\d+(?:\.\d+)?)[^|]*\|(.*)\|\s*$/);
    if (!m) continue;
    const vo = m[4].split("|").at(-1).trim().replace(/^"|"$/g, "");
    if (vo && vo !== "—") lines.push({ t: +m[2] * 60 + +m[3], vo });
  }
}
lines.sort((a, b) => a.t - b.t);

const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const words = (s) => s.split(/\s+/).filter(Boolean).length;
let md = `# Voiceover: read-along script

Team Chalcogens · SIH 2026 · PS 26009 · **3:30 total**

Read each line when its timecode comes up (or load \`out/full_voiceover.srt\` as a subtitle track in
your editor to see them on the video). Target pace is about 2.3 words per second: calm, not rushed.
Lines ending in "—" run straight into the next one. Numbers in the demo match the 26 Sep 2026 data.

`;
for (const [i, [start, title]] of SECTIONS.entries()) {
  const end = SECTIONS[i + 1]?.[0] ?? END;
  const inSec = lines.filter((l) => l.t >= start && l.t < end);
  md += `## ${mmss(start)}–${mmss(end)} · ${title}\n\n| Time | Line |\n|---|---|\n`;
  for (const l of inSec) md += `| ${mmss(l.t)} | ${l.vo} |\n`;
  const w = inSec.reduce((a, l) => a + words(l.vo), 0);
  md += `\n*${w} words in ${end - start} s (${(w / (end - start)).toFixed(1)} words/s)*\n\n`;
}
fs.writeFileSync(path.join(HERE, "VOICEOVER.md"), md);
console.log(`VOICEOVER.md: ${lines.length} lines`);
