# MOIL Manganese Copilot: Prototype Demo Script

**Prototype walkthrough · 1:04 → 2:34 (90 s)**

This file is both the **shot list you voice over** and the **timing source for the recorder**.
`record.mjs` reads the beat table in section 3 (ID, start time, VO line) and hits every beat on
that exact frame. Change a time here, re-run the recorder, and the video follows.

Output: `demo/out/moil_demo_1080p60.mp4` (H.264), `demo/out/moil_demo_1080p60_av1.mp4` (AV1, for
Linux editors without H.264), and `demo/out/voiceover_guide.srt` (load it as a subtitle track so
each VO line appears when you should say it).

---

## 1 · Visual setup

The recorder drives a headless Chromium and captures the page itself: **no browser chrome, no OS
cursor, no notifications.**

| Setting | Value | Why |
|---|---|---|
| Viewport (CSS) | **1600 × 900** | The dashboard fills the frame edge to edge |
| Device scale | **2×** → captured at 3200 × 1800 | Zoom-ins up to ~1.8× stay sharp after downscaling |
| Output | 1920 × 1080 · 60 fps | Supersampled, so text is crisp |
| Timing | Virtual clock, stepped exactly 1/60 s per frame | Map flights, chart draws and tooltips are frame-perfect, however slow the render |
| Scrolling | Never; vertical moves are an eased camera pan | No browser scroll jumps |
| Cursor | Synthetic arrow, eased curved paths, press-squash + ripple on click | Moves like a person |
| Focus aid | Spotlight dims everything except the card being discussed | Used sparingly so it keeps its punch |

---

## 2 · Demo state (must be true before recording)

The storm is **scripted relative to the seed date** (D+3…D+5). Re-seed on the recording day:

```bash
make data     # reseed (real ERA5 rain + scripted storm), train, build deposits, krige, score
make prosp    # once: prospectivity heat-map (needs data/EMAG2_V3_UpCont_DataTiff.tif)
make run      # API :8000 + dashboard :5173
```

State this script was written against (seeded **26 Sep 2026**):

| Mine | Level | 7-day shortfall | Notes |
|---|---|---|---|
| **Dongri Buzurg** (opencast) | RED | 35.5 % · 2.5 kt at risk · P(>10 %) 64 % | Storm 29 Sep–1 Oct (30 / 55 / 40 mm); output falls from ~930 to ~320 t/day. 34 % weather, 1.5 % equipment. Action: *Advance blasting and pre-stock ore before the 30 Sep rain window* → **+529 t**, 35.5 % → 27.9 % |
| **Balaghat** | RED | 15.7 % | Equipment-driven (7-day availability 50 %). Action: *Redeploy 1 healthy unit(s) to Balaghat* (dumper DBZ-D1) → **15.7 % → 9.5 %**, RED → AMBER |
| Chikla, Kandri, Mansar | AMBER | 5–6 % | |

Reserve P50, Dongri Buzurg: **8.54 Mt** (P10–P90 8.26–8.89 Mt, mean grade 31.2 % Mn). The synthetic
orebody's true tonnage is ~7.5 Mt, so the kriged P50 is within ~14 %.

If you re-seed on another day, check `demo/out/cues_demo/*.jpg` and update the numbers in the VO lines.
If the Redeploy card lands on a different mine, run the recorder with `REDEPLOY_MINE=<name>`.

---

## 3 · Beat sheet

Times are **absolute video time** (1:04–2:34 in the final cut); the recorder subtracts 1:04. VO
lines are sized at ~2.3 words/second to fit their beat.

