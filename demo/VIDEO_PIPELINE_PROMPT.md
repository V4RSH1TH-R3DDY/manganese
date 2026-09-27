# Prompt: reproduce the pitch-video pipeline

Paste everything below the line into a coding agent (e.g. Claude Code) at the root of a web-app repo.
Fill in the `<…>` placeholders. It describes the pipeline that produced the MOIL Manganese Copilot
3:30 video: the architecture, every motion parameter, the story structure, the QA loop, and the
mistakes to avoid. The agent should rebuild it for *your* app rather than copy MOIL-specific content.

---

You are building a **code-driven, frame-perfect product video** for `<PROJECT NAME>`, a web app in this
repo, for `<EVENT / AUDIENCE>`. Total length **exactly `<M:SS>`**, 1920×1080 at 60 fps, silent (a human
records the voiceover later). Nothing is screen-captured by hand: every frame is rendered by
Playwright driving headless Chromium, so the video is reproducible from scripts with one command
per segment.

## 1. Story structure

Split the runtime into five segments and allocate time by importance; give the live product the
largest share. Reference allocation for 3:30:

| Segment | Share | Content |
|---|---|---|
| Problem | ~11% (0:00–0:24) | The real-world pain, told with **verified, sourced facts** and 1–2 footage clips |
| Solution | ~19% (0:24–1:04) | Name reveal, the core idea as connected stages each illustrated by **real app screenshots**, 3–4 differentiators, a bookend line that echoes the problem |
| Live demo, main screen | ~43% (1:04–2:34) | The hero workflow, choreographed beat by beat |
| Live tour of the other tabs | ~11% (2:34–2:58) | Every remaining screen, each doing one real action on camera |
| Impact, roadmap, team, end card | ~15% (2:58–3:30) | Market numbers, 3-phase roadmap, team card, end card |

Rules: **every number on screen is sourced** (with a small mono source line) or computed from data on
screen; never invent statistics. Label synthetic data and illustrative/AI footage on screen. **Every
screen/tab of the app must appear at least once.** Voiceover runs at ~2.2 words/second (never above
2.6); lines ending in "—" run into the next line.

## 2. Architecture

```
demo/
  DEMO_SCRIPT.md          beat sheet for the live demo  (single source of truth: times + VO)
  <segment>/<SEG>_SCRIPT.md  beat sheets for the designed segments
  record.mjs              live-app recorder (camera, cursor, spotlight); `--tour` mode for other tabs
  record_segment.mjs      renders a designed HTML segment: intro | solution | outro
  <segment>/<segment>.html  one self-contained page per designed segment, timeline = pure function of t
  capture_assets.mjs      screenshots of the running app used inside designed segments
  assemble.mjs            trims + concatenates segments, builds one SRT of all VO lines
  voiceover.mjs           builds VOICEOVER.md (read-along script) from the same tables
```

**Beat sheets are the single source of truth.** Markdown tables with rows
`| ID | m:ss.s | Camera | Cursor / UI | "VO line" |`. IDs match `[A-Z]+\d*`, and times are absolute
video time. Recorders parse them with a regex and hit each beat on its exact frame, printing
planned vs actual time per beat. The SRT and the read-along script are generated from the same
tables, so script, video and voiceover can never drift.

## 3. Rendering engine (both recorders)

- **Virtual time.** `page.clock.install()` *before* navigation (libraries capture
  `requestAnimationFrame` / `performance.now` at load). Let it flow during setup, then
  `page.clock.pauseAt(now + 1000)`. Per frame: apply the scene state → `page.clock.runFor(ms)`, where
  ms alternates 16/17 so the integer sum stays exact → CDP `Page.captureScreenshot` (JPEG q93,
  `optimizeForSpeed`). Smoothness then never depends on render speed.
- **CSS transitions** run on wall time, so step them: each frame, for `document.getAnimations()`,
  pause new ones and advance `currentTime += 1000/60`, finishing when past `endTime`.
- **Resolution.** Viewport 1600×900 CSS at `deviceScaleFactor: 2` → 3200×1800 frames → ffmpeg
  `scale=1920:1080:flags=lanczos`. Zooms up to 1.8× stay sharp.
- **GPU.** Full Chromium (`channel: "chromium"`) with `--enable-gpu --ignore-gpu-blocklist --use-gl=angle
  --use-angle=gl-egl`. SwiftShader is ~2× slower.
