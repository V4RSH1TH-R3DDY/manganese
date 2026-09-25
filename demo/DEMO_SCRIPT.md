# MOIL Manganese Copilot: Prototype Demo Script

**Slide 4 · Live prototype · 0:50 → 2:00 (70 s)**

This file is both the **shot list you voice over** and the **timing source for the recorder**.
`record.mjs` reads the beat table below (ID, start time, VO line) and drives the camera to hit
every beat on that exact frame. If you change a time here and re-run the recorder, the video follows.

Output: `demo/out/moil_demo_1080p60.mp4` (1920×1080, 60 fps, silent), plus
`demo/out/voiceover_guide.srt`. Load the SRT as a subtitle track in your editor, so each VO line
appears exactly when you should say it.

---

## 1 · Visual setup: "native app, zero clutter"

The recorder doesn't record your screen. It drives a headless Chromium and captures the page
itself. So there's **no browser chrome at all**: no tabs, no URL bar, no bookmarks, no
"controlled by automated software" bar, and no OS cursor or notifications.

| Setting | Value | Why |
|---|---|---|
| Viewport (CSS) | **1600 × 900** | The app's `max-w-[1400px]` layout fills the frame with slim margins. At 1920 wide, the dashboard floats in dead space. |
| Device scale factor | **2×** → captured at 3200 × 1800 | Zoom-ins up to ~1.8× stay razor sharp after downscaling to 1080p. |
| Output | 1920 × 1080 · 60 fps · H.264 (NVENC, CQ 16) | Standard editor timeline. Supersampled, so text is crisp. |
| Timing | Virtual clock, stepped exactly 1/60 s per frame | MapLibre fly-tos, ECharts line draws and tooltips are frame-perfect. No dropped frames, however slow the render. |
| Scrollbars | Hidden. The page never "scrolls". | Vertical movement is a camera pan (eased), not a browser scroll jump. |
| Cursor | Synthetic macOS-style arrow with soft shadow, eased curved paths, press-squash + ripple on click | The real pointer is invisible in headless capture. This one moves like a person, not a robot. |
| Focus aid | "Spotlight": everything except the target card dims to 55 % | Used on 5 beats only, so it stays meaningful. |

**If you ever record by hand instead** (OBS etc.):
- Launch Chrome in app mode: `google-chrome --app=http://localhost:5173 --window-size=1600,900`
  (no tabs or URL bar), then press `F11` for full screen.
- Use a clean profile: `--user-data-dir=/tmp/demo-profile` (no extensions, bookmarks or sign-in bubbles).
- Turn on OS Do-Not-Disturb, hide the dock/taskbar, and set cursor size to 1.5×.
- Keep the page at 100 % zoom and do the zooms in post (Screen Studio, or DaVinci keyframes on a 4K capture).

---

## 2 · Demo state (what must be true before recording)

The storm is **scripted relative to the seed date** (D+3…D+5). **Re-seed on the day you record**,
or the storm will have "passed" and the blast-advance action won't appear.

```bash
# from repo root (SQLite mode, no Docker needed)
cd backend && export PYTHONPATH=. DATABASE_URL=sqlite:///../moil.db MODEL_DIR=../artifacts
../venv/bin/python -m scripts.seed_synthetic --storm && ../venv/bin/python -m scripts.train_all && cd ..
PYTHONPATH=backend venv/bin/python -m uvicorn app.main:app --port 8000 &     # API
(cd web && npx vite --port 5173 &)                                           # UI
for m in KDR MNS DBZ BLG CHK; do curl -s -X POST localhost:8000/api/v1/reserves/$m/recompute -H "X-API-Key: change-me" >/dev/null; done
curl -X POST localhost:8000/api/v1/actions/refresh -H "X-API-Key: change-me"   # expect {"actions":3}
```

Expected state (seeded 25 Sep 2026):

| Mine | Level | Shortfall (7 d) | Notes |
|---|---|---|---|
| **Dongri Buzurg** (opencast) | RED | 38.1 % · 2.7 kt at risk | Storm 28–30 Sep (57/55/51 mm). Action: *Advance blasting and pre-stock ore*, **+618 t** → 29.2 % |
| **Mansar** | RED | 28.5 % | Equipment-driven (avail 59 %). Action: *Redeploy 4 healthy unit(s) to Mansar*, which moves the dumpers DBZ-D1…D4 → MNS. What-if → **5.7 %** (RED → AMBER) |
| Balaghat, Chikla, Kandri | AMBER | 6–8 % | |