**Camera grammar:** one eased move at a time (cubic in-out, 1.3–1.7 s). The camera settles before
the cursor acts, the cursor settles before it clicks, and nothing moves while a number is read out.

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| A1 | 1:04.0 | Wide command center: prospectivity heat-map and MRDS deposit dots over the dark basemap. | Cursor fades in and glides to the mine names in the red alert. | "The Command Center: five MOIL mines, and this week's risks flagged up top." |
| A2 | 1:09.0 | Push in on the map (~1.3×). | Cursor to the map legend; spotlight on it. | "Where to look: magnetic data ranks prospective ground, matching 130 known manganese sites." |
| D1 | 1:15.0 | Map (as A2). | Glides to the blue **Bharweli** dot and **clicks**: its USGS record pops up (past producer, hollandite ore, quartzite / phyllite host rock). | "Each blue dot is a real USGS record, like Bharweli, a past-producing manganese mine." |
| A3 | 1:21.0 | Map. | Glides to the red **Dongri Buzurg** marker; **click** at 1:22.6 (popup, map flies in). | "Click Dongri Buzurg, an open-pit mine at risk." |
| A4 | 1:25.0 | Map + basemap switcher in frame. | **Click** *Satellite*: imagery appears under the heat-map. | "Switch to satellite imagery, and the heat-map sits on real terrain." |
| A5 | 1:30.0 | Glide to the KPI grid (~1.8×); spotlight **Reserve P50**. | Cursor under "8.26 Mt – 8.89 Mt". | "How much is there: kriged drill assays give 8.5 million tonnes at P50, with a range." |
| B1 | 1:37.0 | Spotlight **Expected shortfall**, then **P(shortfall > 10 %)**. | Cursor to "35.5 %", then "64 %". | "Next week it's forecast to miss plan by thirty-five percent." |
| B2 | 1:42.0 | Pan down to the **Production forecast** fan chart (~1.4×). | Slow day-by-day tooltip sweep, lingering on 29 Sep–1 Oct. | "Here's why. A storm hits on the thirtieth. Rain bars drop from the top, expected output falls to a third of plan, and the shaded band shows how uncertain that forecast is." |
| B3 | 1:56.0 | Glide to **Why output drops** + **Top drags**, spotlight. | Cursor down the three drivers. | "The engine splits the loss: here it's weather, driven by soil wetness, open-pit exposure and rainfall." |
| C1 | 2:03.0 | Glide to the **Recommended actions** card (~1.45×). | Cursor over the title and its three steps, then to *Simulate impact*. | "So it recommends advancing blasts and pre-stocking ore before the rain." |
| C2 | 2:08.0 | Hold. | **Click** *Simulate impact*. | "Simulate it —" |
| C3 | 2:08.5 | Pull back to chart + actions (1.0×). | Green **After action** line draws over the storm days. | "the green line is the output recovered." |
| C4 | 2:12.0 | Push in on "**+529 t recovered**" (serif italic), spotlight. | Cursor rests beside it. | "About five hundred and thirty tonnes won back, before the storm even arrives." |
| C5 | 2:17.0 | Glide to the mine chips. | **Click** *Balaghat* at 2:18.4. | "It also balances the fleet across mines." |
| C6 | 2:21.0 | Glide to the **Redeploy** card, spotlight. | Cursor down "Move DBZ-D1: DBZ → BLG", then to *Simulate impact*. | "Balaghat is short on dumpers, so the optimizer moves one over from Dongri Buzurg." |
| C7 | 2:26.5 | Hold. | **Click** *Simulate impact*. | "Simulate —" |
| C8 | 2:27.0 | Glide to the KPI grid; spotlight **Expected shortfall**, now green. | Cursor rests on it. | "and Balaghat drops from sixteen percent to under ten." |
| C9 | 2:31.5 | Slow pull back to the full command center (2 s). | Cursor fades out. | — |
| END | 2:34.0 | Clean wide frame. | — | — |

---

## 4 · Motion rules (baked into the recorder)

- **Cursor:** 0.5–1.4 s per move, cubic ease-in-out along a gentle arc (~12 % bow). Never moves
  while a number is being read.
- **Clicks:** press = 0.25 s squash to 85 % plus a sky-blue ripple (0.5 s fade).
- **Camera:** scale interpolated in log space so zooms feel linear; focus and scale move together.
  Range 1.0–1.8×.
- **Spotlight:** only on the card being talked about.
- **Holds:** every key number stays still for ≥ 2.5 s.

---

## 5 · Honesty notes for this cut

| On screen | Say it this way |
|---|---|
| Prospectivity heat-map | "Magnetic data **ranks where to explore**." Never "finds manganese". It is magnetics-only for now; spatially cross-validated AUC is 0.67 (captures 18 % of known deposits in the top 10 % of area vs 10 % at random). The map also shows those training deposits, so it naturally highlights them. |
| Reserves | Synthetic drill data. The P50 is within ~3–17 % of the synthetic truth, but the P10–P90 range is too narrow (the UI says "approximate"). |
| Shortfall / actions | Ops data is synthetic, rainfall is real ERA5 plus a scripted storm, and the badge says so. The 40 % recoverable share behind each action is an assumption to tune with MOIL. |

---

## 6 · Re-recording

```bash
cd demo && npm install && npx playwright install chromium   # once
node record.mjs                                             # full 1080p60, about 5 min
node record.mjs --preview                                   # quick 30 fps, 1× DPR check
```

The recorder prints each beat's actual time next to the planned time here, and saves one still per
beat to `demo/out/cues_demo/` so you can check every number before the voiceover session.