- **Encoding.** Pipe JPEGs to one ffmpeg (`-f image2pipe -c:v mjpeg -i -`), `split` into H.264
  (`h264_nvenc -preset p7 -tune hq -rc vbr -cq 16 -profile:v high -movflags +faststart`, or libx264
  crf 16) **and** AV1 (`libsvtav1 -preset 6 -crf 20 -g 120`). The AV1 copy decodes on builds without
  H.264 (Fedora ffmpeg-free, Resolve free on Linux). Respect stdin backpressure (await `drain`).
- **Tweens are thenables.** `tween(dur, fn, ease)` registers an animation. Fire-and-forget runs in
  parallel; `await tween(...)` must itself render frames until the tween ends (otherwise awaiting
  deadlocks: nothing advances time).

## 4. Live-app recorder: the look

**Camera** = CSS `transform: translate(tx,ty) scale(s)` on `#root` (`transform-origin: 0 0`),
`html, body { overflow: hidden }`, all cursors `none`. The page never scrolls; vertical movement is a
camera pan. `camTo(rect, {max = 1.8, pad = 48, dur = 1.6})`: scale = fit(rect + pad) clamped to
[1, max]. Interpolate **scale in log space** and the focus point linearly, eased with cubic in-out
`u < .5 ? 4u³ : 1 - (-2u+2)³/2`; start from the *visible* (post-clamp) camera so nothing jumps; clamp
tx/ty so no page edge ever shows. World coordinates = untransformed page CSS px; convert rects with the
current transform.

**Cursor**: a synthetic 26 px macOS-style arrow SVG (dark fill, 1.6 px white stroke, 2–3 px drop
shadow) in a fixed overlay *outside* `#root`, in world coordinates so it rides with the camera; scale
`1 + (camScale - 1) × 0.35`. Moves follow a **quadratic Bézier bowed 12%** of the distance,
alternating sides per move, eased cubic in-out; default duration `clamp(0.55 + dist/900, 0.8, 1.5)` s.
Each frame, also send `page.mouse.move` so real hover states and chart tooltips fire.
**Click**: press = `sin(πu)` over 0.25 s, scaling the cursor to 85%; a ripple ring grows 8→52 px
(ease-out cubic) and fades over 0.5 s, 2 px sky-400 border at 90% plus 18% fill; then
`page.mouse.click` at the screen point.

**Spotlight**: a fixed div over the target rect (+8–12 px padding), `border-radius: 16px`,
`box-shadow: 0 0 0 200vmax rgba(2,6,23,.58), 0 0 0 1.5px rgba(56,189,248,.55), 0 0 32px rgba(56,189,248,.25)`,
opacity 0→1 over 0.6 s; it slides between rects when retargeted. Use it only on the card being
narrated.

**Choreography grammar**: one camera move at a time (1.3–1.7 s). The camera settles before the cursor
acts, the cursor arrives ≥ 0.3 s before a click, nothing moves while a number is read, and every key
number holds ≥ 2.5 s. Open wide with a cursor fade-in, end with a 2 s pull-back to wide and a cursor
fade-out.

**Setup (not recorded)**:
1. **Rehearse** the whole map path once on a throwaway page in the same browser context, with a real
   clock, so every map tile is in the HTTP cache; otherwise fly-tos show black frames.
2. **Pre-roll** the recorded page into the opening state.
3. Locate click targets drawn on canvas (map markers) by **predicting the pixel** from known
   coordinates (Web Mercator maths), then refining by hit-testing the pointer cursor in a ±14 px grid.
   Hide other pointer-cursor layers while scanning.
4. If setup clicks scroll the page, `window.scrollTo(0, 0)` afterwards.

**Tour mode**: record actions that mutate data (uploads, recomputes, optimizer runs) against an
**isolated instance** (API + dashboard on other ports, pointed at a *copy* of the database). Start
the tour from the exact end state of the main demo (same basemap, same what-if applied) so the cut
between them is invisible.

## 5. Designed segments: the look

One HTML page per segment, 1600×900 stage, `window.__render(t)` a **pure function of t** (seconds),
plus optional `__ready()`, `__seek(t)` (video clips), `__warm()` (pre-cache) and
`__cues = [{t, run}]`. Scenes are absolutely positioned with `data-start` / `data-end`; opacity is a
crossfade of 0.22–0.25 s around each boundary (the first scene fades from black in 0.35–0.4 s).

- **Entrance** for every text/element: `appear(el, t, t0, dur = 0.55, rise = 18)` → opacity = u,
  `translateY((1-u)·rise)`, `blur((1-u)·6px)` with u = ease-out cubic. Stagger items 0.2–1.2 s apart.
  Blur masks the crossfade.
