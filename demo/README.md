# Pitch video

2:18 at 1080p60, built from five segments rendered frame-by-frame and joined by `assemble.mjs`.

| Time | Segment | Script | Render |
|---|---|---|---|
| 0:00–0:20 | Problem statement | `intro/INTRO_SCRIPT.md` | `node record_segment.mjs intro` |
| 0:20–0:50 | Solution, value, innovation | `solution/SOLUTION_SCRIPT.md` | `node capture_assets.mjs && node record_segment.mjs solution` |
| 0:50–1:50 | Live prototype: Command center | `DEMO_SCRIPT.md` | `node record.mjs` |
| 1:50–2:02 | Live tour: Reserves, Actions, Data adapter | `outro/OUTRO_SCRIPT.md` | `node record.mjs --tour` (isolated instance, see the script) |
| 2:02–2:18 | Market impact, roadmap, end card | `outro/OUTRO_SCRIPT.md` | `node record_segment.mjs outro` |

```bash
make data && make run            # from the repo root, on the recording day
cd demo && npm install           # once
# render the segments above, then:
node assemble.mjs                # -> out/full_1080p60.mp4 (+ _av1.mp4), out/full_voiceover.srt
```

`out/full_voiceover.srt` carries every VO line at its absolute time. Load it as a subtitle track
while recording the voiceover. The AV1 files are for Linux editors whose ffmpeg can't decode H.264.
