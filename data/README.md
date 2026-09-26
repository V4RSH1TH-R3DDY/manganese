# Data directory

Everything here is **downloaded or derived** and is deliberately kept out of git
(see the root `.gitignore`), except the small MRDS exports in `sources/`, which are tracked. This file documents how to re-fetch it, so a fresh
clone can rebuild the full pipeline.

| Path | What | Size | Where it comes from |
|---|---|---|---|
| `EMAG2_V3_UpCont_DataTiff.tif` | EMAG2 v3 magnetic anomaly grid, upward-continued to 4 km | ~229 MB | <https://www.ncei.noaa.gov/products/earth-magnetic-model-anomaly-grid-2> |
| `sources/mrds-fIN.txt` | USGS MRDS deposit points for India, all commodities (manganese is filtered by `build_deposits.py`) | ~360 KB | <https://mrdata.usgs.gov/mrds/> (filter: country = India) |
| `sources/fulltext-search.json` | USGS MRDS full-text search export (manganese) | ~712 KB | <https://mrdata.usgs.gov/mrds/> full-text search |
| `deposits.json` | Manganese sites for the map layer and prospectivity labels | ~60 KB | Built by `pipelines/build_deposits.py` |
| `features/*.tif` | Co-registered model input rasters, one band each | small | Built by `pipelines/extract_features.py` |
| `interim/` | Scratch space for pre-COG rasters | small | Built by `backend/scripts/predict_raster.py` |
| `cogs/prospectivity.tif` | Cloud-Optimized GeoTIFF served to the map | small | Built by `backend/scripts/predict_raster.py` |
| `raw/` | Landing zone for MOIL operational CSVs | — | Not public; see the ingest schema in the root `README.md` |

## Rebuild order

```bash
# 1. put EMAG2 in data/ (link above); the MRDS exports are already in data/sources/
python pipelines/build_deposits.py            # -> data/deposits.json
python pipelines/extract_features.py          # -> data/features/*.tif
python pipelines/train_prospectivity.py       # -> artifacts/prospectivity.joblib
python backend/scripts/predict_raster.py      # -> data/cogs/prospectivity.tif
```

## Provenance note

The prospectivity feature stack is currently **magnetics-only** (all seven
rasters are EMAG2 derivatives: anomaly, gradients, gradient magnitude, analytic
signal, curvature, distance-to-contact). Deposit labels come from MRDS, which
makes this positive-unlabeled learning. No optical satellite features
(Sentinel-2 / ASTER band ratios, DEM derivatives) are in the stack yet.