- **Count-ups**: numbers animate from 0 with ease-out over ~0.9–1.2 s.
- **Data motion**: bars grow with cubic in-out; lines draw via `stroke-dashoffset`; connectors and rails
  draw with `scaleX` from the left; backdrops push in slowly (scale 1.10 → 1.04 over the scene).
- **Maps**: MapLibre in the page with keyless Esri imagery; `flyTo` triggered by a cue, duration scaled
  by the segment's time-stretch; `__warm` flies once in real time to cache tiles, then resets.
- **Footage clips**: transcode to **all-keyframe VP9** (`-g 1`, crf 18, 30 fps), then seek
  `video.currentTime` per frame and await `seeked`. Treatments per clip: *vertical/low-res* → a sharp
  portrait panel (scaled only to ~780 px tall, `unsharp`, 1 px border) on the right, over a
  `gblur=38` darkened copy of itself filling 16:9, with text in the open left column; *watermarked* →
  crop the watermark corner out, keeping 16:9 (reads as part of a slow push-in). Always add a
  1.03 → 1.08 push-in and a dark gradient where text sits.
- **Time-stretch**: to lengthen a segment without re-authoring it, render with
  `__render(t / stretch)` and fire cues at `t / stretch ≥ cue.t`.

**Visual system** (match the app):
- Background `#0a0a0a`, ink `#e5e5e5` / `#a3a3a3` / `#737373`, lines `#262626`.
- Accents: amber `#f59e0b` (risk), sky `#38bdf8` (water/uncertainty), green `#22c55e` (recovery), red `#ef4444`.
- **Type roles**:
  - *Instrument Serif italic* only for the brand word, the subject in focus and outcomes (e.g. *+529 t recovered*).
  - *Inter Tight* for UI and headline stats (600, tabular numbers).
  - *JetBrains Mono* uppercase, 0.08em tracking, 10–15 px for labels, sources and "Illustrative" tags.

## 6. Assembly and voiceover

`assemble.mjs` checks each segment's duration with ffprobe (so an interrupted render is refused), trims
each to its exact slot (`trim=0:d,setpts=PTS-STARTPTS,fps=60`), concatenates, and encodes H.264 + AV1.
It then writes `full_voiceover.srt` from every beat table (`[ID] line`, ending 50 ms before the next
line). `voiceover.mjs` writes `VOICEOVER.md`: all lines in order with timecodes and
words-per-second per section.

## 7. QA loop (do this after every render)

- Beat report: every beat's actual time equals its planned time.
- **Contact sheets** of mid-beat frames (not beat starts), tiled 2×2 or 4×4 with timestamps; look at
  them, don't assume. Crop at full resolution to check small things (watermarks, tiny map features,
  clipped axis labels).
- Frames on both sides of **every seam** between segments.
- `ffprobe` duration and frame count; `ffmpeg -f null` a full decode of the AV1 file.
- Fact check: every on-screen number traced to its source or computed from the drawn data.
- If something the voiceover mentions isn't visible at that zoom, change the shot, not the words.

## 8. Mistakes this pipeline already hit

- **Awaiting a tween that nothing renders** deadlocks. Make `await tween()` render frames.
- `pkill -f "<pattern>"` also matches the shell running it; kill by port (`fuser -k PORT/tcp`) or PID.
- A stale headless Chromium from an earlier run hogs the GPU and makes new runs crawl.
- Playwright clicks **scroll elements into view**; reset the scroll before recording.
- Buttons outside the current camera framing get clicked off-screen and silently miss: frame the
  target (`camTo(union(area, button))`) before clicking.
- Map libraries: guards like `isStyleLoaded() ? apply() : once("load")` silently drop updates while
  tiles load. Track "loaded once" yourself.
- Free basemaps change terms (CARTO started watermarking without a key); prefer keyless Esri.
- Tests or recordings that upload data **mutate the dev database**; use copies.
- Canvas charts don't re-render when web fonts arrive: re-apply options after `document.fonts.ready`.
- Anything seeded "N days from today" goes stale: reseed on recording day.

## 9. Deliverables

1. The scripts above, committed.
2. `out/full_1080p60.mp4` + `_av1.mp4`, `out/full_voiceover.srt`, `VOICEOVER.md`.
3. A short README with the render order.

Report actual numbers (durations, beat timings, anything you couldn't verify) rather than claiming
success.