Reserve P50 for Dongri Buzurg: **1.71 Mt** (P10–P90 1.26–2.25 Mt, mean grade 32 % Mn).

Numbers change if you re-seed on another day. Check the frames in `demo/out/cues/` and update the
VO lines if any number moved.

---

## 3 · Beat sheet: the 70-second flow

Times are **absolute video time** (the demo sits at 0:50–2:00 in the final cut). The recorder
subtracts 0:50. Keep VO lines around 2.3 words/second so they land inside the beat.

**Camera grammar:** every move is one eased motion (cubic in-out, 1.3–1.8 s). The camera settles
**before** the cursor acts, the cursor settles **before** it clicks, and nothing moves while a
number is being read out.

### Segment A: Interactive GIS map ("where to look, how much is there")

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| A1 | 0:50.0 | Wide, full command center, static. Map shows all 5 MOIL mines over Esri satellite imagery, colour-coded by risk. | Cursor fades in bottom-centre, glides to the red alert banner. | "This is the MOIL Manganese Copilot: one command center for all five mines." |
| A2 | 0:52.6 | Push in on the map, 1.0 → ~1.5×, 1.6 s. | Glides to the red **Dongri Buzurg** marker and rests. | "Satellite imagery and geology rank where to look." |
| A3 | 0:55.0 | Hold. | **Click** the marker: ripple, popup (*Shortfall 38.1 % · Reserve P50 1.71 Mt*), map flies in. The right panel switches to Dongri Buzurg. | "Click a mine and it's live." |
| A4 | 0:56.4 | Hold camera. The *map* zooms instead (scroll-zoom, ~3 s) into the satellite terrain around the deposit. | Cursor steady on the mine: the zoom anchors on it. | "We zoom straight into the deposit area…" |
| A5 | 0:59.4 | Hold on satellite detail. | Tiny drift, no clicks. | "…and drill-hole assays tell us how much is there." |
| A6 | 1:01.4 | Camera glides to the KPI grid (~1.8×). | Cursor moves to **Reserve P50**. | "Kriging on the assays gives a reserve with honest uncertainty:" |
| A7 | 1:03.0 | Spotlight on the Reserve P50 card. Hold 6 s. | Cursor rests under "1.26 Mt – 2.25 Mt". | "one-point-seven million tonnes at P50, with a P10-to-P90 range, not a single guess." |

### Segment B: Predictive shortfall engine ("will we hit the plan?")

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| B1 | 1:09.6 | Same framing; spotlight slides to **Expected shortfall**. | Cursor → "38.1 %". | "Now the real question: will we hit the plan? For the next seven days, Dongri Buzurg is forecast to miss by thirty-eight percent," |
| B2 | 1:13.0 | Spotlight slides to **P(shortfall > 10 %)**. | Cursor → "67 %". | "with a sixty-seven percent chance of a serious dip." |
| B3 | 1:15.0 | Spotlight off. Camera pans down to the **Production forecast** fan chart, ~1.4×. | Cursor enters the chart at the first day. | "Here's why." |
| B4 | 1:17.0 | Hold on chart. | Slow day-by-day sweep, one tooltip at a time (Plan / Expected / Range / Rain). Lingers on **28–30 Sep**: 57 mm rain, output falls from ~950 to ~360 t/day. | "A storm hits on the twenty-eighth. Rain bars drop from the top, the expected line falls to a third of plan, and the amber band shows our uncertainty." |
| B5 | 1:25.5 | Camera glides up-right to **Why output drops**, spotlight. | Cursor on the blue weather bar. | "The engine separates weather from equipment: this loss is weather-driven…" |
| B6 | 1:28.5 | Spotlight slides to **Top drags on output**. | Cursor down the three drivers. | "…open-cast exposure, soil wetness from satellite moisture data, and three-day rainfall." |

