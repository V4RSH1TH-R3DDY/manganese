# Getting started: MOIL Manganese Copilot

Everything a new teammate needs to get the whole system running from a fresh clone, and to
understand every dataset and model it uses.

- [1. What you are running](#1-what-you-are-running)
- [2. Prerequisites](#2-prerequisites)
- [3. Quick start](#3-quick-start)
- [4. What `make` does, step by step](#4-what-make-does-step-by-step)
- [5. The data](#5-the-data)
- [6. The models](#6-the-models)
- [7. Optional: the prospectivity heat-map](#7-optional-the-prospectivity-heat-map)
- [8. Plugging in real MOIL data](#8-plugging-in-real-moil-data)
- [9. Configuration](#9-configuration)
- [10. API reference](#10-api-reference)
- [11. Project layout](#11-project-layout)
- [12. Tests and checks](#12-tests-and-checks)
- [13. Troubleshooting](#13-troubleshooting)

---

## 1. What you are running

Three questions, one pipeline:

| Stage | Question | Model | What you see in the app |
|---|---|---|---|
| A | **Where to look?** | Prospectivity classifier on EMAG2 magnetics | Heat-map on the Command center map |
| B | **How much is there?** | 3D ordinary kriging on drill-hole assays | Reserve P10/P50/P90 (KPI card, Reserves tab) |
| C | **Will we hit the plan?** | Quantile LightGBM shortfall forecaster | 7/14-day fan chart, risk level, "why output drops" |
| D | **What do we do about it?** | Rule-based actions + PuLP fleet optimizer | Recommended actions, "Simulate impact" what-if |

```
 browser :5173                     FastAPI :8000                          files
┌──────────────────┐   REST   ┌─────────────────────────┐   SQLAlchemy  ┌──────────────┐
│ React + Vite     │ ───────► │ /api/v1/...             │ ────────────► │ moil.db      │
│ MapLibre, ECharts│          │ services/ (risk,        │               │ (SQLite)     │
│ Tailwind         │ ◄─────── │ reserve, recommend)     │ ◄──── joblib ─│ artifacts/   │
└──────────────────┘          │ ml/ (features, synth,   │               │ data/        │
                              │ optimizer, registry)    │               └──────────────┘
                              └─────────────────────────┘
```

Stack: Python 3.12 · FastAPI · SQLAlchemy (SQLite) · LightGBM ·
PyKrige · PuLP · SHAP · rasterio · React 19 · Vite · MapLibre GL · ECharts · Tailwind 4.

---

## 2. Prerequisites

| Need | Version | Notes |
|---|---|---|
| GNU Make | any | Linux/macOS have it. On Windows, use WSL. |
| Python | **3.12** | Several ML wheels (LightGBM, SHAP, rasterio) lag behind newer Pythons. If you have [uv](https://docs.astral.sh/uv/), it fetches 3.12 for you, so there's no need to install it yourself. |
| Node.js | 20+ | For the dashboard. |
| Disk | ~2 GB | Python + Node dependencies. The optional heat-map adds ~250 MB. |
| Internet | first run | pip/npm packages, real rainfall (Open-Meteo, no key), map tiles (Esri, no key), fonts. The app itself runs offline after seeding; rainfall falls back to simulated if the fetch fails. |

No Docker, database server or `.env` file is needed for a local run.

---

## 3. Quick start

```bash
git clone git@github.com:V4RSH1TH-R3DDY/manganese.git
cd manganese
make            # install -> seed demo data -> train -> precompute -> start API + dashboard
```

Open **<http://localhost:5173>** (dashboard) and **<http://localhost:8000/docs>** (interactive API).
`Ctrl-C` stops both servers. From a clean clone, `make` takes a few minutes before the servers start: most of it is downloading packages; building the data takes about a minute.

Next time you only need `make run`. Re-run **`make data`** on the day you demo: the scripted storm
is placed 3–5 days after the seed date, so old data shows no storm and fewer actions.

`make help` lists every target:

| Target | What it does |
|---|---|
| `make` / `make all` | Everything: `setup`, `data`, `run` |
| `make setup` | Creates `venv/` (Python 3.12) and installs `web/node_modules` |
| `make data` | `seed` + `train` + `deposits` + `precompute` (≈1 minute) |
| `make seed` | Wipes and reseeds `moil.db` (synthetic ops + real rainfall + scripted storm) |
| `make train` | Trains the shortfall forecaster → `artifacts/shortfall.joblib` |
| `make deposits` | Builds `data/deposits.json` (MRDS map layer) |
| `make precompute` | Kriges reserves for all mines and generates ranked actions |
| `make prosp` | Optional heat-map pipeline (needs the EMAG2 grid, see §7) |
| `make run` / `api` / `web` | Start both servers / just the API / just the dashboard |
| `make stop` | Free ports 8000 and 5173 |
| `make test` | Backend tests (on a throwaway copy of `moil.db`) |
| `make build` | Typecheck + production build of the dashboard |

Ports and seed options can be overridden: `make run API_PORT=9000 WEB_PORT=5200`, or
`make data SEED_FLAGS=--storm` to skip the real-rainfall download.

---

## 4. What `make` does, step by step

| # | Step | Command it runs | Produces |
|---|---|---|---|
| 1 | Python env | `uv venv -p 3.12 venv` + `uv pip install -r backend/requirements.txt` (falls back to `python3.12 -m venv` + pip) | `venv/` |
| 2 | Web deps | `npm ci` in `web/` | `web/node_modules/` |
| 3 | Seed | `python -m scripts.seed_synthetic --storm --real-weather` | `moil.db` |
| 4 | Train | `python -m scripts.train_all` | `artifacts/shortfall.joblib`, prints accuracy |
| 5 | Deposits | `python pipelines/build_deposits.py` | `data/deposits.json` (130 sites) |
| 6 | Precompute | `python -m scripts.precompute` | reserve estimates + actions in `moil.db` |
| 7 | Run | uvicorn on :8000 and Vite on :5173 | the app |

Steps 1–2 only rerun when `backend/requirements.txt` or `web/package-lock.json` change.

---

## 5. The data

The demo mixes **real public data** with **clearly labelled synthetic operations data**. MOIL's
shift logs and drill logs aren't public. The badge in the app header shows the provenance of every
source (for example *"SCENARIO: WEATHER · SYNTHETIC: OPS, DRILLHOLES"*), so nothing synthetic is
ever presented as real.

| Dataset | Real or synthetic | Source | Where it lives | Rebuilt by |
|---|---|---|---|---|
| **Mines** | Real mines, approximate coordinates | 5 MOIL mines: Kandri, Mansar, Dongri Buzurg (opencast), Balaghat, Chikla | `moil.db → mines` | `make seed` |
| **Rainfall** | **Real** + scripted storm | ERA5 reanalysis history and Open-Meteo forecast (both keyless, via Open-Meteo), plus a scenario storm of 30 / 55 / 40 mm on days +3…+5 over Kandri, Mansar and Dongri Buzurg | `weather_daily` | `make seed` |
| **Production** | Synthetic, driven by the real rain | `backend/app/ml/synth.py`: daily planned vs actual from 1 Apr 2022, efficiency hit by soil wetness, heavy rain (opencast only), equipment availability and blast delays | `production_daily` | `make seed` |
| **Equipment** | Synthetic | 4 dumpers per mine; breakdown episodes last 3–10 days. One Balaghat dumper is forced down on the seed day, which is what triggers the redeploy action. | `equipment_units`, `equipment_daily` | `make seed` |
| **Blasts** | Synthetic | ~8% of days delayed | `blast_log` | `make seed` |
| **Drill holes + assays** | Synthetic | Per mine, an 8 × 8 grid of holes at 100 m spacing, 5 m assays down to 120 m (320 holes, 7,680 assays), sampled from a known Gaussian ore lens (peak 38–50% Mn, ~350 × 250 × 18 m). Because the truth is known, the reserve model can be checked against it. | `drillholes`, `assays` | `make seed` |
| **Manganese deposits** | **Real** | USGS Mineral Resources Data System (MRDS), India export; 130 manganese sites, 80 in the Nagpur–Bhandara–Balaghat belt | `data/sources/*.{txt,json}` (in git) → `data/deposits.json` | `make deposits` |
| **Magnetic anomaly grid** | **Real** | NOAA EMAG2 v3, upward-continued to 4 km (~229 MB) | `data/EMAG2_V3_UpCont_DataTiff.tif` | download, §7 |
| **National statistics** (pitch only) | **Real** | Indian Bureau of Mines, *Indian Minerals Yearbook 2022: Manganese Ore* | `docs/references/Manganese_Ore_2022.pdf` | — |

**Database tables** (`moil.db`, created automatically): `mines`, `equipment_units`,
`production_daily`, `equipment_daily`, `blast_log`, `weather_daily`, `drillholes`, `assays`,
`reserve_estimates`, `actions`, `data_provenance`.

`moil.db`, `artifacts/*.joblib` and everything under `data/` except `data/sources/` are
**gitignored and rebuilt by `make`**. Don't commit them.

---

## 6. The models

### A. Prospectivity: where to look

| | |
|---|---|
| **Code** | `pipelines/extract_features.py` → `pipelines/train_prospectivity.py` → `backend/scripts/predict_raster.py` |
| **Inputs** | 7 rasters derived from EMAG2 over 78.5–81°E, 21–22.5°N on a 0.01° (~1 km) grid: anomaly, x/y gradients, gradient magnitude, analytic signal, curvature, distance to magnetic contacts |
| **Labels** | Positive-unlabeled: the 80 MRDS belt deposits plus the MOIL mines (83 after de-duplication) as positives; 12× random background points at least 2.5 km from any positive as pseudo-negatives |
| **Method** | LightGBM classifier (180 trees, balanced classes), validated with **spatial block cross-validation**: 5 folds grouped by 0.25° (~28 km) blocks, so training and validation areas never touch. Random CV leaks neighbouring pixels and gives fake 0.99 AUCs. |
| **Result** | ROC-AUC **0.67**; the top 10% of the area captures **18%** of known deposits (1.8× random). Modest but honest; the stack is magnetics-only for now. |
| **Output** | `artifacts/prospectivity.joblib`, `data/cogs/prospectivity.tif` (Cloud-Optimized GeoTIFF). The API renders it into map tiles itself; no tile server needed. |

### B. Reserves: how much is there

| | |
|---|---|
| **Code** | `backend/app/services/reserve_service.py` |
| **Method** | 3D ordinary kriging (PyKrige) on all assays: spherical variogram, 250 m horizontal range, vertical anisotropy 12.5 (lenses are wide and thin), 64-point local neighbourhood, 35 × 35 × 5 m blocks, density 3.6 t/m³ |
| **Uncertainty** | 100 simulations of per-block noise from the kriging variance give P10 / P50 / P90 tonnes above the cut-off (default 25% Mn), plus a grade histogram. Blocks are treated as independent, so the range is **narrower than a full conditional simulation**; the UI says "approximate". |
| **Result** | On the synthetic lenses, the kriged tonnage is within **3–17%** of the known truth. About 3 s per mine. |
| **Runs** | `make precompute`, the Reserves tab (*Recompute* / *Re-krige*), or `POST /reserves/{code}/recompute` |

### C. Shortfall forecast: will we hit the plan

| | |
|---|---|
| **Code** | `backend/app/ml/features.py` (one feature builder shared by training and serving), `backend/scripts/train_all.py`, `backend/app/services/risk_service.py` |
| **Target** | Daily efficiency = actual / planned tonnes |
| **Features (13)** | rainfall today / 3 / 7 / 14 days, soil-wetness index (exponentially smoothed rain), equipment availability (last day, 7-day), breakdowns (30 d), blast delays (14 d), opencast flag, season (sin/cos of day of year), monsoon phase |
| **Models** | Three LightGBM quantile regressors (q10 / q50 / q90; 500 trees) give the fan chart. A LightGBM classifier gives P(efficiency < 0.9), shown as "P(shortfall > 10%)". |
| **Calibration** | Conformalized quantile regression: the band is widened by the margin that makes it cover 80% of a held-out calibration period. Held-out coverage goes from 0.71 raw to 0.77 calibrated (target 0.80). |
| **Split** | Time-based (last 20% of dates held out); `make train` prints pinball loss and coverage |
| **Explanations** | A counterfactual pass with availability set to 1.0 splits the loss into **weather vs equipment**; SHAP on the worst day gives the "top drags on output" |
| **Risk level** | red ≥ 12% expected shortfall, amber ≥ 5%, otherwise green |

### D. Actions and fleet optimizer: what do we do about it

| | |
|---|---|
| **Code** | `backend/app/services/recommend_service.py`, `backend/app/ml/optimizer.py` |
| **Blast advance** | Opencast mine with forecast rain ≥ 35 mm → bring blasts forward and pre-stock ore before the rain |
| **Maintenance** | 7-day availability < 80% → pull preventive maintenance forward |
| **Redeploy** | PuLP mixed-integer program: assign healthy dumpers to mines to maximise tonnes over 7 days, with a 10% transfer-loss penalty per moved unit, per-mine unit slots, a dumper ≥ 3 × excavator ratio, at most 2 moves, and a minimum 100 t gain to recommend anything |
| **What-if** | "Simulate impact" re-runs the forecast with the action applied. `RECOVERABLE = 0.40` (share of predicted loss an action wins back) is an **assumption to tune with MOIL**. |
| **Runs** | `make precompute`, *Re-run optimizer* on the Actions tab, `POST /actions/refresh`, ~10 s after every API start, and nightly at 06:00 IST (APScheduler) |

---

## 7. Optional: the prospectivity heat-map

Without it the app works fully; the *Prospectivity* toggle is just greyed out.

```bash
curl -L -o data/EMAG2_V3_UpCont_DataTiff.tif \
  https://www.ngdc.noaa.gov/geomag/data/EMAG2/EMAG2_V3_20170530/EMAG2_V3_20170530_UpCont.tif   # ~229 MB
make prosp      # extract features -> train (prints the spatial-CV metrics) -> data/cogs/prospectivity.tif
```

Restart the API (`make run`) and the heat-map and legend appear on the map. `make deposits` must have
run first (it does as part of `make data`), because the deposits are the training labels.

---

## 8. Plugging in real MOIL data

The **Data adapter** tab (or `POST /api/v1/ingest/{kind}` with header `X-API-Key`) accepts CSVs.
Each tab offers a downloadable template. Re-uploading the same dates updates rows rather than
duplicating them, and the upload is recorded in the provenance badge as "uploaded".

| kind | Required columns |
|---|---|
| `production` | `mine_code, date, planned_t, actual_t` |
| `weather` | `mine_code, date, rain_mm` |
| `blasts` | `mine_code, date, delayed` |
| `equipment` | `mine_code, unit_code, date, available_hours, scheduled_hours, breakdown` |
| `drillholes` | `mine_code, hole_code, lat, lon, collar_z, from_m, to_m, mn_pct` (optional `fe_pct`) |

Common variants are accepted (`mine`, `plan`, `rainfall`, `grade`, …), and mines can be given by
code (`DBZ`) or name (`Dongri Buzurg`). After uploading:

- **Forecasts refresh immediately.**
- **Reserves** need *Recompute* on the Reserves tab.
- **Actions** need *Re-run optimizer* on the Actions tab.
- **Retrain on real history** with `make train`.

For live operation set `DATA_MODE=live`: the scheduler then also pulls the Open-Meteo forecast every
morning at 05:30 IST, before the 06:00 action refresh.

---

## 9. Configuration

All optional. Set as environment variables or in a root `.env` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./moil.db` | SQLAlchemy URL. SQLite is what's tested; the Docker setup (`make docker-up`) uses Postgres (`postgresql+psycopg://…`) |
| `MODEL_DIR` | `./artifacts` | Where `*.joblib` models are read and written |
| `COG_PATH` | `/data/cogs/prospectivity.tif` | Heat-map raster (falls back to `data/cogs/prospectivity.tif`) |
| `API_KEY` | `change-me` | Required on `/ingest`, `/actions/refresh`, `/reserves/*/recompute`. **Change it for any shared deployment.** |
| `DATA_MODE` | `demo` | `live` enables the daily weather refresh |
| `CORS_ORIGINS` | `["*"]` | Allowed dashboard origins |

Dashboard (Vite, set by `make web`): `VITE_API_URL` (default `http://localhost:8000/api/v1`),
`VITE_API_KEY` (default `change-me`).

---

## 10. API reference

Base URL `http://localhost:8000/api/v1`; interactive docs at `/docs`. 🔑 = needs `X-API-Key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status, model loaded, provenance of every data source |
| GET | `/mines` | Mines with risk level, expected shortfall, reserve P50 |
| GET | `/mines/drillholes` | Drill-hole collars |
| GET | `/risk/{code}?horizon=7\|14` | Fan band, drivers, weather vs equipment split |
| GET | `/reserves/{code}` | Latest P10/P50/P90, mean grade, grade histogram |
| POST | `/reserves/{code}/recompute?cutoff=25` 🔑 | Re-run kriging |
| GET | `/actions?mine=` | Open actions ranked by expected tonnes |
| POST | `/actions/refresh` 🔑 | Regenerate all actions |
| POST | `/actions/{id}/simulate?horizon=7` | What-if forecast with the action applied |
| GET | `/prospectivity/meta` | Tile URL template + bounds (404 until `make prosp`) |
| GET | `/prospectivity/tiles/{z}/{x}/{y}.png` | Heat-map tiles |
| GET | `/prospectivity/deposits` | MRDS deposit points |
| GET | `/ingest/template/{kind}` 🔑 | Sample CSV |
| GET | `/ingest/records/{kind}` 🔑 | Latest rows |
| POST | `/ingest/{kind}` 🔑 | Upload a CSV (`production`, `weather`, `blasts`, `equipment`, `drillholes`) |

---

## 11. Project layout

```
Makefile              one-command setup / data / run
start_api.sh          same as `make api`, logs to backend.log
backend/
  app/
    api/v1/           thin routers (one file per resource)
    services/         risk, reserve, recommend, weather: the logic
    ml/               features (shared train/serve), synth, optimizer, registry, dataset
    jobs/scheduler.py nightly action refresh (+ weather in live mode)
    core/             config, db, API-key check
  scripts/            seed_synthetic, train_all, precompute, predict_raster
  tests/              pytest suite
pipelines/            extract_features, train_prospectivity, build_deposits, gee_extract (optional)
web/src/              pages/ (Overview, Reserves, Actions, Ingest), components/, lib/
data/                 sources/ (tracked MRDS exports); everything else is generated
artifacts/            trained models (generated)
demo/                 pitch-video tooling and scripts (see demo/README.md)
docs/                 references/ (IBM yearbook PDF), planning/ (historical design notes), media/
```

---

## 12. Tests and checks

```bash
make test       # 15 backend tests: optimizer, features, recommender, every API endpoint
make build      # TypeScript typecheck + production build of the dashboard
```

`make test` needs `moil.db` (run `make data` first) and works on a throwaway copy, so it never
changes your demo data. The heat-map test is skipped (not failed) until `make prosp` has run.

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No storm and few or no actions | The storm is placed 3–5 days after the **seed date** | `make data` |
| Badge says "UNKNOWN: …" | Database seeded before provenance tracking existed | `make data` |
| *Prospectivity* toggle greyed out; `/prospectivity/meta` 404 | Heat-map not built | §7, then restart |
| MRDS Deposits layer empty | `data/deposits.json` missing | `make deposits` |
| Forecast panels error; `/health` shows `model_loaded: false` | `artifacts/shortfall.joblib` missing (it's not in git) | `make train` (or `make data`) |
| `Address already in use` | A previous run is still up | `make stop`, or `make run API_PORT=… WEB_PORT=…` |
| pip fails to build LightGBM / SHAP / rasterio | Python newer than 3.12 | Install uv (it fetches 3.12), or `python3.12`; delete `venv/` and rerun `make setup` |
| "pulled 0 days of real rainfall" | No internet during seeding | Fine, it falls back to simulated rain; rerun `make data` online for real rainfall |
| Map tiles missing | Offline, or a firewall blocks `server.arcgisonline.com` | Needs internet for basemap tiles |
| *Recompute* is slow | You're on an old checkout | Current code kriges a mine in ~3 s; pull `main` |
| Tests fail with "no such table" | No `moil.db` yet | `make data` first |
