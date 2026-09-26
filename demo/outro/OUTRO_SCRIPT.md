# Outro: Scale, impact, roadmap, team (2:34 → 3:30)

Picks up exactly where the demo ends (wide command center at 2:34). Three parts:

1. **Live tour of the other three tabs** (2:34–2:58), recorded against a *copy* of the database,
   because it uploads a CSV and re-runs kriging and the optimizer.
2. **Market impact** (2:58–3:07), from Indian Bureau of Mines figures.
3. **Roadmap, team and end card** (3:07–3:30).

```bash
# isolated instance for the tour (API :8011 + dashboard :5174 on a copy of moil.db)
cp moil.db /tmp/tour.db
PYTHONPATH=backend DATABASE_URL=sqlite:////tmp/tour.db venv/bin/python -m uvicorn app.main:app --port 8011 &
(cd web && VITE_API_URL=http://localhost:8011/api/v1 npx vite --port 5174 &)
curl -H "X-API-Key: change-me" localhost:8011/api/v1/ingest/template/production -o /tmp/production.csv

cd demo
TOUR_CSV=/tmp/production.csv node record.mjs --tour    # -> out/tour_1080p60.mp4 (2:34-2:58)
node record_segment.mjs outro                          # -> out/outro_1080p60.mp4 (2:58-3:30)
node assemble.mjs                                      # -> out/full_1080p60.mp4, the whole video
```

## Tour beats (the recorder reads these; times are absolute)

| ID | Time | Camera | Cursor / UI | VO |
|---|---|---|---|---|
| T1 | 2:34.0 | Wide command center (the demo's last frame). | Cursor appears and clicks the **Reserves** tab. | "The other tabs cover the whole portfolio." |
| T2 | 2:36.5 | Push in on the reserve charts. | Tooltip sweep across the five mines' P10 / P50 / P90 bars. | "Reserves: P10, P50 and P90 tonnes for every mine," |
| T3 | 2:40.5 | Hold. | Click the cut-off box and set **30 % Mn**. | "re-kriged at any cut-off grade." |
| T4 | 2:42.5 | Hold. | **Click** *Recompute 3D kriging*; cursor over the redrawn histogram. | "At a thirty percent cut-off, Balaghat holds 4.7 million tonnes." |
| T5 | 2:46.5 | Pull back wide. | Click the **Actions** tab. | "Actions ranks fixes across all mines," |
| T6 | 2:48.0 | Wide. | Over the blast and redeploy cards, then **click** *Re-run optimizer*. | "and re-runs the optimizer on demand." |
| T7 | 2:51.5 | Wide. | Click the **Data adapter** tab. | "The Data adapter is how MOIL plugs in —" |
| T8 | 2:53.0 | Push in on the adapter. | Over the required columns, click *Download sample CSV*, then drop the CSV on the upload box. | "download a template, drop in the CSV," |
| T9 | 2:56.5 | Settle on the refreshed database table. | Cursor fades. | "and forecasts refresh instantly." |
| END | 2:58.0 | — | — | — |

## Designed shots

| # | Time | Picture | VO |
|---|---|---|---|
| O1 | 2:58–3:07 | **Market impact.** 127 reporting manganese mines · 2.70 Mt mined · 6.50 Mt imported (2021–22). Big line: *1% of India's output recovered ≈ 27,000 t less to import.* | "India imports twice the manganese it mines. Recovering just one percent of output means twenty-seven thousand tonnes less to import." |
| O2 | 3:07–3:17 | **Roadmap**, three phases along a line: Pilot (0–3 months), Scale (3–9 months), Expand (9+ months). | "Our roadmap: a three-month pilot on MOIL's live data, then every MOIL mine with satellite spectra, then other minerals and miners, as a service." |
| O3 | 3:17–3:24 | **Team card:** *Chalcogens*: Sunidhi (Team Lead), Ananya, Varshith, Mukul, Charithra, Arjit. | "We're Team Chalcogens: Sunidhi, Ananya, Varshith, Mukul, Charithra and Arjit." |
| O4 | 3:24–3:30 | **End card:** *MOIL Manganese Copilot*, the three-part promise, Team Chalcogens · SIH 2026 · PS 26009. | "Where to explore. How much. How to hit the plan." |

**Numbers:** Indian Bureau of Mines, *Indian Minerals Yearbook 2022, Manganese Ore*: 127 reporting
mines, production 2,696 kt, imports 6.50 Mt (2021–22). 1% of 2,696 kt = 26,960 t ≈ 27,000 t.
