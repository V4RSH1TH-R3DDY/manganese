# Pitch video

3:30 at 1080p60, built from five segments rendered frame-by-frame and joined by `assemble.mjs`.

| Time | Segment | Script | Render |
|---|---|---|---|
| 0:00–0:24 | Problem statement | `intro/INTRO_SCRIPT.md` | `node record_segment.mjs intro` |
| 0:24–1:04 | Solution, value, innovation | `solution/SOLUTION_SCRIPT.md` | `node capture_assets.mjs && node record_segment.mjs solution` |
| 1:04–2:34 | Live prototype: Command center | `DEMO_SCRIPT.md` | `node record.mjs` |
| 2:34–2:58 | Live tour: Reserves, Actions, Data adapter | `outro/OUTRO_SCRIPT.md` | `node record.mjs --tour` (isolated instance, see the script) |
| 2:58–3:30 | Market impact, roadmap, team, end card | `outro/OUTRO_SCRIPT.md` | `node record_segment.mjs outro` |

```bash
make data && make run            # from the repo root, on the recording day
cd demo && npm install           # once
# render the segments above, then:
node assemble.mjs                # -> out/full_1080p60.mp4 (+ _av1.mp4), out/full_voiceover.srt
```

**Voiceover:** read from `VOICEOVER.md`: every line in order with its timecode, per-section pacing,
rebuilt with `node voiceover.mjs` after editing any script. `out/full_voiceover.srt` carries the same
lines at their absolute times (`node assemble.mjs --srt` rebuilds just that). Load it as a subtitle track
while recording the voiceover. The AV1 files are for Linux editors whose ffmpeg can't decode H.264.
