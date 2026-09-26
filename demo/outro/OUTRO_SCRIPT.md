# Outro: Scale, impact, roadmap (1:50 → 2:18)

Picks up exactly where the demo ends (wide command center at 1:50). Three parts:

1. **Live tour of the other three tabs** (1:50–2:02), recorded against a *copy* of the database,
   because it uploads a CSV and re-runs kriging and the optimizer.
2. **Market impact** (2:02–2:08), from Indian Bureau of Mines figures.
3. **Roadmap and end card** (2:08–2:18).

```bash
# isolated instance for the tour (API :8011 + dashboard :5174 on a copy of moil.db)
cp moil.db /tmp/tour.db
PYTHONPATH=backend DATABASE_URL=sqlite:////tmp/tour.db venv/bin/python -m uvicorn app.main:app --port 8011 &
(cd web && VITE_API_URL=http://localhost:8011/api/v1 npx vite --port 5174 &)
curl -H "X-API-Key: change-me" localhost:8011/api/v1/ingest/template/production -o /tmp/production.csv

cd demo
TOUR_CSV=/tmp/production.csv node record.mjs --tour    # -> out/tour_1080p60.mp4 (1:50-2:02)
node record_segment.mjs outro                          # -> out/outro_1080p60.mp4 (2:02-2:18)
node assemble.mjs                                      # -> out/full_1080p60.mp4, the whole video
```

## Tour beats (the recorder reads these; times are absolute)

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| T1 | 1:50.0 | Wide command center (the demo's last frame). | Cursor appears and clicks the **Reserves** tab. | "And it scales across the whole portfolio:" |
| T2 | 1:51.4 | Push in on the reserve charts. | Click the cut-off box and set **30 % Mn**. | "re-krige every mine at any cut-off grade," |
| T3 | 1:52.9 | Hold. | **Click** *Recompute 3D kriging*: the grade histogram redraws. | — |
| T4 | 1:54.0 | Hold. | Cursor over the new histogram. | — |
| T5 | 1:55.3 | Pull back wide. | Click the **Actions** tab. | "rank actions across every mine," |
| T6 | 1:56.4 | Wide. | Over the top-ranked card, then **click** *Re-run optimizer*. | — |
| T7 | 1:58.6 | Wide. | Click the **Data adapter** tab. | "and plug in MOIL's own data:" |
| T8 | 1:59.6 | Push in on the adapter. | Click *Download sample CSV*, then drop the CSV on the upload box. | "five CSV streams, no code changes." |
| T9 | 2:01.2 | Settle on the refreshed database table. | Cursor fades. | — |
| END | 2:02.0 | — | — | — |

## Designed shots

| # | Time | Picture | VO |
|---|---|---|---|
| O1 | 2:02–2:08 | **Market impact.** 127 reporting manganese mines · 2.70 Mt mined · 6.50 Mt imported (2021–22). Big line: *1% of India's output recovered ≈ 27,000 t less to import.* | "Recover just one percent of India's output, and that's twenty-seven thousand tonnes we don't import." |
| O2 | 2:08–2:14 | **Roadmap**, three phases along a line: Pilot (0–3 months), Scale (3–9 months), Expand (9+ months). | "Next: a pilot on MOIL's live data, then every mine with satellite spectra, then other minerals." |
| O3 | 2:14–2:18 | **End card:** *MOIL Manganese Copilot*, the three-part promise, SIH 2026 · PS 26009. | "Where to explore. How much. How to hit the plan." |

**Numbers:** Indian Bureau of Mines, *Indian Minerals Yearbook 2022, Manganese Ore*: 127 reporting
mines, production 2,696 kt, imports 6.50 Mt (2021–22). 1% of 2,696 kt = 26,960 t ≈ 27,000 t.
