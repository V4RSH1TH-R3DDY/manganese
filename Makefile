# MOIL Manganese Copilot: local run (SQLite, no Docker).
#
#   make            set up, seed the demo data and start API + dashboard  (Ctrl-C stops both)
#   make help       list every target
#
# Re-run `make data` on the day you demo: the scripted storm is placed 3-5 days after the seed date.

API_PORT ?= 8000
WEB_PORT ?= 5173
API_KEY  ?= change-me
# --real-weather pulls ERA5 rainfall (falls back to simulated rain when offline)
SEED_FLAGS ?= --storm --real-weather

VENV := venv
PY   := $(VENV)/bin/python
BACK := PYTHONPATH=backend API_KEY=$(API_KEY)

.DEFAULT_GOAL := all

all: setup data run ## Everything: install, seed, train, precompute, then run

# ── setup ────────────────────────────────────────────────────────────────────
setup: $(VENV)/.installed web/node_modules/.installed ## Install Python + web dependencies

# Python 3.12: several ML wheels (lightgbm, shap, rasterio) lag behind newer Pythons.
$(VENV)/.installed: backend/requirements.txt
	@if command -v uv >/dev/null; then uv venv -q -p 3.12 --allow-existing $(VENV) && VIRTUAL_ENV=$(VENV) uv pip install -q -r $<; \
	else python3.12 -m venv $(VENV) && $(PY) -m pip install -q -r $<; fi
	@touch $@

web/node_modules/.installed: web/package-lock.json
	cd web && npm ci --silent
	@touch $@

# ── data + models ────────────────────────────────────────────────────────────
data: seed train deposits precompute ## Reseed demo data, retrain, build deposits, krige + score

seed: setup ## Wipe and reseed moil.db (synthetic ops + scripted storm)
	$(BACK) $(PY) -m scripts.seed_synthetic $(SEED_FLAGS)

train: setup ## Train the shortfall forecaster -> artifacts/shortfall.joblib
	$(BACK) $(PY) -m scripts.train_all

deposits: setup ## Build data/deposits.json (MRDS map layer) from the MRDS export
	$(PY) pipelines/build_deposits.py

precompute: setup ## Krige reserves for every mine and generate ranked actions
	$(BACK) $(PY) -m scripts.precompute

prosp: setup ## Optional: prospectivity heat-map (needs data/EMAG2_V3_UpCont_DataTiff.tif)
	@test -f data/EMAG2_V3_UpCont_DataTiff.tif || { echo "missing data/EMAG2_V3_UpCont_DataTiff.tif (download link in data/README.md)"; exit 1; }
	$(PY) pipelines/extract_features.py
	$(PY) pipelines/train_prospectivity.py
	$(BACK) $(PY) backend/scripts/predict_raster.py

# ── run ──────────────────────────────────────────────────────────────────────
run: setup ## Start API (:8000) + dashboard (:5173) together; Ctrl-C stops both
	@echo "API        http://localhost:$(API_PORT)/docs"
	@echo "Dashboard  http://localhost:$(WEB_PORT)"
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) --no-print-directory api & \
	$(MAKE) --no-print-directory web & \
	wait

api: setup ## Start only the API
	$(BACK) $(PY) -m uvicorn app.main:app --host 127.0.0.1 --port $(API_PORT)

web: setup ## Start only the dashboard
	cd web && VITE_API_URL=http://localhost:$(API_PORT)/api/v1 VITE_API_KEY=$(API_KEY) \
		npx vite --host 127.0.0.1 --port $(WEB_PORT) --strictPort

stop: ## Stop anything listening on the API / dashboard ports
	-@fuser -k $(API_PORT)/tcp $(WEB_PORT)/tcp 2>/dev/null; true

# ── checks ───────────────────────────────────────────────────────────────────
test: setup ## Backend tests on a throwaway copy of moil.db (the API tests upload CSVs)
	@test -f moil.db || { echo "moil.db missing: run 'make data' first"; exit 1; }
	@tmp=$$(mktemp --suffix=.db) && cp moil.db $$tmp && \
	$(BACK) DATABASE_URL=sqlite:///$$tmp $(PY) -m pytest -q -c backend/pytest.ini backend/tests; \
	status=$$?; rm -f $$tmp; exit $$status

build: setup ## Typecheck + production build of the dashboard
	cd web && npm run build

help: ## List targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

# ── Docker stack (Postgres; the API serves the map tiles itself) ─────────────
docker-up:   ; docker compose up -d
docker-down: ; docker compose down

.PHONY: all setup data seed train deposits precompute prosp run api web stop test build help docker-up docker-down