### Segment C: AI action optimizer ("what do we do about it?")

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| C1 | 1:34.0 | Spotlight off. Camera glides to **Recommended actions** (~1.45×). | Cursor traces the title, then the three steps. | "So the copilot recommends: advance blasting and pre-stock ore before the rain window." |
| C2 | 1:38.2 | Hold. | Cursor → **Simulate impact**; **click** at 1:39.0. | "Simulate it —" |
| C3 | 1:39.4 | Camera pulls back to chart + actions (1.0×). | Green **After action** line draws over the storm days. | "— and the green line shows the recovered output." |
| C4 | 1:41.6 | Push in on "**What-if active · +618 t recovered**", spotlight. | Cursor rests beside it. | "Six hundred tonnes won back before the storm arrives." |
| C5 | 1:44.6 | Spotlight off. Camera to the mine chips. | Cursor → **Mansar**, **click** at 1:46.0; map flies to Mansar. | "Across mines, it optimises the fleet." |
| C6 | 1:47.0 | Camera to the redeploy card, spotlight. | Cursor down "Move DBZ-D1: DBZ → MNS" … | "Mansar is short on working equipment, so the optimizer redeploys four dumpers that would sit idle in Dongri's rain." |
| C7 | 1:50.4 | Hold. | **Click** *Simulate impact* on the redeploy card. | "Simulate —" |
| C8 | 1:51.2 | Camera glides to the KPI grid; spotlight on **Expected shortfall**, now green. | Cursor rests on it. | "— Mansar's shortfall drops from twenty-eight percent to under six." |
| C9 | 1:55.5 | Slow pull back to the full command center (2 s). Spotlight off. | Cursor fades out. | "Where to mine, how much, and how to hit the plan: in one screen." |
| END | 2:00.0 | Clean wide frame (hold). | — | — |

---

## 4 · Motion rules (baked into the recorder)

- **Cursor speed:** 0.9–1.5 s per move, cubic ease-in-out along a gentle arc (≈12 % bow), never a
  straight robotic line. It never moves while a number is being read out.
- **Clicks:** land ≥ 0.4 s after the cursor arrives. Press = 0.25 s squash to 85 %, plus a sky-blue
  ripple (40 px, 0.45 s fade).
- **Camera:** scale is interpolated in log space, so the zoom *feels* linear; focus point and scale
  move together in one cubic in-out. Zoom range is 1.0–1.8×, never more (beyond that the UI looks cropped).
- **One idea per frame:** the spotlight dims everything except the card being talked about. It's used
  on only 7 beats, so it keeps its punch.
- **Holds:** every key number stays still for ≥ 2.5 s. Viewers need ~1 s to find it and ~1 s to read it.

---

## 5 · Differences from the original brief (honest notes)

| Brief said | Prototype actually does | Why |
|---|---|---|
| Toggle a high-probability **prospectivity layer** on the map | Not shown. The layer needs real co-registered feature GeoTIFFs + TiTiler (`scripts/predict_raster.py`), which this repo doesn't have. The map shows satellite imagery + risk-coloured mines. The *Prospectivity* checkbox is present but does nothing yet, so the demo never touches it. | We don't fake a prospectivity heat-map. The README's own honesty notes say satellites give *indicators*, not manganese. |
| Recommendation **modal** pops up | Actions are **inline cards** under "Recommended actions" | That's the real UI. The spotlight gives the same "pop" focus without inventing a modal. |
| *"Reallocate Dumpers to Block 4"* | *"Redeploy 4 healthy unit(s) to Mansar"* (dumpers DBZ-D1…D4) | Exact text generated by the PuLP optimizer from the seeded data. |
| Live production data | Synthetic ops data, disclosed by the **SYNTHETIC DEMO DATA** badge (kept in frame) | Say it if asked: "The CSV data adapter takes MOIL's real feeds." |

---

## 6 · Re-recording

```bash
cd demo && npm install            # once (Playwright)
npx playwright install chromium   # once
node record.mjs                   # full 1080p60 render, about 5 min
node record.mjs --preview         # quick 30 fps, 1× DPR check, about 1.5 min
```

The recorder prints each beat's actual frame time next to the planned time from this file, and saves
one still per beat to `demo/out/cues/` so you can check every number before the voiceover session.
